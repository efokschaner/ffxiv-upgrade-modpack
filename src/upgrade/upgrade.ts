import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { parseMtrl, serializeMtrl } from "../mtrl/mtrl";
import type { XivMtrl } from "../mtrl/types";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../sqpack/sqpack";
import { upgradeMaterial } from "./material";
import type { UpgradeInfo } from "./upgrade-info";

// The Dawntrail upgrade pipeline. Ported incrementally from C#
// ModpackUpgrader.cs (orchestration) + EndwalkerUpgrade.cs (transforms). This
// skeleton is a structural copy; the transform rounds slot in here, in order:
//   1. materials + models (UpdateEndwalkerFiles): per-option mtrl/mdl EW->DT.
//   2. remaining textures (UpgradeRemainingTextures): normal+colorset -> index.
//   3. partials (UpdateUnclaimedHairTextures / UpdateEyeMask / UpdateSkinPaths).
// Each round rewrites option.files; keeping this a pure copy keeps the seam clean.

function cloneFile(f: ModpackFile): ModpackFile {
  // Shares the opaque `data` buffer; transforms replace whole ModpackFile
  // entries rather than mutating bytes in place.
  return { ...f };
}

function cloneOption(o: ModpackOption): ModpackOption {
  return {
    ...o,
    fileSwaps: { ...o.fileSwaps },
    manipulations: [...o.manipulations],
    files: o.files.map(cloneFile),
  };
}

function cloneGroup(g: ModpackGroup): ModpackGroup {
  return { ...g, options: g.options.map(cloneOption) };
}

/** Deep-ish copy: fresh container arrays/objects, shared opaque file bytes. */
export function cloneModpack(data: ModpackData): ModpackData {
  return {
    ...data,
    meta: { ...data.meta, tags: [...data.meta.tags] },
    groups: data.groups.map(cloneGroup),
  };
}

/** Uncompresses a ModpackFile's opaque bytes for a codec to read, regardless of source form. */
function uncompressedBytes(f: ModpackFile): Uint8Array {
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

/**
 * Re-wraps transformed uncompressed bytes back into the file's original storage form
 * (ttmp SqPackCompressed source -> re-encode as a Standard SqPack entry; pmp
 * RawUncompressed source -> store raw). Keeps writeModpack's single-storage-form
 * invariant intact — see docs/superpowers for the harness spec.
 */
function restore(f: ModpackFile, bytes: Uint8Array): ModpackFile {
  if (f.storage === FileStorageType.SqPackCompressed) {
    return { ...f, data: encodeSqPackFile(bytes, SqPackType.Standard) };
  }
  return { ...f, data: bytes };
}

const IS_CHARA_MTRL = /^chara\/.*\.mtrl$/;

/**
 * Round 1 (material half of UpdateEndwalkerFiles, EndwalkerUpgrade.cs). Rewrites
 * option.files in place on the CLONE for every chara/**.mtrl; returns the
 * UpgradeInfo targets collected for round 2 (remaining-texture round).
 */
function materialRound(option: ModpackOption): UpgradeInfo[] {
  const infos: UpgradeInfo[] = [];
  option.files = option.files.map((f) => {
    if (!IS_CHARA_MTRL.test(f.gamePath)) return f;
    let mtrl: XivMtrl;
    try {
      mtrl = parseMtrl(uncompressedBytes(f), f.gamePath);
    } catch {
      return f; // unparseable -> leave untouched (C# catch/continue)
    }
    const got = upgradeMaterial(mtrl);
    if (got.length === 0) return f; // no update needed
    infos.push(...got);
    return restore(f, serializeMtrl(mtrl));
  });
  return infos;
}

/** Round 1 (model half of UpdateEndwalkerFiles): per-option mdl EW->DT. */
function modelRound(_option: ModpackOption): void {
  // round N: ported later
}

/** Round 2 (UpgradeRemainingTextures): normal+colorset textures -> index maps. */
function textureRound(_upgradeTargets: UpgradeInfo[]): void {
  // round N: ported later
}

/** Round 3: UpdateUnclaimedHairTextures / UpdateEyeMask / UpdateSkinPaths. */
function partials(): void {
  // round N: ported later
}

/**
 * Upgrade a pre-Dawntrail modpack to Dawntrail. Runs the material round per
 * option; model/texture/partial rounds are structural no-op stubs pending
 * later tasks. Always returns a fresh ModpackData (never mutates `data`).
 */
export function upgradeModpack(data: ModpackData): ModpackData {
  const out = cloneModpack(data);
  const upgradeTargets: UpgradeInfo[] = [];
  for (const group of out.groups) {
    for (const option of group.options) {
      modelRound(option);
      upgradeTargets.push(...materialRound(option));
    }
  }
  textureRound(upgradeTargets);
  partials();
  return out;
}
