import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadModpack } from "../../src/index";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
} from "../../src/model/modpack";
import {
  type DecodedFile,
  decodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";

/**
 * The ONE load + SQPack decode of a corpus pack, shared by every asset-level check.
 *
 * Why this exists: the sqpack / mtrl / tex / mdl / geometry checks used to be five separate work
 * units, each re-doing `readFileSync -> loadModpack -> decodeSqPackFile` from scratch in its own
 * worker process. Measured on the biggest pack, the `tex` check spent 3951 ms re-decoding and only
 * 189 ms actually asserting (mdl 110/3, mtrl 64/3) — ~95% of those checks was duplicated inflate of
 * bytes the `sqpack` unit had already decoded. They now run as ONE unit (corpus-assets.ts) over the
 * decode this module performs once.
 */

/** A ModpackFile narrowed to the always-has-bytes SqPackCompressed variant. */
export type SqPackCompressedFile = Extract<
  ModpackFile,
  { storage: FileStorageType.SqPackCompressed }
>;

/** One compressed inner file paired with its decode result. `d` is null IFF this is a tolerated
 *  Type-4 decode failure (see decodeTolerant) — never for a Type 2/3, which must always decode. */
export interface DecodedEntry {
  f: SqPackCompressedFile;
  d: DecodedFile | null;
}

/** The shared, decoded view of one pack. Populated in the unit's `beforeAll` (registration runs at
 *  collect time, so the checks close over this object and read it when their `it` executes) and
 *  released in `afterAll` so per-worker memory stays at ~one pack. */
export interface PackContext {
  pack: string;
  name: string;
  entries: DecodedEntry[];
  legacyTex: string[];
}

export function newPackContext(pack: string): PackContext {
  return { pack, name: basename(pack), entries: [], legacyTex: [] };
}

/** The SQPack entry type is the int32 at offset 4 — readable without decompressing. */
export function entryType(f: SqPackCompressedFile): number {
  // SqPackCompressed (filtered by compressedFiles below) always carries bytes; only a PMP
  // RawUncompressed entry can be absent (absent-file design spec §3.1) — the type guarantees it here.
  const data = f.data;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(
    4,
    true,
  );
}

export function compressedFilesOf(data: ModpackData): SqPackCompressedFile[] {
  return allFiles(data).filter(
    (f): f is SqPackCompressedFile =>
      f.storage === FileStorageType.SqPackCompressed,
  );
}

/**
 * Decode a file, tolerating ONLY Type-4 (texture) decode failures. A tiny number of legacy textures
 * (imported by old TexTools with improper block spacing) trip the skip/rewind block-recovery heuristic;
 * our reader ports that heuristic faithfully from Dat.cs, so those files are undecodable by the reference
 * algorithm too. We log and tolerate them for Type 4, but any Type-2/3 decode failure is a hard error.
 */
function decodeTolerant(
  f: SqPackCompressedFile,
  legacyTex: string[],
): DecodedFile | null {
  try {
    return decodeSqPackFile(f.data);
  } catch (err) {
    if (entryType(f) === SqPackType.Texture) {
      legacyTex.push(`${f.gamePath} (${(err as Error).message})`);
      return null;
    }
    throw err; // Type 2/3 must always decode.
  }
}

/** Load `ctx.pack` and decode every compressed inner file into `ctx`. Called once, in beforeAll. */
export function decodePack(ctx: PackContext): void {
  const data = loadModpack(ctx.name, new Uint8Array(readFileSync(ctx.pack)));
  ctx.entries = compressedFilesOf(data).map((f) => ({
    f,
    d: decodeTolerant(f, ctx.legacyTex),
  }));
}

/** Every successfully-decoded entry of `type` whose gamePath ends in `ext`. */
export function decodedOfType(
  ctx: PackContext,
  type: SqPackType,
  ext?: string,
): Array<{ f: SqPackCompressedFile; d: DecodedFile }> {
  const out: Array<{ f: SqPackCompressedFile; d: DecodedFile }> = [];
  for (const { f, d } of ctx.entries) {
    if (d === null || d.type !== type) continue;
    if (ext && !f.gamePath.toLowerCase().endsWith(ext)) continue;
    out.push({ f, d });
  }
  return out;
}

/** Count of entries whose gamePath ends in `ext` but which failed to decode (tolerated legacy). */
export function legacySkippedCount(ctx: PackContext, ext: string): number {
  return ctx.entries.filter(
    (e) => e.d === null && e.f.gamePath.toLowerCase().endsWith(ext),
  ).length;
}
