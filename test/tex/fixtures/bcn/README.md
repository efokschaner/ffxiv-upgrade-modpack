# BCn decode golden fixtures

Golden test vectors for the BCn decoder (`src/tex/decode.ts`, `src/tex/bc7.ts`), independent of the
modpack corpus. See `docs/superpowers/specs/2026-07-04-bcn-decode-golden-fixtures-design.md`.

## What's here

- `sources/*.tga` — small, deterministic, procedurally-generated source images (viewable).
- `images/<name>.<fmt>.bin` — raw compressed mip bytes (texconv encode of the source, DDS container stripped).
- `images/<name>.<fmt>.rgba` — golden RGBA8888 (provenance depends on format — see Oracle below).
- `blocks/bc7-mode<N>.{bin,rgba}` — synthetic single-block BC7 vectors for modes the encoder never emits (0/1/2).
- `manifest.json` — the vector list the test iterates: `{ name, format, width, height, input, expected, channelMap }`.

## Oracle (two tiers — this is the important part)

DirectXTex `texconv` — version **DirectXTex may2026 (texconv 2026.5.8.1)**. Dev-time tool, **not committed**,
**not** an npm dependency.

BCn decode is **only** bit-exact/standardized for **BC7 (BPTC)** — there, texconv is an authoritative
independent oracle and every one of our BC7 vectors matches it byte-for-byte. The older **BC1/BC2/BC3/BC4/BC5
(S3TC/RGTC)** formats do **not** standardize how the 1/3 and 2/3 endpoint blends round: DirectXTex rounds
(`(2·c0+c1+1)/3`), while our decoder faithfully ports **rgbcx's default `cBC1Ideal`** (truncation,
`(2·c0+c1)/3` — `reference/bc7enc_rdo/rgbcx.cpp:2959`, `rgbcx.h:274`). The two agree to within **±1 per
channel**. So the golden differs by format:

| Formats | Golden `expected` is… | `channelMap` | Test asserts |
|---|---|---|---|
| **BC7** | texconv's decode (**independent, standard order**) | `swapRB` | **byte-exact** vs texconv |
| **BC1/BC2/BC3/BC4/BC5** | **our decoder's own output**, frozen (already in our channel order) | `none` | byte-exact vs the frozen snapshot |

For the S3TC/RGTC formats the committed golden is our decoder's frozen output (a regression/characterization
anchor), but it is **not** blindly frozen: `regen.ts` **gates** each such vector against texconv at generation
time and fails if our decode differs by more than 1 per channel — an independent check that there is no
structural, channel-order, or endpoint bug (only the sub-LSB rounding convention may differ). BC7 vectors are
gated to an **exact** (0) match.

### How confident are we these match TexTools?

- **BC5 / BC7:** high — TexTools decodes these via **BcnSharp**, a P/Invoke wrapper around the same
  `bc7enc_rdo`/rgbcx we ported, at rgbcx's default mode, so our interpolated **values** share that lineage;
  and the texconv gate independently corroborates the BC5/BC7 **channel order** (a wrong swap would diverge
  by ~255, not ≤1). The corresponding "channel order settled" notes in `src/tex/decode.ts` (BC5) and
  `src/tex/bc7.ts` (BC7) are updated on this branch to match.
- **BC1 / DXT3 / BC4:** TexTools decodes these via **FNA's `DxtUtil`** (Ms-PL, which we deliberately did
  **not** transcribe — see the tex-codec spec §3), a *different* implementation. Our frozen values are a
  faithful standard rgbcx decode, corroborated within ±1 of DirectXTex, but they are **not** independently
  diffed against DxtUtil byte-for-byte. Decoded RGBA is an intermediate for transforms, not the container
  round-trip fidelity gate, so ±1 rounding here is immaterial to pass-through correctness.

## Channel mapping

`channelMap` (applied by the test's `applyChannelMap`) reconciles a golden with our decoder's TexTools
channel convention. It is only non-`none` for BC7 here (whose golden is texconv standard-order); the frozen
BC1–5 goldens are already in our order, so they use `none`. For reference, our decoder's conventions are:

| Format | our output vs. standard |
|---|---|
| DXT1 / DXT3 / DXT5 | standard RGBA, unchanged |
| BC4 | red replicated across RGB, opaque (R,R,R,255) |
| BC5 | R↔B swap: (0, ch1, ch0, 255) |
| BC7 | R↔B swap on the decoded block |

## Regenerate

Requires `texconv` on PATH (or `TEXCONV=C:\path\to\texconv.exe`):

    npx tsx test/tex/fixtures/bcn/regen.ts

It regenerates `sources/`, `images/`, `blocks/`, and `manifest.json`, gating each vector against texconv
(exact for BC7, ≤1 for S3TC/RGTC) and printing the covered BC7 mode set. Fallback BC7 mode blocks (0/1/2)
are authored automatically for any mode the encoder does not emit.

## Coverage impact

`npm run test:coverage` (full suite incl. corpus), before vs. after these fixtures + the golden test
(`test/tex/tex-bcn-golden.test.ts`):

| File | lines | branches | functions |
|---|---|---|---|
| `src/tex/bc7.ts` | 23.7% → **98.9%** | 12.2% → **96.3%** | 33.3% → **100%** |
| `src/tex/decode.ts` | 99.1% → 99.1% | 84.4% → **89.6%** | 100% → 100% |

`bc7.ts` is the headline. Previously only BC7 **mode 6** had a known-answer test, so the other modes'
decode paths were never executed (23.7% lines / 12.2% branches / 33.3% functions). The golden suite
decodes all **8 modes** — modes 3–7 from real texconv-encoded images, modes 0–2 from the authored
single-block fixtures — lifting it to ~99% lines / 96% branches / 100% functions.

`decode.ts` lines were already ~99% from the existing hand-computed known-answer unit tests, so its gain
is in **branches** (84.4% → 89.6%): the BC1/BC2/BC3/BC4/BC5 vectors exercise real multi-block data, the
BC4 gray and BC5 R↔B channel paths, and the partial-edge-block clip paths (`if (px < w)` / `if (py < h)`)
via the 65×33 `edge` fixtures — coverage that was previously only length-checked on the corpus. This is a
branch/behavioural gain (pixel-exact, per mode and per path), not merely a line-count delta.
