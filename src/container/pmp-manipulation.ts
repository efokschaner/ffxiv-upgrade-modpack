// Port of PmpManipulation.cs's typed manipulation subtypes, as far as they affect Manipulations
// regeneration on write. TexTools deserializes each `Manipulations[]` entry into a TYPED
// `PMPManipulationWrapperJson` (JsonSubtypes keyed on `Type`) and the writer re-serializes those
// SAME typed objects: on the PMP load path (`mergeManipulations=false`, WizardData.cs:818)
// `UnpackPmpOption`'s typed `OtherManipulations` list is carried straight through to
// `WizardStandardOptionData.Manipulations` (WizardData.cs:820) and back out via
// `opt.Manipulations.Add(manip)` (`PopulatePmpStandardOption`, PMP.cs:921-926). So — like the rest
// of this port's manifest-regeneration work — re-emitting the SOURCE `Manipulations` array verbatim
// is wrong in two ways a typed round-trip cannot produce:
//
//  1. A `[JsonIgnore]` computed field the typed model never serializes, regardless of what the
//     source document spelled: `PMPImcManipulationJson.PMPImcEntry.AttributeAndSound`
//     (PmpManipulation.cs:318, computed FROM AttributeMask+SoundId on read, PmpManipulation.cs:421-422)
//     and `PMPEqdpManipulationJson.ShiftedEntry` (PmpManipulation.cs:435-473, a getter/setter over
//     `Entry`) are both dropped entirely on write.
//  2. Newtonsoft's typed deserializer COERCES a numeric field spelled as a JSON string in the source
//     into a real JSON number on the way back out. Confirmed empirically (2026-07-13,
//     `[DVNO] DMBX Shoes 1.pmp` /resave golden): source `"SetId": "295"` (Eqp/Eqdp) comes back as
//     `295` (a JSON number, not a string).
//  3. Conversely, a field the source OMITS is not "absent" in the typed round-trip: every field of
//     these five subtypes is a non-nullable C# value type, so a missing key still deserializes to
//     the type's own default and the typed writer serializes THAT. `requireField`/`requireNumber`/
//     `requireEntry` (below) throw instead of inventing an `undefined` (which `JSON.stringify` would
//     silently drop) — see their doc comment for why we don't attempt the enum-default cases.
//
// Confirmed by scanning every real corpus PMP's Manipulations arrays for their `Type` discriminator
// (2026-07-13): only Imc/Eqp/Eqdp/Est/Gmp appear. This module normalizes exactly those five known
// subtypes. Rsp/Atch/GlobalEqp and any unrecognized `Type` are passed through UNCHANGED — Newtonsoft's
// own fallback subtype (`PMPUnknownManipulationWrapperJson`, PmpManipulation.cs:51-63) deserializes an
// unrecognized `Type`'s `Manipulation` into a bare `object` (in practice a JObject/JToken tree) and
// re-serializes it verbatim, with no field-dropping or coercion. None of Rsp/Atch/GlobalEqp
// (PmpManipulation.cs:678-842) carries a `[JsonIgnore]` field, so a raw passthrough matches their
// typed round-trip UNLESS the source also spells one of their fields as a numeric string — no corpus
// pack does, so this is left unported.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Newtonsoft coerces a numeric-typed C# field spelled as a JSON string in the source document into
 *  a real JSON number when the typed model round-trips it (see module header). Applies to every
 *  numeric field of a known subtype below, not just `SetId` -- the coercion is a property of the
 *  field's C# TYPE, not of any one field name. A value that isn't a plain integer string is left
 *  untouched so a genuinely malformed document still surfaces as a diff instead of being silently
 *  swallowed (and an already-numeric value is returned as-is). Requires the field to be PRESENT —
 *  see `requireField`'s doc comment for why a missing field throws instead of inventing a default. */
function coerceNumber(v: unknown): unknown {
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return v;
}

/** Every field of a known manipulation subtype (Imc/Est/Eqp/Eqdp/Gmp) is a plain C# value type
 *  (int/uint/byte/bool/enum) with NO nullable annotation, so Newtonsoft's typed deserializer always
 *  gives the field SOME value even when the source JSON omits the key: the type's own default
 *  (`0`/`false`/the enum member whose underlying value is `0`), and the typed re-serializer then
 *  writes that default back out, a real key with a real value. Our OWN JS field reads (`m[key]`,
 *  `coerceNumber(m[key])`) do the opposite when a key is absent: `undefined`, which
 *  `JSON.stringify` then DROPS -- silently inventing "absent from the output" as the missing
 *  field's behaviour, which is NOT what the typed round-trip does. We don't know each field's exact
 *  C# enum-default spelling (ObjectType/EquipSlot/BodySlot/Gender/Race/Slot are enums; a wrong
 *  guess at "the zero member's name" would be a silent wrong output with nothing to catch it — every
 *  real corpus manipulation spells every field, so there is no golden to prove a guess against).
 *  Fail loud instead, per AGENTS.md ("meet a structure the port does not yet reproduce faithfully?
 *  throw"): a genuinely field-sparse manipulation is unported, not silently mis-normalized. */
function requireField(
  m: Record<string, unknown>,
  key: string,
  subtype: string,
): unknown {
  if (m[key] === undefined) {
    throw new Error(
      `pmp-manipulation: ${subtype} manipulation is missing required field "${key}" — ` +
        "TexTools' typed model would serialize its C# default (0/false/enum-default) here, which " +
        "this port does not reproduce (no corpus manipulation omits a field to pin the exact " +
        "default against); see docs/backlog/2026-07-13-pmp-manipulation-field-defaults.md.",
    );
  }
  return m[key];
}
function requireNumber(
  m: Record<string, unknown>,
  key: string,
  subtype: string,
): unknown {
  return coerceNumber(requireField(m, key, subtype));
}
function requireEntry(
  m: Record<string, unknown>,
  subtype: string,
): Record<string, unknown> {
  const entry = requireField(m, "Entry", subtype);
  if (!isObj(entry)) {
    throw new Error(
      `pmp-manipulation: ${subtype} manipulation's "Entry" is not an object — see ` +
        "docs/backlog/2026-07-13-pmp-manipulation-field-defaults.md.",
    );
  }
  return entry;
}

// PmpManipulation.cs:311-321 (PMPImcEntry struct): AttributeAndSound excluded ([JsonIgnore], :318).
const IMC_ENTRY_NUMERIC_FIELDS = [
  "MaterialId",
  "DecalId",
  "VfxId",
  "MaterialAnimationId",
  "AttributeMask",
  "SoundId",
] as const;
/** Port of the PMPImcEntry struct normalization (PmpManipulation.cs:311-321). Reused for BOTH a
 *  per-manipulation Imc `Entry` (normalizeImc, below) and `PMPImcGroupJson.DefaultEntry`
 *  (PMP.cs:1429, `src/container/pmp.ts`) — the SAME struct type, so it drops the same [JsonIgnore]
 *  `AttributeAndSound` field (:318) and gets the same numeric-string coercion under Newtonsoft's
 *  typed round-trip either way. */
export function normalizeImcEntry(
  entrySrc: Record<string, unknown>,
  subtype: string,
): Record<string, unknown> {
  const Entry: Record<string, unknown> = {};
  for (const k of IMC_ENTRY_NUMERIC_FIELDS)
    Entry[k] = requireNumber(entrySrc, k, subtype);
  return Entry;
}
function normalizeImc(m: Record<string, unknown>): Record<string, unknown> {
  const Entry = normalizeImcEntry(requireEntry(m, "Imc"), "Imc");
  // PmpManipulation.cs:347-353.
  return {
    Entry,
    ObjectType: requireField(m, "ObjectType", "Imc"),
    PrimaryId: requireNumber(m, "PrimaryId", "Imc"),
    SecondaryId: requireNumber(m, "SecondaryId", "Imc"),
    Variant: requireNumber(m, "Variant", "Imc"),
    EquipSlot: requireField(m, "EquipSlot", "Imc"),
    BodySlot: requireField(m, "BodySlot", "Imc"),
  };
}

// PmpManipulation.cs:228-234.
function normalizeEst(m: Record<string, unknown>): Record<string, unknown> {
  return {
    Entry: requireNumber(m, "Entry", "Est"),
    Gender: requireField(m, "Gender", "Est"),
    Race: requireField(m, "Race", "Est"),
    SetId: requireNumber(m, "SetId", "Est"),
    Slot: requireField(m, "Slot", "Est"),
  };
}

// PmpManipulation.cs:537-541.
function normalizeEqp(m: Record<string, unknown>): Record<string, unknown> {
  return {
    Entry: requireNumber(m, "Entry", "Eqp"),
    SetId: requireNumber(m, "SetId", "Eqp"),
    Slot: requireField(m, "Slot", "Eqp"),
  };
}

// PmpManipulation.cs:427-433: ShiftedEntry ([JsonIgnore], :435-473) dropped.
function normalizeEqdp(m: Record<string, unknown>): Record<string, unknown> {
  return {
    Entry: requireNumber(m, "Entry", "Eqdp"),
    Gender: requireField(m, "Gender", "Eqdp"),
    Race: requireField(m, "Race", "Eqdp"),
    SetId: requireNumber(m, "SetId", "Eqdp"),
    Slot: requireField(m, "Slot", "Eqdp"),
  };
}

// PmpManipulation.cs:615-632 (PMPGmpEntry struct + SetId).
const GMP_ENTRY_BOOL_FIELDS = ["Enabled", "Animated"] as const;
const GMP_ENTRY_NUMERIC_FIELDS = [
  "RotationA",
  "RotationB",
  "RotationC",
  "UnknownA",
  "UnknownB",
  "UnknownTotal",
  "Value",
] as const;
function normalizeGmp(m: Record<string, unknown>): Record<string, unknown> {
  const entrySrc = requireEntry(m, "Gmp");
  const Entry: Record<string, unknown> = {};
  for (const k of GMP_ENTRY_BOOL_FIELDS)
    Entry[k] = requireField(entrySrc, k, "Gmp");
  for (const k of GMP_ENTRY_NUMERIC_FIELDS)
    Entry[k] = requireNumber(entrySrc, k, "Gmp");
  return { Entry, SetId: requireNumber(m, "SetId", "Gmp") };
}

const NORMALIZERS: Record<
  string,
  (m: Record<string, unknown>) => Record<string, unknown>
> = {
  Imc: normalizeImc,
  Est: normalizeEst,
  Eqp: normalizeEqp,
  Eqdp: normalizeEqdp,
  Gmp: normalizeGmp,
};

/** Normalizes a PMP option's `Manipulations` array the way TexTools' typed `PMPManipulationWrapperJson`
 *  round-trip does (see module header): drops `[JsonIgnore]` fields and coerces numeric-string fields
 *  for the five subtypes the real corpus exercises, and passes every other entry through unchanged
 *  (matching Newtonsoft's untyped fallback for Rsp/Atch/GlobalEqp/unrecognized `Type`s). THROWS if a
 *  known subtype's `Manipulation` object (or its `Entry`) is missing a field the typed model
 *  declares — including a wholly-absent `Manipulation` key, which normalizes to `{}` and then fails
 *  the same way (see `requireField`'s doc comment above). */
export function normalizeManipulations(raw: readonly unknown[]): unknown[] {
  return raw.map((item) => {
    if (!isObj(item) || typeof item.Type !== "string") return item;
    const normalize = NORMALIZERS[item.Type];
    if (!normalize) return item;
    const manip = isObj(item.Manipulation) ? item.Manipulation : {};
    return { Type: item.Type, Manipulation: normalize(manip) };
  });
}
