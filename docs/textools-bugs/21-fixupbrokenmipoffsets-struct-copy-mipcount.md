# 21. `FixUpBrokenMipOffsets`'s `MipCount` reduction is lost to the struct-copy, so `ValidateTexFileData` serializes a stale `MipCount`

**Status:** reproduced · **Audited against the v3.1.1.4 re-pin (2026-08-07): NOT fixed upstream.**
`1993bf6` rewrites the LoDMips loop *inside* this same function (entry 19), but leaves every
ingredient of this defect exactly as it was: `TexHeader` is still a `struct` (`Tex.cs:71`),
`FixUpBrokenMipOffsets` still takes it **by value** (`:159`), both `header.MipCount` writes are still
to the local copy (`:173`, `:200`), and `ValidateTexFileData` still serializes the caller's untouched
header (`EndwalkerUpgrade.cs:2121`, in a file untouched across the whole range). Line numbers below
are the v3.1.1.4 pin. · **Where:** `Tex.TexHeader.FixUpBrokenMipOffsets` (`Tex.cs:159-234`) vs its
caller `EndwalkerUpgrade.ValidateTexFileData` (`EndwalkerUpgrade.cs:2116-2124`) — see
`src/tex/header.ts`, `fixUpBrokenMipOffsets`

`TexHeader` is a **struct** (`public struct TexHeader`, `Tex.cs:71`), and `FixUpBrokenMipOffsets`
takes it **by value** (`internal static (bool HeaderChanged, long CalculatedTexSize)
FixUpBrokenMipOffsets(TexHeader header, long texSizeIncludingHeader)`, `:159`). When the file's
claimed mip count extends past what the function can actually verify against the file's true size, it
clamps the count by writing the **local** copy's scalar field:

```csharp
header.MipCount = 1;                                    // :173 — local copy only
...
header.MipCount = (byte)(mipLevel + 1);                  // :200 — local copy only
```

Those writes never escape the function — `MipCount` is a `byte` field on a value type passed by
value, so the caller's `header` is untouched. The function's writes to `header.MipMapOffsets[…]` and
`header.LoDMips[…]` **do** escape, because arrays are reference types even inside a struct: the same
backing array is shared between caller and callee, so element writes are visible to both. The
asymmetry is confined to exactly this one field — a defect in how the fix communicates its result to
its caller, not a format rule.

`ValidateTexFileData` then serializes the header the caller still holds:

```csharp
byte[] newData = new byte[fixupResult.CalculatedTexSize];
Array.Copy(header.ToBytes(), newData, Tex._TexHeaderSize);   // :2121 — header.MipCount is UNCHANGED
```

So when a fixup trims mips (a file whose claimed mip table extends past EOF), the rewritten `.tex`
carries the **original, too-high** `MipCount` alongside the **fixed, fewer** offset/LoD entries — a
header that claims more mips than it has valid offsets for. `ToBytes()`'s own ordering guard
(`Tex.cs:138-145` *at the v3.1.0.2 pin*; **deleted by `1993bf6`** — entry 19 above) did not catch this
shape either: a trimmed table's offsets and `LoDMips` stay internally consistent with each other
(`LoDMips` is separately clamped below the reduced local mip count, `Tex.cs:206-212`); only
`MipCount` itself goes stale. Removing that guard therefore neither fixes nor worsens this entry.

**Us:** `fixUpBrokenMipOffsets` (`src/tex/header.ts`) reproduces the split deliberately: it mutates
`header.mipMapOffsets`/`header.lodMips` in place (mirroring the shared-array escape) and tracks the
trimmed count in a **local** `mipCount` variable that is never written back to `header.mipCount` —
the same asymmetry the C# struct-copy produces by accident. `serializeTexHeader` then emits the
caller's still-stale `mipCount`. Pinned by `test/tex/tex-header.test.ts` ("leaves mipCount untouched
on the passed header (struct-copy quirk)"). No corpus pack is known to trim mips at this call site
yet (the two `/resave`-forced real packs, `Bloodlust - Bibo+.ttmp2` and `chained_collars_v1_1_0.ttmp2`,
only move offset-table bytes, not the mip count), so the visible stale-`MipCount` effect is latent.

**Upstream fix:** change `FixUpBrokenMipOffsets` to return the corrected `MipCount` (it already
returns a tuple) and have the caller apply it to `header` before calling `ToBytes()` — or make
`TexHeader` a class, which would fix the whole family of struct-copy surprises at once.
