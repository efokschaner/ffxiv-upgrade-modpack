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
//
// Confirmed by scanning every real corpus PMP's Manipulations arrays for their `Type` discriminator
// (2026-07-13): only Imc/Eqp/Eqdp/Est/Gmp appear. This module normalizes exactly those five known
// subtypes. Rsp/Atch/GlobalEqp and any unrecognized `Type` are passed through UNCHANGED — Newtonsoft's
// own fallback subtype (`PMPUnknownManipulationWrapperJson`, PmpManipulation.cs:51-63) deserializes an
// unrecognized `Type`'s `Manipulation` into a bare `object` (in practice a JObject/JToken tree) and
// re-serializes it verbatim, with no field-dropping or coercion. None of Rsp/Atch/GlobalEqp
// (PmpManipulation.cs:678-842) carries a `[JsonIgnore]` field, so a raw passthrough matches their
// typed round-trip UNLESS the source also spells one of their fields as a numeric string — no corpus
// pack does, so this is left unported; see BACKLOG.md.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Newtonsoft coerces a numeric-typed C# field spelled as a JSON string in the source document into
 *  a real JSON number when the typed model round-trips it (see module header). Applies to every
 *  numeric field of a known subtype below, not just `SetId` -- the coercion is a property of the
 *  field's C# TYPE, not of any one field name. A value that isn't a plain integer string is left
 *  untouched so a genuinely malformed document still surfaces as a diff instead of being silently
 *  swallowed (and an already-numeric value is returned as-is). */
function coerceNumber(v: unknown): unknown {
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return v;
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
function normalizeImc(m: Record<string, unknown>): Record<string, unknown> {
  const entrySrc = isObj(m.Entry) ? m.Entry : {};
  const Entry: Record<string, unknown> = {};
  for (const k of IMC_ENTRY_NUMERIC_FIELDS)
    Entry[k] = coerceNumber(entrySrc[k]);
  // PmpManipulation.cs:347-353.
  return {
    Entry,
    ObjectType: m.ObjectType,
    PrimaryId: coerceNumber(m.PrimaryId),
    SecondaryId: coerceNumber(m.SecondaryId),
    Variant: coerceNumber(m.Variant),
    EquipSlot: m.EquipSlot,
    BodySlot: m.BodySlot,
  };
}

// PmpManipulation.cs:228-234.
function normalizeEst(m: Record<string, unknown>): Record<string, unknown> {
  return {
    Entry: coerceNumber(m.Entry),
    Gender: m.Gender,
    Race: m.Race,
    SetId: coerceNumber(m.SetId),
    Slot: m.Slot,
  };
}

// PmpManipulation.cs:537-541.
function normalizeEqp(m: Record<string, unknown>): Record<string, unknown> {
  return {
    Entry: coerceNumber(m.Entry),
    SetId: coerceNumber(m.SetId),
    Slot: m.Slot,
  };
}

// PmpManipulation.cs:427-433: ShiftedEntry ([JsonIgnore], :435-473) dropped.
function normalizeEqdp(m: Record<string, unknown>): Record<string, unknown> {
  return {
    Entry: coerceNumber(m.Entry),
    Gender: m.Gender,
    Race: m.Race,
    SetId: coerceNumber(m.SetId),
    Slot: m.Slot,
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
  const entrySrc = isObj(m.Entry) ? m.Entry : {};
  const Entry: Record<string, unknown> = {};
  for (const k of GMP_ENTRY_BOOL_FIELDS) Entry[k] = entrySrc[k];
  for (const k of GMP_ENTRY_NUMERIC_FIELDS)
    Entry[k] = coerceNumber(entrySrc[k]);
  return { Entry, SetId: coerceNumber(m.SetId) };
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
 *  (matching Newtonsoft's untyped fallback for Rsp/Atch/GlobalEqp/unrecognized `Type`s). */
export function normalizeManipulations(raw: readonly unknown[]): unknown[] {
  return raw.map((item) => {
    if (!isObj(item) || typeof item.Type !== "string") return item;
    const normalize = NORMALIZERS[item.Type];
    if (!normalize) return item;
    const manip = isObj(item.Manipulation) ? item.Manipulation : {};
    return { Type: item.Type, Manipulation: normalize(manip) };
  });
}
