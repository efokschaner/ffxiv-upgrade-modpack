# 1. `UpgradeRemainingTextures` dereferences a null texture in the `GearMaskNew` branch

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:1865-1889` (see `src/upgrade/texture.ts`, the GearMaskNew branch)

The `GearMaskNew` branch resolves the old mask and passes it straight into `UpgradeMaskTex`
*before* checking it for null:

```csharp
var data = await ResolveFile(upgrade.Files["mask_old"], files, null);
data = await UpgradeMaskTex(data);          // :1870 — NRE when data == null
if (data != null) { await WriteFile(...); } // :1871 — the check comes too late
```

The sibling `GearMaskLegacy` branch immediately below (`:1882-1887`) checks null *first* and skips
cleanly. The asymmetry is plainly unintended: `ResolveFile` returns null whenever the file's
`RealPath` is missing on disk (`:1765`) — which happens for real, in the wild, whenever a PMP's
`Files` map names a payload the archive never contained. `UpgradeMaskTex` then calls
`XivTex.FromUncompressedTex(null)` (`:2084`), which throws an `ArgumentNullException` — not an
NRE — from `new MemoryStream(texData)` (`XivTex.cs:96`), which `ModpackUpgrader` catches and
rethrows as a wrapped failure (`ModpackUpgrader.cs:143-147`), killing the whole `/upgrade`.

**Us:** an absent file must therefore make our `GearMaskNew` path throw, while `GearMaskLegacy`
skips. Fail-loud is faithful here — TexTools fails the pack too.

**Upstream fix:** move the null check above the call, matching `GearMaskLegacy`.
