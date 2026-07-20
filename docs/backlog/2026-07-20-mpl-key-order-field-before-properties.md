# `.mpl` key order: Newtonsoft emits `MinimumFrameworkVersion` FIRST, we emit it 7th

Filed 2026-07-20, out of the review of the `fix/ttmp2-mpl-missing-fields` branch (commit 3276768,
which fixed the key *set* and respelled the nested objects' key *order*, but left the top-level
object's ordering wrong).

## The gap

`writeTtmp2` (`src/container/ttmp2.ts`, the `const mpl: ModPackJsonWrite` literal ~:255-269) spells
the top-level `.mpl` object as:

    TTMPVersion, Name, Author, Version, Description, Url, MinimumFrameworkVersion,
    ModPackPages, SimpleModsList

A real ConsoleTools golden spells it:

    MinimumFrameworkVersion, TTMPVersion, Name, Author, Version, Description, Url,
    ModPackPages, SimpleModsList

Verified against the cached golden `test/corpus/.upgrade-cache/078fd1364c3d…055f.bin`, whose
`TTMPL.mpl` begins:

    {"MinimumFrameworkVersion":"1.3.0.0","TTMPVersion":"2.1w","Name":"in",…

## Why

`ModPackJson.MinimumFrameworkVersion` (`Mods/DataContainers/ModPackJson.cs` · `ModPackJson` · 61) is
the class's only public **field**:

    public string MinimumFrameworkVersion = "1.0.0.0";

Every other member (`TTMPVersion`, `Name`, `Author`, `Version`, `Description`, `Url`,
`ModPackPages`, `SimpleModsList`) is an auto-**property**. `TTMPWriter.Write` serializes the
instance with a bare `JsonConvert.SerializeObject(_modPackJson)` (`Mods/FileTypes/TTMP.cs` ·
`TTMPWriter.Write` · 324), and Newtonsoft's `DefaultContractResolver` builds a type's member list
fields-first, then properties (each group in declaration order), absent `[JsonProperty(Order=…)]` —
and `ModPackJson.cs` carries no ordering attribute anywhere. So the single field is hoisted to the
front of the object. Note the nested classes (`ModPackPageJson`, `ModGroupJson`, `ModOptionJson`,
`ModsJson`) are all-properties, so plain declaration order is correct for them — which is why
3276768's respelling of those was right and the top level is the only site affected.

## Why the harness cannot see it

`test/helpers/upgrade-archive-diff.ts` compares manifests **semantically** — it parses both sides
and diffs with `jsonPointerDiff` — so key order is invisible to every corpus check. The only signal
is the key-order unit test in `test/container/ttmp2-write.test.ts`, which pins the nested objects but
not (today) the top level. This is a genuine byte-parity gap under "byte-parity is the definition of
correct", invisible to the ratchet.

## The fix

Move `MinimumFrameworkVersion` to the head of the `ModPackJsonWrite` literal in `writeTtmp2`, and
extend the key-order test in `test/container/ttmp2-write.test.ts` to assert the full top-level key
sequence above (it would have caught this). Expect **no** baseline movement, since no check compares
manifest bytes.

While there, note the same field-before-property rule for any future `.mpl`-adjacent writer: check
whether the C# member is a field or a property before transcribing declaration order.
