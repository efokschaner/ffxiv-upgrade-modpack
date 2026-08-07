import { bytesEqual } from "./compare";
import { looseKey } from "./upgrade-archive-diff";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Consulted before a payload member present ONLY in the golden is reported as a structural
 *  difference. Returning true means "this specific, expected difference is confirmed". */
export type GoldenOnlyMemberConfirmation = (
  name: string,
  goldenBytes: Uint8Array,
  oursMembers: Map<string, Uint8Array>,
) => boolean;

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
 * (the ExtraFiles copy, WizardData.cs:1495-1507) and again at the regenerated dedup path
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
 * GATED ON THE CAUSE, NOT THE SYMPTOM. `makeV4ExtraFileDuplicateConfirmation` returns `undefined`
 * unless the INPUT pack is a v4 PMP carrying at least one inline group — the precise precondition
 * for the defect. Every other pack in the corpus is compared with no such arm in play at all, the
 * same discipline `packHasFileSwaps` enforces for `layoutEquivalent`.
 *
 * DELIBERATELY TIGHT. A golden-only member is confirmed only when all three hold:
 *   (a) a member of the INPUT pack has the same name (up to `looseKey`);
 *   (b) that input member's bytes equal the golden member's bytes — i.e. it really is a verbatim
 *       re-emission, not a transformed or unrelated file;
 *   (c) the SAME bytes appear somewhere in OUR archive — so we did not lose the data, we merely
 *       declined to duplicate it.
 * Drop (c) and a genuine writer bug that dropped a file entirely would be blessed whenever the input
 * happened to carry it. A golden-only member that is not an input member, or whose bytes differ, or
 * whose content we do not carry, is still reported.
 */
export function makeV4ExtraFileDuplicateConfirmation(
  inputMembers: Map<string, Uint8Array>,
): GoldenOnlyMemberConfirmation | undefined {
  const metaBytes = inputMembers.get("meta.json");
  if (metaBytes === undefined) return undefined;
  let meta: unknown;
  try {
    meta = JSON.parse(new TextDecoder().decode(metaBytes));
  } catch {
    return undefined;
  }
  if (!isObj(meta)) return undefined;
  if (typeof meta.FileVersion !== "number" || meta.FileVersion <= 3)
    return undefined;
  if (!Array.isArray(meta.Groups) || meta.Groups.length === 0) return undefined;

  const inputByLooseName = new Map<string, Uint8Array>();
  for (const [name, bytes] of inputMembers)
    inputByLooseName.set(looseKey(name), bytes);

  return (name, goldenBytes, oursMembers) => {
    const fromInput = inputByLooseName.get(looseKey(name));
    if (fromInput === undefined) return false; // (a)
    if (!bytesEqual(fromInput, goldenBytes)) return false; // (b)
    // (c) — a linear scan. Sound and cheap while the only v4 input in the corpus is the small
    // synthetic repro; index by content if a large v4 pack is ever added.
    for (const bytes of oursMembers.values()) {
      if (bytesEqual(bytes, goldenBytes)) return true;
    }
    return false;
  };
}
