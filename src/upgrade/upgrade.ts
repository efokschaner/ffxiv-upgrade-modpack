import type {
  ModpackData,
  ModpackFile,
  ModpackGroup,
  ModpackOption,
} from "../model/modpack";

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

/** Upgrade a pre-Dawntrail modpack to Dawntrail. Skeleton: structural identity. */
export function upgradeModpack(data: ModpackData): ModpackData {
  return cloneModpack(data);
}
