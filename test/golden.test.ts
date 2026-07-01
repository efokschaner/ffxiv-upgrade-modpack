import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { corpusInputs } from "./helpers/oracle";
import { compareInnerFilesByteIdentical } from "./helpers/compare";
import { loadModpack, writeModpack, ModpackFormat } from "../src/index";

// Layer-1 corpus test (see the plan's "Testing Strategy" and spec §6).
//
// IMPORTANT — why this asserts a SELF round-trip, NOT a ConsoleTools /resave diff:
// ConsoleTools /resave is a TRANSFORMING operation. It decompresses every inner
// game file, RE-compresses it (different block layout ⇒ different bytes), and even
// normalizes/upgrades model (.mdl) files (their uncompressed size changes). It does
// NOT preserve the opaque SQPack-compressed payloads. Because this plan treats
// payloads as opaque (no codecs), a byte-comparison of our payloads against /resave
// output can never pass. Verified empirically across the whole corpus (2026-06-30):
// only trivial .mtrl blobs survived; every .mdl/.tex/.meta diverged.
//
// The valid layer-1 assertion at this (no-codec) stage is a pure round-trip through
// OUR OWN reader/writer: load → write(same format) → load must yield byte-identical
// inner files. The ConsoleTools differential is DEFERRED to the codec plan, where we
// can decompress and compare semantic content (see the skipped block below).

describe("corpus round-trip (skips without test/corpus/inputs)", () => {
  const packs = corpusInputs();

  it.runIf(packs.length > 0).each(packs)(
    "our reader→writer→reader preserves every inner file byte-for-byte: %s",
    (packPath) => {
      const name = basename(packPath);
      const data = loadModpack(name, readFileSync(packPath));
      const target = data.sourceFormat === ModpackFormat.Pmp ? "pmp" : "ttmp2";
      const rewritten = writeModpack(data, target);
      const reread = loadModpack(target === "pmp" ? "x.pmp" : "x.ttmp2", rewritten);
      const result = compareInnerFilesByteIdentical(data, reread);
      if (!result.ok) console.error("mismatched files:", result.mismatches);
      expect(result.ok).toBe(true);
    },
    // Real corpus packs can be >1 GB of inner files; the in-memory round-trip and
    // byte compare need far more than Vitest's 5s default. Generous per-pack ceiling.
    1_200_000,
  );

  it("reports when nothing ran", () => {
    if (packs.length === 0) {
      console.warn("corpus round-trip skipped: empty test/corpus/inputs");
    }
    expect(true).toBe(true);
  });
});

// DEFERRED: ConsoleTools /resave (and /upgrade) byte-differential.
// This requires the SQPack codec (a later plan) so we can compare DECOMPRESSED
// content: /resave recompresses and normalizes inner files, so raw compressed bytes
// never match (see the explanatory note above). Re-enable and rewrite to
// decompress-then-compare once codecs land.
describe.skip("corpus /resave differential (DEFERRED — needs SQPack codec)", () => {
  it("compares decompressed inner files against ConsoleTools /resave", () => {
    expect(true).toBe(true);
  });
});
