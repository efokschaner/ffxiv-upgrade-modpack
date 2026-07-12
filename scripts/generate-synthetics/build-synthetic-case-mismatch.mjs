// Builds test/corpus/synthetic/case-mismatch.pmp: a PMP whose option Files VALUE is lowercased
// (as Penumbra writes it) while the archived payload entry preserves the option-folder DISPLAY
// case. Pre-fix, readPmp's exact-case lookup throws `pmp: missing file entry`; TexTools loads it
// via a case-insensitive NTFS read (PMP.cs:1080). The single gamePath is one /upgrade ignores, so
// ConsoleTools no-ops and the golden harness compares our output against the input. Reproduces the
// case-sensitivity fix (see docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md).
// The .pmp is gitignored; regenerate locally with
// `node scripts/generate-synthetics/build-synthetic-case-mismatch.mjs`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "test", "corpus", "synthetic");
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));

// A gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/case_dummy.bin";
// Zip entry keeps DISPLAY case; the Files VALUE is lowercased + backslashed (Penumbra's form).
const displayZipPath = "Case Options/On/files/case_dummy.bin";
const filesValue = displayZipPath.toLowerCase().replace(/\//g, "\\");
const dummy = new Uint8Array([0, 1, 2, 3]);

const meta = {
  FileVersion: 3,
  Name: "Case Mismatch Repro",
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
  Name: "Case Options",
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
  // group filename = group_001_<safeName("Case Options")> = the lowercased penumbra name, so our
  // writer reproduces it (mirrors build-synthetic-f1.mjs).
  "group_001_case options.json": enc(group),
  [displayZipPath]: dummy,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "case-mismatch.pmp"), zipSync(members));
console.log("wrote", join(outDir, "case-mismatch.pmp"));
