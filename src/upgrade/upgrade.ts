import { deserializeMeta } from "../meta/deserialize";
import { reconstructMeta } from "../meta/reconstruct";
import { serializeMeta } from "../meta/serialize";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  type ModpackGroup,
  type ModpackOption,
  type RawUncompressedFile,
  type SqPackCompressedFile,
} from "../model/modpack";
import { parseMtrl, serializeMtrl } from "../mtrl/mtrl";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../sqpack/sqpack";
import { upgradeMaterial } from "./material";
import { HAIR_MATERIALS } from "./reference/hair-materials";
import { SKIN_REPATH_DICT } from "./skin-repath-dict";
import { upgradeRemainingTextures } from "./texture";
import {
  updateUnclaimedHairAccessory,
  updateUnclaimedHairTextures,
} from "./unclaimed-hair";
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
    files: new Map([...o.files].map(([p, f]) => [p, cloneFile(f)])),
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
    // Fresh Map: `...data` would otherwise share the SOURCE map by reference, so a caller mutating
    // the clone's extraFiles (or a future upgrade round adding/removing entries) would mutate
    // `data` too — silently contradicting this function's (and upgradeModpack's) "never mutates
    // `data`" contract. The values (Uint8Array payloads) stay shared/opaque, matching cloneFile.
    extraFiles: data.extraFiles && new Map(data.extraFiles),
  };
}

/**
 * Port of EndwalkerUpgrade.ResolveFile, the file-list branch (EndwalkerUpgrade.cs:1761-1774).
 * Returns the file's uncompressed bytes for a codec to read, carrying the source SqPack entry
 * type — or NULL when the file has no bytes, mirroring C#'s
 * `if (RealPath == null || !File.Exists(RealPath)) return null;` (:1765) for a PMP `Files` entry
 * the archive never contained — OR when decoding throws, mirroring the `catch { return null; }`
 * wrapped around the read (:1771-1774). The `tx` fallback (:1777-1782) has no analogue here: our
 * model carries no transaction store to fall back to.
 *
 * Callers must NOT treat null uniformly: each C# call site decides for itself, and they disagree.
 * See the per-seam table in docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md §2.
 */
export function resolveFile(f: ModpackFile): Decoded | null {
  if (!f.data) return null;
  if (f.storage === FileStorageType.SqPackCompressed) {
    try {
      const d = decodeSqPackFile(f.data);
      return { bytes: d.data, type: d.type };
    } catch {
      return null;
    }
  }
  return { bytes: f.data };
}

/**
 * A DIRECT read — NOT a ResolveFile port. Used only at seams whose C# counterpart reads the file
 * unguarded, with no ResolveFile call and therefore no swallow-and-return-null around a decode
 * failure: throws when the file has no bytes at all, and lets a decode error propagate unchanged
 * (rather than mapping it to the same "no bytes" error) so a corrupt entry surfaces its real
 * failure instead of a misleading one. Use ONLY for seams that are not ResolveFile callers (see
 * the §2 table) — everything that IS a ResolveFile call site must use `resolveFile` instead.
 */
export function requireBytes(f: ModpackFile, gamePath: string): Decoded {
  if (!f.data) throw new Error(`upgrade: file has no bytes: ${gamePath}`);
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
  f: SqPackCompressedFile,
  bytes: Uint8Array,
  type: SqPackType | undefined,
): SqPackCompressedFile;
export function restore(
  f: RawUncompressedFile,
  bytes: Uint8Array,
  type: SqPackType | undefined,
): RawUncompressedFile;
// Fallback for a caller whose `f` is not yet narrowed to a specific ModpackFile variant (e.g.
// a `.map()` over `option.files: ModpackFile[]`) — keeps the two narrower overloads above for
// callers that DO have a narrowed input, without forcing every call site to narrow first.
export function restore(
  f: ModpackFile,
  bytes: Uint8Array,
  type: SqPackType | undefined,
): ModpackFile;
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
  function upgradeOne(path: string, f: ModpackFile): ModpackFile {
    if (!IS_CHARA_MTRL.test(path)) return f;
    // ResolveFile returned null -> UpdateEndwalkerMaterials `continue`s past this material
    // (EndwalkerUpgrade.cs:495-499), leaving the entry untouched. Hoisted ABOVE the try/catch
    // below: C#'s `continue` (:496-499) precedes the per-material `try` (:501), so a
    // resolve-failure must skip before the parse/serialize failure handler ever runs, not fall
    // through it.
    const resolved = resolveFile(f);
    if (!resolved) return f;
    const { bytes, type } = resolved;
    try {
      const mtrl = parseMtrl(bytes, path);
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
  }
  const next = new Map<string, ModpackFile>();
  for (const [path, f] of option.files) next.set(path, upgradeOne(path, f));
  option.files = next;
  return infos;
}

const IS_META = /\.meta$/;

/**
 * Metadata round (round 5). Replaces the opaque .meta pass-through: reconstruct each .meta the
 * way ConsoleTools /upgrade does (base-game seed + mod deltas). See
 * docs/superpowers/specs/2026-07-10-metadata-round-design.md.
 */
function metadataRound(option: ModpackOption): void {
  function fixOne(path: string, f: ModpackFile): ModpackFile {
    if (!IS_META.test(path)) return f;
    // No absent-file analogue: PMP .meta files are materialized from manipulations
    // (PMP.cs:1141-1164), never read from a zip member, so a .meta with no bytes is unreachable.
    // Write-side confirmation: TexTools' PMP writer turns any `.meta` into `Manipulations` rather
    // than a zip member (PMP.cs:891-895), so a PMP `Files` entry naming a `.meta` is not something
    // TexTools or Penumbra produce. Fail loud.
    const { bytes, type } = requireBytes(f, path);
    const out = serializeMeta(reconstructMeta(deserializeMeta(bytes), path));
    return restore(f, out, type ?? SqPackType.Standard);
  }
  const next = new Map<string, ModpackFile>();
  for (const [path, f] of option.files) next.set(path, fixOne(path, f));
  option.files = next;
}

/**
 * Round 6 partials, slice 1: UpdateSkinPaths (ModpackUpgrader.cs:484-500). For each file whose
 * game path is a key in SKIN_REPATH_DICT, add a byte-identical alias at the target path unless the
 * option already contains it — pure pointer duplication, no content change. Mutates option.files.
 *
 * C# iterates a snapshot (`clone`) of the option's files but checks the LIVE dict for the target,
 * so a target added earlier in this same pass is seen; we mirror that by snapshotting the source
 * list and checking `option.files.has(target)` directly against the growing, live Map.
 * UpdateUnclaimedHairTextures (the rest of the includePartials block, ModpackUpgrader.cs:158-182) is
 * ported in `partials`; UpdateEyeMask alone remains unported — see
 * docs/backlog/2026-07-15-partials-eye-mask.md.
 */
export function updateSkinPaths(option: ModpackOption): void {
  const snapshot = [...option.files];
  for (const [path, f] of snapshot) {
    const target = SKIN_REPATH_DICT.get(path);
    if (target === undefined) continue;
    if (option.files.has(target)) continue; // C# files.ContainsKey (ModpackUpgrader.cs:487)
    // Duplicate the pointer: shares f.data, carries storage + any ttmp metadata.
    option.files.set(target, { ...f }); // C# files.Add (ModpackUpgrader.cs:497)
  }
}

/**
 * Round 6 partials (ModpackUpgrader.cs:148-183, the includePartials block). Runs UpdateSkinPaths
 * over every option first (ForAllOptions, :158), then the third round (:162-182): per option,
 * `contained` = `unused` (globally-unreferenced textures, {@link computeUnusedTextures}) intersected
 * with that option's own files (:171, `o.StandardData.Files.ContainsKey(x)`), fed to the
 * hair/tail/ear rescue and the accessory rescue (both `EndwalkerUpgrade.UpdateUnclaimedHairTextures`
 * calls fused into the C#'s single wrapper, :172/:1324-1330 — see src/upgrade/unclaimed-hair.ts).
 * `UpdateEyeMask` (:174-177) remains deferred — docs/backlog/2026-07-15-partials-eye-mask.md.
 */
function partials(data: ModpackData, unused: Set<string>): void {
  for (const group of data.groups) {
    for (const option of group.options) {
      updateSkinPaths(option); // ForAllOptions (ModpackUpgrader.cs:158)
    }
  }
  for (const group of data.groups) {
    for (const option of group.options) {
      // ModpackUpgrader.cs:171: `unusedTextures.Where(x => o.StandardData.Files.ContainsKey(x))`.
      const contained = new Set([...unused].filter((t) => option.files.has(t)));
      updateUnclaimedHairTextures(option, contained, HAIR_MATERIALS);
      updateUnclaimedHairAccessory(option, contained, HAIR_MATERIALS);
    }
  }
}

/**
 * A texture is "unused" (a candidate for the round-6 jank-upgrade rescue) iff it is not any VALUE
 * of any texture-upgrade target's `files` (ModpackUpgrader.cs:151-155:
 * `!textureUpgradeTargets.Any(x => x.Value.Files.ContainsValue(t))`). `UpgradeInfo.files` mirrors
 * C#'s `Dictionary<string,string>` (`normal`/`mask`/`index`/`mask_old`/`mask_new` keys) as a
 * `Record<string,string>` (src/upgrade/upgrade-info.ts), so "any value" is `Object.values`.
 * Exported for unit testing (see test/upgrade/unclaimed-hair.test.ts).
 */
export function computeUnusedTextures(
  allTextures: Set<string>,
  targets: Map<string, UpgradeInfo>,
): Set<string> {
  const used = new Set<string>();
  for (const info of targets.values()) {
    for (const v of Object.values(info.files)) used.add(v);
  }
  return new Set([...allTextures].filter((t) => !used.has(t)));
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
 *
 * TexTools' LOAD-time fixes (FixOldTexData on `.tex`, FixOldModel on `.mdl`, for an old pack per
 * DoesModpackNeedFix, TTMP.cs:916-930) are NOT run here: they are fused into the read seam and so
 * ran already inside `loadModpack`, exactly as `WizardData.FromModpack`/`FromWizardGroup` hands the
 * caller already-fixed data (WizardData.cs:700-737). Both `/upgrade` (ModpackUpgrader.cs:58) and
 * `/resave` (Program.cs:204) take that same fixed load path, so `data` reaching here is already
 * load-fixed — see src/upgrade/load-fixes.ts. (PMP has its own, separate, still-unported load-time
 * `.tex` fixup, FastValidateTexFile — docs/backlog/2026-07-13-pmp-load-time-tex-fixup.md.)
 *
 * Pass 1 runs the material round per option and collects the texture-upgrade targets it records into
 * a single first-wins-deduped map, plus every option's `.tex` keys into `allTextures` (:108-109);
 * pass 2 applies those targets to every option's textures (round 2, UpgradeRemainingTextures). The
 * partial round runs UpdateSkinPaths (skin path aliasing) and the unclaimed-hair/accessory rescue
 * (:162-182) over `allTextures` minus every target value; only UpdateEyeMask remains deferred — see
 * `partials`. Always returns a fresh ModpackData (never mutates `data`).
 */
export function upgradeModpack(data: ModpackData): ModpackData {
  const out = cloneModpack(data);
  // Pass 1 (ModpackUpgrader.cs:88-120): material + metadata per option; collect
  // texture-upgrade targets into a single first-wins-deduped map, and every option's `.tex`
  // keys into `allTextures` (:108-109).
  const targets = new Map<string, UpgradeInfo>();
  const allTextures = new Set<string>();
  for (const group of out.groups) {
    for (const option of group.options) {
      metadataRound(option);
      for (const info of materialRound(option)) {
        const k = targetKey(info);
        if (!targets.has(k)) targets.set(k, info);
      }
      for (const p of option.files.keys()) {
        if (p.endsWith(".tex")) allTextures.add(p);
      }
    }
  }
  // Pass 2 (ModpackUpgrader.cs:124-144): apply the global targets to every option.
  for (const group of out.groups) {
    for (const option of group.options) {
      upgradeRemainingTextures(option, targets);
    }
  }
  partials(out, computeUnusedTextures(allTextures, targets));
  return out;
}
