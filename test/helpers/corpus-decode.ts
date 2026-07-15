import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadModpack } from "../../src/index";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type RawUncompressedFile,
  type SqPackCompressedFile,
} from "../../src/model/modpack";
import {
  type DecodedFile,
  decodeSqPackFile,
  detectTypeFromGamePath,
  SqPackType,
} from "../../src/sqpack/sqpack";

/**
 * The ONE load + decode of a corpus pack, shared by every asset-level check.
 *
 * Why this exists: the sqpack / mtrl / tex / mdl / geometry checks used to be five separate work
 * units, each re-doing `readFileSync -> loadModpack -> decodeSqPackFile` from scratch in its own
 * worker process. Measured on the biggest pack, the `tex` check spent 3951 ms re-decoding and only
 * 189 ms actually asserting (mdl 110/3, mtrl 64/3) — ~95% of those checks was duplicated inflate of
 * bytes the `sqpack` unit had already decoded. They now run as ONE unit (corpus-assets.ts) over the
 * decode this module performs once.
 *
 * Storage-agnostic on purpose: a TTMP stores each game file as an SQPack-compressed payload, but a
 * PMP stores it `RawUncompressed` — a plain zip member, already the uncompressed game file. Both
 * kinds flow through here so the codec checks run over BOTH. (A SqPack-only filter would silently
 * exclude every PMP pack's assets — they are all RawUncompressed — leaving the codecs untested over
 * the newer half of the corpus.)
 */

/** A RawUncompressed file that actually carries bytes. An absent PMP entry (data === undefined — the
 *  archive lacked the named member, absent-file design spec §3.1) is filtered out by `assetFilesOf`,
 *  so it never reaches a check as an empty payload. */
export type PresentRawFile = RawUncompressedFile & { data: Uint8Array };

/** One asset file a check operates on: a compressed SQPack entry (TTMP) or a present raw file (PMP).
 *  Both always carry `data`; `storage` discriminates for the /unwrap oracle, which only a
 *  SqPackCompressed payload can feed. */
export type AssetFile = SqPackCompressedFile | PresentRawFile;

/** One asset file paired with its decode result. `d` is null IFF this is a tolerated Type-4
 *  (texture) SQPack decode failure (see decodeEntry) — never for a Type 2/3, and never for a
 *  RawUncompressed file (which is used as-is and cannot fail to decode). */
export interface DecodedEntry {
  f: AssetFile;
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

/** The SQPack entry type is the int32 at offset 4 — readable without decompressing. Only defined for
 *  a SqPackCompressed payload (a RawUncompressed file has no SQPack header); the type guarantees the
 *  caller has narrowed to that variant, so `f.data` is always present. */
export function entryType(f: SqPackCompressedFile): number {
  const data = f.data;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(
    4,
    true,
  );
}

/** Only the SqPackCompressed game files of a pack — the compressed payloads. Used by the geometry
 *  A2 check to decode a /upgrade golden ModpackData directly (not via the shared decode). The
 *  source-side shared decode uses `assetFilesOf` instead, which spans both storage kinds. */
export function compressedFilesOf(data: ModpackData): SqPackCompressedFile[] {
  return allFiles(data).filter(
    (f): f is SqPackCompressedFile =>
      f.storage === FileStorageType.SqPackCompressed,
  );
}

/** Every file a per-asset check should look at, across BOTH storage kinds:
 *  - SqPackCompressed (TTMP): the compressed payload, inflated by `decodeEntry`.
 *  - RawUncompressed (PMP): the raw game file — a PMP stores game files uncompressed, so there is
 *    nothing to inflate; `decodeEntry` wraps the bytes as-is with the type from the game path.
 *  An absent PMP entry (data === undefined, absent-file design spec §3.1) carries no bytes and is
 *  skipped — it must not be treated as an empty payload. */
export function assetFilesOf(data: ModpackData): AssetFile[] {
  const out: AssetFile[] = [];
  for (const f of allFiles(data)) {
    if (f.storage === FileStorageType.SqPackCompressed) out.push(f);
    else if (f.data !== undefined) out.push(f as PresentRawFile);
  }
  return out;
}

/**
 * Decode one asset entry into its uncompressed DecodedFile.
 *
 * - RawUncompressed (PMP): the bytes are already the uncompressed game file, so wrap them as-is with
 *   the type derived from the game path. Nothing can fail, so this branch never returns null.
 * - SqPackCompressed (TTMP): inflate via decodeSqPackFile, tolerating ONLY a Type-4 (texture)
 *   failure. A tiny number of legacy textures (imported by old TexTools with improper block spacing)
 *   trip the skip/rewind block-recovery heuristic; our reader ports that heuristic faithfully from
 *   Dat.cs, so those files are undecodable by the reference algorithm too. We log and tolerate them
 *   for Type 4, but any Type-2/3 decode failure is a hard error.
 */
function decodeEntry(f: AssetFile, legacyTex: string[]): DecodedFile | null {
  if (f.storage === FileStorageType.RawUncompressed) {
    return { type: detectTypeFromGamePath(f.gamePath), data: f.data };
  }
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

/** Load `ctx.pack` and decode every asset file into `ctx`. Called once, in beforeAll. */
export function decodePack(ctx: PackContext): void {
  const data = loadModpack(ctx.name, new Uint8Array(readFileSync(ctx.pack)));
  ctx.entries = assetFilesOf(data).map((f) => ({
    f,
    d: decodeEntry(f, ctx.legacyTex),
  }));
}

/** Every successfully-decoded entry of `type` whose gamePath ends in `ext`. */
export function decodedOfType(
  ctx: PackContext,
  type: SqPackType,
  ext?: string,
): Array<{ f: AssetFile; d: DecodedFile }> {
  const out: Array<{ f: AssetFile; d: DecodedFile }> = [];
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
