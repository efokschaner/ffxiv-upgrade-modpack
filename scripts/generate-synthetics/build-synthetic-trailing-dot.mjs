// Builds test/corpus/synthetic/trailing-dot.pmp: a PMP whose option Files VALUE keeps a trailing
// dot on a folder segment (Penumbra's lowercased form) while the archived payload entry stores the
// Windows-stripped name. Pre-fix, readPmp misses it and throws `pmp: missing file entry`; TexTools
// resolves it via an NTFS Path.Combine read (PMP.cs:1080) after a LoadPMP with no existence check
// (PMP.cs:124). The single gamePath is one /upgrade ignores, so ConsoleTools no-ops and the golden
// harness compares our output against the input. Reproduces the Windows path-normalization fix (see
// docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md). The .pmp is gitignored;
// regenerate locally with `node scripts/generate-synthetics/build-synthetic-trailing-dot.mjs`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "test", "corpus", "synthetic");
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));

// A gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/trailing_dot_dummy.bin";
// Archived entry: the Windows-stripped folder name (no trailing dot), arbitrary display case.
const strippedZipPath =
  "Trailing Options/Rose acc/files/trailing_dot_dummy.bin";
// Files VALUE: Penumbra's lowercased form, retaining a trailing '.' on the folder segment + backslashes.
const filesValue = "trailing options\\rose acc.\\files\\trailing_dot_dummy.bin";
const dummy = new Uint8Array([0, 1, 2, 3]);

const meta = {
  FileVersion: 3,
  Name: "Trailing Dot Repro",
  Author: "synthetic",
  Description: "",
  Version: "1.0.0",
  Website: "",
  ModTags: [],
};
const defaultMod = {
  Name: "",
  Description: "",
  Files: {},
  FileSwaps: {},
  Manipulations: [],
};
const group = {
  Version: 0,
  Name: "Trailing Options",
  Description: "",
  Image: "",
  Page: 0,
  Priority: 0,
  Type: "Single",
  DefaultSettings: 0,
  Options: [
    {
      Name: "On",
      Description: "",
      Image: "",
      Files: { [dummyGamePath]: filesValue },
      FileSwaps: {},
      Manipulations: [],
    },
  ],
};

const members = {
  "meta.json": enc(meta),
  "default_mod.json": enc(defaultMod),
  // group filename = group_001_<safeName("Trailing Options")> = the lowercased penumbra name, so our
  // writer reproduces it (mirrors build-synthetic-case-mismatch.mjs).
  "group_001_trailing options.json": enc(group),
  [strippedZipPath]: dummy,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "trailing-dot.pmp"), zipSync(members));
console.log("wrote", join(outDir, "trailing-dot.pmp"));
