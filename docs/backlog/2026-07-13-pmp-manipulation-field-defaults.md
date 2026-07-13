# PMP manipulation/DefaultEntry normalization fails loud on a missing field instead of emitting the C# type's own default

Filed: 2026-07-13 · Status: open (fail-loud guard in place; no corpus manipulation omits a field)

`normalizeManipulations` / `normalizeImcEntry` (`src/container/pmp-manipulation.ts`) require every
field of the five known subtypes (Imc/Est/Eqp/Eqdp/Gmp) to be present in the source document and
THROW otherwise, rather than reproducing what Newtonsoft's typed round-trip would actually do —
serialize the C# field's own default (`0` / `false` / the enum member whose value is `0`) for an
omitted key.

The honest fix needs each field's exact C# type (several are enums — `PMPObjectType`,
`PMPEquipSlot`, a race/gender enum, a slot enum — and their zero-value member NAME is what
Newtonsoft would print, which isn't necessarily "the first declared member" or anything guessable
without reading each enum definition).

No real corpus manipulation omits a field (every one spells all of them), so there is no golden to
prove a default-value guess against; throwing surfaces a genuinely unported shape loudly instead of
risking a silent wrong value.

Revisit if a real pack ever needs a field default: read each enum's C# definition, encode the
zero-value member name per field, and replace the throw with the real default.
