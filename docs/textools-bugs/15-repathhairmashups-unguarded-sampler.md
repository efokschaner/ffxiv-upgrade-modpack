# 15. `RepathHairMashups`' sampler scan dereferences `x.Sampler.SamplerId` unguarded

**Status:** reproduced · **Where:** `ModpackUpgrader.cs:434-436` (and the sibling highlight-half scan
at `:322-323`) — see `src/upgrade/repath-hair-mashups.ts` / `src/upgrade/resolve-highlight.ts`,
`findSamplerUnguarded`

`RepathHairMashups` finds its normal/mask/diffuse textures with
`Textures.FirstOrDefault(x => x.Sampler.SamplerId == ...)` (`:434-436`), reading `x.Sampler.SamplerId`
with no null guard — the same defect class as entry 3, at a different call site. A texture that bound
no sampler NREs mid-scan. `ResolveHighlightOptionsAndMashupHair`'s highlight half does the identical
unguarded scan (`:322-323`), but there the enclosing `try/catch` (`:329-332`) folds the NRE into "skip
this .mtrl"; `RepathHairMashups` has **no** try/catch, so the NRE propagates and aborts the whole
`/upgrade`.

**Us:** both sites share `findSamplerUnguarded` (`resolve-highlight.ts`), which throws when it reaches
a null-sampler texture before a match — `Array.find` order decides the outcome, mirroring
`FirstOrDefault`. The highlight-half caller wraps it in a skip; `repathHairMashups` does not, so the
throw propagates, matching TexTools' uncaught NRE. Latent: real hair/`zear`/`tail` materials always
bind their samplers (no corpus/library mod reaches it).

**Upstream fix:** guard the scan (`x.Sampler?.SamplerId`) like entry 3's siblings, and — for
`RepathHairMashups` specifically — decide whether an unbound sampler should skip the material rather
than abort the run.
