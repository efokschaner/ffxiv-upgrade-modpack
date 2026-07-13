import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import {
  decodeVertexData,
  encodeIndices,
  encodeVertexData,
  parseGeometryLayout,
  parseMdl,
  parseVertexDeclarations,
  transpose,
} from "../../src/mdl/mdl";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
} from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";
import { confirmDocumentedDivergence } from "./geometry-divergence";
import { upgradeGoldenCached } from "./upgrade-golden";

/** A ModpackFile narrowed to the always-has-bytes SqPackCompressed variant. */
type SqPackCompressedFile = Extract<
  ModpackFile,
  { storage: FileStorageType.SqPackCompressed }
>;

function mdlFilesOf(data: ModpackData): SqPackCompressedFile[] {
  return allFiles(data).filter(
    (f): f is SqPackCompressedFile =>
      f.storage === FileStorageType.SqPackCompressed &&
      f.gamePath.toLowerCase().endsWith(".mdl"),
  );
}

/** Byte-exact decode->transpose->encode over every mesh of every decodable model in `data`.
 *  Returns the count of models round-tripped (0 if none decodable). A byte mismatch is only
 *  tolerated when a re-decode of our re-encoded bytes is semantically identical to the source
 *  decode (confirmDocumentedDivergence) — i.e. the difference lies solely in the reference's own
 *  lossy channels (Half4 W / NaN-Inf clamp / NaN-UV / handedness). Any real divergence throws. */
function roundTripModels(data: ModpackData, label: string): number {
  let models = 0;
  for (const f of mdlFilesOf(data)) {
    let decoded: ReturnType<typeof decodeSqPackFile>;
    try {
      // SqPackCompressed (filtered by mdlFilesOf above) is TTMP/PMP-compressed-only and always
      // carries bytes; only a PMP RawUncompressed entry can be absent (absent-file design spec §3.1).
      decoded = decodeSqPackFile(f.data);
    } catch {
      continue; // tolerated undecodable legacy model (mirrors corpus-mdl)
    }
    if (decoded.type !== SqPackType.Model) continue;
    const bytes = decoded.data;
    const mdl = parseMdl(bytes, f.gamePath);
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

      const where = `${label} ${f.gamePath} mesh ${m}`;
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
        `[geometry] ${f.gamePath} mesh ${m}: expected divergence confirmed (source non-canonical bytes in normalized channels — Half4 W / handedness / NaN-UV — re-decode is semantically identical)`,
      );
    }
    models++;
  }
  return models;
}

// Sub-project A gate: decode->encode symmetry on real geometry. A1 runs on the corpus
// SOURCE models (no oracle). A2 repeats on the cached /upgrade golden (Float-format),
// proving the decoder/encoder on normalized data too. See the geometry-codec design spec.
export function registerGeometryChecks(pack: string): void {
  const name = basename(pack);
  const bytes = () => new Uint8Array(readFileSync(pack));

  describe(`geometry corpus: ${name}`, () => {
    it("A1 source round-trip: decode->encode is byte-exact per mesh", () => {
      const n = roundTripModels(loadModpack(name, bytes()), "A1");
      console.log(`[geometry] ${name}: A1 round-tripped ${n} source model(s)`);
    }, 1_200_000);

    it("A2 golden cross-check: decode->encode is byte-exact on Float-format goldens", () => {
      const input = bytes();
      const golden = upgradeGoldenCached(name, input);
      if (golden === null || golden.kind === "noop") {
        console.log(`[geometry] ${name}: A2 skipped (no golden / no-op)`);
        return;
      }
      const n = roundTripModels(golden.data, "A2");
      console.log(`[geometry] ${name}: A2 round-tripped ${n} golden model(s)`);
    }, 1_200_000);
  });
}
