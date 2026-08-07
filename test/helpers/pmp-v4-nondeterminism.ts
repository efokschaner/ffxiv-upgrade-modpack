/** CONFIRMATION (not a tolerance) of the ONLY three v4 `meta.json` values that can NEVER match a
 *  ConsoleTools golden, because TexTools generates each one fresh on every single write:
 *
 *   - `meta.json#/Identifier`            `Guid.NewGuid()` field initializer, PMP.cs:1476. Never
 *                                        assigned — `WizardData.WritePmp` (:1509-1517) does not
 *                                        touch it.
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
 *  and still reports through `jsonPointerDiff`.
 *
 *  The per-group arm is what keeps an **Imc** group honest. `PMPImcGroupJson` declares
 *  `public PmpIdentifierJson Identifier;` (PMP.cs:1538), which HIDES the base `Guid Identifier`
 *  (:1514); Json.NET resolves a hidden member in favour of the most-derived declaring type, so an
 *  Imc group serializes the identifier OBJECT and no GUID at all. Verified against a real v4 golden
 *  (`test/corpus/.resave-cache/fecdd91c….bin`, 2026-08-06: an Imc group whose `Identifier` is
 *  `{ ObjectType, PrimaryId, SecondaryId, Variant, EquipSlot, BodySlot }`). Because this arm adopts
 *  only when BOTH sides are GUID STRINGS, that object passes through untouched, and a writer bug
 *  emitting a GUID where the golden has an object is reported rather than blessed.
 *
 *  Groups are paired BY INDEX and only when the two arrays are the same length — a lost, extra or
 *  reordered group is a real divergence and must not be absorbed here.
 *
 *  Operator ruling, 2026-08-06 (see the plan's Ruling 2). */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Newtonsoft serializes a `Guid` with `ToString("D")`: 32 lowercase hex digits, 8-4-4-4-12. */
export const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** .NET's round-trip ("O") format: `yyyy-MM-ddTHH:mm:ss.fffffffK`. `DateTime.Now` yields a LOCAL
 *  time with a `±HH:mm` offset (observed: `2026-08-06T04:41:11.0160172-07:00`); `Z` is accepted too
 *  because a UTC `DateTime` renders that way and this check is about SHAPE, not about which clock. */
export const DOTNET_ROUND_TRIP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}(Z|[+-]\d{2}:\d{2})$/;

function confirmedString(
  oursValue: unknown,
  goldenValue: unknown,
  shape: RegExp,
): string | undefined {
  if (typeof oursValue !== "string" || typeof goldenValue !== "string") return;
  if (!shape.test(oursValue) || !shape.test(goldenValue)) return;
  return oursValue;
}

export function confirmNondeterministicMetaFields(
  ours: unknown,
  goldenMeta: Record<string, unknown>,
): Record<string, unknown> {
  if (!isObj(ours)) return goldenMeta;
  const out: Record<string, unknown> = { ...goldenMeta };

  const id = confirmedString(ours.Identifier, goldenMeta.Identifier, GUID_RE);
  if (id !== undefined) out.Identifier = id;

  const lastWrite = confirmedString(
    ours.LastWrite,
    goldenMeta.LastWrite,
    DOTNET_ROUND_TRIP_RE,
  );
  if (lastWrite !== undefined) out.LastWrite = lastWrite;

  const oursGroups = ours.Groups;
  const goldenGroups = goldenMeta.Groups;
  if (
    Array.isArray(oursGroups) &&
    Array.isArray(goldenGroups) &&
    oursGroups.length === goldenGroups.length
  ) {
    out.Groups = goldenGroups.map((g, i) => {
      const o = oursGroups[i];
      if (!isObj(g) || !isObj(o)) return g;
      const gid = confirmedString(o.Identifier, g.Identifier, GUID_RE);
      return gid === undefined ? g : { ...g, Identifier: gid };
    });
  }
  return out;
}
