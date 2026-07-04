# BCn Decode Golden Fixtures — Design

**Date:** 2026-07-04
**Status:** Design approved (brainstorming complete) — ready for implementation planning
**Depends on:** TEX Codec (merged; `src/tex/`). Adds tests + committed fixtures only; no production
source changes except downgrading two `PROVISIONAL`/`TODO` comments once the gaps they name are covered.
**Parent spec:** `2026-07-03-tex-codec-design.md` (§5 decode, §6/§7 correctness strategy).

---

## 1. Goal

Raise real, pixel-level test coverage of the BCn **decoder** (`src/tex/decode.ts`, `src/tex/bc7.ts`)
with a small, stable, committed set of golden decode vectors — independent of both the large modpack
corpus (which is volatile and being re-sourced) and of TexTools/ConsoleTools.

Concretely, close the gaps the decoder's own comments flag as unverified:

- **BC7 modes 0–5 and 7 have no known-answer test** (`bc7.ts:5`). Only mode 6 is unit-tested; the other
  modes are exercised on corpus textures for **output length only**, so their pixel output is unverified.
- **BC7 channel order (the R/B swap) is provisional** (`bc7.ts:11`).
- **BC5 channel order is provisional** (`decode.ts:396`).

Non-goals for this effort (explicitly out of scope):

- Nvtt **mip-filter** parity (`generateMipmaps`) and **power-of-two resize** (`resizeToPowerOfTwo`).
  These are *not* spec-exact; their real oracle is Nvtt via ConsoleTools, not texconv, and they are
  already parked as deferred "tier-2 oracle" work in the tex-codec spec (§6). Mixing them in would drag
  a second, incompatible toolchain into this effort.
- The BCn **encoder** (still deferred per tex-codec spec §9).
- Proving TexTools' *intent* for the R/B swap convention. We verify our decode equals an independent
  standard decode **plus a documented swap** — the strongest independent statement available without the
  TexTools oracle. A later ConsoleTools run can confirm intent; it is not needed here.

---

## 2. Why this approach

BCn decode is a **bit-exact, spec-defined** operation: a conformant decoder must return results identical
to the format specification (Microsoft: "BC7 decompression hardware must be bit accurate … identical to
the results returned by the decoder described in the specification"). This is the same reasoning the
tex-codec spec used in §5 ("a spec-conformant decoder matches any other").

Consequence: we can generate golden `(compressed input → expected RGBA)` pairs **once**, offline, with a
trusted independent decoder, commit them, and the test itself needs **no tooling** — no corpus, no oracle
run at test time. It runs in the normal `npm test` gate as pure data-driven assertions.

**Oracle: DirectXTex `texconv`.** Chosen over the ported lineage (`bc7enc`) and over ConsoleTools because
it is independent of *both* our port and TexTools, so it catches real port bugs **and** channel-order
mistakes. texconv both **encodes** (mint compressed inputs) and **decodes** (mint golden pixels), so one
trusted tool produces both halves of every vector.

---

## 3. Fixture families

Two families, because they close different gaps. Both are needed; neither alone is sufficient.

### Family A — per-mode BC7 blocks (guarantees mode coverage)

One hand-authored 16-byte BC7 block per mode **0–7**, each a single 4×4 block.

- Why hand-authored, not encoder-driven: DirectXTex's BC7 encoder picks modes **adaptively** and may
  never emit some modes for given content, so encoding images cannot *guarantee* all-8-mode coverage.
  Hand-authoring the mode bits does.
- We do **not** hand-compute expected pixels. We author only a **valid** mode-N block (correct mode
  marker + minimally-valid partition/endpoint/index/p-bit fields, with non-trivial endpoints/indices so
  the mode's interpolation math is actually exercised). **texconv decodes the block to produce the
  golden.** Cross-decoding our block against an independent decoder *is* the verification — no re-derived
  expected values, so no shared-logic blind spot.
- Existing `test/tex/make-tex.ts` already has a mode-6 block builder; this generalizes that to a
  per-mode builder. Blocks are validated during authoring by decoding with both our decoder and texconv
  and confirming agreement (that agreement is the committed golden).

Closes: `bc7.ts:5` (modes 0–5/7 unverified).

### Family B — small real source images (breadth, multi-block, edges, BC1–5)

A small set (~2–3) of committed source images, each encoded via texconv to **every** supported block
format — BC1 (DXT1), BC2 (DXT3), BC3 (DXT5), BC4, BC5, BC7 — and decoded back to golden RGBA.

These add what Family A cannot:

- **Multi-block iteration** and realistic content (not just single solid/synthetic blocks).
- An **alpha channel** (exercises DXT3/DXT5/BC7 alpha paths, and BC1 punch-through).
- **Non-multiple-of-4 dimensions** (e.g. one 65×33 image) to hit the partial-edge-block clip paths
  (`if (px < w) / if (py < h)`).
- Pixel-exact verification of BC1–5 on real data — upgrading the corpus's current *length-only* smoke to
  *pixel-exact*, **without the corpus**.

**Source images** are small and **deterministic** (procedurally generated patterns: smooth gradient,
sharp two-color edge, alpha ramp, flat region — chosen to span encoder decision paths), committed in a
texconv-readable uncompressed format (PNG/TGA/DDS). Determinism + procedural generation means "unlikely
to change" and no third-party licensing. Total footprint: a few hundred KB.

Closes: pixel-level BC1–5 coverage; edge-block coverage; contributes to channel-order coverage (§4).

---

## 4. Channel-mapping handling (the two PROVISIONAL comments)

texconv emits **standard** R8G8B8A8. Our decoders apply TexTools-specific channel conventions on top of a
standard decode, which differ per format. **These mappings are not incidental — they are exactly what the
PROVISIONAL comments call unverified — so the test must apply the same documented mapping to texconv's
standard output before comparing.** The full table:

| Format | Our decoder output vs. standard | `channelMap` |
|---|---|---|
| BC1 (DXT1), BC2 (DXT3), BC3 (DXT5) | standard RGBA, unchanged | `none` |
| **BC4** | **grayscale** `(v,v,v,255)` — TexTools replicates the single channel across RGB, whereas texconv BC4 is red-only `(v,0,0,255)` (`decode.ts:374`) | `grayFromR` |
| **BC5** | R↔B swap: `(0, ch1, ch0, 255)` vs. texconv's `(ch0, ch1, 0, 255)` (`decode.ts:396`) | `swapRB` |
| **BC7** | R↔B swap on the decoded block (`bc7.ts:11`) | `swapRB` |

Decision: **goldens are stored as unmodified texconv output** (standard order — so they stay
re-verifiable against texconv at any time), and the **test applies the documented mapping** for each
vector before comparing. A per-vector `channelMap` field (`none` | `swapRB` | `grayFromR`) in the
manifest drives this; the mapping is a small local helper in the test, where it is visible and
documented, not baked silently into the golden.

This makes each assertion read literally as: *our decode == an independent standard decode, plus this
documented channel mapping*. That is what resolves both `PROVISIONAL` comments. On landing, downgrade:

- `bc7.ts:11` and `decode.ts:396` from "PROVISIONAL / unverified" to "verified against texconv;
  the channel mapping is applied on top of standard-order decode and is covered by `tex-bcn-golden`."
- `bc7.ts:5` TODO removed (modes 0–7 now have golden fixtures).

For any BC5 / BC4 vector to be meaningful the source must have **distinct R and G** content (so a wrong or
missing mapping is observable); the procedural sources guarantee this.

---

## 5. Fixture layout & storage

```
test/tex/fixtures/bcn/
  manifest.json              # array of vectors (see schema below)
  blocks/
    bc7-mode0.bin .. bc7-mode7.bin   # Family A: raw 16-byte compressed blocks
    bc7-mode0.rgba .. bc7-mode7.rgba # Family A: golden RGBA (texconv, standard order)
  images/
    <name>.<fmt>.bin                 # Family B: raw compressed mip bytes per (image, format)
    <name>.<fmt>.rgba                # Family B: golden RGBA (texconv, standard order)
  sources/
    <name>.<ext>                     # Family B: committed source images (viewable)
  README.md                          # provenance, exact texconv commands + version, channel-order note
  gen-bcn-fixtures.ps1               # regen script (dev-time; shells out to texconv)
```

- Inputs/goldens are **raw `.bin`/`.rgba`** (opaque but fully deterministic) — same precedent as the
  committed `test/corpus/.oracle-cache/*.bin` blobs. Source images stay committed and viewable for human
  review. Storing goldens raw avoids adding a PNG decoder to the test (respects the tex-codec
  no-runtime-deps rule).
- **Manifest vector schema** (single source of truth the test iterates):

  ```jsonc
  {
    "name": "bc7-mode3",        // unique label; also used in test titles
    "format": "BC7",            // maps to the XivTexFormat constant in src/tex/types.ts
    "width": 4,
    "height": 4,
    "input": "blocks/bc7-mode3.bin",
    "expected": "blocks/bc7-mode3.rgba",
    "channelMap": "swapRB"      // none | swapRB | grayFromR — applied to the golden before comparing (§4)
  }
  ```

- The manifest enumerates BC7 modes 0–7 explicitly, so mode coverage is **visible and asserted** — no
  silent gaps (a test-count assertion guards against a mode vector going missing).

---

## 6. The test

`test/tex/tex-bcn-golden.test.ts`:

1. Read and parse `manifest.json`.
2. For each vector: read `input` bytes, build a minimal `XivTex` (`format`, `width`, `height`,
   `mipData = input`, single mip — reusing the `texOf` shape already in `tex-decode.test.ts`), call
   `decodeToRgba`.
3. Apply the vector's `channelMap` (`none` | `swapRB` | `grayFromR`, §4) to the **golden** so it matches
   our decoder's TexTools convention (a small local helper — the mapping is intentionally in the *test*,
   where it is visible and documented, not baked into the committed golden).
4. Assert **byte-exact** equality against the `expected` golden.
5. A guard assertion confirms all 8 BC7 modes are present (coverage cannot silently shrink).

Pure data-driven; no external tooling at test time; part of the normal `npm test` gate. Follows the
existing `node:fs` fixture-reading pattern in `tex-fixtures.test.ts` and lives alongside the other
`test/tex/` files.

---

## 7. Reproducibility

`test/tex/fixtures/bcn/gen-bcn-fixtures.ps1` + `README.md` document exact regeneration:

- **texconv is a dev-time tool** — acquired (downloaded from DirectXTex releases; Microsoft-signed),
  **not committed** to the repo, exactly like the ConsoleTools oracle. The README records the version
  used and the acquisition step.
- The script, for Family B: source → `texconv -f <BCn>` → compressed DDS → strip the DDS container to
  raw mip bytes (handling the optional DX10 extended header) → `<name>.<fmt>.bin`; then
  `texconv -f R8G8B8A8_UNORM` on that DDS → uncompressed DDS → strip container → `<name>.<fmt>.rgba`.
- For Family A: wrap each hand-authored block in a minimal BC7 DDS → texconv decode → strip → `.rgba`.
- The script also writes/updates `manifest.json` so the committed manifest and blobs cannot drift.

Regeneration is a one-time/occasional dev action, **not** part of the `npm test` gate.

---

## 8. Correctness / verification of this work

- The new test must pass in `npm test` and show up in `npm run test:coverage` exercising the BC1/BC2/BC3/
  BC4/BC5/BC7 decode paths and all BC7 modes (report-only; no threshold gate).
- Each Family-A block is confirmed to be a *valid* mode-N block by texconv accepting and decoding it as
  that mode (recorded in the README); the golden is texconv's decode.
- End-of-task ritual per `AGENTS.md`: `npm run check`, `npm run typecheck`, `npm test` all green.
- The two `PROVISIONAL` comments and the one `TODO` (§4) are downgraded/removed in the same change, so the
  source no longer claims these paths are unverified.

---

## 9. Risks & mitigations

- **Authoring valid per-mode BC7 blocks is fiddly** (partitions, subset endpoints, p-bits, index/rotation
  bits for modes 4/5). Mitigation: we already own a full BC7 decoder to sanity-check each block, and
  texconv is the independent cross-check; use partition 0 and simple endpoints where a mode allows, and
  keep each block minimal-but-non-trivial. This is the main implementation effort.
- **DDS container stripping** must handle the DX10 extended header (BC7/BC5 use DXGI formats). Mitigation:
  the regen script detects the `DX10` fourCC and adjusts the header offset; documented in the README.
- **texconv availability on the dev machine.** Mitigation: download the standalone signed exe (no global
  install, no system side-effects); record version in the README. Fixtures, once minted and committed,
  never need texconv again.
