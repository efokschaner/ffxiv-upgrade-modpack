import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { parseMtrl, serializeMtrl } from "../mtrl/mtrl";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../sqpack/sqpack";
import { upgradeMaterial } from "./material";
import { needsMdlFix, normalizeModel } from "./model";
import { upgradeRemainingTextures } from "./texture";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";

interface Decoded {
  bytes: Uint8Array;
  /** Source SqPack entry type (Standard/Model/Texture); undefined for a RawUncompressed pmp file. */
  type?: SqPackType;
}

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

/** Uncompresses a ModpackFile for a codec to read, carrying the source SqPack entry type. */
export function uncompressedBytes(f: ModpackFile): Decoded {
  if (f.storage === FileStorageType.SqPackCompressed) {
    const d = decodeSqPackFile(f.data);
    return { bytes: d.data, type: d.type };
  }
  return { bytes: f.data };
}

/**
 * Re-wraps transformed uncompressed bytes into the file's original storage form. For a
 * SqPackCompressed source, re-encode with the SOURCE entry's own type — Standard for
 * .mtrl, Model for .mdl — so models stay valid Type-3 entries the game can load; for a
 * RawUncompressed (pmp) source, store raw. Keeps writeModpack's single-storage-form invariant.
 */
export function restore(
  f: ModpackFile,
  bytes: Uint8Array,
  type: SqPackType | undefined,
): ModpackFile {
  if (f.storage === FileStorageType.SqPackCompressed) {
    return { ...f, data: encodeSqPackFile(bytes, type ?? SqPackType.Standard) };
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
    try {
      const { bytes, type } = uncompressedBytes(f);
      const mtrl = parseMtrl(bytes, f.gamePath);
      const got = upgradeMaterial(mtrl);
      if (got.length === 0) return f; // no update needed
      // Record the texture-upgrade targets only AFTER the rewrite is committed: a throw from
      // serializeMtrl/restore (caught below -> file left untouched) must not leave orphaned targets
      // in the returned set pointing at a material that was never actually rewritten.
      const restored = restore(f, serializeMtrl(mtrl), type);
      infos.push(...got);
      return restored;
    } catch {
      // Unparseable, OR a material C# abandons via its own NRE (e.g. a colorset material with no
      // resolvable normal texture) -> leave the file byte-untouched. Mirrors the per-material
      // try/catch in UpdateEndwalkerMaterials (EndwalkerUpgrade.cs:522-539).
      return f;
    }
  });
  return infos;
}

const IS_MDL = /\.mdl$/;

/**
 * Round 1 (model half of UpdateEndwalkerFiles): normalize every `.mdl` via FixOldModel
 * when the pack needs the fix (TTMP major < 2). Re-wrapped as a Model (Type-3) entry.
 * Throws from the normalizer are surfaced (not swallowed) so the golden ratchet exposes
 * any unported model structure rather than silently passing the source through.
 */
function modelRound(option: ModpackOption, gate: boolean): void {
  if (!gate) return;
  option.files = option.files.map((f) => {
    if (!IS_MDL.test(f.gamePath)) return f;
    const { bytes, type } = uncompressedBytes(f);
    return restore(
      f,
      normalizeModel(bytes, f.gamePath),
      type ?? SqPackType.Model,
    );
  });
}

/** Round 3: UpdateUnclaimedHairTextures / UpdateEyeMask / UpdateSkinPaths. */
function partials(): void {
  // round N: ported later
}

/**
 * First-wins dedup key for a texture-upgrade target, mirroring the C# dict keys
 * ModpackUpgrader builds targets into before round 2 runs:
 *   IndexMaps -> files.index (EndwalkerUpgrade.cs:970)
 *   HairMaps  -> files.normal (EndwalkerUpgrade.cs:1141)
 *   Gear (else) -> files.mask_old (EndwalkerUpgrade.cs:1003/1024)
 */
function targetKey(info: UpgradeInfo): string {
  if (info.usage === EUpgradeTextureUsage.IndexMaps) return info.files.index!;
  if (info.usage === EUpgradeTextureUsage.HairMaps) return info.files.normal!;
  return info.files.mask_old!;
}

/**
 * Upgrade a pre-Dawntrail modpack to Dawntrail (ModpackUpgrader.cs:88-144).
 * Pass 1 runs the model + material rounds per option and collects the
 * texture-upgrade targets they record into a single first-wins-deduped map;
 * pass 2 applies those targets to every option's textures (round 2,
 * UpgradeRemainingTextures). The partial round remains a structural stub
 * pending a later task. Always returns a fresh ModpackData (never mutates
 * `data`).
 */
export function upgradeModpack(data: ModpackData): ModpackData {
  const out = cloneModpack(data);
  const gate = needsMdlFix(data);
  // Pass 1 (ModpackUpgrader.cs:88-120): model + material per option; collect
  // texture-upgrade targets into a single first-wins-deduped map.
  const targets = new Map<string, UpgradeInfo>();
  for (const group of out.groups) {
    for (const option of group.options) {
      modelRound(option, gate);
      for (const info of materialRound(option)) {
        const k = targetKey(info);
        if (!targets.has(k)) targets.set(k, info);
      }
    }
  }
  // Pass 2 (ModpackUpgrader.cs:124-144): apply the global targets to every option.
  for (const group of out.groups) {
    for (const option of group.options) {
      upgradeRemainingTextures(option, targets);
    }
  }
  partials();
  return out;
}
