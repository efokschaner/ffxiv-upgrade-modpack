// Reads a PMP archive the way Penumbra does: as a redirect table, not as a file layout.
//
// Penumbra's SubMod.AddContainerTo (Penumbra repo Mods/SubMods/SubMod.cs:23-32 -- a separate repo
// from this project's reference/) reduces an option to
// `redirections` + `manipulations`:
//
//     foreach (var (path, file) in container.Files)     redirections.TryAdd(path, file);
//     foreach (var (path, file) in container.FileSwaps) redirections.TryAdd(path, file);
//
// so the zip member NAME a payload happens to live under is plumbing, invisible to the game. That is
// what licenses the layout-equivalent comparison in upgrade-archive-diff.ts (see the spec, §5.2).
//
// FileSwaps are deliberately NOT resolved here: a swap's value is a base-game path with no member
// bytes behind it. Their preservation is confirmed separately, by the manifest carve-out.
import { isManifest, looseKey } from "./upgrade-archive-diff";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** One option document in the archive, plus the identity that pairs it with the SAME option on
 *  the other side of a comparison: the manifest member it came from, and a stable id WITHIN that
 *  member.
 *
 *  `optionId` is a STRING, not an index, because v4 moved every option into one member. Under v3 it
 *  is the index in a `group_NNN*.json`'s `Options` array (and `"0"` for `default_mod.json`, which
 *  IS a single option document, PMP.cs:1664-1682), so `manifestName` alone discriminated groups.
 *  Under v4 (`PMP.cs · PMPMetaJson · 1484/1487`) every option lives in `meta.json`, so a bare option
 *  index would MERGE two different groups' first options onto one redirect key and hide a real
 *  divergence in one of them — the exact failure `resolveRedirects`' per-option keying exists to
 *  prevent. So v4 ids are `"<groupIndex>/<optionIndex>"`, and `meta.DefaultData` is `"default"`. */
interface OptionEntry {
  manifestName: string;
  optionId: string;
  doc: Record<string, unknown>;
}

function optionEntries(members: Map<string, Uint8Array>): OptionEntry[] {
  const out: OptionEntry[] = [];
  let sawMeta = false;
  let sawOptionContainer = false;
  for (const [name, raw] of members) {
    const isMeta = /(^|\/)meta\.json$/i.test(name);
    const isV3Manifest = /(^|\/)(group_\d+.*|default_mod)\.json$/i.test(name);
    if (!isMeta && !isV3Manifest) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      continue; // a malformed manifest is the JSON diff's problem to report, not ours
    }
    if (!isObj(doc)) continue;

    if (isMeta) {
      sawMeta = true;
      // A v4 meta.json ALWAYS carries both keys: WizardData.WritePmp builds pmp.Groups /
      // pmp.DefaultMod non-null (WizardData.cs:1481-1487), PMP.WritePmp moves them into the meta
      // (PMP.cs:928-939), and Newtonsoft's default NullValueHandling.Include writes even a null. So
      // key PRESENCE is the reliable "this is a v4 manifest" signal, independent of content.
      if (Object.hasOwn(doc, "Groups") || Object.hasOwn(doc, "DefaultData")) {
        sawOptionContainer = true;
      }
      if (Array.isArray(doc.Groups)) {
        doc.Groups.forEach((g, gi) => {
          if (!isObj(g) || !Array.isArray(g.Options)) return;
          g.Options.forEach((o, oi) => {
            if (isObj(o))
              out.push({ manifestName: name, optionId: `${gi}/${oi}`, doc: o });
          });
        });
      }
      if (isObj(doc.DefaultData)) {
        out.push({
          manifestName: name,
          optionId: "default",
          doc: doc.DefaultData,
        });
      }
      continue;
    }

    sawOptionContainer = true;
    if (Array.isArray(doc.Options)) {
      doc.Options.forEach((o, i) => {
        if (isObj(o))
          out.push({ manifestName: name, optionId: String(i), doc: o });
      });
    } else {
      out.push({ manifestName: name, optionId: "0", doc });
    }
  }

  // FAIL LOUD (AGENTS.md), do not return []. This helper feeds `resolveRedirects`, whose output
  // `diffPayloadSemantic` compares: two empty maps compare EQUAL, so an unrecognized manifest shape
  // would make the whole redirect-table check pass vacuously — exactly the fail-open a v4 archive
  // produced before this function learned the v4 shape.
  if (sawMeta && !sawOptionContainer) {
    throw new Error(
      "archive-redirects: PMP archive has a meta.json but no recognizable option container — " +
        "no v4 meta.Groups/meta.DefaultData key (PMP.cs:1484/1487) and no v3 default_mod.json or " +
        "group_NNN.json member. resolveRedirects would return an empty map and diffPayloadSemantic " +
        "would pass vacuously, so this fails loud instead.",
    );
  }
  return out;
}

/** Every option document in the archive, discarding the pairing identity `optionEntries` tracks —
 *  `packHasFileSwaps` only needs to know "does ANY option have a swap", not which one. */
function optionDocs(
  members: Map<string, Uint8Array>,
): Record<string, unknown>[] {
  return optionEntries(members).map((e) => e.doc);
}

/** True iff any option in the archive carries a non-empty `FileSwaps` map. This is the CAUSE gate
 *  for the layout-equivalent comparison: it is a property of the INPUT pack, known before any
 *  diffing, and it is exactly the condition under which TexTools' placeholder mechanism
 *  (PMP.cs:1202-1235) can burn an idx we do not. Gating on the cause rather than on the diff's
 *  SHAPE is what keeps every swap-free pack under full byte-and-name exactness. */
export function packHasFileSwaps(members: Map<string, Uint8Array>): boolean {
  return optionDocs(members).some(
    (o) => isObj(o.FileSwaps) && Object.keys(o.FileSwaps).length > 0,
  );
}

/** Non-manifest ("payload") member names of an archive. */
export function payloadMemberNames(members: Map<string, Uint8Array>): string[] {
  return [...members.keys()].filter((n) => !isManifest(n));
}

/** Composite key pairing a `gamePath` with the option that redirects it, so two DIFFERENT options
 *  defining the SAME `gamePath` (the ordinary shape of a Single-select/radio group, where each
 *  option is a mutually exclusive alternative content for the same file) get distinct entries
 *  instead of colliding. `manifestName` + `optionId` identify the option — see `OptionEntry`'s doc
 *  comment for what `optionId` is under v3 vs v4. `diffPayloadSemantic` (upgrade-archive-diff.ts)
 *  reports this composite key as `FileDiff.gamePath`, so a `confirmDivergence` predicate must match
 *  a gamePath SUFFIX, not the whole key. */
export function redirectKey(
  manifestName: string,
  optionId: string,
  gamePath: string,
): string {
  return `${manifestName}#${optionId}|${gamePath}`;
}

/** The archive's effective `gamePath -> content` mapping, resolved through each option's `Files`,
 *  keyed PER OPTION rather than merged archive-wide.
 *
 *  Per the design spec (`docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`
 *  §5.2): "if each option's `gamePath → content` map is equal, any selection yields an equal
 *  effective mapping — linear and sufficient." That is a claim about EACH option's map, not one
 *  merged map for the whole archive. An archive-wide `Map<gamePath, bytes>` with last-write-wins
 *  merging would collapse two options that legitimately define the same `gamePath` with different
 *  content — the normal shape of a Single-select group's mutually exclusive choices — so only the
 *  last-visited option's content would ever be compared, silently hiding a real divergence in every
 *  other option. That is exactly the failure mode AGENTS.md's "fail loud, never silently diverge"
 *  rule exists to prevent, so the key here includes the option's identity (`redirectKey`) and every
 *  option's mapping is preserved and compared independently.
 *
 *  A gamePath whose member is absent is OMITTED rather than defaulted — an absent payload is a real
 *  state (PMP.cs:976-981 drops such a key on write) and inventing bytes for it would mask a genuinely
 *  lost member. `looseKey` matches the resolution the rest of the diff harness uses, so a member
 *  differing only by case or a stripped trailing dot still resolves. */
export function resolveRedirects(
  members: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
  const byLooseName = new Map<string, Uint8Array>();
  for (const [name, bytes] of members) byLooseName.set(looseKey(name), bytes);

  const out = new Map<string, Uint8Array>();
  for (const { manifestName, optionId, doc } of optionEntries(members)) {
    if (!isObj(doc.Files)) continue;
    for (const [gamePath, zipPath] of Object.entries(doc.Files)) {
      if (typeof zipPath !== "string") continue;
      const bytes = byLooseName.get(looseKey(zipPath.replace(/\\/g, "/")));
      if (bytes === undefined) continue;
      out.set(redirectKey(manifestName, optionId, gamePath), bytes);
    }
  }
  return out;
}
