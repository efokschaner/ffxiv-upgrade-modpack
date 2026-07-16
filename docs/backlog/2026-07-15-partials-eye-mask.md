# Round 6 partials — `UpdateEyeMask` pixel pipeline

Filed: 2026-07-15 · Updated: 2026-07-16 · Status: open · Priority: prioritized

The **control-flow half** of `UpdateEyeMask` (`EndwalkerUpgrade.cs:2007-2079`) is now ported: the
`EyeMaskPathRegex` match, the option-exists check, the face/race parse, and the bundled iris
`(race, face) → diffuse` **existence oracle** with its `FileExists` gate all live in
`src/upgrade/eye-mask.ts` (table in `src/upgrade/reference/eye-materials.ts`, extracted by
`scripts/extract-eye-materials.ts`). When an unclaimed `--c{race}f{face}_iri_s.tex` clears every guard
— i.e. TexTools *would* convert it — the port **throws a fail-loud gap** citing this item, instead of
the previous silent pass-through. See `docs/superpowers/specs/2026-07-16-eye-mask-partial-design.md`.

**What remains — the pixel half.** To actually produce the Dawntrail diffuse (and remove the throw),
port `ConvertEyeMaskToDiffuse` (`EndwalkerUpgrade.cs:1910-2003`) and the tail of `UpdateEyeMask`
(`:2056-2077`):

- **ImageSharp pixel pipeline (the blocker).** Bicubic `Resize`, NearestNeighbor `Resize`,
  `BoxBlur(w/128)`, and two `DrawImage` alpha composites (positioned `SrcOver`, then `SrcAtop`). This
  depends on and subsumes the T3 resampler item (`docs/backlog/2026-07-10-imagesharp-resampler.md`).
  The pure per-texel helpers it also uses — `ExpandChannel`, `MaskImage`, `SwizzleRB`
  (`TextureHelpers.cs`) — are trivial and can be added to `src/tex/helpers.ts` alongside the existing
  ports.
- **Bundled base-game eye textures** `chara/common/texture/eye/eye01_base.tex` and `eye01_mask.tex`
  (`:1928-1929`): their raw RGBA pixels, extracted in the same `extract-eye-materials.ts` pass.
- **Write-back is already solved.** The output is uncompressed A8R8G8B8 (`DefaultTextureFormat`,
  `XivCache.cs:68`; the `ConvertToDDS`/`DDSToUncompressedTex` round collapses to
  `encodeUncompressedTex` + `writeGeneratedTex`, both already byte-exact), and the diffuse
  **destination path** is already captured per-entry in `eye-materials.ts` — **no second game-install
  extraction run is needed.**

**Two avenues to evaluate first (operator-flagged, 2026-07-16):**

1. **Third-party npm library** that reproduces the ImageSharp ops closely enough — survey a pure-JS
   resampler, `sharp`/libvips, and `jimp` before hand-porting resampler + blur + compositing. Install
   pinned-exact with a ≥7-day min release age (supply-chain rule).
2. **"Close-enough" comparison.** Byte-parity against ImageSharp float math is unlikely; expect a
   `DIVERGENCE_RULES` entry with a documented per-pixel tolerance, as other texture cases already do
   non-exact matching (`test/helpers/upgrade-compare.ts`). Scope the pixel port as "close-enough,
   blessed against a golden," not "byte-exact."

**Coverage — add the golden as part of the pixel port (same work removes the throw).** A synthetic
**unit** test pins the shipped gate today; a golden is not viable *yet* because **our** port throws at
the unported pixel step. Note the blocker is our side, not the harness: ConsoleTools **succeeds** on an
eye mod (it emits a converted diffuse, a perfectly cacheable golden) — so this is **not** the
`docs/backlog/2026-07-11-expected-failure-golden.md` case (that item is about packs *ConsoleTools*
errors on). Porting the pixel pipeline is exactly what stops our throw, at which point a normal golden
just works. **So when the pixel port lands, it MUST land with a golden** — a synthetic (or real) eye
mod that ships a loose `iri_s.tex`, run through `/upgrade` and compared under the close-enough
`DIVERGENCE_RULES` tolerance above. The golden proving the conversion and the removal of the throw are
the same deliverable; do not consider the pixel port done without it. (Locking the *current* throw
behaviour via an expected-failure golden is possible but low-value — the unit/e2e tests already assert
it — and would need the separate expected-failure capability, so it is not planned here.)

Reference: `reference/.../Mods/EndwalkerUpgrade.cs:1910-2003, 2056-2077`, `.../ModpackUpgrader.cs:174-177`.
