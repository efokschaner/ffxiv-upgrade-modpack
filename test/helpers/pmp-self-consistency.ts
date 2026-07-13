import { readZip } from "../../src/zip/zip";
import { looseKey } from "./upgrade-archive-diff";
import type { FileDiff } from "./upgrade-diff";

const dec = new TextDecoder();
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isManifestName(name: string): boolean {
  const n = name.split("/").pop()!.toLowerCase();
  return (
    n === "meta.json" ||
    n === "default_mod.json" ||
    (n.startsWith("group_") && n.endsWith(".json"))
  );
}

/** Every zip path a manifest names: option `Files` VALUES plus every `Image` field (meta, group,
 *  option). Returned with the raw (forward-slashed) spelling alongside the gamePath that named it,
 *  so a dangling report can say which key dangles. */
function referenced(
  members: Map<string, Uint8Array>,
): Array<{ zipPath: string; gamePath: string }> {
  const out: Array<{ zipPath: string; gamePath: string }> = [];
  const addFiles = (opt: unknown): void => {
    if (!isObj(opt)) return;
    if (typeof opt.Image === "string" && opt.Image !== "") {
      out.push({ zipPath: opt.Image.replace(/\\/g, "/"), gamePath: "" });
    }
    if (!isObj(opt.Files)) return;
    for (const [gamePath, value] of Object.entries(opt.Files)) {
      if (typeof value !== "string") continue;
      out.push({ zipPath: value.replace(/\\/g, "/"), gamePath });
    }
  };

  for (const [name, data] of members) {
    if (!isManifestName(name)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(dec.decode(data));
    } catch {
      continue; // a manifest we cannot parse is not this check's problem — the golden diff owns that
    }
    if (!isObj(doc)) continue;
    if (typeof doc.Image === "string" && doc.Image !== "") {
      out.push({ zipPath: doc.Image.replace(/\\/g, "/"), gamePath: "" });
    }
    if (Array.isArray(doc.Options)) for (const o of doc.Options) addFiles(o);
    else addFiles(doc); // default_mod.json: the document IS the option
  }
  return out;
}

/**
 * Self-consistency of a PMP WE WROTE: an oracle-free invariant that the pack is actually usable.
 *
 * Two failures, both of which shipped silently before the writer regeneration:
 *  - DANGLING: an option's `Files` value names a zip path with no member. Penumbra cannot load it.
 *  - ORPHAN:   a payload member that no `Files`/`Image` field names, and that was not already an
 *              unreferenced extra of the SOURCE pack (PMP.cs:213-215 preserves those verbatim, so
 *              they are legitimately unreferenced on the way out too).
 *
 * `sourceExtras` is the source pack's `data.extraFiles` key set. Pass an empty set for a pack with
 * none. Reported as FileDiffs so the result rides the existing ratchet instead of hard-failing —
 * the defect this catches is pre-existing on real corpus packs and must be blessed before it is
 * burned down.
 */
export function pmpSelfConsistency(
  archive: Uint8Array,
  sourceExtras: Set<string>,
): FileDiff[] {
  const members = readZip(archive);
  const memberKeys = new Set(
    [...members.keys()].filter((n) => !isManifestName(n)).map(looseKey),
  );
  const extraKeys = new Set([...sourceExtras].map(looseKey));
  const refs = referenced(members);
  const refKeys = new Set(refs.map((r) => looseKey(r.zipPath)));

  const diffs: FileDiff[] = [];
  for (const r of refs) {
    if (r.gamePath === "") continue; // an Image that names nothing is not a payload failure
    if (memberKeys.has(looseKey(r.zipPath))) continue;
    diffs.push({
      kind: "structure",
      gamePath: `self:dangling:${r.zipPath}`,
      index: 0,
      status: "removed",
      detail: r.gamePath,
    });
  }
  for (const name of members.keys()) {
    if (isManifestName(name)) continue;
    const k = looseKey(name);
    if (refKeys.has(k) || extraKeys.has(k)) continue;
    diffs.push({
      kind: "structure",
      gamePath: `self:orphan:${name}`,
      index: 0,
      status: "added",
      detail: undefined,
    });
  }
  return diffs.sort((a, b) =>
    a.gamePath < b.gamePath ? -1 : a.gamePath > b.gamePath ? 1 : 0,
  );
}
