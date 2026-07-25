# Port the full `ValidateTexFileData` at the TTMP load seam — Design

**Date:** 2026-07-25
**Status:** Design (approved to plan)

**Closes:** prioritized backlog item #1
([`docs/backlog/2026-07-10-imagesharp-resampler.md`](../../backlog/2026-07-10-imagesharp-resampler.md))
and the `ValidateTexFileData` bulk of the T2 item
([`docs/backlog/2026-07-10-fixoldtexdata-load-round.md`](../../backlog/2026-07-10-fixoldtexdata-load-round.md)),
leaving only T2's deferred unconditional recompress.

**Builds on:** the NPOT-resize design
([`2026-07-21-npot-texture-resize-design.md`](2026-07-21-npot-texture-resize-design.md)), which
shipped the Bicubic resampler and the `resizeToPow2ForMerge` helper (with its two faithful TexTools
guards) at the *material-round* call sites. This design brings the same `ValidateTexFileData` logic
to the *load-time* seam that design explicitly scoped out (its §2).

---

## 1. Provenance & the call path

TexTools runs every `.tex` in an old pack through a load-time fixup:

```
WizardData.FromWizardGroup  (WizardData.cs:705, inside `try { … } catch { continue }`)
  -> TTMP.FixOldTexData       (TTMP.cs:1413-1460)
       -> EndwalkerUpgrade.ValidateTexFileData  (EndwalkerUpgrade.cs:2100-2129)
       -> Tex.CompressTexFile  (TTMP.cs:1436)   [recompress — deferred, see §5]
```

`FromWizardGroup` is the load path **both** `/upgrade` (`ModpackUpgrader.cs:58 -> FromModpack`) and
`/resave` (`Program.cs:204`) execute — verified, and distinct from the look-alike
`MakeFileStorageInformationDictionary` (which also calls `FixOldTexData` at `TTMP.cs:1372` but is not
on our path). So this is genuinely part of "load", not "upgrade".

Our port already sits exactly here: `makeTtmpLoadFix`'s `.tex` branch
(`src/upgrade/load-fixes.ts:96-104`), gated by `ttmpNeedsTexFix` (`src/upgrade/texfix.ts`), which
mirrors `DoesModpackNeedFix` (`TTMP.cs:916-930` — TTMP major < 2, or major == 2 && minor == 0; PMP
never). Today that branch only decodes-to-validate and returns the file **unchanged**; the resize and
mip-offset-fixup halves of `ValidateTexFileData` are unported. This design ports them.

## 2. What `ValidateTexFileData` does (`EndwalkerUpgrade.cs:2100-2129`)

One `if/else` over the parsed 80-byte header, two mutually-exclusive branches:

- **Branch A — `(!IsPow2(Width) || !IsPow2(Height)) && MipCount > 1`:** resize to power-of-two.
  ```csharp
  await Tex.ResizeXivTx(tex, IOUtil.RoundToPowerOfTwo(header.Width),
                             IOUtil.RoundToPowerOfTwo(header.Width), false);   // :2110
  return tex.ToUncompressedTex();
  ```
- **Branch B — else** (already power-of-two, or NPOT with ≤1 mip): fix broken mip offsets.
  ```csharp
  var fixupResult = Tex.TexHeader.FixUpBrokenMipOffsets(header, uncompressedTex.Length);   // :2116
  if (fixupResult.HeaderChanged || fixupResult.CalculatedTexSize != uncompressedTex.Length)
  {
      // new = fixed 80-byte header + original body trimmed/kept to CalculatedTexSize
      return newData;
  }
  return null;   // nothing changed
  ```

`FixOldTexData` then does `if (resized != null) data = resized;`, recompresses, and stores.

## 3. Design

### 3.1 Module layout (split, don't blend)

Three distinct C# symbols → three TS homes, orchestrated by the existing load-fix. No blending: each
module cites exactly one C# symbol.

| New/changed | Ports | C# source |
|---|---|---|
| `src/tex/header.ts` → add `fixUpBrokenMipOffsets(header, texSizeInclHeader)` | `Tex.TexHeader.FixUpBrokenMipOffsets` | `Tex.cs:168-235` |
| `src/upgrade/texture.ts` → extract `resizeForMerge(rgba, srcW, srcH, dstW, dstH, format)` core | `Tex.ResizeXivTx` + `MergePixelData` | `Tex.cs:413-420`, `:637-706` |
| `src/upgrade/validate-tex.ts` (new) → `validateTexFileData(uncompressedTex)` | `EndwalkerUpgrade.ValidateTexFileData` | `EndwalkerUpgrade.cs:2100-2129` |
| `src/upgrade/load-fixes.ts` → rewrite the `.tex` branch | `FromWizardGroup` `.tex` else-branch + `FixOldTexData` | `WizardData.cs:701-712`, `TTMP.cs:1413-1460` |

- **`fixUpBrokenMipOffsets`** belongs in `header.ts` (same C# owner `Tex.TexHeader`, beside the
  `parseTexHeader`/`serializeTexHeader` it composes with, reusing `texMipSizes` = our
  `DDS.CalculateMipMapSizes`). It is **also** the symbol the future PMP `FastValidateTexFile` item
  ([`2026-07-13-pmp-load-time-tex-fixup.md`](../../backlog/2026-07-13-pmp-load-time-tex-fixup.md))
  needs — ported once here, wired to the TTMP seam only for now; a comment records the PMP consumer.
- **`resizeForMerge`** is extracted from the shipped `resizeToPow2ForMerge`, which becomes a thin
  wrapper computing per-dimension rounding. Reason: the load seam must reproduce a TexTools bug (§3.3)
  that rounds *width for both dimensions*, which the current helper's hardcoded per-dim rounding
  cannot express. **Material-round callers stay byte-identical** — they still pass independently
  rounded dims through the wrapper.
- **`validate-tex.ts`** is a new module rather than an extension of `texfix.ts`, which owns only the
  *gate*; the *fix body* is a different C# symbol and gets its own home.

### 3.2 Branch A — resize (`src/upgrade/validate-tex.ts` + `resizeForMerge`)

Decode the uncompressed tex → `resizeForMerge` → re-encode, keyed on the source format:

- **A8R8G8B8 (and any format we can round-trip losslessly): resize + `encodeUncompressedTex`,
  byte-exact.** TexTools' `MergePixelData` maps A8R8G8B8 → `CompressionFormat.BGRA` (lossless), and
  `ToUncompressedTex` stores it back as A8R8G8B8 — the same bytes our uncompressed encoder produces.
  This is the case we can match; a synthetic golden (§6) proves it.
- **BC / block-compressed source (DXT1/DXT5/BC5/BC7): fail loud.** See §3.4.

`resizeForMerge` already carries the two faithful TexTools failure guards verbatim (unsupported
format → `"Format is currently unsupported: …"`, `Tex.cs:743`; `<64` post-resize dim →
`"Image is too small for DDS Compressor. (64x64 Minimum Size)"`, `Tex.cs:659`, non-BC7 arm only).
At *this* seam those throws mean **drop** (§3.4), not abort.

### 3.3 The TexTools bug to reproduce (`EndwalkerUpgrade.cs:2110`)

`ResizeXivTx(tex, RoundToPowerOfTwo(header.Width), RoundToPowerOfTwo(header.Width), false)` passes
`Width` for the **height** argument, so a non-square NPOT texture is squished to a square
(`roundW × roundW`). We reproduce it faithfully — `resizeForMerge(rgba, W, H, roundW, roundW,
format)` (source stays `W × H`, target is `roundW × roundW`) — and register it in
`docs/TEXTOOLS_BUGS.md` as a genuine defect we knowingly reproduce.

### 3.4 Drop vs. abort at the load seam

`FixOldTexData` runs under `FromWizardGroup`'s `catch { continue }` (`WizardData.cs:703-712`), so at
this seam a throw **drops the file** — unlike the material round (`EndwalkerUpgrade.cs:1842`, no
catch), where the same `resizeForMerge` guards abort the pack. The helper only throws; the *caller*
decides. Our `.tex` branch therefore:

| Condition | Behaviour | Faithful to TexTools? |
|---|---|---|
| decode failure (majorly-broken tex) | **drop** (`return null`) | ✅ `catch { continue }` |
| `resizeForMerge` guard throw (`<64`, unsupported format) | **drop** | ✅ FixOldTexData throws → `catch { continue }` |
| `texMipSizes` throws on unknown format in Branch B | **drop** | ✅ `DDS.CalculateMipMapSizes` throws → caught |
| Branch B change, or Branch A on A8R8G8B8 | **keep** (fixed bytes) | ✅ byte-exact |
| **Branch A on a BC source** | **fail-loud abort** (typed sentinel escaping the drop-catch) | ❌ *deliberate divergence* |

The BC-source abort is **not** what TexTools does — it resizes + nvtt-re-encodes to the same BC
format and keeps the file. We have no BC encoder (`src/tex/` decodes BC1/3/5/7 but the only encoder
is `encodeUncompressedTex` → A8R8G8B8), and cannot reproduce nvtt byte-for-byte. Emitting A8R8G8B8
instead would be a **larger** divergence than the material-round mask path — it changes the file's
**format and length** (uncompressed is 4–8× larger), not just pixel values — for a path **no corpus
pack reaches**, to "fix" a texture where TexTools' own BC re-encode is the degraded output
(`docs/TEXTOOLS_BUGS.md` #18). So per AGENTS.md "fail loud, never silently diverge," we abort, framed
as an **unported path gated behind the BC-encoder item**
([`2026-07-22-bc-encoder-merge-pixel-data.md`](../../backlog/2026-07-22-bc-encoder-merge-pixel-data.md)).
This is **latent**: it requires an old-version (`needsTexFix`) TTMP carrying a BC NPOT-with-mips
texture; none exists in the corpus.

**Decision provenance.** A BC-encoder impact survey (2026-07-25) confirmed the missing encoder is the
sole blocker of 1 backlog item (+1 matched-pair decoder item) and the cause of all 3 current
`DIVERGENCE_RULES` entries, but that it affects **zero** corpus packs and that closing it would
re-introduce bug #18's quality loss. Option (b) (produce A8R8G8B8 + a new `DIVERGENCE_RULES` entry)
was rejected on that evidence in favour of fail-loud (a). The survey also settled that the BC-encoder
item stays **unprioritized** (probability ~0, severity bounded-to-cosmetic; leverage, not urgency, is
its only case for a bump).

The typed sentinel must escape the load-fix drop-catch. Everything else that throws is caught → drop.

### 3.5 The load-fix `.tex` branch (`load-fixes.ts`)

```
try {
  const { bytes } = requireBytes(file, gamePath);        // GetUncompressedFile; throw → drop
  const fixed = validateTexFileData(bytes);              // Branch A/B; guard throws → drop
  return fixed ? restore(file, fixed, SqPackType.Texture) : file;
} catch (e) {
  if (e is UnportedBcReencode) throw e;                  // fail loud (§3.4), latent
  return null;                                            // majorly-broken / guard fired → drop
}
```

Mirrors the existing `.mdl` branch's `requireBytes` + `restore` shape (`load-fixes.ts:105-116`). The
`ui/` carve-out currently at `:97` is preserved as-is (it predates this change; see the module doc
comment). `restore(file, fixed, SqPackType.Texture)` re-wraps as a Type-4 entry; the stored
uncompressed bytes are what the golden decompresses and compares.

## 4. Blast radius

`validateTexFileData` changes a file's **stored bytes at load**, which feed dedup `common/N`
numbering and every later round — wider than a material-round resize. Mitigations:

- **Branch B is byte-exact** (pure header/size integer math, no lossy step), so it can only *remove*
  existing baseline diffs, never add one.
- **Branch A is latent** for BC (abort) and byte-exact for A8R8G8B8.
- Full `npm test` + a re-bless, reporting per-pack before/after entry counts, with any *unexpected*
  baseline movement investigated (an NPOT/broken-mip source we didn't know about) rather than blessed.

## 5. Deferred (unchanged)

The **unconditional recompress** (`Tex.CompressTexFile`, `TTMP.cs:1436`) stays deferred: it is
invisible to the golden harness, which compares **decompressed** content, and recompression preserves
it — the same reason the `.mdl` load-fix stores uncompressed. T2's backlog item is narrowed to this
remainder only.

## 6. Tests

Following AGENTS.md "a found divergence is a test-coverage gap" — prefer a golden that reproduces the
behaviour first.

### 6.1 Branch B (mip-offset fixup) — corpus-forced, verifiable now

- **Unit** (`test/tex/header.test.ts`): `fixUpBrokenMipOffsets` on hand-built headers derived from the
  C# — broken offsets rewritten, excess trailing data trimmed via `CalculatedTexSize`, `LoDMips`
  clamped when a referenced mip is dropped, no-op returns unchanged. Cite `Tex.cs:168-235`.
- **Corpus re-bless:** the `/resave` mip-offset entries for `Bloodlust - Bibo+.ttmp2`
  (`v01_c0201e0256_top_m.tex`, first diff byte 72) and `chained_collars_v1_1_0.ttmp2`
  (`v01_c0101a0004_nek_d.tex`, first diff byte 20) — documented in the T2 item — should **shrink or
  vanish**. Report before/after; check `/upgrade` baselines for the same packs.
- **Synthetic modpack** (`scripts/generate-synthetics/`): an old-version TTMP with a POT `.tex` whose
  mip offsets are deliberately broken / carry trailing null padding → `/upgrade` golden pins the fixup
  independent of the two real packs above.

### 6.2 Branch A (resize)

- **Synthetic modpack — A8R8G8B8:** an old-version TTMP with an A8R8G8B8 **NPOT-with-mips** `.tex`
  (e.g. 400×400, ≥2 mips) → `/upgrade` golden, expected **byte-exact**. Proves the resize wiring and
  the width-for-both-dims bug against the real oracle.
- **Unit** (`test/upgrade/validate-tex.test.ts`): NPOT-with-mips A8R8G8B8 resizes to the hand-computed
  `resizeForMerge` + `encodeUncompressedTex` reference; **the §3.3 bug** — a non-square NPOT input
  produces a **square** output (`roundW × roundW`); guard cases return the drop signal; a BC
  NPOT-with-mips source throws the `UnportedBcReencode` sentinel.
- **BC measurement (documentation, not a passing golden):** optionally build the BC-source synthetic
  (an old-version TTMP with a DXT5 NPOT-with-mips `.tex`, hand-assembled like `npot-mask-dxt5`),
  capture ConsoleTools' golden, and record the measured divergence magnitude in `TEXTOOLS_BUGS.md`
  #18 / the backlog item as the evidence for §3.4's fail-loud choice. It **cannot** be a normal
  corpus pack (ConsoleTools succeeds where we deliberately abort) — pin our abort with the unit test
  above. Skip if the measurement adds nothing beyond the mask-path numbers already recorded.

### 6.3 Regression guard

Branch A must not fire on a POT-with-mips or a ≤1-mip texture (those take Branch B); Branch B must
no-op when offsets are already correct. Assert both explicitly so a future change can't silently swap
branches.

## 7. Backlog & docs outcome

- `2026-07-10-imagesharp-resampler.md` (prioritized #1) — **delete** on ship; grep `src/`, `test/`,
  `docs/` for references first (per `docs/BACKLOG.md`'s rule) and update each.
- `2026-07-10-fixoldtexdata-load-round.md` (T2) — **narrow** to the deferred recompress remainder;
  the `ValidateTexFileData` resize + mip-offset halves are done.
- `2026-07-13-pmp-load-time-tex-fixup.md` — note that `fixUpBrokenMipOffsets` is now ported and ready
  to wire; the PMP `FastValidateTexFile` truncation half remains.
- `docs/TEXTOOLS_BUGS.md` — **add** the width-for-both-dims resize bug (§3.3); optionally append the
  measured BC magnitude to #18 (§6.2).
- `docs/BACKLOG.md` — re-rank after removing #1; record a dated pass note. BC-encoder item stays
  unprioritized (§3.4 survey).
