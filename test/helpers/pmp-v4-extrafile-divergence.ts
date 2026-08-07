import { bytesEqual } from "./compare";
import { isManifest, looseKey } from "./upgrade-archive-diff";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Consulted before a payload member present ONLY in the golden is reported as a structural
 *  difference. Returning true means "this specific, expected difference is confirmed".
 *
 *  Takes the FULL golden member map (not just the one member's bytes) and the FULL "ours" member
 *  map — both still include manifest members (`meta.json`, `group_*.json`, `default_mod.json`),
 *  the same shape `diffPayloadMembers`/`diffPayloadSemantic` already hold internally. A
 *  confirmation that needs more than one member's worth of golden context (this one does — see
 *  `makeV4ExtraFileDuplicateConfirmation`'s "twin" check) could not be built against a
 *  single-`Uint8Array` signature. */
export type GoldenOnlyMemberConfirmation = (
  name: string,
  goldenMembers: Map<string, Uint8Array>,
  oursMembers: Map<string, Uint8Array>,
) => boolean;

/** Members of `members`, keyed by `looseKey`, optionally excluding manifest documents
 *  (`meta.json`, `group_*.json`, `default_mod.json`, `.mpl`). Excluding manifests matters for a
 *  BYTE scan specifically: a manifest document's serialized JSON could coincidentally collide with
 *  a payload's bytes, which would have nothing to do with this divergence. */
function byLooseKey(
  members: Map<string, Uint8Array>,
  excludeManifests: boolean,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [name, bytes] of members) {
    if (excludeManifests && isManifest(name)) continue;
    out.set(looseKey(name), bytes);
  }
  return out;
}

/** All zip paths named by some `Files` value in a v4 `meta.json` (`meta.Groups[].Options[].Files`,
 *  `meta.DefaultData.Files`) — the mirror of `dropConfirmedAbsentKeys`' own v4 walk
 *  (`upgrade-archive-diff.ts`, `PMP.cs · PMPMetaJson · 1484/1487`), reading `Files` VALUES here
 *  instead of pruning `Files` KEYS there. Backslash-normalized then `looseKey`'d, matching how a
 *  `Files` value is resolved to an archive member elsewhere in this module
 *  (`dropConfirmedAbsentKeys`' `isCommon`/`present` checks). A malformed or unparsable `meta.json`
 *  yields an empty set — this walk is a rejection-strengthening check (criterion (c) below), not
 *  the primary gate, so failing to find anything here only means criterion (c) cannot reject on
 *  this specific ground; criterion (d) still has to independently hold. */
function referencedZipPathKeys(meta: unknown): Set<string> {
  const out = new Set<string>();
  const addFiles = (filesValue: unknown): void => {
    if (!isObj(filesValue)) return;
    for (const v of Object.values(filesValue)) {
      if (typeof v === "string") out.add(looseKey(v.replace(/\\/g, "/")));
    }
  };
  if (!isObj(meta)) return out;
  if (Array.isArray(meta.Groups)) {
    for (const g of meta.Groups) {
      if (!isObj(g) || !Array.isArray(g.Options)) continue;
      for (const opt of g.Options) {
        if (isObj(opt)) addFiles(opt.Files);
      }
    }
  }
  if (isObj(meta.DefaultData)) addFiles(meta.DefaultData.Files);
  return out;
}

function parseJson(bytes: Uint8Array | undefined): unknown {
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

// Per-golden-map memo for `referencedZipPathKeys`: the SAME `goldenMembers` Map instance is passed
// once per golden-only member found during one `diffArchives` call (i.e. this can run several
// times against the identical map), and `meta.json` never changes mid-comparison — a WeakMap keyed
// on the map object itself avoids re-parsing it on every call without pinning any lifetime this
// module doesn't already control (a `Map` dropped by the caller is dropped here too).
const referencedCache = new WeakMap<Map<string, Uint8Array>, Set<string>>();
function referencedZipPathKeysCached(
  goldenMembers: Map<string, Uint8Array>,
): Set<string> {
  const cached = referencedCache.get(goldenMembers);
  if (cached !== undefined) return cached;
  const computed = referencedZipPathKeys(
    parseJson(goldenMembers.get("meta.json")),
  );
  referencedCache.set(goldenMembers, computed);
  return computed;
}

/**
 * CONFIRMATION (not a tolerance) of our ONE deliberate divergence from TexTools' PMP v4 read path:
 * docs/TEXTOOLS_BUGS.md #23, operator ruling 2026-08-06, upstream report at
 * docs/upstream/2026-08-06-textools-pmp-v4-extrafile-duplication.md.
 *
 * WHAT DIFFERS. `PMP.LoadPMP` builds its "extra files" set by iterating the local `groups` list
 * deserialized from `group_*.json` (PMP.cs:191-208) — a list the v4 pull-back at :220 never assigns,
 * because it assigns `pmp.Groups` instead. So for a v4 pack the scan at :234 sees nothing, every
 * inline-group payload member fails the `!allPmpFiles.Contains(x)` test at :279, and
 * `WizardData.WritePmp` then writes those bytes TWICE: verbatim at the input's own member name
 * (the ExtraFiles copy, WizardData.cs:1496-1507) and again at the regenerated dedup path
 * (:1602-1619). We read the groups we actually loaded, so we write each member once. The golden
 * therefore carries payload members ours does not — and nothing else differs: both sides' `Files`
 * values point at the regenerated path, so the manifest comparison is untouched (verified against
 * the real golden, see scripts/generate-synthetics/build-synthetic-pmp-v4.ts's OBSERVED OUTPUT).
 *
 * WHY NOT REPRODUCE IT. Reproducing would hand the user a modpack roughly twice its necessary size,
 * compounding on every resave. AGENTS.md's user-benefit-divergence bar, scored honestly:
 *   1. registered defect — MET (docs/TEXTOOLS_BUGS.md #23);
 *   2. exercised over the corpus with every moved byte accounted for — MET
 *      (test/corpus/synthetic/pmp-v4-extrafiles.pmp, plus this rule);
 *   3. IN-GAME VERIFICATION: **OUTSTANDING**. Not performed. The operator ruled that
 *      implementation proceeds without it (2026-08-06); that ruling is theirs to make and does NOT
 *      satisfy the bar. What must still be checked, by the operator, by hand: install both packs —
 *      ours and ConsoleTools' /resave of the same v4 input — in Penumbra; confirm both load;
 *      confirm identical in-game result; confirm ours is roughly half the size. Record the outcome
 *      HERE (replacing this paragraph, in the style of the FileSwaps carve-out's own verification
 *      block in upgrade-archive-diff.ts) and in docs/TEXTOOLS_BUGS.md #23.
 *      Honest note, which is NOT a substitute for the check: the duplicated members are referenced
 *      by no `Files` key, so Penumbra never reads them — the expected harm is size and confusion,
 *      not broken function. That makes this a LOWER-risk divergence than the FileSwaps one, which
 *      changed behaviour. It does not make it a verified one.
 *
 * GATED ON THE INPUT'S SHAPE. `makeV4ExtraFileDuplicateConfirmation` returns `undefined` unless the
 * INPUT pack has `FileVersion > 3` AND carries at least one inline group. This is a SUFFICIENT
 * condition for the defect, not the exact one `LoadPMP` itself tests: `PMP.cs:217`'s own v4
 * discriminator is `(meta.Groups?.Count > 0) || meta.DefaultData != null`, which does not consult
 * `FileVersion` at all. A pack with inline `Groups` but `FileVersion <= 3` would take the C#'s v4
 * path and hit the bug while this gate stays disarmed for it — a real gap, but one that FAILS
 * CLOSED (this rule simply does not fire, so an unconfirmed golden-only member is still reported
 * as a diff, never wrongly blessed) rather than open. No pack in the corpus is v4-shaped-but-not-
 * v4-numbered as of this writing; if one is ever added, align this gate with `PMP.cs:217` instead
 * of `dropConfirmedAbsentKeys`' own already-aligned one. Every pack this gate does NOT disarm is
 * compared with no such arm in play at all, the same discipline `packHasFileSwaps` enforces for
 * `layoutEquivalent`.
 *
 * `inputMembers.get("meta.json")` is a case-exact lookup (unlike `isManifest`'s case-INsensitive
 * one). A `Meta.json`-spelled input disarms this rule the same way it fails closed above — every
 * pack `writePmp` and every golden ConsoleTools writes spells it lowercase, so this has never been
 * observed; noted rather than generalized into a case-fold, to keep this function's only external
 * dependency on `upgrade-archive-diff.ts` the two symbols it already imports.
 *
 * DELIBERATELY TIGHT — FOUR conditions, not three; see the 2026-08-07 code review for why an
 * earlier three-condition version was insufficient. A golden-only member is confirmed only when
 * ALL of the following hold:
 *   (a) a member of the INPUT pack has the same name (up to `looseKey`) — `inputByLooseName`,
 *       built once and reused (last INPUT member under a colliding `looseKey` wins; a real pack has
 *       no two members sharing one after case/dot normalization, so this is not expected to bite,
 *       but a construction picking the wrong bytes on a hypothetical collision is a known,
 *       documented limitation of the shortcut, not a silent one);
 *   (b) that input member's bytes equal the golden member's bytes at `name` — i.e. `name` really is
 *       a verbatim re-emission of that input member, not a transformed or unrelated file;
 *   (c) `name` (up to backslash-normalization + `looseKey`) is named by NO `Files` value anywhere
 *       in the GOLDEN's own `meta.json` — the invariant this file's own header already asserts
 *       ("the duplicated members are referenced by no Files key") is now ENFORCED, not merely
 *       claimed. A golden-only member the golden's manifest still points at is, by construction, a
 *       real referenced file — dropping it is a genuine loss, never this divergence;
 *   (d) the GOLDEN carries a SECOND, DIFFERENTLY-NAMED payload member with the exact same bytes as
 *       `name` (the regenerated dedup path bug #23 ALSO writes — the copy that survives), AND our
 *       archive carries that second member too (by `looseKey`, byte-identical). This is the
 *       specific signature of the bug: not "these bytes exist somewhere in our archive" (which any
 *       unrelated file sharing content — routine, since TexTools content-hash dedups payloads —
 *       could satisfy) but "the golden's OWN second copy of this exact file is the one we kept".
 *
 * Why the previous single global byte-scan (criterion (c) in the pre-review version) was not
 * enough, concretely: dropping (c)/(d)-as-now-defined down to "these bytes appear somewhere in our
 * archive" cannot distinguish "we declined to duplicate a file" from "we lost an unrelated file
 * that happens to share content with something we kept" — and shared content between otherwise
 * distinct payload members is the NORM in a mod pack, not an edge case (it is why TexTools has
 * `PmpExtensions.ResolveDuplicates` at all). The corpus's only v4 pack does not exercise this,
 * because `build-synthetic-pmp-v4.ts` deliberately gives its two files distinct bytes — a property
 * of that pack, not a guarantee this rule could rely on. (c) and (d) together close it: (c) rules
 * out a golden-only member that is still genuinely referenced (so dropping it is a real bug, full
 * stop), and (d) requires the SPECIFIC twin bug #23 predicts, present on both sides, rather than
 * any byte-identical file anywhere.
 */
export function makeV4ExtraFileDuplicateConfirmation(
  inputMembers: Map<string, Uint8Array>,
): GoldenOnlyMemberConfirmation | undefined {
  const meta = parseJson(inputMembers.get("meta.json"));
  if (!isObj(meta)) return undefined;
  if (typeof meta.FileVersion !== "number" || meta.FileVersion <= 3)
    return undefined;
  if (!Array.isArray(meta.Groups) || meta.Groups.length === 0) return undefined;

  const inputByLooseName = byLooseKey(inputMembers, false);

  return (name, goldenMembers, oursMembers) => {
    const goldenBytes = goldenMembers.get(name);
    if (goldenBytes === undefined) return false; // defensive; callers only pass a real member
    const fromInput = inputByLooseName.get(looseKey(name));
    if (fromInput === undefined) return false; // (a)
    if (!bytesEqual(fromInput, goldenBytes)) return false; // (b)
    if (referencedZipPathKeysCached(goldenMembers).has(looseKey(name)))
      return false; // (c)

    // (d) — find a second, differently-named GOLDEN payload member with these exact bytes, and
    // require OUR archive to carry that SAME member (by looseKey, byte-identical). A linear scan
    // over both maps; sound and cheap while the only v4 input in the corpus is the small synthetic
    // repro — index by content if a large v4 pack is ever added.
    const targetKey = looseKey(name);
    const oursByLoose = byLooseKey(oursMembers, true);
    for (const [candidateName, candidateBytes] of goldenMembers) {
      if (isManifest(candidateName)) continue;
      const candidateKey = looseKey(candidateName);
      if (candidateKey === targetKey) continue; // must be a DIFFERENT name, not `name` itself
      if (!bytesEqual(candidateBytes, goldenBytes)) continue;
      const oursTwin = oursByLoose.get(candidateKey);
      if (oursTwin !== undefined && bytesEqual(oursTwin, goldenBytes)) {
        return true;
      }
    }
    return false;
  };
}
