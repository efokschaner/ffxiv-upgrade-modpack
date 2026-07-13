// Builds test/corpus/synthetic/absent-file-upgraded.pmp: like absent-file.pmp (an option whose
// Files map names a payload the archive never contains), but paired with a payload that genuinely
// upgrades, so ConsoleTools /upgrade actually WRITES a pack instead of no-opping — giving the
// writer's Files-key drop (PMP.cs:883-888) a real /upgrade golden instead of only the `/resave`
// probe + writePmp unit test. Verified empirically (spike, see docs/superpowers/plans/
// 2026-07-12-pmp-absent-file-tolerance.md Task 6): ConsoleTools writes group_001_absent.json with
// the absent gamePath's Files key gone and the surviving mtrl's key intact.
//
// Registered in build-all.ts (2026-07-13, feat/pmp-writer-regeneration Task 9). It was blocked
// until then: this pack's repro target (group_001_absent.json) already matched ConsoleTools
// byte-for-byte, but meta.json/default_mod.json did not — writePmp used to re-emit the source
// manifest documents verbatim, where TexTools' writer always regenerates them from its typed model
// (adds "Image": ""; drops Name/Description; adds "Version": 0). Task 8's writer-regeneration port
// closed that gap (see BACKLOG.md's now-fixed "writePmp round-trips the source pack..." entry), and
// this pack reaches a clean 0-diff (verified in the spike referenced above).
//
// Two things this pack must get right or it tests the wrong thing entirely:
//
// 1. Zip layout. TexTools' writer regenerates every payload entry name as
//    `<optionPrefix><gamePath>` (PmpExtensions.cs:534) rather than reusing the source archive's
//    member name — a pre-existing, otherwise-invisible divergence from our writer (which reuses
//    the source name; see BACKLOG.md, "writePmp reuses source zip member names"). For a
//    single-option group, MakeOptionPrefix (WizardData.cs:1419) collapses to the group's own
//    folder (no per-option subfolder), and MakeGroupPrefix (:1383-1412) lowercases the group name
//    via IOUtil.MakePathSafe and appends "/". A one-page, one-group, one-option pack named "Absent"
//    therefore gets optionPrefix "absent/", so every payload here is zipped at "absent/<gamePath>" —
//    matching what TexTools' writer would independently compute, so both writers agree and the
//    diff isolates the Files-key drop instead of the naming divergence.
// 2. The material must actually upgrade. DoesMtrlNeedDawntrailUpdate (EndwalkerUpgrade.cs:550)
//    fires on any 256-entry (Endwalker-era) colorset, which buildMtrlWithNormalPath below encodes,
//    with a NormalMap0 sampler bound so the colorset round's normalTex lookup
//    (EndwalkerUpgrade.cs:912, mtrl.Textures.FirstOrDefault(x => ResolveFullUsage(x) == Normal))
//    finds a match — ResolveFullUsage keys off the sampler ID alone (XivMtrl.cs:339-346), so this
//    holds regardless of the texture path text, but a realistic game path
//    (chara/equipment/.../texture/..._n.tex) is used anyway for a representative repro. The
//    referenced normal texture is deliberately NOT packed, so the second upgrade round's
//    `files.ContainsKey(upgrade.Files["normal"])` guard (EndwalkerUpgrade.cs:1840) misses and no
//    texture file is generated — keeping this pack's only non-absent payload the one .mtrl.

import { SAMPLER_NORMAL_MAP_0 } from "../../src/mtrl/types";
import { ByteBuilder } from "../../src/util/binary";
import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

const enc = new TextEncoder();

/** A hand-built EW 256-entry-colorset .mtrl (see test/mtrl/make-mtrl.ts's buildMinimalMtrl, whose
 * layout this mirrors) with one NormalMap0-sampled texture at `texturePath`, so
 * DoesMtrlNeedDawntrailUpdate fires and the colorset round's normalTex lookup succeeds. */
function buildMtrlWithNormalPath(texturePath: string): Uint8Array {
  const uv = "uv1";
  const shpk = "character.shpk";
  const shaderNameOffset = texturePath.length + 1 + uv.length + 1;
  const rawStringBlockSize = shaderNameOffset + shpk.length + 1;
  const stringBlockSize = Math.ceil(rawStringBlockSize / 4) * 4;
  const pad = stringBlockSize - rawStringBlockSize;

  const b = new ByteBuilder();
  b.i32(0x00000301); // signature
  const fileSizePos = b.length;
  b.u16(0); // fileSize (backfilled below)
  b.u16(544); // colorSetDataSize = 512 colorset + 32 EW dye
  b.u16(stringBlockSize);
  b.u16(shaderNameOffset);
  b.u8(1); // texCount
  b.u8(1); // mapCount
  b.u8(0); // colorsetCount
  b.u8(4); // additionalDataSize

  b.u16(0).u16(0); // texture[0]: offset 0, flags 0
  b.u16(texturePath.length + 1).u16(0); // uvMap[0]

  b.bytes(enc.encode(texturePath)).u8(0);
  b.bytes(enc.encode(uv)).u8(0);
  b.bytes(enc.encode(shpk)).u8(0);
  for (let i = 0; i < pad; i++) b.u8(0);

  b.bytes([0x08, 0, 0, 0]); // additionalData: dye present

  for (let i = 0; i < 256; i++) b.u16((i * 7) & 0xffff); // EW colorset
  for (let i = 0; i < 32; i++) b.u8((i * 3) & 0xff); // EW dye

  b.u16(4); // shaderConstantsDataSize (1 float)
  b.u16(1); // shaderKeyCount
  b.u16(1); // shaderConstantsCount
  b.u16(1); // textureSamplerCount
  b.u16(0x0011); // materialFlags
  b.u16(0x0022); // materialFlags2

  b.u32(0x12345678).u32(0x9abcdef0); // shader key
  b.u32(0xcafebabe).u16(0).u16(4); // shader-constant descriptor
  b.u32(SAMPLER_NORMAL_MAP_0).u32(0x00010203).u8(0).bytes([0, 0, 0]); // NormalMap0 sampler on tex 0
  b.f32(1.5); // float data block

  const out = b.toUint8Array();
  new DataView(out.buffer).setUint16(fileSizePos, out.length & 0xffff, true);
  return out;
}

// The material that genuinely upgrades. Not a gamePath /upgrade ignores — the whole point here is
// that it DOES process this one.
const mtrlGamePath =
  "chara/equipment/e9999/material/v0001/mt_c0101e9999_top_a.mtrl";
const normalTexPath = "chara/equipment/e9999/texture/v01_c0101e9999_top_n.tex";

// A gamePath the archive genuinely does not contain (mirrors absent-file.pmp). Its payload is
// never packed below, so this Files key names nothing.
const absentGamePath = "chara/dummy/absent_file_missing.bin";

// Single-option group "Absent" -> MakeOptionPrefix collapses to the group folder "absent/"
// (see header comment #1). Every zip member below must sit under that prefix.
const optionPrefix = "absent/";
const mtrlZipPath = optionPrefix + mtrlGamePath;

writePmp("absent-file-upgraded.pmp", {
  meta: syntheticMeta("Absent File Upgraded Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_absent.json": singleOptionGroup("Absent", {
      [mtrlGamePath]: mtrlZipPath.toLowerCase().replace(/\//g, "\\"),
      [absentGamePath]: (optionPrefix + absentGamePath)
        .toLowerCase()
        .replace(/\//g, "\\"),
    }),
  },
  files: { [mtrlZipPath]: buildMtrlWithNormalPath(normalTexPath) },
});
