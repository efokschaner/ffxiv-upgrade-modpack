import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import {
  allFiles,
  FileStorageType,
  type ModpackFile,
} from "../../src/model/modpack";
import {
  type DecodedFile,
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";
import { texMipSizes } from "../../src/sqpack/type4";
import { bytesEqual } from "./compare";
import { unwrapCached } from "./oracle";

const TEX_HEADER_SIZE = 80;

/** Canonical decompressed length of a Type-4 tex: 80-byte header + sum of formula-derived mip sizes. */
function canonicalTexLength(decoded: Uint8Array): number {
  const dv = new DataView(
    decoded.buffer,
    decoded.byteOffset,
    decoded.byteLength,
  );
  const format = dv.getUint32(4, true);
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const mipCount = decoded[14]! & 0xf;
  const sizes = texMipSizes(format, width, height).slice(0, mipCount);
  return TEX_HEADER_SIZE + sizes.reduce((a, b) => a + b, 0);
}

const SELF_CAP_PER_TYPE = 25; // full round-trip cap per SqPack type per pack

/** True when one buffer is a byte-exact prefix of the other (they differ only in trailing bytes). */
function isPrefixRelation(a: Uint8Array, b: Uint8Array): boolean {
  const m = Math.min(a.length, b.length);
  for (let i = 0; i < m; i++) if (a[i] !== b[i]) return false;
  return true;
}

function compressedFiles(path: string): ModpackFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f) => f.storage === FileStorageType.SqPackCompressed,
  );
}

/** The SQPack entry type is the int32 at offset 4 — readable without decompressing. */
function entryType(f: ModpackFile): number {
  // SqPackCompressed (filtered by compressedFiles above) always carries bytes; only a PMP
  // RawUncompressed entry can be absent (absent-file design spec §3.1).
  const data = f.data!;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(
    4,
    true,
  );
}

/**
 * Decode a file, tolerating ONLY Type-4 (texture) decode failures. A tiny number of legacy textures
 * (imported by old TexTools with improper block spacing) trip the skip/rewind block-recovery heuristic;
 * our reader ports that heuristic faithfully from Dat.cs, so those files are undecodable by the reference
 * algorithm too. We log and tolerate them for Type 4, but any Type-2/3 decode failure is a hard error.
 */
function decodeTolerant(
  f: ModpackFile,
  legacyTex: string[],
): DecodedFile | null {
  try {
    // SqPackCompressed (filtered by compressedFiles above) always carries bytes; only a PMP
    // RawUncompressed entry can be absent (absent-file design spec §3.1).
    return decodeSqPackFile(f.data!);
  } catch (err) {
    if (entryType(f) === SqPackType.Texture) {
      legacyTex.push(`${f.gamePath} (${(err as Error).message})`);
      return null;
    }
    throw err; // Type 2/3 must always decode.
  }
}

/** One compressed inner file paired with its tolerant decode result — d is null iff a tolerated Type-4 failure. */
interface PackEntry {
  f: ModpackFile;
  d: DecodedFile | null;
}

/** Register the three sqpack checks (decode-all, self round-trip, /unwrap oracle cross-check) for one
 * pack. The pack is read + parsed + decoded ONCE in beforeAll and shared by the three its; afterAll
 * releases the decoded data so per-worker memory stays at ~one pack. */
export function registerSqpackChecks(pack: string): void {
  const name = basename(pack);
  describe(`sqpack corpus: ${name}`, () => {
    let entries: PackEntry[] = [];
    const legacyTex: string[] = [];

    beforeAll(() => {
      entries = compressedFiles(pack).map((f) => ({
        f,
        d: decodeTolerant(f, legacyTex),
      }));
    }, 1_200_000);

    afterAll(() => {
      entries = [];
    });

    it(`decodes every compressed inner file in ${name}`, () => {
      let decoded = 0;
      for (const { d } of entries) {
        if (d === null) continue;
        expect(d.data.length).toBeGreaterThan(0);
        decoded++;
      }
      console.log(
        `[decode-all] ${name}: ${decoded}/${entries.length} decoded` +
          (legacyTex.length
            ? `; ${legacyTex.length} legacy Type-4 tolerated: ${legacyTex.join(", ")}`
            : ""),
      );
    }, 1_200_000);

    it(`self round-trips a bounded sample per type in ${name}`, () => {
      const canonicalized: string[] = [];
      const testedByType = new Map<number, number>();
      const totalByType = new Map<number, number>();
      for (const { f, d: first } of entries) {
        if (first === null) continue;
        totalByType.set(first.type, (totalByType.get(first.type) ?? 0) + 1);
        if ((testedByType.get(first.type) ?? 0) >= SELF_CAP_PER_TYPE) continue;
        const second = decodeSqPackFile(
          encodeSqPackFile(first.data, first.type),
        );
        if (!bytesEqual(first.data, second.data)) {
          // Type 4 encode re-derives mip sizes from the canonical formula (exactly as SE's
          // Tex.CompressTexFile does), so a texture whose stored mip tail is non-canonical is
          // canonicalized on re-encode — SE is non-idempotent here too. Tolerate ONLY when BOTH:
          // (1) one output is a byte-exact prefix of the other (content matches, differs only in the
          // trailing tail), AND (2) the re-decoded length equals the canonical formula-derived length.
          // (2) proves the difference is exactly mip-tail canonicalization and rules out an arbitrary
          // Type-4 encode truncation bug (which prefix-relation alone would mask). Any mid-content
          // divergence, a non-canonical re-decoded length, or any Type-2/3 mismatch is a hard failure.
          if (
            first.type === SqPackType.Texture &&
            isPrefixRelation(first.data, second.data) &&
            second.data.length === canonicalTexLength(second.data)
          ) {
            canonicalized.push(
              `${f.gamePath} (${first.data.length}->${second.data.length})`,
            );
            testedByType.set(
              first.type,
              (testedByType.get(first.type) ?? 0) + 1,
            );
            continue;
          }
          expect.fail(
            `self round-trip mismatch (type ${first.type}) for ${f.gamePath}: ` +
              `${first.data.length} vs ${second.data.length} bytes`,
          );
        }
        testedByType.set(first.type, (testedByType.get(first.type) ?? 0) + 1);
      }
      for (const [type, total] of totalByType) {
        console.log(
          `[self round-trip] ${name}: type ${type} tested ${testedByType.get(type) ?? 0}/${total}`,
        );
      }
      if (canonicalized.length) {
        console.log(
          `[self round-trip] ${name}: ${canonicalized.length} Type-4 mip-canonicalized (trailing-byte only): ${canonicalized.join(", ")}`,
        );
      }
    }, 1_200_000);

    it(`matches /unwrap for every Type 2/3 entry in ${name}`, () => {
      const testedByType = new Map<number, number>();
      for (const { f, d: decoded } of entries) {
        if (decoded === null || decoded.type === SqPackType.Texture) continue; // /unwrap doesn't decompress Type 4
        // Content-addressed cache: a cache hit skips the ConsoleTools spawn (~436ms) entirely.
        // Policy: fail (don't skip) when we cannot verify — a null means the oracle output is neither
        // cached nor generable (TexTools absent), so we cannot cross-check and must fail loudly.
        // SqPackCompressed (filtered by compressedFiles above) always carries bytes; only a PMP
        // RawUncompressed entry can be absent (absent-file design spec §3.1).
        const oracleOut = unwrapCached(f.data!);
        if (oracleOut === null) {
          throw new Error(
            `cannot cross-check ${f.gamePath}: no cached /unwrap output and ConsoleTools unavailable`,
          );
        }
        expect(bytesEqual(decoded.data, oracleOut)).toBe(true);
        testedByType.set(
          decoded.type,
          (testedByType.get(decoded.type) ?? 0) + 1,
        );
      }
      for (const [type, tested] of testedByType) {
        console.log(`[/unwrap] ${name}: type ${type} cross-checked ${tested}`);
      }
    }, 1_200_000);
  });
}
