import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FileStorageType } from "../../src/model/modpack";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";
import { texMipSizes } from "../../src/sqpack/type4";
import { bytesEqual } from "./compare";
import type { PackContext } from "./corpus-decode";
import { oracleKey, unwrapCached } from "./oracle";
import {
  compareToBaseline,
  DEFAULT_ROUNDTRIP_BASELINE,
  loadBaseline,
  saveBaseline,
} from "./upgrade-baseline";
import type { FileDiff } from "./upgrade-diff";

/** Same env var the /upgrade and /resave ratchets use (corpus-upgrade.ts:17-18). */
const BLESS = process.env.UPDATE_UPGRADE_BASELINE === "1";

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

/** Register the three sqpack checks (decode-all, self round-trip, /unwrap oracle cross-check).
 * The pack is loaded + decoded ONCE by corpus-assets.ts and shared via `ctx` — see corpus-decode.ts. */
export function registerSqpackChecks(ctx: PackContext): void {
  const { name } = ctx;
  describe(`sqpack corpus: ${name}`, () => {
    it(`decodes every compressed inner file in ${name}`, () => {
      let decoded = 0;
      for (const { d } of ctx.entries) {
        if (d === null) continue;
        expect(d.data.length).toBeGreaterThan(0);
        decoded++;
      }
      console.log(
        `[decode-all] ${name}: ${decoded}/${ctx.entries.length} decoded` +
          (ctx.legacyTex.length
            ? `; ${ctx.legacyTex.length} legacy Type-4 tolerated: ${ctx.legacyTex.join(", ")}`
            : ""),
      );
    }, 1_200_000);

    it(`self round-trips a bounded sample per type in ${name}`, () => {
      const canonicalized: string[] = [];
      const modelPadded: string[] = [];
      const roundTripDiffs: FileDiff[] = [];
      const testedByType = new Map<number, number>();
      const totalByType = new Map<number, number>();
      for (const { f, d: first } of ctx.entries) {
        if (first === null) continue;
        totalByType.set(first.type, (totalByType.get(first.type) ?? 0) + 1);
        if ((testedByType.get(first.type) ?? 0) >= SELF_CAP_PER_TYPE) continue;
        const encoded = encodeSqPackFile(first.data, first.type);
        const second = decodeSqPackFile(encoded);
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
          // Type 3 (model): a decode canonically normalizes a stored .mdl in two ways. It appends 68
          // reserved zero bytes (the output is sized `68 + decompressedSize`, and `decompressedSize`
          // already counts the same 68-byte header — Dat.cs:801, reproduced in decodeType3), and it
          // rewrites the per-LoD buffer offsets to Dat.ReadSqPackType3's running cursor, which is
          // assigned unconditionally so an unused LoD takes the end-of-geometry value rather than
          // keeping a stored 0 (Dat.cs:825/835; TexTools' own serializer writes the same value,
          // Mdl.cs:3930-3942). A game .mdl stored uncompressed in a PMP carries neither, so
          // decode(encode(x)) differs from x on both counts — a benign non-idempotency, like Type 4.
          // A decoded TTMP model is already canonical, stays byte-exact and never reaches here.
          //
          // Rather than assert the shape of that normalization ourselves, CONFIRM IT AGAINST THE
          // ORACLE: hand ConsoleTools /unwrap the very entry we compressed and require its decode to
          // equal ours byte-for-byte. That is a strictly stronger statement than any structural
          // predicate — it proves the rewritten bytes are the bytes TexTools itself produces, not
          // merely the ones we derived from reading Dat.cs — and it exercises our ENCODER too, since
          // TexTools has to be able to read what we compressed. Any Type-3 divergence the oracle does
          // not reproduce is a hard failure.
          //
          // (The separate /unwrap check below cannot cover these entries: it needs a stored compressed
          // form, and a PMP RawUncompressed entry has none. Here we supply our own.)
          if (first.type === SqPackType.Model) {
            // Policy matches the /unwrap check: a null means the output is neither cached nor
            // generable, so we cannot confirm and must fail loudly rather than skip.
            const oracleOut = unwrapCached(encoded);
            if (oracleOut === null) {
              throw new Error(
                `cannot confirm Type-3 round-trip normalization for ${f.gamePath}: ` +
                  `no cached /unwrap output and ConsoleTools unavailable`,
              );
            }
            if (bytesEqual(second.data, oracleOut)) {
              modelPadded.push(
                `${f.gamePath} (${first.data.length}->${second.data.length})`,
              );
              testedByType.set(
                first.type,
                (testedByType.get(first.type) ?? 0) + 1,
              );
              continue;
            }
          }
          // Not an oracle diff -- this is our codec contradicting itself. Ratcheted (not ignored)
          // so a KNOWN codec defect is recorded and burnable rather than blocking the whole suite;
          // anything not already in the baseline still fails hard below.
          roundTripDiffs.push({
            kind: "roundtrip",
            gamePath: f.gamePath,
            index: 0,
            status: "mismatch",
            detail: `type ${first.type}: ${first.data.length} vs ${second.data.length} bytes`,
          });
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
      if (modelPadded.length) {
        console.log(
          `[self round-trip] ${name}: ${modelPadded.length} Type-3 decode-canonicalized, confirmed byte-identical to /unwrap: ${modelPadded.join(", ")}`,
        );
      }

      // Ratchet, mirroring corpus-upgrade.ts / corpus-resave.ts: same pack key (sha256 of the input
      // pack), same BLESS env var, its own baseline root (see DEFAULT_ROUNDTRIP_BASELINE).
      const key = oracleKey(readFileSync(ctx.pack));
      if (BLESS) {
        saveBaseline(key, roundTripDiffs, DEFAULT_ROUNDTRIP_BASELINE);
        if (roundTripDiffs.length) {
          console.log(
            `[self round-trip] ${name}: blessed ${roundTripDiffs.length} known codec divergence(s)`,
          );
        }
        return;
      }
      const baseline = loadBaseline(key, DEFAULT_ROUNDTRIP_BASELINE) ?? [];
      const { ok, regressions } = compareToBaseline(roundTripDiffs, baseline);
      if (!ok) {
        expect.fail(
          `self round-trip regressions in ${name}: ` +
            regressions
              .map((r) => `${r.gamePath} (${r.detail ?? "?"})`)
              .join(", "),
        );
      }
      if (roundTripDiffs.length) {
        console.log(
          `[self round-trip] ${name}: ${roundTripDiffs.length} known codec divergence(s) within baseline: ` +
            roundTripDiffs.map((r) => r.gamePath).join(", "),
        );
      }
    }, 1_200_000);

    it(`matches /unwrap for every Type 2/3 entry in ${name}`, () => {
      const testedByType = new Map<number, number>();
      for (const { f, d: decoded } of ctx.entries) {
        if (decoded === null || decoded.type === SqPackType.Texture) continue; // /unwrap doesn't decompress Type 4
        // /unwrap decompresses a SQPack payload; a PMP RawUncompressed entry has no compressed form
        // to cross-check (its bytes are already the uncompressed game file), so there is nothing to
        // unwrap. The codec round-trips above still exercise it.
        if (f.storage !== FileStorageType.SqPackCompressed) continue;
        // Content-addressed cache: a cache hit skips the ConsoleTools spawn (~436ms) entirely.
        // Policy: fail (don't skip) when we cannot verify — a null means the oracle output is neither
        // cached nor generable (TexTools absent), so we cannot cross-check and must fail loudly.
        const oracleOut = unwrapCached(f.data);
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
