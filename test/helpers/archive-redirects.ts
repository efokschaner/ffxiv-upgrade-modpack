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

/** One option document in the archive, plus the identity that pairs it with the SAME option on
 *  the other side of a comparison: the manifest member it came from, and (for a `group_NNN*.json`'s
 *  `Options` array) its index within that array. `default_mod.json` IS a single option document
 *  (PMP.cs:1504-1517), so it is always index 0. Manifest member names are regenerated identically by
 *  both our writer and TexTools' (see `resolveRedirects` below for why that licenses using the name
 *  as part of the pairing key), and `dropConfirmedAbsentKeys` (upgrade-archive-diff.ts) already pairs
 *  a `group_NNN.json`'s `Options` the same way, by index — this mirrors that. */
interface OptionEntry {
  manifestName: string;
  optionIndex: number;
  doc: Record<string, unknown>;
}

function optionEntries(members: Map<string, Uint8Array>): OptionEntry[] {
  const out: OptionEntry[] = [];
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
      doc.Options.forEach((o, i) => {
        if (isObj(o)) out.push({ manifestName: name, optionIndex: i, doc: o });
      });
    } else {
      out.push({ manifestName: name, optionIndex: 0, doc });
    }
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

/** Composite key pairing a `gamePath` with the option that redirects it, so two DIFFERENT options
 *  defining the SAME `gamePath` (the ordinary shape of a Single-select/radio group, where each
 *  option is a mutually exclusive alternative content for the same file) get distinct entries
 *  instead of colliding. `manifestName` + `optionIndex` identify the option exactly as
 *  `dropConfirmedAbsentKeys` (upgrade-archive-diff.ts) already pairs options across two archives —
 *  by manifest member name, then by index within that member's `Options` array — which is safe
 *  because both our writer and TexTools' regenerate group manifest member names identically. */
export function redirectKey(
  manifestName: string,
  optionIndex: number,
  gamePath: string,
): string {
  return `${manifestName}#${optionIndex}|${gamePath}`;
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
 *  state (PMP.cs:883-888 drops such a key on write) and inventing bytes for it would mask a genuinely
 *  lost member. `looseKey` matches the resolution the rest of the diff harness uses, so a member
 *  differing only by case or a stripped trailing dot still resolves. */
export function resolveRedirects(
  members: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
  const byLooseName = new Map<string, Uint8Array>();
  for (const [name, bytes] of members) byLooseName.set(looseKey(name), bytes);

  const out = new Map<string, Uint8Array>();
  for (const { manifestName, optionIndex, doc } of optionEntries(members)) {
    if (!isObj(doc.Files)) continue;
    for (const [gamePath, zipPath] of Object.entries(doc.Files)) {
      if (typeof zipPath !== "string") continue;
      const bytes = byLooseName.get(looseKey(zipPath.replace(/\\/g, "/")));
      if (bytes === undefined) continue;
      out.set(redirectKey(manifestName, optionIndex, gamePath), bytes);
    }
  }
  return out;
}
