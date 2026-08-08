# 14. `UpdateEyeMask` dereferences a `FirstOrDefault` that can return null for `TexturePath`

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:2056-2059` (see `src/upgrade/eye-mask.ts`,
`updateEyeMask`)

`baseMaterial.Textures.FirstOrDefault(x => x.Sampler?.SamplerId == ... g_SamplerDiffuse)` can
legitimately return null when the iris material binds no diffuse sampler; the very next line
dereferences `mtrlTex.TexturePath` unconditionally (`:2059`), throwing a
`NullReferenceException`. Unlike entry 3 (an unguarded *scan predicate*), this is an unguarded
*result* dereference after a `FirstOrDefault` whose null case is the whole point of that LINQ
method — the same shape as entry 2's `normalTex.Dx11Path`, at a different call site.

**Us:** our eye-material lookup table (`EyeMaterialTable`, `src/upgrade/reference/eye-materials-types.ts`)
records that case as `diffusePath === undefined`, and `updateEyeMask` throws citing this entry
when it sees it — fail-loud in place of the NRE, since there is no cross-material fallback to
substitute.

**Upstream fix:** null-check `mtrlTex` before dereferencing `TexturePath`, and either skip the
material or surface a clearer error naming the missing sampler.
