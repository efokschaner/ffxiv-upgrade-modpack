# 20. `ValidateTexFileData` resizes NPOT textures using `Width` for both dimensions

**Status:** reproduced · **Audited against the v3.1.1.4 re-pin (2026-08-07): UNAFFECTED.** The
`1993bf6` mip work (entry 19) touches `Tex.cs` only; `EndwalkerUpgrade.cs` is untouched across the
whole `e20179a0..8e2a2603` range (`git diff --stat` returns nothing for it), so the swapped argument
at `:2110` is still there verbatim and both line numbers below are still current. · **Where:**
`EndwalkerUpgrade.cs:2110` (`ValidateTexFileData`) — see
`src/upgrade/validate-tex.ts`, `validateTexFileData`

Branch A of `ValidateTexFileData` resizes a texture whose width or height is not a power of two and
which carries more than one mip:

```csharp
await Tex.ResizeXivTx(tex, IOUtil.RoundToPowerOfTwo(header.Width),
                           IOUtil.RoundToPowerOfTwo(header.Width), false);   // :2110
```

`ResizeXivTx`'s third parameter is `newHeight`, but the call passes `RoundToPowerOfTwo(header.Width)`
again instead of `RoundToPowerOfTwo(header.Height)`. A non-square NPOT source (e.g. 96×192) is
therefore squished to a **square** `roundW×roundW` (here 64×64) rather than the natural
`roundW×roundH` (64×128) the sibling material-round resize sites (`CreateIndexFromNormal`,
`UpgradeMaskTex`, `UpdateEndwalkerHairTextures`) compute correctly, each independently rounding both
dimensions. Plain transcription defect — a copy-pasted argument, not a format rule.

**Us:** `validateTexFileData` (`src/upgrade/validate-tex.ts`) reproduces it verbatim — it calls
`resizeForMerge` with `roundToPowerOfTwo(tex.width)` for BOTH the target width and height. Pinned by
`test/upgrade/validate-tex.test.ts` ("Branch A: reproduces the Width-for-both-dims bug (96x192
A8R8G8B8 → 64x64, not 64x128)"). No corpus pack is known to carry a non-square NPOT-with-mips `.tex`
in an old (`needsTexFix`) pack, so the squish itself is latent; the real pack that does reach this
call site, `KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2`, happens to carry a **square** NPOT source
(2048×2048), so its target dimensions are the same with or without the bug and it does not exercise
the asymmetry.

**Upstream fix:** pass `RoundToPowerOfTwo(header.Height)` for the third argument, matching what the
other three `ResizeXivTx` call sites already do.
