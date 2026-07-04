# BCn decode golden fixtures

Golden test vectors for the BCn decoder (`src/tex/decode.ts`, `src/tex/bc7.ts`), independent of the
modpack corpus and of TexTools. See `docs/superpowers/specs/2026-07-04-bcn-decode-golden-fixtures-design.md`.

## What's here

- `sources/*.tga` — small, deterministic, procedurally-generated source images (viewable).
- `images/<name>.<fmt>.bin` — raw compressed mip bytes (texconv encode of the source, DDS container stripped).
- `images/<name>.<fmt>.rgba` — golden RGBA8888, **standard channel order**, exactly texconv's decode.
- `manifest.json` — the vector list the test iterates.
- `blocks/*` — present only if a BC7 mode had to be hand-authored (see "Filling mode gaps").

## Oracle

DirectXTex `texconv` (Microsoft's reference BCn codec). Version used: **DirectXTex may2026 (texconv 2026.5.8.1)**.
BCn decode is bit-exact and spec-defined, so texconv's output is authoritative and independent of our
ported lineage. texconv is a dev-time tool — **not committed** and **not** an npm dependency.

## Channel order

texconv emits standard RGBA. Our decoder applies TexTools conventions on top of a standard decode; the
test applies the same mapping to the golden before comparing (`applyChannelMap`):

| Format | channelMap | Our output vs. standard |
|---|---|---|
| DXT1 / DXT3 / DXT5 | `none` | unchanged |
| BC4 | `grayFromR` | red replicated across RGB, opaque (R,R,R,255) |
| BC5 | `swapRB` | R<->B swap: (0, ch1, ch0, 255) |
| BC7 | `swapRB` | R<->B swap on the decoded block |

## Regenerate

Requires `texconv` on PATH (or `TEXCONV=C:\path\to\texconv.exe`):

    npx tsx test/tex/fixtures/bcn/regen.ts

It regenerates `sources/`, `images/`, and `manifest.json`, then prints the covered BC7 mode set.

## Filling mode gaps

If `regen.ts` warns that a BC7 mode is missing, hand-author one valid block for that mode (extend the
mode-6 builder in `test/tex/make-tex.ts`), write the 16 raw bytes to `blocks/bc7-mode<N>.bin`, wrap them
in a 4x4 BC7 DDS and `texconv -f R8G8B8A8_UNORM` it to `blocks/bc7-mode<N>.rgba`, and add a manifest entry
`{ name, format: "BC7", width: 4, height: 4, input, expected, channelMap: "swapRB" }`. The mode-coverage
test then goes green.

## Coverage impact

<!-- filled in by the coverage-assessment task -->
