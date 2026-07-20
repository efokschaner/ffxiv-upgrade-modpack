// Shared scaffolding for the synthetic PMP builders in this directory. Emits the minimal Penumbra
// pack shape TexTools' PMP.LoadPMP reads (reference/.../Mods/FileTypes/PMP.cs:1369-1543): meta.json
// + default_mod.json + group_NNN_<safeName>.json + payload entries. This is test scaffolding, not
// ported business logic — each builder supplies only what makes its repro distinct.
//
// The JSON literals below fix the key ORDER of the emitted files, and the member insertion order
// below fixes the zip ORDER. Both are load-bearing: they decide the bytes of the pack members, which
// the /upgrade golden harness compares. Do not reorder.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
// Raw (document) types, not the parsed ones: these builders author meta.json/group JSON exactly as
// PENUMBRA writes it — which omits keys TexTools would serialize (notably `Image`).
import type {
  PmpGroupJsonRaw,
  PmpMetaJsonRaw,
  PmpOptionJsonRaw,
} from "../../src/container/manifest-types";

const CORPUS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "corpus",
);

/** Corpus root a synthetic lands in. `synthetic` is the default (the full assets/golden/upgrade/
 * resave unit set); `upgrade-error` is for packs ConsoleTools /upgrade is EXPECTED to error on,
 * which are scoped to the `upgrade` check alone — see test/helpers/corpus-roots.ts. */
export type SyntheticRoot = "synthetic" | "upgrade-error";

/** Payload bytes. The content is irrelevant to every synthetic here: each sits at a gamePath
 * /upgrade ignores, so ConsoleTools no-ops and the harness compares our output against the input. */
export const DUMMY_PAYLOAD = new Uint8Array([0, 1, 2, 3]);

/** Pinned zip mtime. fflate stamps `Date.now()` into every entry when `mtime` is omitted, which made
 * each rebuild emit different bytes for identical contents — and since the /upgrade golden cache is
 * keyed by sha256(input pack), every rebuild silently missed the cache and re-spawned ConsoleTools.
 * A fixed date makes the packs byte-reproducible, so a rebuild keeps its cached golden. The value is
 * arbitrary (any date >= the 1980 DOS epoch); fflate converts it with local-time getters, so the
 * bytes are stable per machine/timezone — which is all the gitignored, local-only cache needs. */
const FIXED_MTIME = new Date("2024-01-01T00:00:00");

/** Penumbra omits `Image` from meta.json (the key is optional — PMP.cs:1377 defaults it to ""), so
 * these packs leave it absent too: emitting it would drift their bytes from what a real pack, and
 * every previous build of these fixtures, contains. */
export function syntheticMeta(name: string): PmpMetaJsonRaw {
  return {
    FileVersion: 3,
    Name: name,
    Author: "synthetic",
    Description: "",
    Version: "1.0.0",
    Website: "",
    ModTags: [],
  };
}

/** default_mod.json — an empty option: these packs ship nothing outside their one group. */
export const EMPTY_DEFAULT_MOD: PmpOptionJsonRaw = {
  Name: "",
  Description: "",
  Files: {},
  FileSwaps: {},
  Manipulations: [],
};

/** A Single-select group holding exactly one option ("On") that carries `files`
 * (gamePath -> zip path, backslashed on disk as Penumbra writes it).
 *
 * `fileSwaps` (gamePath being overridden -> base-game path served instead, backslashed the same way
 * — PMP.cs:1107-1109 notes the value is the backslashed one) defaults to `{}`, which keeps both the
 * emitted key ORDER and the emitted bytes identical for every pack that does not pass it. */
export function singleOptionGroup(
  name: string,
  files: Record<string, string>,
  fileSwaps: Record<string, string> = {},
): PmpGroupJsonRaw {
  return {
    Version: 0,
    Name: name,
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
        Files: files,
        FileSwaps: fileSwaps,
        Manipulations: [],
      },
    ],
  };
}

export interface SyntheticPack {
  meta: PmpMetaJsonRaw;
  defaultMod: PmpOptionJsonRaw;
  /** "group_NNN_<safeName>.json" -> group. The name is what the repro turns on, so it is explicit. */
  groups: Record<string, PmpGroupJsonRaw>;
  /** zip path (forward slashes) -> raw bytes. */
  files: Record<string, Uint8Array>;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

/** Zips `pack` into test/corpus/<root>/<fileName> (gitignored, like the real corpus). */
export function writePmp(
  fileName: string,
  pack: SyntheticPack,
  root: SyntheticRoot = "synthetic",
): void {
  const members: Record<string, Uint8Array> = {
    "meta.json": encodeJson(pack.meta),
    "default_mod.json": encodeJson(pack.defaultMod),
  };
  for (const [name, group] of Object.entries(pack.groups)) {
    members[name] = encodeJson(group);
  }
  for (const [zipPath, bytes] of Object.entries(pack.files)) {
    members[zipPath] = bytes;
  }

  const outDir = join(CORPUS_DIR, root);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, fileName);
  writeFileSync(out, zipSync(members, { mtime: FIXED_MTIME }));
  console.log("wrote", out);
}
