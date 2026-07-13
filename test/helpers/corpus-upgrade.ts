import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack, upgradeModpack, writeModpack } from "../../src/index";
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

// End-to-end golden check: our upgrade pipeline vs the cached ConsoleTools /upgrade output,
// diffed per gamePath on decompressed content, exact-byte except for confirmed intentional
// divergences, ratcheted against a gitignored per-pack baseline (see the harness design spec).
export function registerUpgradeCheck(pack: string): void {
  const name = basename(pack);
  describe(`upgrade golden: ${name}`, () => {
    it("matches ConsoleTools /upgrade within the ratchet baseline", () => {
      const bytes = new Uint8Array(readFileSync(pack));
      const oursModel = upgradeModpack(loadModpack(name, bytes));
      const golden = upgradeGoldenCached(name, bytes);
      if (golden === null) {
        throw new Error(
          `No /upgrade golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.upgrade-cache.`,
        );
      }
      // A no-op upgrade writes no golden; the correct reference is the original input, so this
      // still exercises our whole load->upgrade->reduce->serialize pipeline end to end.
      const reference =
        golden.kind === "noop" ? loadModpack(name, bytes) : golden.data;
      const goldenBytes = golden.kind === "noop" ? bytes : golden.bytes;

      // Exercise the real writer on the oracle path (audit blind spot #5): the archive it produces
      // now feeds BOTH the structure/manifest diff below AND the payload diff (see next comment) —
      // the payload diff used to run on the in-memory model and so was blind to the writer entirely.
      // See the parity design spec.
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
      const oursArchive = writeModpack(oursModel, target);
      // Diff the ARTIFACT WE SHIP, not the in-memory model. Feeding `oursModel` here made every
      // writer bug invisible by construction: a file the writer emits with no `Files` key naming it
      // is a perfectly good file in the model and an unreachable orphan in the pack. Re-reading
      // closes that gap — such a file comes back as an ExtraFile, drops out of `allFiles`, and its
      // gamePath shows as `added` against the golden. (It also puts the whole write->read round-trip
      // under the golden oracle for free.)
      const oursReRead = loadModpack(name, oursArchive);

      const payload = diffUpgrade(
        name,
        oursReRead,
        reference,
        confirmDivergence,
      );
      // checkPayloadMembers's counts-only comparison assumes PMP's payload-member shape (every
      // non-manifest zip entry). A TTMP noop's "TTMPD.mpd" is a single opaque blob, not a set of
      // per-gamePath payload members like PMP's, so scope this to PMP noops only (see
      // diffPayloadMembers' doc comment).
      const archive = diffArchives(
        oursArchive,
        goldenBytes,
        target === "pmp" && golden.kind === "noop",
      );
      // Oracle-free invariant on OUR OWN artifact: no dangling `Files` key, no orphan member.
      // Independent of the golden, so it still guards a pack ConsoleTools cannot upgrade or that
      // has no golden at all. PMP-only: a TTMP has no per-file zip members to orphan.
      const selfDiffs =
        target === "pmp"
          ? pmpSelfConsistency(
              oursArchive,
              new Set(loadModpack(name, bytes).extraFiles?.keys() ?? []),
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
