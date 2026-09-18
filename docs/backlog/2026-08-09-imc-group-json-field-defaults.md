# Imc group JSON is passed through verbatim, so a source that omits a field omits it on write

Filed: 2026-08-09 · Status: open · **Found by a real Penumbra v4 pack, first day one was measured**

`writePmp` carries an Imc group's untyped extras — `Identifier`, `AllVariants`, `OnlyAttributes`,
`DefaultEntry` — through `filteredRaw` (`src/container/pmp.ts:1012-1030`, `KNOWN_GROUP_KEYS`), i.e.
**verbatim from the source document**. TexTools does not: it deserializes into `PMPImcGroupJson`
(`PMP.cs:1536-1546`) and `PmpIdentifierJson`, then re-serializes the **complete** field set, so any
field the source omitted is written at its C# default rather than staying absent.

Result: for a source pack that spells only part of the Imc shape, our `meta.json` is missing keys the
golden has. Key *set* is strictly in scope under AGENTS.md's JSON-manifest rule — the semantic-compare
carve-out covers key **order**, not presence — so this is a real divergence, not spelling.

## Measured 2026-08-09 on `hs-Yet Another Leisurewear (+Rue!)-1.1.1-Zx8j.pmp`

Its three Imc groups each omit fields the C# class declares:

| source group | omits | golden-only keys produced |
| --- | --- | --- |
| `Groups/1` (Imc) | `AllVariants`, `OnlyAttributes`; `Identifier` lacks `BodySlot`, `SecondaryId` | 4 |
| `Groups/2` (Imc) | same | 4 |
| `Groups/4` (Imc) | `Identifier` lacks `BodySlot`, `SecondaryId` (has `AllVariants`/`OnlyAttributes`) | 2 |

Source `Identifier` spells exactly `{ObjectType, PrimaryId, Variant, EquipSlot}`; `PmpIdentifierJson`
also declares `BodySlot` and `SecondaryId`. That is **10 golden-only `meta.json` pointers**, which is
exactly what a `/resave` diff of this pack reports:

```
added   meta.json#/Groups/1/AllVariants             added   meta.json#/Groups/2/AllVariants
added   meta.json#/Groups/1/OnlyAttributes          added   meta.json#/Groups/2/OnlyAttributes
added   meta.json#/Groups/1/Identifier/BodySlot     added   meta.json#/Groups/2/Identifier/BodySlot
added   meta.json#/Groups/1/Identifier/SecondaryId  added   meta.json#/Groups/2/Identifier/SecondaryId
added   meta.json#/Groups/4/Identifier/BodySlot     added   meta.json#/Groups/4/Identifier/SecondaryId
```

Count matches the prediction exactly (4 + 4 + 2), which is what identifies the cause rather than merely
being consistent with it.

## Why the existing reasoning missed it

`src/container/pmp.ts:1065-1071` already reasons carefully about the Imc `Identifier`: `PMPImcGroupJson`
declares `public PmpIdentifierJson Identifier` which **hides** the base `Guid`, so an Imc group
serializes the identifier *object* and no GUID, and the code therefore lets `filteredRaw` carry it
through rather than applying the GUID override. That reasoning is correct about **which** member wins
and **where** it sits — and silent about the fact that carrying the source object through verbatim
leaves absent sub-fields absent, where a typed round-trip would materialize them. The same gap applies
to the sibling booleans `AllVariants`/`OnlyAttributes`.

Note the contrast with `DefaultEntry`, which is *already* handled the right way: it gets an explicit
`normalizeImcEntry` override (`:1037-1045`) precisely so it survives the typed round-trip rather than
being passed through. This item is the same treatment, for the other three members.

## What to do

1. Read `PMPImcGroupJson` (`PMP.cs:1536-1546`) and `PmpIdentifierJson` for the exact declared field
   set and each field's C# default — including whether Json.NET writes a null object member or omits
   it, which decides the `Identifier`-absent case.
2. Replace the verbatim pass-through with a typed normalization for `Identifier`, `AllVariants` and
   `OnlyAttributes`, in the shape `normalizeImcEntry` already establishes for `DefaultEntry`.
3. Pin it with the pack that found it, or a synthetic Imc group that omits the same fields if the pack
   is not taken into the corpus
   ([`2026-08-09-real-v4-corpus-coverage.md`](2026-08-09-real-v4-corpus-coverage.md)).

## Reachability

Unlike its v4 neighbours this is **not** gated behind the `/upgrade` v4 refusal. Nothing about it is
v4-specific: any pack with an Imc group whose JSON omits a declared field hits it, at whatever manifest
version. The v4 pack merely happens to be the first one measured that omits any.

**Now pinned by a real corpus pack (2026-08-10).** When filed this was undetected by anything — grepped
across all 92 `.resave-baseline` and 78 `.upgrade-baseline` files for `AllVariants` /
`OnlyAttributes` / `Identifier/{BodySlot,SecondaryId}` pointers, zero hits. `hs-Yet Another
Leisurewear …` has since been added to `test/corpus/real/`, and its `/resave` baseline now carries
exactly the 10 predicted pointers:

```
meta.json#/Groups/1/{AllVariants,OnlyAttributes,Identifier/BodySlot,Identifier/SecondaryId}
meta.json#/Groups/2/{AllVariants,OnlyAttributes,Identifier/BodySlot,Identifier/SecondaryId}
meta.json#/Groups/4/{Identifier/BodySlot,Identifier/SecondaryId}
```

**Success criterion for the fix:** those 10 entries disappear from that baseline and the pack still
passes. Delete them from the baseline rather than re-blessing the pack wholesale, so the other 84
entries (a different, unrelated gap) stay recorded and a regression in them stays visible.
