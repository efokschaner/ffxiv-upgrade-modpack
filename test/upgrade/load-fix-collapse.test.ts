import { describe, expect, it } from "vitest";
import type {
  ModPackJson,
  TtmpModsJson,
} from "../../src/container/manifest-types";
import { loadModpack, upgradeModpack } from "../../src/index";
import { parseMdl } from "../../src/mdl/mdl";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";
import { encodeType4, texMipSizes } from "../../src/sqpack/type4";
import { normalizeModel } from "../../src/upgrade/model";
import { writeZip } from "../../src/zip/zip";
import { corpusModels } from "../helpers/corpus-models";

// These pin FromWizardGroup's fix-then-collapse ORDER (WizardData.cs:700-737): the per-file load
// fix runs BEFORE the last-write-wins collapse `.set`, so a later duplicate FullPath whose fix
// DROPS it (C# `catch { continue }`) never overwrites the earlier survivor. Both drive loadModpack,
// which wires makeTtmpLoadFix into the reader — the seam under test.

const enc = new TextEncoder();

/**
 * A wizard TTMP2 (one page/group/option) whose ModsJsons lists `path` TWICE, first pointing at
 * `first`, then at `second` — the duplicate-FullPath shape FromWizardGroup collapses. `version`
 * sets TTMPVersion so the reader's needsTexFix/needsMdlFix gate fires (major < 2 → both true).
 */
function buildDupWizardTtmp2(
  version: string,
  path: string,
  first: Uint8Array,
  second: Uint8Array,
): Uint8Array {
  const mpd = new Uint8Array(first.length + second.length);
  mpd.set(first, 0);
  mpd.set(second, first.length);
  const mod = (name: string, off: number, size: number): TtmpModsJson => ({
    Name: name,
    Category: "Body",
    FullPath: path,
    ModOffset: off,
    ModSize: size,
    DatFile: "040000.win32.dat0",
    IsDefault: false,
  });
  const mpl: ModPackJson = {
    TTMPVersion: version,
    Name: "Dup",
    Author: "test",
    Version: "1.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [
      {
        PageIndex: 0,
        ModGroups: [
          {
            GroupName: "Choice",
            SelectionType: "Single",
            OptionList: [
              {
                Name: "A",
                Description: "",
                ImagePath: "",
                GroupName: "Choice",
                SelectionType: "Single",
                ModsJsons: [
                  mod("first", 0, first.length),
                  mod("second", first.length, second.length),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  return writeZip(
    new Map<string, Uint8Array>([
      ["TTMPL.mpl", enc.encode(JSON.stringify(mpl))],
      ["TTMPD.mpd", mpd],
    ]),
  );
}

// --- .tex blob builders (copied from test/upgrade/texfix.test.ts) ---
const TEX_HEADER_SIZE = 80;
const BC5 = 25136;

function makeUncompressedTex(
  width: number,
  height: number,
  mipCount: number,
): Uint8Array {
  const sizes = texMipSizes(BC5, width, height).slice(0, mipCount);
  const total = sizes.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(TEX_HEADER_SIZE + total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, BC5, true);
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, 1, true);
  buf[14] = mipCount & 0xf;
  for (let i = TEX_HEADER_SIZE; i < buf.length; i++)
    buf[i] = (i * 17 + 3) & 0xff;
  return buf;
}

function validTexEntry(): Uint8Array {
  return encodeType4(makeUncompressedTex(16, 16, 1));
}

/** A malformed Type-4 entry: uncompressedFileSize (bytes [8..12)) patched below the tex header,
 *  making decodeType4 throw (Dat.cs:908-909). */
function malformedTexEntry(): Uint8Array {
  const entry = validTexEntry().slice();
  new DataView(entry.buffer, entry.byteOffset).setInt32(8, 16, true);
  return entry;
}

/** The first decompressed corpus model that survives normalizeModel (FixOldModel), for the valid
 *  first copy of the .mdl case. */
function normalizableModelBytes(): Uint8Array {
  for (const cm of corpusModels()) {
    try {
      normalizeModel(cm.bytes, cm.gamePath);
      return cm.bytes;
    } catch {
      // out-of-scope structure — try the next model
    }
  }
  throw new Error("no normalizable model in test/corpus/real");
}

describe("load-fix + collapse ordering (WizardData.FromWizardGroup, WizardData.cs:700-737)", () => {
  it(".tex: a duplicate whose LATER copy is malformed keeps the earlier VALID copy (fix-then-collapse)", () => {
    const path = "chara/x/tex/dup_n.tex";
    const first = validTexEntry();
    const second = malformedTexEntry();
    // needsTexFix (major < 2): the malformed later copy fails FixOldTexData -> continue (dropped),
    // so it never overwrites the valid earlier copy in the collapse.
    const bytes = buildDupWizardTtmp2("1.3w", path, first, second);

    const data = loadModpack("dup.ttmp2", bytes);
    const files = data.groups[0]!.options[0]!.files;

    expect(files.has(path)).toBe(true);
    // Kept copy is the FIRST (valid) one, bytes unchanged (texFix is a validity check only).
    expect(Array.from(files.get(path)!.data!)).toEqual(Array.from(first));
  });

  it(".mdl: a duplicate whose LATER copy is corrupt keeps the earlier VALID copy and never throws (closes model-round-throw)", () => {
    const path = "chara/human/c0101/obj/body/b0001/model/c0101b0001.mdl";
    const first = encodeSqPackFile(normalizableModelBytes(), SqPackType.Model);
    // Decodes fine, but its decompressed bytes fail parseMdl -> FixOldModel throws -> continue.
    const second = encodeSqPackFile(
      new Uint8Array([1, 2, 3, 4]),
      SqPackType.Standard,
    );
    const bytes = buildDupWizardTtmp2("1.3w", path, first, second);

    const data = loadModpack("dup.ttmp2", bytes);
    const files = data.groups[0]!.options[0]!.files;

    expect(files.has(path)).toBe(true);
    // Kept copy is the FIRST (valid) one, normalized by FixOldModel to a v6 model.
    const decoded = decodeSqPackFile(files.get(path)!.data!);
    expect(parseMdl(decoded.data, path).header.version).toBe(6);
    // The corrupt later copy was DROPPED at load, so the whole pipeline no longer throws.
    expect(() => upgradeModpack(data)).not.toThrow();
  });
});
