// Generates src/meta/reference/est-table.ts.
//
// EST reconstruction (Task 7, src/meta/reconstruct.ts) seeds each .meta's EST segment from the
// base game before applying the mod's own deltas (mirrors Est.GetExtraSkeletonEntry falling back
// to the base-game entries, Est.cs:345-360). That requires a (race, setId) -> skelId lookup per
// EST type, extracted directly from the four base-game EST files ConsoleTools ships.
//
// NOTE (authorized scope change from the round-5 task-6 brief): EQP/GMP extraction was
// intentionally dropped. The scoping spike found EQP/GMP segments never grow and never mismatch
// across the corpus -- mods always provide them, so pass-through is already byte-exact and a base
// EQP/GMP seed is never consulted. Bundling them would be dead data; the golden ratchet will flag
// the theoretical mod-omits-EQP/GMP case if it ever appears, at which point we'd extract them.
//
// Regenerate via `npx tsx scripts/extract-meta-reference.ts`.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// oracle.ts reads __dirname at module scope (Vite-only global); shim it before importing. See
// scripts/extract-shader-params.ts for the rationale.
(globalThis as unknown as { __dirname: string }).__dirname = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "helpers",
);
const { extractGameFile } = await import("../test/helpers/oracle");

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
