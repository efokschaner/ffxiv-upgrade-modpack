import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { ModpackFormat, writeModpack } from "../../src/index";
import { compareInnerFilesByteIdentical } from "./compare";
import { loadRawModpack } from "./load-raw";

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
      const rewritten = writeModpack(data, target, { store: true });
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
