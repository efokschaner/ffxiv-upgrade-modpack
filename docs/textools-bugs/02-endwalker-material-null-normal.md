# 2. `UpdateEndwalkerMaterial` dereferences an unresolvable Normal texture

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:912-921` (see `src/upgrade/material.ts:135`)

`normalTex.Dx11Path` is dereferenced unconditionally, so a colorset material with no resolvable
Normal texture throws an NRE. The per-material `try/catch` in `UpdateEndwalkerMaterials`
(`:522-539`) swallows it, so the file is left **byte-untouched** — `WriteFile` (`:1069`) is never
reached.

**Us:** `upgradeMaterial` throws on that shape and `materialRound` catches it, leaving the file
untouched. Reproducing the *outcome* (untouched bytes) is what byte-parity requires; "fixing" it
would rewrite a material TexTools leaves alone.

**Upstream fix:** null-check the sampler and skip (or stub) the material explicitly, rather than
relying on an exception to abandon it.
