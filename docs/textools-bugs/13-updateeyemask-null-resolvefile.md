# 13. `UpdateEyeMask` passes a possibly-null `ResolveFile` result straight into `FromUncompressedTex`

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:2030-2032` (see `src/upgrade/eye-mask.ts`,
`updateEyeMask`)

`ResolveFile` returns null whenever the mask file's bytes cannot be resolved or decoded
(`EndwalkerUpgrade.cs:1761-1774` — an absent `RealPath`, or a decode failure caught and folded to
null). `UpdateEyeMask` takes that result and passes it directly into
`XivTex.FromUncompressedTex(data)` with no null check (`:2032`), which throws an
`ArgumentNullException` from `new MemoryStream(texData)` (`XivTex.cs:96`) — the same class of
unguarded-null-into-constructor defect as entry 1 (`GearMaskNew`), at a different call site. It is
the *same* exception from the *same* line: entry 1 reaches `XivTex.cs:96` indirectly, through
`UpgradeMaskTex` (`:2084`), where this site calls `FromUncompressedTex` directly at `:2032`. Only
the depth differs. (Corrected 2026-08-08: this paragraph previously claimed the two sites throw
"a different exception type (`ArgumentNullException`, not NRE)", reasoning that the null is passed
as a constructor argument rather than dereferenced. That reasoning is sound but does not
*distinguish* the two — it is equally true of entry 1, which is why entry 1's own text also says
`ArgumentNullException`, not NRE. Both go through `MemoryStream(byte[])`, which throws
`ArgumentNullException` on a null buffer before `texData.Length` at `:99` could dereference it.)

**Us:** `updateEyeMask` throws when `resolveFile` returns null for the mask, citing this entry and
`XivTex.cs:96` at the throw site — fail-loud is faithful here, matching TexTools' own crash.

**Upstream fix:** null-check `ResolveFile`'s result before calling `FromUncompressedTex`, matching
the guard the sibling `GearMaskLegacy` branch (entry 1) already has.
