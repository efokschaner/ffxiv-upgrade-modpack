import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeVertexData,
  encodeIndices,
  encodeVertexData,
  parseGeometryLayout,
  parseMdl,
  parseVertexDeclarations,
  transpose,
} from "../../src/mdl/mdl";
import { FileStorageType, type ModpackData } from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";
import { assetFilesOf, decodedOfType, type PackContext } from "./corpus-decode";
import { confirmDocumentedDivergence } from "./geometry-divergence";
import { upgradeGoldenCached } from "./upgrade-golden";

/** A decoded model: its game path and its decompressed .mdl bytes. */
interface Model {
  gamePath: string;
  bytes: Uint8Array;
}

/** Decode the .mdl entries of a ModpackData we did NOT pre-decode (the /upgrade golden, for A2).
 *  Storage-agnostic via the same `assetFilesOf` selector the source decode uses (so A2 and the
 *  source cannot drift back to covering different files): a TTMP golden's models are SQPack payloads
 *  to inflate; a PMP golden stores each .mdl RawUncompressed, already the uncompressed model. Without
 *  this, a PMP-sourced golden matched zero models and A2 silently round-tripped nothing. Tolerates an
 *  undecodable legacy SQPack model, exactly as the shared source decode does (the raw path can't
 *  fail to decode — the bytes are taken as-is). */
function goldenModels(data: ModpackData): Model[] {
  const out: Model[] = [];
  for (const f of assetFilesOf(data)) {
    if (!f.gamePath.toLowerCase().endsWith(".mdl")) continue;
    if (f.storage === FileStorageType.RawUncompressed) {
      out.push({ gamePath: f.gamePath, bytes: f.data });
      continue;
    }
    try {
      const d = decodeSqPackFile(f.data);
      if (d.type === SqPackType.Model)
        out.push({ gamePath: f.gamePath, bytes: d.data });
    } catch {
      // tolerated undecodable legacy model (mirrors the shared decode)
    }
  }
  return out;
}

/** Byte-exact decode->transpose->encode over every mesh of every model in `models`.
 *  Returns the count of models round-tripped. A byte mismatch is only tolerated when a re-decode of
 *  our re-encoded bytes is semantically identical to the source decode (confirmDocumentedDivergence)
 *  — i.e. the difference lies solely in the reference's own lossy channels (Half4 W / NaN-Inf clamp /
 *  NaN-UV / handedness). Any real divergence throws. */
function roundTripModels(models: Model[], label: string): number {
  for (const { gamePath, bytes } of models) {
    const mdl = parseMdl(bytes, gamePath);
    const layout = parseGeometryLayout(mdl);
    const decls = parseVertexDeclarations(mdl.vertexInfo, mdl.header.meshCount);
    for (let m = 0; m < layout.meshes.length; m++) {
      const mesh = layout.meshes[m]!;
      if (mesh.vertexCount === 0) continue;
      const lod = layout.lods[layout.meshLod[m]!]!;
      const vd = decodeVertexData(
        bytes,
        mesh,
        decls[m]!,
        lod.vertexDataOffset,
        lod.indexDataOffset,
      );
      const { stream0, stream1 } = encodeVertexData(transpose(vd), decls[m]!);
      const idx = encodeIndices(vd.indices);

      const b0 = mesh.vertexDataOffset0 + lod.vertexDataOffset;
      const b1 = mesh.vertexDataOffset1 + lod.vertexDataOffset;
      const io = mesh.indexDataOffset * 2 + lod.indexDataOffset;
      const src0 = bytes.subarray(
        b0,
        b0 + mesh.vertexCount * mesh.vertexDataEntrySize0,
      );
      const src1 = bytes.subarray(
        b1,
        b1 + mesh.vertexCount * mesh.vertexDataEntrySize1,
      );
      const srcIdx = bytes.subarray(io, io + idx.length);

      const where = `${label} ${gamePath} mesh ${m}`;
      // Primary fast path: byte-exact on all three buffers.
      if (
        bytesEqual(stream0, src0) &&
        bytesEqual(stream1, src1) &&
        bytesEqual(idx, srcIdx)
      ) {
        continue;
      }

      // Byte mismatch: confirm it is confined to the reference's own lossy channels by
      // re-decoding our re-encoded bytes and proving semantic identity to the source decode.
      const buf = new Uint8Array(stream0.length + stream1.length + idx.length);
      buf.set(stream0, 0);
      buf.set(stream1, stream0.length);
      buf.set(idx, stream0.length + stream1.length);
      const mesh2 = {
        ...mesh,
        vertexDataOffset0: 0,
        vertexDataOffset1: stream0.length,
        indexDataOffset: 0,
      };
      const vd2 = decodeVertexData(
        buf,
        mesh2,
        decls[m]!,
        0,
        stream0.length + stream1.length,
      );
      const verdict = confirmDocumentedDivergence(vd, vd2);
      const which = !bytesEqual(stream0, src0)
        ? "stream0"
        : !bytesEqual(stream1, src1)
          ? "stream1"
          : "indices";
      expect(
        verdict.ok,
        `${where} ${which}: byte mismatch NOT confined to documented lossy channels (field: ${verdict.reason})`,
      ).toBe(true);
      console.log(
        `[geometry] ${gamePath} mesh ${m}: expected divergence confirmed (source non-canonical bytes in normalized channels — Half4 W / handedness / NaN-UV — re-decode is semantically identical)`,
      );
    }
  }
  return models.length;
}

// Sub-project A gate: decode->encode symmetry on real geometry. A1 runs on the corpus
// SOURCE models (no oracle, and reuses the shared decode — see corpus-decode.ts). A2 repeats on the
// cached /upgrade golden (Float-format), proving the decoder/encoder on normalized data too, and so
// must decode that golden itself. See the geometry-codec design spec.
export function registerGeometryChecks(ctx: PackContext): void {
  const { name, pack } = ctx;

  describe(`geometry corpus: ${name}`, () => {
    it("A1 source round-trip: decode->encode is byte-exact per mesh", () => {
      const models = decodedOfType(ctx, SqPackType.Model, ".mdl").map(
        ({ f, d }) => ({ gamePath: f.gamePath, bytes: d.data }),
      );
      const n = roundTripModels(models, "A1");
      console.log(`[geometry] ${name}: A1 round-tripped ${n} source model(s)`);
    }, 1_200_000);

    it("A2 golden cross-check: decode->encode is byte-exact on Float-format goldens", () => {
      const golden = upgradeGoldenCached(
        name,
        new Uint8Array(readFileSync(pack)),
      );
      if (golden === null || golden.kind === "noop") {
        console.log(`[geometry] ${name}: A2 skipped (no golden / no-op)`);
        return;
      }
      const n = roundTripModels(goldenModels(golden.data), "A2");
      console.log(`[geometry] ${name}: A2 round-tripped ${n} golden model(s)`);
    }, 1_200_000);
  });
}
