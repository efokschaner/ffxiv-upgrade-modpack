import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack, upgradeModpack, writeModpack } from "../../src/index";
import { readZip } from "../../src/zip/zip";
import { packHasFileSwaps } from "./archive-redirects";
import { oracleKey } from "./oracle";
import { pmpSelfConsistency } from "./pmp-self-consistency";
import { diffArchives } from "./upgrade-archive-diff";
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./upgrade-baseline";
import { confirmDivergence } from "./upgrade-compare";
import { diffUpgrade } from "./upgrade-diff";
import { upgradeGoldenCached } from "./upgrade-golden";

// Set UPDATE_UPGRADE_BASELINE=1 to (re-)record each pack's baseline to its current actual diff.
const BLESS = process.env.UPDATE_UPGRADE_BASELINE === "1";

/** Assert our port matches a ConsoleTools /upgrade oracle ERROR: a matched failure is a PASS (our
 * upgrade must throw where TexTools throws); our upgrade SUCCEEDING is a divergence -> loud fail.
 * Exported for unit testing (test/helpers/corpus-upgrade.test.ts). See spec §3 +
 * docs/backlog/2026-07-11-expected-failure-golden.md. */
export function assertMatchedUpgradeFailure(
  name: string,
  oracleMessage: string,
  runUpgrade: () => void,
): void {
  let ourError: unknown;
  try {
    runUpgrade();
  } catch (e) {
    ourError = e;
  }
  if (ourError === undefined) {
    expect.fail(
      `${name}: ConsoleTools /upgrade errored but our upgrade SUCCEEDED — divergence.\n` +
        `Oracle error was:\n${oracleMessage}`,
    );
  }
  // Verify a MATCHED REASON, not just "both threw": our port reproduces ConsoleTools' exact error
  // strings, so our thrown message must appear within the oracle's captured trace. A compound
  // regression that throws a DIFFERENT error on this pack (e.g. the pre-round stops throwing and a
  // later round throws for another reason) fails here instead of passing silently.
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  const ourMessage =
    ourError instanceof Error ? ourError.message : String(ourError);
  const ourNorm = norm(ourMessage);
  if (ourNorm.length === 0 || !norm(oracleMessage).includes(ourNorm)) {
    expect.fail(
      `${name}: our upgrade threw, but its error does not match the oracle's — a matched failure ` +
        `must be the SAME error our port reproduces from TexTools.\nOur error:\n${ourMessage}\n\n` +
        `Oracle error:\n${oracleMessage}`,
    );
  }
  console.log(
    `[upgrade] ${name}: matched expected failure (oracle + our port both error).`,
  );
}

// End-to-end golden check: our upgrade pipeline vs the cached ConsoleTools /upgrade output,
// diffed per gamePath on decompressed content, exact-byte except for confirmed intentional
// divergences, ratcheted against a gitignored per-pack baseline (see the harness design spec).
export function registerUpgradeCheck(pack: string): void {
  const name = basename(pack);
  describe(`upgrade golden: ${name}`, () => {
    it("matches ConsoleTools /upgrade within the ratchet baseline", () => {
      const bytes = new Uint8Array(readFileSync(pack));
      // ONE load of the source, reused three ways below (upgrade input, no-op reference, and the
      // source ExtraFiles key set). Safe because upgradeModpack cloneModpack()s and never mutates
      // its argument (src/upgrade/upgrade.ts). Re-loading cost ~3s per big PMP, three times over.
      const source = loadModpack(name, bytes);
      const golden = upgradeGoldenCached(name, bytes);
      if (golden === null) {
        throw new Error(
          `No /upgrade golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.upgrade-cache.`,
        );
      }
      // The oracle itself errored on this pack (e.g. ModpackUpgrader's Highlight/Visibility
      // "unresolveable" throw). A MATCHED failure is a PASS: our port must refuse exactly the packs
      // TexTools refuses. Our upgrade SUCCEEDING here is a divergence -> loud fail. (Deliberately
      // unlike corpus-resave.ts's loud-skip: a /resave oracle error is environmental — a TexTools
      // CMP-read crash unrelated to our port — whereas a /upgrade oracle error is transform logic
      // our port is expected to reproduce. See spec §3 + docs/backlog/2026-07-11-expected-failure-golden.md.)
      if (golden.kind === "error") {
        assertMatchedUpgradeFailure(name, golden.message, () =>
          upgradeModpack(source),
        );
        return;
      }
      const oursModel = upgradeModpack(source);
      // A no-op upgrade writes no golden; the correct reference is the original input, so this
      // still exercises our whole load->upgrade->reduce->serialize pipeline end to end.
      const reference = golden.kind === "noop" ? source : golden.data;
      const goldenBytes = golden.kind === "noop" ? bytes : golden.bytes;

      // Exercise the real writer on the oracle path (audit blind spot #5): the archive it produces
      // now feeds BOTH the structure/manifest diff below AND the payload diff (see next comment) —
      // the payload diff used to run on the in-memory model and so was blind to the writer entirely.
      // See the parity design spec.
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
      // store: the archive we write here is only ever re-READ (below, and by diffArchives /
      // pmpSelfConsistency), and nothing compares its compressed bytes — so DEFLATE-ing it is work
      // whose only consumer immediately inflates it again. See writePmp's doc comment.
      const oursArchive = writeModpack(oursModel, target, { store: true });
      // Diff the ARTIFACT WE SHIP, not the in-memory model. Feeding `oursModel` here made every
      // writer bug invisible by construction: a file the writer emits with no `Files` key naming it
      // is a perfectly good file in the model and an unreachable orphan in the pack. Re-reading
      // closes that gap — such a file comes back as an ExtraFile, drops out of `allFiles`, and its
      // gamePath shows as `added` against the golden. (It also puts the whole write->read round-trip
      // under the golden oracle for free.)
      // Re-read under the WRITTEN format (`target`), NOT the source `name`: our writer folds the
      // whole TTMP family to ttmp2 (there is no legacy-.ttmp writer), so a legacy `.ttmp` source is
      // written as ttmp2. Re-reading it under the `.ttmp` name would send the ttmp2 zip to
      // readLegacyTtmp, which silently yields an EMPTY pack — making every file show as `added`
      // against the golden (a whole-pack phantom divergence). The golden side already folds this way
      // (upgrade-golden.ts goldenExt). See docs/backlog/2026-07-17-harness-legacy-ttmp-reread-format.md.
      const oursReRead = loadModpack(`ours.${target}`, oursArchive);

      const payload = diffUpgrade(
        name,
        oursReRead,
        reference,
        confirmDivergence,
      );
      // Two INDEPENDENT reasons the zip layout cannot match member-for-member, either of which
      // re-keys the payload comparison to the Penumbra redirect table (gamePath -> content).
      //
      //  (a) FileSwaps in the INPUT pack. The gate comes from the input, not `ours` or the golden —
      //      PopulatePmpStandardOption (PMP.cs:873-875) has already destroyed the golden's swaps by
      //      the time we'd read it here, so gating on the golden would never fire. See the
      //      FileSwap-preservation spec, §5.2.
      //
      //  (b) A DEFAULT-ONLY PMP on the NO-OP branch. ConsoleTools wrote no archive at all, so the
      //      reference above is the UNTOUCHED INPUT PACK — laid out by Penumbra, never by TexTools'
      //      writer. For a PMP with NO GROUPS that layout provably cannot match ours: TexTools'
      //      loader synthesizes a lone group named "Default" (FromPmp, WizardData.cs:1118-1138),
      //      MakeGroupPrefix folder-safes it to `default/` (:1390-1400), and every member comes out
      //      one folder deeper than the raw input's. `torn bassment glow.pmp` is the pack that
      //      exposed this — 12 added + 12 removed, purely from a prefix we emit CORRECTLY. Verified
      //      against the write-side oracle: ConsoleTools /resave on that same pack emits
      //      `default/chara/equipment/e0246/...`, byte-identical to ours, and its /resave baseline
      //      records no name divergence at all.
      //
      //      Scoped to the default-only SHAPE, not to no-op in general, and paired with a
      //      `stripOursPrefix` CONFIRMATION rather than a waiver (see the diffArchives call below).
      //      A blanket "no-op -> stop comparing names" would disarm the no-op synthetics that exist
      //      to pin member names (f1-safename, case-mismatch, trailing-dot), whose builders author
      //      the input layout to be exactly what TexTools writes.
      //
      //      Content is NOT lost either way: diffUpgrade above already compares every gamePath's
      //      bytes, and diffPayloadSemantic part 1 re-compares them through the redirect table.
      //
      //      NOTE the layout is not the only thing a raw-input reference gets wrong. Penumbra also
      //      spells MANIFEST VALUES its own way, and our writer normalizes them the TexTools way, so
      //      a no-op pack's residual manifest baseline is not evidence of divergence either. Two
      //      confirmed instances: every no-op synthetic baselines the same four keys Penumbra omits
      //      or spells differently (`default_mod.json#/Name`, `#/Description`, `#/Version`,
      //      `meta.json#/Image`), and `torn bassment glow.pmp` baselines
      //      `default_mod.json#/Manipulations/6/Manipulation/SetId` purely because its input holds
      //      the string "246" where we (and TexTools) write the number 246 — proven by the /resave
      //      oracle, whose golden for that pack matches our manifest exactly.
      //      `groups[0]` is our reader's synthesized Default group, so `<= 1` means "no real
      //      groups" (see src/container/option-prefix.ts's header).
      const defaultOnlyNoop =
        golden.kind === "noop" && target === "pmp" && source.groups.length <= 1;
      const layoutEquivalent =
        defaultOnlyNoop || packHasFileSwaps(readZip(bytes));
      if (layoutEquivalent) {
        const why = defaultOnlyNoop
          ? "default-only PMP vs a no-op (raw input) reference -> `default/` prefix confirmed"
          : "input carries FileSwaps";
        console.log(
          `[upgrade] ${name}: ${why} -> payload compared SEMANTICALLY ` +
            `(redirect table, not member names). See the FileSwap-preservation spec, §5.2.`,
        );
      }
      // Payload member NAMES are now comparable on the real-golden branch too: our writer
      // regenerates them the TexTools way (optionPrefix + gamePath, content-deduped into
      // common/N). This is strictly stronger than the payload diff: a member name IS
      // `<optionPrefix><gamePath>`, so it catches a file landing in the WRONG OPTION -- which
      // diffUpgrade's whole-pack, gamePath-keyed multiset flattens away entirely. Scoped to PMP
      // only: a TTMP's single opaque "TTMPD.mpd" blob is not a PMP-shaped payload member (see
      // diffArchives' doc comment).
      const archive = diffArchives(
        oursArchive,
        goldenBytes,
        target === "pmp",
        confirmDivergence,
        layoutEquivalent,
        // CONFIRM (not waive) the one member-name difference reason (b) above predicts: strip the
        // synthesized `default/` folder from OUR names, then require an EXACT match with the
        // golden's. Anything else about the layout is still reported.
        defaultOnlyNoop ? "default/" : undefined,
      );
      // Oracle-free invariant on OUR OWN artifact: no dangling `Files` key, no orphan member.
      // Independent of the golden, so it still guards a pack ConsoleTools cannot upgrade or that
      // has no golden at all. PMP-only: a TTMP has no per-file zip members to orphan.
      const selfDiffs =
        target === "pmp"
          ? pmpSelfConsistency(
              oursArchive,
              new Set(source.extraFiles?.keys() ?? []),
            )
          : [];

      const diff = {
        ...payload,
        files: [...payload.files, ...archive, ...selfDiffs],
      };
      const key = oracleKey(bytes);

      if (BLESS) {
        saveBaseline(key, diff.files);
        console.log(
          `[upgrade] blessed ${name}: ${diff.matched} matched, ${diff.files.length} recorded`,
        );
        return;
      }

      const baseline = loadBaseline(key) ?? [];
      const { ok, regressions } = compareToBaseline(diff.files, baseline);
      console.log(
        `[upgrade] ${name}: ${diff.matched} matched, ${diff.files.length} diffs, ` +
          `${regressions.length} regressions (baseline ${baseline.length})`,
      );
      if (!ok) {
        expect.fail(
          `upgrade regressions in ${name}: ` +
            regressions
              .map((r) => `${r.gamePath}#${r.index}:${r.status}`)
              .join(", "),
        );
      }
      // 20 min: a cold cache spawns ConsoleTools /upgrade once for this pack (seconds for a big
      // pack); generous so the first, cache-populating run never times out. Warm runs are ~instant.
    }, 1_200_000);
  });
}
