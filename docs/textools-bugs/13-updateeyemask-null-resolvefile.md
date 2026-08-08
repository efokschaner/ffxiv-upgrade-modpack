# 13. `UpdateEyeMask` passes a possibly-null `ResolveFile` result straight into `FromUncompressedTex`

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:2030-2032` (see `src/upgrade/eye-mask.ts`,
`updateEyeMask`)

`ResolveFile` returns null whenever the mask file's bytes cannot be resolved or decoded
(`EndwalkerUpgrade.cs:1761-1774` — an absent `RealPath`, or a decode failure caught and folded to
null). `UpdateEyeMask` takes that result and passes it directly into
`XivTex.FromUncompressedTex(data)` with no null check (`:2032`), which throws an
`ArgumentNullException` from `new MemoryStream(texData)` (`XivTex.cs:96`) — the same class of
unguarded-null-into-constructor defect as entry 1 (`GearMaskNew`), at a different call site with a
different exception type (`ArgumentNullException`, not NRE, since the null is passed as a
constructor argument rather than dereferenced directly).

**Us:** `updateEyeMask` throws when `resolveFile` returns null for the mask, citing this entry and
`XivTex.cs:96` at the throw site — fail-loud is faithful here, matching TexTools' own crash.

**Upstream fix:** null-check `ResolveFile`'s result before calling `FromUncompressedTex`, matching
the guard the sibling `GearMaskLegacy` branch (entry 1) already has.
