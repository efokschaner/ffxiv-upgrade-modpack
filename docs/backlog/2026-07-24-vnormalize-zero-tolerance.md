# `vNormalize` doesn't reproduce SharpDX's zero-tolerance normalize behaviour

Filed: 2026-07-24 · Status: open · Surfaced while porting the tangent recompute

`vNormalize` in `src/mdl/model/model-modifiers.ts` (used by `calculateTangentsForMesh`'s full
binormal recompute) guards only an **exactly-zero** length before dividing:

```ts
function vNormalize(a: Vec3): Vec3 {
  const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}
```

SharpDX `Vector3.Normalize` / the TexTools `.Normalized()` extension it stands in for (call sites
`ModelModifiers.cs:2225-2226`) instead leave the vector **unchanged** whenever its length sits below
a small zero-tolerance (~1e-6) — not only at exactly zero. So for a degenerate or near-cancelled
tangent sum whose length falls in `(0, ~1e-6)`, our port divides by a tiny number (producing a huge or
`Infinity`-poisoned result before serialization clamps it) where TexTools would instead pass the
near-zero vector straight through.

**Why deferred, not fixed:** the `.Normalized()` extension's source is not vendored anywhere in
`reference/` (it's a SharpDX helper, not xivModdingFramework code), so we cannot read its exact
tolerance constant or branch shape. Guessing one would be inventing behaviour, which the project's
"port behaviour, don't invent it" rule (AGENTS.md) rules out. The current exactly-zero-only guard
already matches the `/resave` golden byte-for-byte on `gar_b0_m0112.mdl` — the one corpus model whose
recompute path is exercised — so there is no known divergence today, only a latent gap.

**Severity:** cosmetic/latent — degenerate-geometry-only (a mesh with a genuinely near-cancelled
tangent basis at a vertex), and no corpus model's recompute reaches it.

**To close:** find or reconstruct the real SharpDX `Vector3.Normalize` zero-tolerance constant and
branch (validated against known SharpDX behaviour, not transcribed from memory), then port it
faithfully into `vNormalize`, and add a synthetic unit test with a hand-built near-zero tangent sum
pinning the boundary.

See `docs/superpowers/specs/2026-07-24-tangent-recompute-design.md` §3.3 (item 3) for the fuller
context this was filed from.
