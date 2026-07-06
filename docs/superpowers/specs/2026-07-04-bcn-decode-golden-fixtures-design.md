# BCn Decode Golden Fixtures — Design

**Date:** 2026-07-04
**Status:** Implemented (PR #9). **Amended during implementation — see the "Amendment" note below; the
fixtures `README.md` is the authoritative description of the final two-tier design.**
**Depends on:** TEX Codec (merged; `src/tex/`). Adds tests + committed fixtures only; no production
source changes except downgrading two `PROVISIONAL`/`TODO` comments once the gaps they name are covered.
**Parent spec:** `2026-07-03-tex-codec-design.md` (§5 decode, §6/§7 correctness strategy).

---

## Amendment (2026-07-04, during implementation)

§4 below (and the corresponding plan) originally specified a **single-tier** oracle: goldens stored as
*unmodified texconv output* for **all** formats, with the test asserting byte-exact vs texconv. Wiring up
the fixtures surfaced that **BCn decode is only bit-exact/standardized for BC7 (BPTC)** — the older
BC1–BC5 (S3TC/RGTC) formats leave the ⅓/⅔ midpoint rounding implementation-defined, so texconv (which
rounds) differs from our decoder (faithful to rgbcx's default `cBC1Ideal` truncation, the BcnSharp/rgbcx
lineage TexTools uses) by ±1. The shipped design is therefore **two-tier**:

- **BC7** → golden is texconv's decode (independent, byte-exact), all 8 modes (0–2 via authored blocks).
- **BC1–BC5** → golden is our decoder's own frozen output, which the generator gates to within ±1 of
  texconv at generation time (an independent no-structural-bug check).

`test/tex/fixtures/bcn/README.md` is the authoritative, current description. Read §4 below as the original
intent; the README overrides it wherever they differ.

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

### Family A — BC7 all-modes coverage (encoder-sourced + measured guard)

Goal: pixel-verify **every** BC7 mode 0–7, with coverage that is **measured and asserted**, not assumed.

Mechanism:

- Craft the Family-B source images (below) to deliberately induce a spread of BC7 modes — multi-region
  color patches (partitioned modes 1/3/7), decorrelated alpha (rotation/index modes 4/5), 3-subset
  opaque regions (modes 0/2), smooth opaque (mode 6) — and encode with texconv at **maximum quality**
  (`-bcmax`), which pushes the encoder to exploit more modes.
- A tiny **mode-histogram** reads the BC7 mode of every block across all committed BC7 fixtures. A test
  asserts the **set of covered modes**. The BC7 block mode is trivially recoverable: it is the index of
  the least-significant set bit of the block's first byte (mode *m* = *m* zero bits then a 1).
- **Fallback authoring only for genuinely unreachable modes.** If a mode never appears after crafting
  images, hand-author a single valid block for *that* mode (extending the existing `make-tex.ts` mode-6
  builder) — expected to be at most a couple, if any. The histogram makes any such gap explicit rather
  than silent.
- Either way, expected pixels come from **texconv**, not hand computation — no shared-logic blind spot.

Closes: `bc7.ts:5` (modes 0–5/7 unverified), with the exact covered-mode set recorded and asserted.

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
  images/
    <name>.<fmt>.bin                 # Family B: raw compressed mip bytes per (image, format)
    <name>.<fmt>.rgba                # Family B: golden RGBA (texconv, standard order)
                                     #   BC7 fixtures here supply Family-A mode coverage (measured)
  blocks/
    bc7-mode<N>.bin / .rgba          # Family A FALLBACK ONLY: hand-authored block for any BC7 mode
                                     #   texconv's encoder never emitted (often empty)
  sources/
    <name>.<ext>                     # Family B: committed source images (viewable)
  README.md                          # provenance, exact texconv commands + version, channel-order note
  gen-bcn-fixtures.ps1               # regen script (dev-time; shells out to texconv)
```

- Inputs/goldens are **raw `.bin`/`.rgba`** (opaque but fully deterministic, and regenerable from the
  committed sources + regen script). Source images stay committed and viewable for human review. Storing
  goldens raw avoids adding a PNG decoder to the test (respects the tex-codec no-runtime-deps rule).
  These fixtures live under `test/tex/fixtures/` — **not** under the gitignored `/test/corpus/` — so they
  are committed to the repo (small and stable), unlike the local-only modpack corpus.
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

Pure data-driven; no external tooling at test time; part of the normal `npm test` gate. Uses the
standard `node:fs` fixture-reading pattern and lives alongside the other `test/tex/` files.

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
- **Coverage-change assessment (required deliverable).** Capture `npm run test:coverage` **before** and
  **after** the change, and report the delta for `src/tex/decode.ts` and `src/tex/bc7.ts` — line/branch/
  function %, plus which previously-uncovered regions (notably the BC7 per-mode branches, BC4/BC5 channel
  paths, and edge-block clip paths) are now exercised. This is the concrete evidence the effort moved the
  needle; include it in the final task write-up.
- Each Family-A block is confirmed to be a *valid* mode-N block by texconv accepting and decoding it as
  that mode (recorded in the README); the golden is texconv's decode.
- End-of-task ritual per `AGENTS.md`: `npm run check`, `npm run typecheck`, `npm test` all green.
- The two `PROVISIONAL` comments and the one `TODO` (§4) are downgraded/removed in the same change, so the
  source no longer claims these paths are unverified.

---

## 9. Risks & mitigations

- **A BC7 mode may be unreachable by texconv's encoder** even with crafted content and `-bcmax`.
  Mitigation: the mode-histogram makes any gap explicit; hand-author a single valid block for just that
  mode (extending the existing mode-6 builder), validated against texconv. Expected to be at most a
  couple of modes, if any — far less bitstream code than authoring all eight.
- **DDS container stripping** must handle the DX10 extended header (BC7/BC5 use DXGI formats). Mitigation:
  the regen script detects the `DX10` fourCC and adjusts the header offset; documented in the README.
- **texconv availability on the dev machine.** Mitigation: download the standalone signed exe (no global
  install, no system side-effects); record version in the README. Fixtures, once minted and committed,
  never need texconv again.
