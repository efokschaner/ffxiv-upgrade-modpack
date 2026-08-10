import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { ModpackFormat, writeModpack } from "../../src/index";
import { compareInnerFilesByteIdentical } from "./compare";
import { loadRawModpack } from "./load-raw";
import { declaredPortedRefusal } from "./resave-compare";

// Layer-1 corpus check (moved from the former golden.test.ts).
//
// IMPORTANT — why this is a SELF round-trip, NOT a ConsoleTools /resave diff: /resave is a
// TRANSFORMING op (it decompresses, re-compresses with a different block layout, and normalizes
// .mdl files), so it does not preserve opaque SQPack payloads — a byte-comparison against /resave
// can never pass. The valid layer-1 assertion is a pure round-trip through OUR reader/writer:
// load → write(same format) → load must yield byte-identical inner files.
//
// KNOWN BLIND SPOT: both sides flow through the SAME reader, so a reader that mis-slices real
// SQPack ModOffset/ModSize would corrupt both sides identically and still pass. PMP manifest
// fidelity IS independently validated against ConsoleTools' OWN /resave output in
// registerResaveCheck (corpus-resave.ts) — real ground truth, not a same-reader self round-trip.
//
// DEFERRED: a ConsoleTools /resave (and /upgrade) DECOMPRESSED-content differential — needs the
// codec to compare decompressed inner files (raw compressed bytes never match after /resave).

/** Register the reader→writer→reader byte-identical round-trip for one pack. */
export function registerGoldenCheck(pack: string): void {
  describe(`golden round-trip: ${basename(pack)}`, () => {
    it("our reader→writer→reader preserves every inner file byte-for-byte", () => {
      const name = basename(pack);
      // Raw (no load-fix) read on BOTH sides: this asserts the container reader/writer preserve the
      // pack's ORIGINAL inner files. loadModpack's fused FixOldModel/FixOldTexData would rewrite/drop
      // files for the 49 old corpus packs, turning this into a round-trip of post-fix data — a
      // different, weaker assertion. See loadRawModpack.
      const data = loadRawModpack(name, readFileSync(pack));
      const target = data.sourceFormat === ModpackFormat.Pmp ? "pmp" : "ttmp2";
      // store: this is a reader->writer->reader round-trip; the archive is written only to be read
      // back, and the assertion is on the inner files, not the container's compressed bytes.
      //
      // A DELIBERATE PORTED REFUSAL is not a round-trip failure. Some packs our writer refuses ON
      // PURPOSE, reproducing a throw TexTools itself performs — today, a PMP carrying a `Combining`
      // group (WizardData.cs · WizardGroupEntry.ToPmpGroup · 897-900, ported in writePmp). For such a
      // pack there IS no artifact to round-trip, by design and on both implementations: the
      // assertion below is inapplicable, not failing.
      //
      // This must not become a blanket "swallow write throws" — a genuine writer bug has to stay
      // red — so the throw is checked against the DECLARED refusal registry
      // (RESAVE_MATCHED_FAILURE_RULES, test/helpers/resave-compare.ts) and anything unrecognized is
      // re-thrown. What is read here is only that registry's `ourRefusal` half, a statement about
      // OUR OWN writer that consults no oracle — so this is not the harness coupling the 2026-07-19
      // ruling forbids (which is about reading another check's ORACLE CACHE). The refusal's parity
      // with TexTools is asserted separately and for real, by the `resave` unit's matched-failure
      // branch against the actual ConsoleTools trace. See spec §3
      // (docs/superpowers/specs/2026-08-09-resave-matched-failure-design.md).
      //
      // NOT ctx.skip: this is a real assertion. If our writer stops refusing, or refuses with a
      // different message, `declaredPortedRefusal` misses and the unit goes red.
      let rewritten: Uint8Array;
      try {
        rewritten = writeModpack(data, target, { store: true });
      } catch (err) {
        const refusal =
          err instanceof Error ? declaredPortedRefusal(err.message) : undefined;
        if (refusal === undefined) throw err;
        console.log(
          `[golden] ${name}: our writer DELIBERATELY refuses this pack (${refusal.csharp}), so there ` +
            `is no round-trip to assert — reproduced at ${refusal.port}. The refusal's parity with ` +
            `ConsoleTools is asserted by the \`resave\` unit's matched-failure branch.`,
        );
        return;
      }
      const reread = loadRawModpack(
        target === "pmp" ? "x.pmp" : "x.ttmp2",
        rewritten,
      );
      const result = compareInnerFilesByteIdentical(data, reread);
      if (!result.ok) console.error("mismatched files:", result.mismatches);
      expect(result.ok).toBe(true);
    }, 1_200_000);
  });
}
