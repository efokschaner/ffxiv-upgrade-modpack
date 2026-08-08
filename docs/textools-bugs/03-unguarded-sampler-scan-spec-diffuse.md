# 3. Unguarded sampler scan in the spec/diffuse lookup

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:1028-1029` (see `src/upgrade/material.ts:211`)

The spec/diffuse scan reads `x.Sampler.SamplerId` with no null guard, unlike the mask lookups above
it (`:975` / `:1011`), which guard with `x.Sampler != null`. A texture that bound no sampler NREs
mid-scan, and the per-material `try/catch` abandons the material byte-untouched.

**Us:** we scan without `?.` and throw before a match if a null-sampler texture is reached first —
`Array.find` order matters, so the *position* of the null-sampler texture decides the outcome, and
we mirror that.

**Upstream fix:** guard the scan like its siblings do.
