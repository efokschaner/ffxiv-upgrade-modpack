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
import { diffUpgrade, type FileDiff } from "./upgrade-diff";
import { upgradeGoldenCached } from "./upgrade-golden";
import { transformChanges } from "./upgrade-noop";

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
      //
      // `loadModpack` runs INSIDE the assertion, not before it. ConsoleTools' /upgrade covers
      // load+transform in one call (HandleUpgrade -> WizardData.FromModpack -> UpgradeModpack), so a
      // pack the oracle refuses at LOAD is refused just as legitimately by our loader — e.g. an
      // unrecognized PMP group `Type`, which throws inside `PMP.LoadPMP` (see parsePmpGroup). Loading
      // outside this branch made such a throw escape the assertion and fail the test as an error
      // instead of passing as the matched failure it is.
      if (golden.kind === "error") {
        assertMatchedUpgradeFailure(name, golden.message, () =>
          upgradeModpack(loadModpack(name, bytes)),
        );
        return;
      }
      // ONE load of the source, reused three ways below (upgrade input, no-op reference, and the
      // source ExtraFiles key set). Safe because upgradeModpack cloneModpack()s and never mutates
      // its argument (src/upgrade/upgrade.ts). Re-loading cost ~3s per big PMP, three times over.
      const source = loadModpack(name, bytes);
      const oursModel = upgradeModpack(source);
      // A no-op upgrade writes no golden; the correct reference is the original input, so this
      // still exercises our whole load->upgrade->reduce->serialize pipeline end to end.
      const reference = golden.kind === "noop" ? source : golden.data;

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
      // A NO-OP golden means ConsoleTools wrote NO ARCHIVE, so `reference` above is the UNTOUCHED
      // INPUT PACK — a Penumbra export whose layout and manifest spelling TexTools'
      // writer never produced. Comparing our member NAMES or manifest JSON against it asserts "our
      // writer reproduces this author's arbitrary choices", which has no oracle behind it and takes
      // our own writer as ground truth. So on this branch we do NOT call diffArchives at all.
      //
      // What replaces it:
      //  - CONTENT is still compared, by `diffUpgrade` above, keyed by gamePath — the assertion the
      //    harness spec designed for this branch (2026-07-04-upgrade-golden-harness-design.md §4.3).
      //  - The TRANSFORM is asserted directly below, mirroring the very predicate the oracle
      //    branches on when it declines to write (ModpackUpgrader.cs · AnyChanges · 25-49). This is
      //    STRICTER than diffUpgrade in one way that matters: it is keyed per OPTION, so a file
      //    moving between options is caught where diffUpgrade's whole-pack multiset flattens it away.
      //  - WRITER PARITY is covered by registerResaveCheck (corpus-resave.ts) against a real
      //    ConsoleTools /resave golden. /upgrade and /resave are the same call minus the transform
      //    (Program.cs:204-211 vs ModpackUpgrader.cs:58 + :212-219), so when /upgrade no-ops the
      //    /resave golden IS what /upgrade would have written. The two harnesses stay INDEPENDENT:
      //    this branch deliberately does not consult /resave's cache or its error markers.
      //
      // See docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md.
      const noopReference = golden.kind === "noop";
      const transform = noopReference
        ? transformChanges(source, oursModel)
        : [];

      // Payload member NAMES are now comparable on the real-golden branch too: our writer
      // regenerates them the TexTools way (optionPrefix + gamePath, content-deduped into
      // common/N). This is strictly stronger than the payload diff: a member name IS
      // `<optionPrefix><gamePath>`, so it catches a file landing in the WRONG OPTION -- which
      // diffUpgrade's whole-pack, gamePath-keyed multiset flattens away entirely. Scoped to PMP
      // only: a TTMP's single opaque "TTMPD.mpd" blob is not a PMP-shaped payload member (see
      // diffArchives' doc comment).
      //
      // `layoutEquivalent` (and the `readZip` it costs — a full zip parse, up to 457 MB for the
      // biggest corpus pack) is only computed on THIS branch, because it is only ever consumed by
      // the `diffArchives` call below: on the no-op branch `diffArchives` does not run at all (see
      // the comment above), so there is nothing here for it to gate. Gated on the INPUT pack
      // carrying FileSwaps, not on `ours` or the golden — PopulatePmpStandardOption (PMP.cs:873-875)
      // has already destroyed the golden's swaps by the time we'd read it here, so gating on the
      // golden would never fire. See the FileSwap-preservation spec, §5.2.
      let archive: FileDiff[] = [];
      if (!noopReference) {
        const layoutEquivalent = packHasFileSwaps(readZip(bytes));
        if (layoutEquivalent) {
          console.log(
            `[upgrade] ${name}: input carries FileSwaps -> payload compared SEMANTICALLY ` +
              `(redirect table, not member names). See the FileSwap-preservation spec, §5.2.`,
          );
        }
        archive = diffArchives(
          oursArchive,
          golden.bytes,
          target === "pmp",
          confirmDivergence,
          layoutEquivalent,
        );
      }
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
        files: [...payload.files, ...archive, ...selfDiffs, ...transform],
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
