// Reads a PMP archive the way Penumbra does: as a redirect table, not as a file layout.
//
// Penumbra's SubMod.AddContainerTo (Penumbra SubMod.cs:23-32) reduces an option to
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

/** Every option document in the archive: each `group_NNN*.json`'s `Options` entries, plus
 *  `default_mod.json`, which IS a single option document (PMP.cs:1504-1517). */
function optionDocs(
  members: Map<string, Uint8Array>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [name, raw] of members) {
    if (!/(^|\/)(group_\d+.*|default_mod)\.json$/i.test(name)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      continue; // a malformed manifest is the JSON diff's problem to report, not ours
    }
    if (!isObj(doc)) continue;
    if (Array.isArray(doc.Options)) {
      for (const o of doc.Options) if (isObj(o)) out.push(o);
    } else {
      out.push(doc);
    }
  }
  return out;
}

/** True iff any option in the archive carries a non-empty `FileSwaps` map. This is the CAUSE gate
 *  for the layout-equivalent comparison: it is a property of the INPUT pack, known before any
 *  diffing, and it is exactly the condition under which TexTools' placeholder mechanism
 *  (PMP.cs:1104-1137) can burn an idx we do not. Gating on the cause rather than on the diff's
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

/** The archive's effective `gamePath -> content` mapping, resolved through every option's `Files`.
 *
 *  A gamePath whose member is absent is OMITTED rather than defaulted — an absent payload is a real
 *  state (PMP.cs:883-888 drops such a key on write) and inventing bytes for it would mask a genuinely
 *  lost member. `looseKey` matches the resolution the rest of the diff harness uses, so a member
 *  differing only by case or a stripped trailing dot still resolves. */
export function resolveRedirects(
  members: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
  const byLooseName = new Map<string, Uint8Array>();
  for (const [name, bytes] of members) byLooseName.set(looseKey(name), bytes);

  const out = new Map<string, Uint8Array>();
  for (const o of optionDocs(members)) {
    if (!isObj(o.Files)) continue;
    for (const [gamePath, zipPath] of Object.entries(o.Files)) {
      if (typeof zipPath !== "string") continue;
      const bytes = byLooseName.get(looseKey(zipPath.replace(/\\/g, "/")));
      if (bytes === undefined) continue;
      out.set(gamePath, bytes);
    }
  }
  return out;
}
