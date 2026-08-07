/** CONFIRMATION (not a tolerance) of the ONLY three v4 `meta.json` values that can NEVER match a
 *  ConsoleTools golden, because TexTools generates each one fresh on every single write:
 *
 *   - `meta.json#/Identifier`            `Guid.NewGuid()` field initializer, PMP.cs:1476. Never
 *                                        assigned — `WizardData.cs · WritePmp · 1509-1517` does
 *                                        not touch it.
 *   - `meta.json#/Groups/{i}/Identifier` `Guid.NewGuid()` field initializer, PMP.cs:1514, one per
 *                                        group per write. `ToPmpGroup` (WizardData.cs:957-964)
 *                                        assigns Name/Description/Priority/DefaultSettings/
 *                                        SelectedSettings/Page/Image and nothing else.
 *   - `meta.json#/LastWrite`             `DateTime.Now.ToString("O", InvariantCulture)`, re-stamped
 *                                        at PMP.cs:941 on every write.
 *
 *  AGENTS.md forbids meeting this with a widened tolerance or a `normalize()`-style strip: the rule
 *  must confirm the SPECIFIC expected difference and reject everything else. So this asserts BOTH
 *  sides are well-formed and only then adopts ours' value. A writer that emits `null`, `""`, an
 *  uppercase or malformed GUID, a wrong-shaped timestamp, or drops the key entirely is NOT confirmed
 *  and still reports through `jsonPointerDiff`. Shape alone is not enough either — see the duplicate
 *  check below, which is the one semantic property a freshly-minted GUID still has to give up.
 *
 *  The per-group arm is what keeps an **Imc** group honest. `PMPImcGroupJson` declares
 *  `public PmpIdentifierJson Identifier;` (PMP.cs:1538), which HIDES the base `Guid Identifier`
 *  (:1514); Json.NET resolves a hidden member in favour of the most-derived declaring type, so an
 *  Imc group serializes the identifier OBJECT and no GUID at all. Unlike the other two fields, this
 *  one is NOT random: it is derived from the item it targets (`PmpIdentifierJson.FromRoot`,
 *  WizardData.cs:913), so it MUST byte-match the golden. Passing it through untouched here is
 *  correct not because it is unconfirmable, but because `jsonPointerDiff` already checks it in
 *  full — this rule simply declines to touch a shape (`{ ObjectType, ... }`) it was never asked to
 *  confirm. Verified against a real v4 golden (`test/corpus/.resave-cache/fecdd91c….bin`,
 *  2026-08-06: an Imc group whose `Identifier` is
 *  `{ ObjectType, PrimaryId, SecondaryId, Variant, EquipSlot, BodySlot }`). Because the per-group
 *  arm adopts only when BOTH sides are GUID STRINGS, that object passes through untouched, and a
 *  writer bug emitting a GUID where the golden has an object is reported rather than blessed.
 *
 *  Groups are paired BY INDEX and only when the two arrays are the same length — a lost, extra or
 *  reordered group is a real divergence and must not be absorbed here.
 *
 *  DUPLICATE GUIDS ARE NEVER CONFIRMED. `Guid.NewGuid()` collisions are cryptographically
 *  negligible, so a real TexTools write can never reuse a value across `Identifier` and every
 *  `Groups[i].Identifier` — meaning this rule is the ONLY place left that could catch a writer bug
 *  that does (e.g. stamping every group with one shared GUID, or reusing `meta.Identifier` as a
 *  group's). The golden's own values are discarded by construction (each one really was fresh), so
 *  nothing downstream re-checks this. Zero false-positive risk against a real golden; see the
 *  operator-review addendum, 2026-08-07.
 *
 *  Operator ruling, 2026-08-06 (see the plan's Ruling 2); tightened per review, 2026-08-07. */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** THE TWO SIDES HAVE DIFFERENT PRODUCERS, SO THEY GET DIFFERENT SHAPES. Both are the same
 *  Newtonsoft `Guid.ToString("D")` spelling — 32 lowercase hex digits, 8-4-4-4-12 — and each is
 *  pinned to exactly what ITS producer can emit and nothing else. A single shared regex would have
 *  to be the UNION of the two, which is strictly looser than either; splitting is a tightening.
 *
 *  GOLDEN: `Guid.NewGuid()` (PMP.cs:1476/:1514, the only producer on that side) always mints a
 *  RANDOM RFC-4122 v4 GUID — version nibble `4`, variant nibble in `[89ab]`, never nil, never
 *  v1/v3/v5. Verified against 8 cached goldens (review, 2026-08-07).
 *
 *  OURS: `pmpIdentifier` (src/container/pmp-identifier.ts) always mints a DERIVED RFC-4122 v5
 *  (name-based, SHA-1) GUID — version nibble `5`, same variant range, never nil. Requiring `5`
 *  here is not a concession to our writer; it is an assertion ABOUT it. A `4` arriving on our side
 *  would mean something other than `pmpIdentifier` produced that value — a random GUID leaking in,
 *  or a golden value being echoed back — which is precisely a writer bug this rule must report
 *  rather than confirm.
 *
 *  A plain "32 lowercase hex digits" shape on either side would confirm values neither producer can
 *  emit (the nil GUID, an out-of-range version/variant nibble). */
export const GOLDEN_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const OURS_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** .NET's round-trip ("O") format: `yyyy-MM-ddTHH:mm:ss.fffffffK`. `DateTime.Now` yields a LOCAL
 *  time with a `±HH:mm` offset (observed: `2026-08-06T04:41:11.0160172-07:00`); `Z` is accepted too
 *  because a UTC `DateTime` renders that way and this check is about SHAPE, not about which clock.
 *  Field ranges are bounded (month 01-12, day 01-31, hour 00-23, minute/second 00-59, offset hour
 *  00-23, offset minute 00-59) so a value like `2026-99-99T99:99:99.0000000Z` or an offset of
 *  `+99:99` — neither of which `ToString("O")` can ever produce — is rejected; this stops short of
 *  full calendar validation (e.g. `02-30` still matches) because `DateTime` itself guarantees that
 *  and a regex bound is enough to catch a malformed WRITER, which is all this rule needs to reject.
 *  A regex bound was chosen over `Date.parse` because JS `Date` only carries millisecond precision
 *  and does not reliably round-trip a 7-fractional-digit .NET timestamp — the regex is exact where
 *  `Date.parse` would be lossy or engine-dependent. */
export const DOTNET_ROUND_TRIP_RE =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{7}(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

/** Adopts ours' value only when BOTH sides are well-formed for their OWN producer. `goldenShape`
 *  defaults to `oursShape` for a field whose two sides really do share one shape (`LastWrite`:
 *  `DateTime.Now.ToString("O")` on the golden side, `dotnetRoundTripLocal` on ours, and the whole
 *  point of that function is to be indistinguishable in shape). */
function confirmedString(
  oursValue: unknown,
  goldenValue: unknown,
  oursShape: RegExp,
  goldenShape: RegExp = oursShape,
): string | undefined {
  if (typeof oursValue !== "string" || typeof goldenValue !== "string") return;
  if (!oursShape.test(oursValue) || !goldenShape.test(goldenValue)) return;
  return oursValue;
}

export function confirmNondeterministicMetaFields(
  ours: unknown,
  goldenMeta: Record<string, unknown>,
): Record<string, unknown> {
  if (!isObj(ours)) return goldenMeta;
  const out: Record<string, unknown> = { ...goldenMeta };

  const idCandidate = confirmedString(
    ours.Identifier,
    goldenMeta.Identifier,
    OURS_GUID_RE,
    GOLDEN_GUID_RE,
  );

  const lastWrite = confirmedString(
    ours.LastWrite,
    goldenMeta.LastWrite,
    DOTNET_ROUND_TRIP_RE,
  );
  if (lastWrite !== undefined) out.LastWrite = lastWrite;

  const oursGroups = ours.Groups;
  const goldenGroups = goldenMeta.Groups;
  const paired =
    Array.isArray(oursGroups) &&
    Array.isArray(goldenGroups) &&
    oursGroups.length === goldenGroups.length;
  // Shape-valid per slot (top-level + one per group), BEFORE the duplicate check below decides
  // which of these are actually adoptable. `undefined` means "not shape-confirmed" (Imc object,
  // malformed, missing, non-object element, etc.) and never participates in the duplicate count.
  const groupCandidates: (string | undefined)[] = paired
    ? (goldenGroups as unknown[]).map((g, i) => {
        const o = (oursGroups as unknown[])[i];
        if (!isObj(g) || !isObj(o)) return undefined;
        return confirmedString(
          o.Identifier,
          g.Identifier,
          OURS_GUID_RE,
          GOLDEN_GUID_RE,
        );
      })
    : [];

  // A real TexTools write can never mint the same GUID twice (Guid.NewGuid() collisions are
  // cryptographically negligible), so a value that appears more than once among the shape-valid
  // candidates is a writer bug, not a coincidence — refuse to adopt EVERY slot holding it. This is
  // the only place left that can catch it, because the golden's own (genuinely distinct) values are
  // discarded once ours is adopted in their place.
  const freq = new Map<string, number>();
  for (const c of [idCandidate, ...groupCandidates]) {
    if (c !== undefined) freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  const isUnique = (c: string | undefined): c is string =>
    c !== undefined && freq.get(c) === 1;

  if (isUnique(idCandidate)) out.Identifier = idCandidate;

  if (paired) {
    out.Groups = (goldenGroups as unknown[]).map((g, i) => {
      const gid = groupCandidates[i];
      return isUnique(gid)
        ? { ...(g as Record<string, unknown>), Identifier: gid }
        : g;
    });
  }

  return out;
}
