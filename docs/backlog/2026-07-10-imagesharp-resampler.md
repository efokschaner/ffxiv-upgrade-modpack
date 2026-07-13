# T3 — ImageSharp Bicubic/NearestNeighbor resampler (texture-round resize skips + T2)

Filed: 2026-07-10 · Status: open · Needs its own spec→plan

The texture round throws `TextureResizeUnsupported` (caught → skipped, baselined) whenever a
generation source is non-power-of-two (`CreateIndexFromNormal` `:1098`, `UpgradeMaskTex` `:2088`) or
a hair normal/mask pair differs in size (`ResizeImages`, `:1205`). C# resizes via ImageSharp
(Bicubic, or NearestNeighbor for the pow2 pre-step).

**Real corpus case:** `Misty_Hairstyle_Female.ttmp2` hits the hair size-mismatch branch twice
(normal 4096² vs mask 1024², c0101/c0201 h0170) — currently baselined skips. **No NPOT source exists
anywhere in the ~940-pack scan**, so the NPOT branch has zero real coverage (synthetic-only when
built).

Porting an ImageSharp-faithful Bicubic resampler is the shared dependency for these skips AND T2's
`ValidateTexFileData` NPOT-resize (`2026-07-10-fixoldtexdata-load-round.md`); byte-parity against
ImageSharp's float math may be machine-dependent (see the texture-round spec,
`docs/superpowers/specs/2026-07-09-texture-round-design.md` §4.4) — likely needs a scoped
per-pixel-threshold `DIVERGENCE_RULES` entry for resized outputs.
