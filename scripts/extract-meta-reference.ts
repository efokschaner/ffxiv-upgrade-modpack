// Generates src/meta/reference/est-table.ts and src/meta/reference/imc-table.ts.
//
// EST reconstruction (Task 7, src/meta/reconstruct.ts) seeds each .meta's EST segment from the
// base game before applying the mod's own deltas (mirrors Est.GetExtraSkeletonEntry falling back
// to the base-game entries, Est.cs:345-360). That requires a (race, setId) -> skelId lookup per
// EST type, extracted directly from the four base-game EST files ConsoleTools ships.
//
// IMC reconstruction (Task 8b, src/meta/reconstruct.ts) similarly seeds a .meta's IMC segment
// from the base game, growing the entry list to the base game's entry count when the mod
// supplies fewer entries (PMP.cs:455-480; docs/superpowers/specs/2026-07-10-metadata-round-
// design.md §3.2-3.3). That requires a `.meta` root path -> ordered base entry table, extracted
// from base-game .imc files. It is exhaustive over every root in the framework's item_sets.db
// whose primary type Imc.UsesImc accepts (Imc.cs · UsesImc · 74-85): equipment, accessory,
// weapon, monster, demihuman -- not merely the ones a corpus .meta happens to reference.
//
// NOTE (authorized scope change from the round-5 task-6 brief): EQP/GMP extraction was
// intentionally dropped. The scoping spike found EQP/GMP segments never grow and never mismatch
// across the corpus -- mods always provide them, so pass-through is already byte-exact and a base
// EQP/GMP seed is never consulted. Bundling them would be dead data; the golden ratchet will flag
// the theoretical mod-omits-EQP/GMP case if it ever appears, at which point we'd extract them.
//
// Regenerate (needs a game install + ConsoleTools, and node's --experimental-sqlite for the
// item_sets.db item enumeration behind the exhaustive IMC table):
//   $env:NODE_OPTIONS='--experimental-sqlite'; npx tsx scripts/extract-meta-reference.ts
// Add `--imc-only` to regenerate just imc-table.ts (leaving est-table.ts untouched) — the IMC
// extraction is ~8000 ConsoleTools spawns (a parallel pool, ~15 minutes); EST is 4 files.
// The generated tables (est-table.ts / imc-table.ts) are excluded from Biome (see biome.jsonc).

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadModpack } from "../src/index";
import { deserializeMeta } from "../src/meta/deserialize";
import { allFiles, FileStorageType } from "../src/model/modpack";
import { decodeSqPackFile } from "../src/sqpack/sqpack";
import { GameIndex } from "./lib/game-index";
import {
  type ImcRootInfo,
  rawImcFilePath,
  readImcEntries,
} from "./lib/imc-entries";

// oracle.ts (and corpus-roots.ts, which it depends on) read __dirname at module scope
// (Vite-only global); shim it before importing either. See scripts/extract-shader-params.ts
// for the rationale. corpus-roots.ts is dynamically imported (not statically, like the src/
// modules above) for the same reason: a static import would evaluate its module-scope
// `__dirname` read before this shim runs.
(globalThis as unknown as { __dirname: string }).__dirname = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "helpers",
);
const { extractGameFile } = await import("../test/helpers/oracle");
const { corpusPacks } = await import("../test/helpers/corpus-roots");

// --imc-only regenerates ONLY imc-table.ts, leaving est-table.ts untouched (this script normally
// regenerates BOTH). Use it to widen the IMC table without re-running the EST extraction.
const IMC_ONLY = process.argv.includes("--imc-only");
// IMC_LIMIT=N extracts only the first N distinct .imc files and neither validates nor writes
// imc-table.ts — a cheap smoke test of the item_sets.db enumeration + parallel extraction before
// the full ~8000-file run.
const IMC_LIMIT = process.env.IMC_LIMIT
  ? Number(process.env.IMC_LIMIT)
  : Number.POSITIVE_INFINITY;

// Local async ConsoleTools /extract for the parallel IMC pool. We do NOT touch oracle.ts's
// synchronous extractGameFile (shared with EST extraction); this is a self-contained async variant
// so a bug here can never affect the EST path. Same command as oracle.run (["/extract", path, dest]).
const CONSOLE_TOOLS_EXE =
  "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
// The game's sqpack folder, read in-process by GameIndex as the FileExists oracle for .imc paths
// (same constant as scripts/extract-hair-materials.ts:26-27).
const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";
const execFileAsync = promisify(execFile);
async function extractGameFileAsync(
  gamePath: string,
  dest: string,
): Promise<void> {
  // execFile rejects on ConsoleTools' non-zero exit (missing file) -- caller treats that as "not
  // present in game". maxBuffer raised so chatty stdout never spuriously rejects a real extract.
  await execFileAsync(CONSOLE_TOOLS_EXE, ["/extract", gamePath, dest], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

// Est.EstType, minus Invalid (which never selects a file) -- Est.cs:24-31. Named EstFileType (not
// EstType) to avoid clashing with src/meta/root.ts's EstType, which additionally includes null for
// "no EST segment" roots; that is a distinct, wider type consumers must not confuse with this one.
type EstFileType = "Head" | "Body" | "Hair" | "Face";

// Est.cs:39-45 (EstFiles dictionary).
const EST_FILES: Record<EstFileType, string> = {
  Head: "chara/xls/charadb/extra_met.est",
  Body: "chara/xls/charadb/extra_top.est",
  Hair: "chara/xls/charadb/hairskeletontemplate.est",
  Face: "chara/xls/charadb/faceskeletontemplate.est",
};

type RaceSetSkel = Record<number, Record<number, number>>;

// Port of Est.GetEstFile (Est.cs:362-386) + ExtraSkeletonEntry.Read (ExtraSkeletonEntry.cs:39-56).
//
//   public static ExtraSkeletonEntry Read(byte[] data, uint count, uint index)
//   {
//       int offset = (int)(4 + (index * 4));
//       var setId = BitConverter.ToUInt16(data, offset);
//       var raceId = BitConverter.ToUInt16(data, offset + 2);
//       var race = XivRaces.GetXivRace(raceId.ToString().PadLeft(4, '0'));
//       var baseOffset = 4 + (count * 4);
//       offset = (int)(baseOffset + (index * 2));
//       var skelId = BitConverter.ToUInt16(data, offset);
//       var ret = new ExtraSkeletonEntry(race, setId, skelId);
//       return ret;
//   }
//
// Layout: uint32 count header at offset 0; then `count` x { uint16 setId, uint16 raceId } pairs
// starting at offset 4 (4 bytes each); then `count` x uint16 skelId starting at offset
// 4 + count*4 (2 bytes each). All little-endian (BitConverter on the platforms TexTools ships for).
//
// Race codes are read as the raw uint16: XivRaces.GetXivRace round-trips the zero-padded decimal
// string back to the identical numeric race code (e.g. raceId 101 == Hyur Midlander Male), the same
// codes used by src/meta/playable-races.ts's PLAYABLE_RACES and src/meta/types.ts's EstEntry.race,
// so no enum mapping table is needed here. Race codes are preserved raw as read from the est file:
// C#'s GetXivRace would collapse an unrecognized code to All_Races(0), but this table is only ever
// queried by Task 7 for known playable-race codes (src/meta/playable-races.ts), so an unknown race
// id (none expected in the EST human/equipment/hair/face domain) is never looked up and is
// harmless here -- no bucketing/collapsing needed.
function parseEstFile(data: Uint8Array, label: string): RaceSetSkel {
  if (data.byteLength < 4) {
    throw new Error(
      `${label}: file too short for count header (${data.byteLength} bytes)`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const expectedLength = 4 + count * 6;
  if (data.byteLength !== expectedLength) {
    throw new Error(
      `${label}: count header ${count} implies length ${expectedLength}, but file is ${data.byteLength} bytes`,
    );
  }
  const table: RaceSetSkel = {};
  const baseSkelOffset = 4 + count * 4;
  let uniqueEntries = 0;
  let dupes = 0;
  for (let i = 0; i < count; i++) {
    const pairOffset = 4 + i * 4;
    const setId = view.getUint16(pairOffset, true);
    const raceId = view.getUint16(pairOffset + 2, true);
    const skelId = view.getUint16(baseSkelOffset + i * 2, true);
    table[raceId] ??= {};
    const byRace = table[raceId]!;
    if (byRace[setId] === undefined) {
      byRace[setId] = skelId;
      uniqueEntries++;
    } else {
      // Est.GetEstFile: a duplicate (race, setId) is dropped, first entry wins, gated by a
      // ContainsKey check (Est.cs:377-382). The C# notes exactly one known duplicate in the base
      // game -- a Lalafell M face entry appearing twice with identical values -- which this
      // tolerates by keeping the first. Any *conflicting* duplicate (same race+setId, different
      // skelId) is not something Est.cs anticipates and would mean a real parse bug or an
      // unexpected game-file change, so fail loud instead of silently keeping the first.
      if (byRace[setId] !== skelId) {
        throw new Error(
          `${label}: conflicting duplicate (race=${raceId}, setId=${setId}): ` +
            `first skelId=${byRace[setId]}, later skelId=${skelId}`,
        );
      }
      dupes++;
    }
  }
  console.log(
    `  ${label}: ${data.byteLength} bytes, count=${count}, ${uniqueEntries} unique entries` +
      (dupes ? ` (${dupes} duplicate (race,setId) rows dropped)` : ""),
  );
  return table;
}

function serializeRaceSetSkel(table: RaceSetSkel, indent: string): string {
  const raceKeys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const raceLines = raceKeys.map((race) => {
    const bySet = table[race]!;
    const setKeys = Object.keys(bySet)
      .map(Number)
      .sort((a, b) => a - b);
    const setBody = setKeys
      .map((setId) => `${setId}: ${bySet[setId]}`)
      .join(", ");
    return `${indent}  ${race}: { ${setBody} },`;
  });
  return `{\n${raceLines.join("\n")}\n${indent}}`;
}

// EST extraction + est-table.ts write, gated by --imc-only (skipped when only widening IMC).
if (!IMC_ONLY) {
  const EST_TYPES: EstFileType[] = ["Head", "Body", "Hair", "Face"];
  const table: Partial<Record<EstFileType, RaceSetSkel>> = {};
  let failed = false;

  for (const type of EST_TYPES) {
    const gamePath = EST_FILES[type];
    const dir = mkdtempSync(join(tmpdir(), "est-"));
    const dest = join(dir, "file.est");
    try {
      extractGameFile(gamePath, dest);
      const bytes = new Uint8Array(readFileSync(dest));
      table[type] = parseEstFile(bytes, `${type} (${gamePath})`);
    } catch (err) {
      console.error(
        `FAILED extracting/parsing ${type} (${gamePath}): ${(err as Error).message}`,
      );
      failed = true;
    }
  }

  if (!failed) {
    const body = EST_TYPES.map(
      (type) => `  ${type}: ${serializeRaceSetSkel(table[type]!, "  ")},`,
    ).join("\n");
    const out =
      "// GENERATED — regenerate via npx tsx scripts/extract-meta-reference.ts. Do not edit by hand.\n" +
      "//\n" +
      "// Base-game EST lookup: race code -> setId -> skelId, per EST type. Mirrors Est.GetEstFile's\n" +
      "// Dictionary<XivRace, Dictionary<ushort, ExtraSkeletonEntry>> (Est.cs:362-386), flattened to\n" +
      "// plain numbers (skelId is all ExtraSkeletonEntry callers here need). See\n" +
      "// scripts/extract-meta-reference.ts for the extraction/parsing logic and provenance.\n" +
      'export type EstFileType = "Head" | "Body" | "Hair" | "Face";\n' +
      "export const EST_TABLE: Record<EstFileType, Record<number, Record<number, number>>> = {\n" +
      body +
      "\n};\n";
    const outDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "meta",
      "reference",
    );
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "est-table.ts");
    writeFileSync(outPath, out);
    console.log(`wrote ${outPath} (${Buffer.byteLength(out, "utf8")} bytes)`);
  } else {
    console.log("\nNot writing est-table.ts due to failures above.");
    process.exitCode = 1;
  }
} else {
  console.log(
    "--imc-only: skipping est-table.ts regeneration (left unchanged).",
  );
}

// ---------------------------------------------------------------------------------------------
// IMC extraction (Task 8a, re-keyed in the NonSet round).
//
// The three symbols ConsoleTools actually executes to build a .meta's IMC base seed
// (ItemMetadata.cs · CreateFromRaw · 233-247) are ported in scripts/lib/imc-entries.ts:
// XivDependencyRoot.GetRawImcFilePath, XivDependencyRoot.GetImcEntryPaths and Imc.GetEntries.
// This script only enumerates the roots, extracts each .imc, and fans the decoded entries back
// out per root. Both ImcType.Set (equipment/accessory) and ImcType.NonSet (weapon/monster/
// demihuman) are covered -- the entry-offset arithmetic in imc-entries.ts handles both.
//
// reference/ is gitignored (the maintainer re-clones the framework); node:sqlite needs
// --experimental-sqlite (set via NODE_OPTIONS -- see the regen command in this file's header).
const ITEM_SETS_DB = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "reference",
  "FFXIV_TexTools_UI",
  "lib",
  "xivModdingFramework",
  "xivModdingFramework",
  "Resources",
  "DB",
  "item_sets.db",
);
// Exhaustive enumeration from the framework's item_sets.db `roots` table over every primary type
// Imc.UsesImc accepts (Imc.cs · UsesImc · 74-85): equipment, accessory, weapon, monster, demihuman.
// `root_path` is stored verbatim as the .meta gamePath, which is the table key (spec §3.2).
interface ImcRootRow extends ImcRootInfo {
  rootPath: string;
}
const { DatabaseSync } = await import("node:sqlite");
const rootsDb = new DatabaseSync(ITEM_SETS_DB, { readOnly: true });
let roots = rootsDb
  .prepare(
    "SELECT primary_type AS primaryType, primary_id AS primaryId, " +
      "secondary_type AS secondaryType, secondary_id AS secondaryId, " +
      "slot, root_path AS rootPath FROM roots " +
      "WHERE primary_type IN ('equipment', 'accessory', 'weapon', 'monster', 'demihuman')",
  )
  .all() as unknown as ImcRootRow[];
rootsDb.close();

// One .imc serves many roots (every slot of an equipment set; every slot of a demihuman set), so
// extract per distinct PATH and fan the result back out to each root that reads it.
const pathOf = new Map<string, string>(); // rootPath -> .imc gamePath
for (const r of roots) pathOf.set(r.rootPath, rawImcFilePath(r));

// The game index is the existence oracle (AGENTS.md): a path absent here is a file the game
// genuinely does not have, which TexTools seeds as NOTHING (ItemMetadata.cs · CreateFromRaw ·
// 236,243-246). Recording those as an explicit [] is what lets a table MISS mean "we have no data"
// and throw. Pre-filtering here also keeps us from spawning ConsoleTools for files that cannot be
// extracted.
const gameIndex = GameIndex.load(SQPACK);
let distinctPaths = [...new Set(pathOf.values())];
if (IMC_LIMIT !== Number.POSITIVE_INFINITY) {
  // Smoke test: keep the first N distinct .imc files and only the roots that read them, so every
  // invariant below (a root's path is always extracted) still holds on the reduced set.
  distinctPaths = distinctPaths.slice(0, IMC_LIMIT);
  const kept = new Set(distinctPaths);
  roots = roots.filter((r) => kept.has(pathOf.get(r.rootPath)!));
}
const presentPaths = distinctPaths.filter((p) => gameIndex.fileExists(p));
console.log(
  `\nIMC: ${roots.length} roots across ${distinctPaths.length} distinct .imc files; ` +
    `${presentPaths.length} present in game, ${distinctPaths.length - presentPaths.length} absent ` +
    "(recorded as [])" +
    (IMC_LIMIT !== Number.POSITIVE_INFINITY
      ? ` (IMC_LIMIT=${IMC_LIMIT}: smoke test, will not validate or write)`
      : ""),
);

// Parallel extraction pool: ConsoleTools spawns (~0.9s each) dominate wall time, so a small
// concurrency pool over the files turns a very long sequential run into ~15 minutes. Each worker
// uses its own temp dest (no shared-file race). Slow extraction runs concurrently; decoding +
// table-building (fast, order-sensitive) runs sequentially afterward for deterministic output.
const CONCURRENCY = 8;
const extractedBytes = new Map<string, Uint8Array>(); // .imc gamePath -> bytes
const extractErrors = new Map<string, string>(); // .imc gamePath -> error message
let cursor = 0;
async function extractWorker(wid: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `imc-w${wid}-`));
  const dest = join(dir, "file.imc");
  while (true) {
    const i = cursor++;
    if (i >= presentPaths.length) break;
    const imcPath = presentPaths[i]!;
    try {
      await extractGameFileAsync(imcPath, dest);
      extractedBytes.set(imcPath, new Uint8Array(readFileSync(dest)));
    } catch (err) {
      // Left unset; the table-building loop below fails loud, because the index said this
      // path exists and a failed extract of an existing file is not a faithful state.
      extractErrors.set(imcPath, (err as Error).message);
    }
    if ((i + 1) % 200 === 0)
      console.log(`  ...extracted ${i + 1}/${presentPaths.length}`);
  }
}
await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, w) => extractWorker(w)),
);

const imcTable: Record<string, number[][]> = {};
let imcParseFailed = false;
let imcAbsent = 0;
for (const r of roots) {
  const imcPath = pathOf.get(r.rootPath)!;
  const key = r.rootPath.toLowerCase();
  const bytes = extractedBytes.get(imcPath);
  if (!bytes) {
    // Absent from the game index, or the extract failed. Absent is a real, faithful state (see
    // above); a failed extract of a path the index says EXISTS is not, so fail loud on it.
    if (gameIndex.fileExists(imcPath)) {
      const cause = extractErrors.get(imcPath);
      console.error(
        `FAILED extracting ${imcPath} (index says it exists)` +
          (cause ? `: ${cause}` : ""),
      );
      imcParseFailed = true;
      continue;
    }
    imcTable[key] = [];
    imcAbsent++;
    continue;
  }
  try {
    imcTable[key] = readImcEntries(bytes, r.slot);
  } catch (err) {
    console.error(
      `FAILED reading ${imcPath} for ${r.rootPath}: ${(err as Error).message}`,
    );
    imcParseFailed = true;
  }
}
console.log(
  `  built ${Object.keys(imcTable).length} root keys (${imcAbsent} with no .imc in game)`,
);

// IMC_LIMIT smoke test: enumeration + parallel extraction exercised on a subset; do NOT validate
// (needs the specific golden-target items) or overwrite the committed imc-table.ts.
if (IMC_LIMIT !== Number.POSITIVE_INFINITY) {
  console.log(
    `\nIMC_LIMIT=${IMC_LIMIT} smoke test done (${extractedBytes.size} extracted, ` +
      `${Object.keys(imcTable).length} keys). Not validating or writing imc-table.ts.`,
  );
  process.exit(imcParseFailed ? 1 : 0);
}

// Golden spot-check (required, per the task-8a brief): confirm IMC_TABLE reproduces the base
// portion of the two known IMC-variant-growth residue cases (e6137_top 2->3, e0724_top 4->7).
// A .meta's IMC section length grows from the mod's own variant count up to the base game's
// (PMP.cs:455-480); entries at indices >= the mod's own variant count are pure base data, so they
// must equal IMC_TABLE's corresponding entries exactly. This is how we validate the slot-index
// and entry-ordering port above against real ConsoleTools output, not just our own reading of the
// C#.
function uncompress(f: {
  storage: FileStorageType;
  data?: Uint8Array;
}): Uint8Array {
  // .meta files are synthesized from PMP Manipulations, never from a zip `Files` member (absent-file
  // design spec §3.3), so a `.meta` ModpackFile always carries bytes.
  if (!f.data)
    throw new Error("extract-meta-reference: .meta file has no bytes");
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}
const UPGRADE_CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "corpus",
  ".upgrade-cache",
);
const VALIDATION_TARGETS = [
  {
    gamePath: "chara/equipment/e6137/e6137_top.meta",
    key: "chara/equipment/e6137/e6137_top.meta",
  },
  {
    gamePath: "chara/equipment/e0724/e0724_top.meta",
    key: "chara/equipment/e0724/e0724_top.meta",
  },
];
let validationFailed = false;
for (const target of VALIDATION_TARGETS) {
  const table = imcTable[target.key];
  if (table === undefined || table.length === 0) {
    console.error(
      `VALIDATION FAILED: IMC_TABLE["${target.key}"] is ${table === undefined ? "absent" : "empty"} ` +
        "(needed for the golden spot-check)",
    );
    validationFailed = true;
    continue;
  }
  let found = false;
  for (const pack of corpusPacks()) {
    const modBytes = new Uint8Array(readFileSync(pack));
    const modData = loadModpack(pack, modBytes);
    const modFile = allFiles(modData).find(
      (f) => f.gamePath === target.gamePath,
    );
    if (!modFile) continue;

    const cacheKey = createHash("sha256").update(modBytes).digest("hex");
    const goldenFile = existsSync(UPGRADE_CACHE_DIR)
      ? readdirSync(UPGRADE_CACHE_DIR).find(
          (f) => f.startsWith(cacheKey) && f.endsWith(".bin"),
        )
      : undefined;
    if (!goldenFile) continue; // no cached golden for this pack yet (or it's a no-op upgrade)

    const goldenBytes = new Uint8Array(
      readFileSync(join(UPGRADE_CACHE_DIR, goldenFile)),
    );
    const goldenData = loadModpack(pack, goldenBytes);
    const goldenMetaFile = allFiles(goldenData).find(
      (f) => f.gamePath === target.gamePath,
    );
    if (!goldenMetaFile) continue;

    found = true;
    const modMeta = deserializeMeta(uncompress(modFile.file));
    const goldenMeta = deserializeMeta(uncompress(goldenMetaFile.file));
    if (!modMeta.imc || !goldenMeta.imc) {
      console.error(
        `VALIDATION FAILED: ${target.gamePath} in ${pack}: mod or golden .meta has no IMC segment`,
      );
      validationFailed = true;
      break;
    }
    const modLen = modMeta.imc.length;
    const goldenLen = goldenMeta.imc.length;
    if (goldenLen !== table.length) {
      console.error(
        `VALIDATION FAILED: ${target.gamePath}: golden has ${goldenLen} variant entries, ` +
          `IMC_TABLE["${target.key}"] has ${table.length}`,
      );
      validationFailed = true;
      break;
    }
    let mismatches = 0;
    for (let i = modLen; i < goldenLen; i++) {
      const g = goldenMeta.imc[i]!;
      const t = table[i]!;
      const same = g.length === 6 && g.every((b, j) => b === t[j]);
      if (!same) {
        mismatches++;
        console.error(
          `  entry ${i}: golden=[${Array.from(g).join(",")}] table=[${t.join(",")}]`,
        );
      }
    }
    if (mismatches > 0) {
      console.error(
        `VALIDATION FAILED: ${target.gamePath}: ${mismatches}/${goldenLen - modLen} residue entries diverge from IMC_TABLE`,
      );
      validationFailed = true;
    } else {
      console.log(
        `  VALIDATED ${target.gamePath} against ${pack.split(/[\\/]/).pop()}: ` +
          `${goldenLen - modLen} residue entries (index ${modLen}..${goldenLen - 1}) match IMC_TABLE`,
      );
    }
    break;
  }
  if (!found) {
    console.error(
      `VALIDATION FAILED: no corpus pack + cached /upgrade golden found for ${target.gamePath}`,
    );
    validationFailed = true;
  }
}

if (!imcParseFailed && !validationFailed) {
  const sortedKeys = Object.keys(imcTable).sort();
  const body = sortedKeys
    .map((key) => {
      const entries = imcTable[key]!.map(
        (entry) => `[${entry.join(", ")}]`,
      ).join(", ");
      return `  ${JSON.stringify(key)}: [${entries}],`;
    })
    .join("\n");
  const out =
    "// GENERATED — regenerate via npx tsx scripts/extract-meta-reference.ts. Do not edit by hand.\n" +
    "//\n" +
    "// Base-game IMC lookup: the base seed ConsoleTools builds for a .meta's IMC segment\n" +
    "// (ItemMetadata.cs · CreateFromRaw · 233-247), via ports of the three symbols that path\n" +
    "// executes -- XivDependencyRoot.GetRawImcFilePath (XivDependencyRoot.cs:1093-1126),\n" +
    "// XivDependencyRoot.GetImcEntryPaths (XivDependencyRoot.cs:1133-1202) and Imc.GetEntries\n" +
    "// (Imc.cs:189-238). Those ports live in scripts/lib/imc-entries.ts; see\n" +
    "// scripts/extract-meta-reference.ts for the enumeration, extraction, and the golden\n" +
    "// spot-check that validates them against real ConsoleTools output.\n" +
    "//\n" +
    "// KEY: the lowercased .meta root path (item_sets.db `roots.root_path`, e.g.\n" +
    '// "chara/equipment/e0724/e0724_top.meta").\n' +
    "// VALUE: the ordered 6-byte entries that root's .meta IMC section carries -- one per subset\n" +
    "// (default first, then each variant subset), each (MaterialSet, Decal, Mask lo, Mask hi, Vfx,\n" +
    "// Animation -- SerializeEntry/DeserializeEntry, Imc.cs:310-342).\n" +
    "// [] means the game has no .imc file for that root at all, which TexTools seeds as no entries\n" +
    "// (ItemMetadata.cs · CreateFromRaw · 236,243-246) -- a real, faithful state, not missing data.\n" +
    "// A MISS means the root is unknown to item_sets.db, which we cannot seed faithfully: it is a\n" +
    "// fail-loud condition for consumers, never a pass-through.\n" +
    "//\n" +
    "// SCOPE: exhaustive over every root in item_sets.db whose primary type Imc.UsesImc accepts\n" +
    "// (Imc.cs · UsesImc · 74-85) -- equipment, accessory, weapon, monster, demihuman -- covering\n" +
    "// both ImcType.Set and ImcType.NonSet files, not just the roots a corpus .meta references.\n" +
    "export const IMC_TABLE: Record<string, number[][]> = {\n" +
    body +
    "\n};\n";
  const imcOutDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "meta",
    "reference",
  );
  mkdirSync(imcOutDir, { recursive: true });
  const imcOutPath = join(imcOutDir, "imc-table.ts");
  writeFileSync(imcOutPath, out);
  console.log(`wrote ${imcOutPath} (${Buffer.byteLength(out, "utf8")} bytes)`);
} else {
  console.log("\nNot writing imc-table.ts due to failures above.");
  process.exitCode = 1;
}
