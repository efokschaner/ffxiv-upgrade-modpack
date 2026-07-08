// Builds test/corpus/synthetic/f1-safename.pmp: a wizard PMP whose group Name has spaces + capitals,
// so TexTools' MakePMPPathSafe emits "group_001_weareable ears options.json" while the pre-fix TS
// safeName emits "group_001_Weareable_Ears_Options.json". Reproduces audit finding F1 (see the
// parity design spec §6). The .pmp is gitignored; regenerate locally with `node scripts/build-synthetic-f1.mjs`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "test", "corpus", "synthetic");
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));

// One already-Dawntrail-safe dummy file at a gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/f1_dummy.bin";
const dummyZipPath = "files/f1_dummy.bin";
const dummy = new Uint8Array([0, 1, 2, 3]);

const meta = {
  FileVersion: 3,
  Name: "F1 SafeName Repro",
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
  Name: "Weareable Ears Options",
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
      Files: { [dummyGamePath]: dummyZipPath.replace(/\//g, "\\") },
      FileSwaps: {},
      Manipulations: [],
    },
  ],
};

const members = {
  "meta.json": enc(meta),
  "default_mod.json": enc(defaultMod),
  // NOTE: authored with the CORRECT penumbra name (lowercase, spaces kept) so the pre-fix writer diverges.
  "group_001_weareable ears options.json": enc(group),
  [dummyZipPath]: dummy,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "f1-safename.pmp"), zipSync(members));
console.log("wrote", join(outDir, "f1-safename.pmp"));
