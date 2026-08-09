# TexTools re-pin Part B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port upstream commit `1993bf6` ("Be less strict about texture mip data, and fix
non-ascending lodmips") — the last commit in the v3.1.0.2 → v3.1.1.4 range that still owes a port —
and pin the result against the real ConsoleTools oracle with two synthetic load-seam modpacks.

**Architecture:** Three hunks, all in `Tex.cs`, landing in two of our modules. `TexHeader.ToBytes`
loses its entire four-check validation block, so our `assertTexHeaderWritable`
(`src/tex/header.ts`) and its one call site (`src/upgrade/validate-tex.ts`) are deleted;
`FixUpBrokenMipOffsets` gains an ascending-order clamp on `LoDMips`, added to `fixUpBrokenMipOffsets`
in the same module; and `CreateTexFileHeader`'s LoD2 line changes, a one-token edit to
`buildCanonicalTexHeader`. Hunks 1 and 3 together convert a currently-dropped texture into a repaired,
retained one — the class-1 fix — so they land as one task. Hunk 2 is independent. Two new synthetic
`.ttmp2` packs then drive the same `/upgrade` golden harness the rest of the corpus uses, which
requires one new parameter on the shared TTMP2 builder.

**Tech Stack:** TypeScript, Node, the repo's custom parallel test runner (`npm test`), Biome, the
pinned ConsoleTools v3.1.1.4 oracle under `reference/oracle/`, `scripts/generate-synthetics/`.

## Global Constraints

- **The spec for this work is `docs/TEXTOOLS_BUGS.md` #19** (sections *Upstream fix, as landed*,
  *Reach re-measured*, *What Part B owes*) plus
  `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §10 row 1. Read #19 before
  Task 1. Do not re-derive the C#; it is quoted there and verified against the pin.
- **The upstream commit is readable directly:**
  `git -C reference/FFXIV_TexTools_UI/lib/xivModdingFramework show 1993bf6`. `reference/` is
  read-only — never edit, lint or format it.
- **Every behaviour change cites its C# source** as `file · symbol · lines`, verified against
  `reference/` rather than quoted from memory.
- **End-of-task ritual, every task:** `npm run check`, then `npm run typecheck`, then `npm test` —
  all green before the task is considered done.
- **Never re-bless a baseline to make a test pass.** Blessing happens once, deliberately, in Task 6.
  The `roundtrip` ratchet must not move at all; it is currently 0 and that is the goal state.
- **The oracle must be installed** (`reference/oracle/v3.1.1.4/`) for Tasks 4-6; `npx tsx
  scripts/setup-oracle.ts` if it is not. Tasks 1-3 need no oracle.
- **Commit per task.** Conventional-commit prefixes, matching the repo's existing history.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/tex/header.ts` | Modify | `buildCanonicalTexHeader` LoD2 line (hunk 2); ascending clamp in `fixUpBrokenMipOffsets` (hunk 3); **delete** `assertTexHeaderWritable` (hunk 1) |
| `src/upgrade/validate-tex.ts` | Modify | Drop the `assertTexHeaderWritable` import and its Branch-B call; keep the source-overrun guard |
| `src/upgrade/load-fixes.ts` | Modify | Comment only — rewrite the deferred-recompress rationale |
| `test/tex/tex-header.test.ts` | Modify | Replace the `assertTexHeaderWritable` describe with clamp cases; add `buildCanonicalTexHeader` LoD2 cases |
| `test/upgrade/validate-tex.test.ts` | Modify | Invert the two cases that pin the throw |
| `scripts/generate-synthetics/ttmp2-builder.ts` | Modify | New optional `ttmpVersion` parameter on `writeTtmp2Files` |
| `scripts/generate-synthetics/build-synthetic-load-seam-mipfix.ts` | Create | Branch-B synthetic pack |
| `scripts/generate-synthetics/build-synthetic-load-seam-npot.ts` | Create | Branch-A synthetic pack |
| `scripts/generate-synthetics/build-all.ts` | Modify | Register both new builders |
| `test/helpers/upgrade-compare.ts` | Modify | Comment only — `confirmBcResizedAsA8`'s "a synthetic is planned" note |
| `docs/TEXTOOLS_BUGS.md` + `docs/textools-bugs/19-*.md` | Modify | Status reconciliation |
| `docs/superpowers/specs/2026-08-05-*.md` | Modify | New baseline-totals row, §10 row 1 verdict closed out |
| `docs/BACKLOG.md`, `docs/backlog/2026-08-08-textools-repin-part-b.md`, `docs/backlog/2026-07-25-validate-tex-load-seam-synthetics.md` | Delete / modify | Both items ship in this change |

---

### Task 1: Delete the write-time guard and add the ascending clamp (hunks 1 + 3)

These two hunks are one task because they are jointly observable: with the guard still live, adding
the clamp turns a currently-throwing case into a passing one, so the existing throw-assertions break
either way. Landing them together means every intermediate state is green and honest.

**Files:**
- Modify: `src/tex/header.ts` (`fixUpBrokenMipOffsets` LoDMips loop at `:135-140`; delete
  `assertTexHeaderWritable` at `:154-170`)
- Modify: `src/upgrade/validate-tex.ts:7,49` (import and call site)
- Modify: `src/upgrade/load-fixes.ts` (the `.tex` bullet of `makeTtmpLoadFix`'s header comment)
- Test: `test/tex/tex-header.test.ts`, `test/upgrade/validate-tex.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `fixUpBrokenMipOffsets(header: MipOffsetFixable, texSizeIncludingHeader: number):
  { headerChanged: boolean; calculatedTexSize: number }` — signature unchanged, but `header.lodMips`
  is now always non-descending on return. `assertTexHeaderWritable` **no longer exists**; nothing may
  import it after this task.

- [ ] **Step 1: Read the spec sections**

Read `docs/textools-bugs/19-mipcount2-lodmips-ordering-guard.md` end to end, then confirm the C#
first-hand:

```powershell
git -C reference/FFXIV_TexTools_UI/lib/xivModdingFramework show 1993bf6
```

Expected: three hunks, `+9/−10`, all in `xivModdingFramework/Textures/FileTypes/Tex.cs`.

- [ ] **Step 2: Write the failing clamp tests**

In `test/tex/tex-header.test.ts`, **delete** the entire `describe("assertTexHeaderWritable", ...)`
block (`:107-117`) and the `assertTexHeaderWritable` name from the import at `:3`. Add these two
cases inside the existing `describe("fixUpBrokenMipOffsets", ...)`:

```ts
  it("raises a non-ascending LoDMips entry to its predecessor (Tex.cs:213-218, added by 1993bf6)", () => {
    // 4x4 A8R8G8B8 mip sizes are [64, 16, 4] -> offsets 80, 144, 160 and a 164-byte file, so all
    // three mips fit and the local mip count stays 3. That isolates the ascending clamp: the
    // `>= mipCount` clamp above it cannot fire for any of [0, 2, 1].
    const header = {
      format: A8R8G8B8,
      width: 4,
      height: 4,
      mipCount: 3,
      lodMips: [0, 2, 1] as [number, number, number],
      mipMapOffsets: [80, 144, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const res = fixUpBrokenMipOffsets(header, 164);
    expect(header.lodMips).toEqual([0, 2, 2]);
    expect(res.headerChanged).toBe(true);
    expect(res.calculatedTexSize).toBe(164);
  });

  it("leaves an already-ascending LoDMips table alone", () => {
    // The negative of the case above: nothing else in the fixture is broken, so if the clamp
    // over-fires this reports headerChanged and the whole .tex gets needlessly rewritten.
    const header = {
      format: A8R8G8B8,
      width: 4,
      height: 4,
      mipCount: 3,
      lodMips: [0, 1, 2] as [number, number, number],
      mipMapOffsets: [80, 144, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const res = fixUpBrokenMipOffsets(header, 164);
    expect(header.lodMips).toEqual([0, 1, 2]);
    expect(res.headerChanged).toBe(false);
  });
```

- [ ] **Step 3: Invert the two `validate-tex` cases that pin the throw**

In `test/upgrade/validate-tex.test.ts`, replace the case at `:56-67` ("Branch B: a mipCount==2 tex
with a broken offset throws the ToBytes ordering guard") with:

```ts
  it("Branch B: a legacy non-ascending LoDMips tex is repaired and KEPT (TEXTOOLS_BUGS #19)", () => {
    // A 4x4 A8R8G8B8 tex has exactly 2 mips (generateMipmaps' 2x2 floor). LoD2 is forced back to 0
    // here so the fixture is a pre-1993bf6 header regardless of what buildCanonicalTexHeader
    // currently emits -- that is the shape TexTools wrote for years, and the shape whose ordering
    // ToBytes used to reject. At the v3.1.1.4 pin the guard is gone (Tex.cs:136-154) and
    // FixUpBrokenMipOffsets' ascending clamp (Tex.cs:213-218) normalizes it to [0,1,1], so the file
    // is repaired instead of dropped at the load seam.
    const src = encodeUncompressedTex(solidRgba(4, 4), 4, 4, { mips: true });
    const broken = src.slice();
    const dv = new DataView(broken.buffer, broken.byteOffset);
    dv.setUint32(24, 0, true); // legacy LoD2
    dv.setUint32(28, 999, true); // clobbered mip0 offset
    const out = validateTexFileData(broken);
    expect(out).not.toBeNull();
    const o = new DataView(out!.buffer, out!.byteOffset);
    expect(o.getUint32(28, true)).toBe(80); // offset repaired
    expect([
      o.getUint32(16, true),
      o.getUint32(20, true),
      o.getUint32(24, true),
    ]).toEqual([0, 1, 1]); // LoDMips clamped ascending
  });
```

Then in the case at `:69-86` ("Branch B: a POT tex with a broken first offset is rewritten, not
resized"), replace its comment block — it currently explains why 16x16 was chosen to *avoid* the
crash, which is no longer a thing that can happen — with:

```ts
    // 16x16 (mipCount=4, canonical LoDMips=[0,1,2]) exercises the plain offset-rewrite path with
    // nothing else in play: no NPOT resize, and no LoDMips clamping to attribute a byte to.
```

- [ ] **Step 4: Run both test files to verify they fail**

```powershell
npm test -- tex-header validate-tex
```

Expected: FAIL. `tex-header.test.ts` fails on `[0,2,2]` (we return `[0,2,1]` — no clamp yet);
`validate-tex.test.ts` fails because `validateTexFileData` throws "LoDMips is not in non-descending
order." instead of returning bytes.

- [ ] **Step 5: Add the ascending clamp**

In `src/tex/header.ts`, replace the LoDMips loop at `:135-140` with:

```ts
  // Tex.cs:203-219. TWO clamps in ONE loop, and the order is load-bearing: the `>= mipCount` clamp
  // can itself drop an entry below its predecessor, and the ascending clamp (added by 1993bf6, the
  // "fix non-ascending lodmips" half) then raises it back. `mipCount` here is the LOCAL struct-copy
  // value the C# reads as `header.MipCount` -- see this function's struct-copy note.
  let maxLodMip = 0;
  for (let lodLevel = 0; lodLevel < 3; ++lodLevel) {
    if (header.lodMips[lodLevel]! >= mipCount) {
      modified = true;
      header.lodMips[lodLevel] = mipCount - 1;
    }
    if (header.lodMips[lodLevel]! < maxLodMip) {
      modified = true;
      header.lodMips[lodLevel] = maxLodMip;
    }
    maxLodMip = header.lodMips[lodLevel]!;
  }
```

- [ ] **Step 6: Delete `assertTexHeaderWritable` and its call site**

In `src/tex/header.ts`, delete the whole `assertTexHeaderWritable` function and its doc comment
(`:154-170`). In `src/upgrade/validate-tex.ts`, drop it from the import at `:6-10` (leaving
`fixUpBrokenMipOffsets` and `serializeTexHeader`) and delete line `:49` entirely. Replace the comment
above the surviving overrun guard so the reader knows the guard that used to sit there is gone:

```ts
    // TexHeader.ToBytes carries NO validation at this pin -- 1993bf6 deleted all four of its checks
    // (Tex.cs:136-154), so it is a pure serializer and this rewrite cannot be refused. What remains
    // is the C#'s own Array.Copy overrun:
```

- [ ] **Step 7: Run the tests to verify they pass**

```powershell
npm test -- tex-header validate-tex
```

Expected: PASS, all cases in both files.

- [ ] **Step 8: Rewrite the deferred-recompress rationale**

In `src/upgrade/load-fixes.ts`, the `.tex` bullet of `makeTtmpLoadFix`'s header comment currently
reads "The `Tex.CompressTexFile` recompress step remains deferred (invisible to the golden: we always
store uncompressed .tex payloads pre-SqPack-compression, so there is no observable byte difference)".
That claim only became true with this task. Replace it with:

```
 *   The `Tex.CompressTexFile` recompress step (TTMP.cs · FixOldTexData · 1438) remains deferred. It
 *   is invisible to the golden -- we store uncompressed .tex payloads pre-SqPack-compression, so
 *   there is no observable byte difference -- but only at the v3.1.1.4 pin: before 1993bf6 that call
 *   re-validated the header through `TexHeader.ToBytes` (Tex.cs:1324), so it could DROP a file
 *   ValidateTexFileData had already passed. See docs/TEXTOOLS_BUGS.md #19's "Reach re-measured".
```

- [ ] **Step 9: Retire the `*pre-fix*` markers**

Two of the three go away with the code they annotated (the `assertTexHeaderWritable` doc comment,
deleted in Step 6; the `validate-tex.ts:49` call site, deleted in Step 6). Confirm none survive
outside `docs/`:

```powershell
Select-String -Path src,test,scripts -Pattern "pre-fix" -Recurse
```

Expected: hits only in `scripts/generate-synthetics/build-synthetic-f1.ts` (an unrelated use of the
words "pre-fix writer") — no hit citing `Tex.cs:138`.

- [ ] **Step 10: Full gate**

```powershell
npm run check; npm run typecheck; npm test
```

Expected: all green. A corpus pack whose diff *shrinks* here is expected and is recorded in Task 6 —
do **not** bless anything now; the ratchet passes as long as the actual diff is a subset of the
baseline, and a shrink is a subset.

- [ ] **Step 11: Commit**

```powershell
git add src/tex/header.ts src/upgrade/validate-tex.ts src/upgrade/load-fixes.ts test/tex/tex-header.test.ts test/upgrade/validate-tex.test.ts
git commit -m @'
feat(tex): port 1993bf6 hunks 1+3 - drop ToBytes validation, clamp LoDMips ascending

TexHeader.ToBytes lost all four of its checks upstream (Tex.cs:136-154), so
assertTexHeaderWritable and its Branch-B call site are deleted, and
FixUpBrokenMipOffsets gains the ascending-order clamp (Tex.cs:213-218). Together
these turn a .tex with a broken mip-offset table AND non-ascending LoDMips from a
file dropped at our load seam into one repaired and kept, matching v3.1.1.4.

See docs/TEXTOOLS_BUGS.md #19.
'@
```

---

### Task 2: `CreateTexFileHeader`'s LoD2 line (hunk 2)

**Files:**
- Modify: `src/tex/header.ts:79` (`buildCanonicalTexHeader`)
- Test: `test/tex/tex-header.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent hunk; ordered second only because Task 1 carries the
  class-1 fix).
- Produces: `buildCanonicalTexHeader(format, width, height, mipCount)` — unchanged signature; for
  `mipCount === 2` the emitted LoDMips become `[0, 1, 1]` instead of `[0, 1, 0]`.

- [ ] **Step 1: Write the failing test**

Add to `test/tex/tex-header.test.ts`, inside the `describe` that holds "builds a canonical header
matching CreateTexFileHeader":

```ts
  it("emits LoD2 = mipCount - 1 below three mips (Tex.cs:1126, as fixed by 1993bf6)", () => {
    // The pre-1993bf6 line was `newMipCount > 2 ? 2 : 0`, which for exactly two mips produced the
    // non-ascending [0,1,0] that ToBytes' own ordering guard then rejected (TEXTOOLS_BUGS #19).
    const lodMips = (h: Uint8Array) => {
      const dv = new DataView(h.buffer);
      return [dv.getUint32(16, true), dv.getUint32(20, true), dv.getUint32(24, true)];
    };
    expect(lodMips(buildCanonicalTexHeader(A8R8G8B8, 4, 4, 2))).toEqual([0, 1, 1]);
    expect(lodMips(buildCanonicalTexHeader(A8R8G8B8, 4, 4, 1))).toEqual([0, 0, 0]);
    expect(lodMips(buildCanonicalTexHeader(A8R8G8B8, 8, 8, 4))).toEqual([0, 1, 2]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
npm test -- tex-header
```

Expected: FAIL on the first assertion — `[0, 1, 0]` received, `[0, 1, 1]` expected. The other two
already hold, which is the point: this hunk moves exactly one mip count.

- [ ] **Step 3: Change the LoD2 line**

In `src/tex/header.ts`, replace line `:79`:

```ts
  b.i32(mipCount > 2 ? 2 : mipCount - 1); // LoD 2 mip (Tex.cs:1126, as fixed by 1993bf6)
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
npm test -- tex-header
```

Expected: PASS.

- [ ] **Step 5: Confirm no synthetic pack's bytes moved**

Every `buildCanonicalTexHeader` call under `scripts/generate-synthetics/` passes `mipCount = 1`, so
no fixture should change — and if one did, its cached golden (keyed on `sha256(input pack)`) would be
silently orphaned. Verify rather than assume:

```powershell
$before = Get-ChildItem test/corpus/synthetic -File | Get-FileHash
npm run synthetics
$after = Get-ChildItem test/corpus/synthetic -File | Get-FileHash
Compare-Object $before $after -Property Path,Hash
```

Expected: no output (no differences). If any pack moved, stop — a cached golden has been invalidated
and that must be understood before continuing.

- [ ] **Step 6: Full gate**

```powershell
npm run check; npm run typecheck; npm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```powershell
git add src/tex/header.ts test/tex/tex-header.test.ts
git commit -m @'
feat(tex): port 1993bf6 hunk 2 - CreateTexFileHeader LoD2 is mipCount-1 below three mips

Tex.cs:1126. A regenerated exactly-two-mip texture now carries LoDMips [0,1,1]
rather than the [0,1,0] that TexTools own writer produced and its own reader
rejected. Reaches output only for a regenerated texture whose smaller dimension
is exactly 4; no corpus pack or synthetic produces one.
'@
```

---

### Task 3: Teach the TTMP2 builder to emit an old `TTMPVersion`

The load-time `.tex` fix runs only for an old pack: `TTMP.cs · DoesModpackNeedFix · 918-932` returns
`NeedsTexFix | NeedsMdlFix` for major < 2, `NeedsTexFix` alone for exactly `"2.0"`, and `None`
otherwise. Every existing synthetic hardcodes `"2.1w"`, so neither Task 4 nor Task 5 can build its
pack without this.

**Files:**
- Modify: `scripts/generate-synthetics/ttmp2-builder.ts` (`writeTtmp2Files`, `:203-276`)

**Interfaces:**
- Produces: `writeTtmp2Files(fileName: string, packName: string, files: { gamePath: string; data:
  Uint8Array }[], root?: SyntheticRoot, ttmpVersion?: string): void` — the new fifth parameter
  defaults to `"2.1w"`, so every existing caller is byte-identical.

- [ ] **Step 1: Add the parameter**

In `scripts/generate-synthetics/ttmp2-builder.ts`, change `writeTtmp2Files`' signature:

```ts
export function writeTtmp2Files(
  fileName: string,
  packName: string,
  files: { gamePath: string; data: Uint8Array }[],
  root: SyntheticRoot = "synthetic",
  /** Gates TexTools' LOAD-time fixes: `TTMP.cs · DoesModpackNeedFix · 918-932` returns
   *  NeedsTexFix|NeedsMdlFix for major < 2, NeedsTexFix alone for exactly "2.0", and None for
   *  anything newer. Defaults to the modern "2.1w" every other fixture uses — do NOT change that
   *  default, their cached goldens are keyed on sha256(pack bytes). */
  ttmpVersion = "2.1w",
): void {
```

and the `mpl` literal's first key (`:233`) to `TTMPVersion: ttmpVersion,`. Leave the key in place —
JSON key order fixes the `.mpl` bytes the harness compares.

- [ ] **Step 2: Verify every existing pack is byte-identical**

```powershell
$before = Get-ChildItem test/corpus/synthetic,test/corpus/upgrade-error -File | Get-FileHash
npm run synthetics
$after = Get-ChildItem test/corpus/synthetic,test/corpus/upgrade-error -File | Get-FileHash
Compare-Object $before $after -Property Path,Hash
```

Expected: no output. A default-parameter addition that moves a byte means the key landed in the wrong
position.

- [ ] **Step 3: Full gate**

```powershell
npm run check; npm run typecheck; npm test
```

Expected: all green, with no cache misses (no ConsoleTools spawns) since no pack changed.

- [ ] **Step 4: Commit**

```powershell
git add scripts/generate-synthetics/ttmp2-builder.ts
git commit -m "test(synthetics): let writeTtmp2Files emit an old TTMPVersion"
```

---

### Task 4: Branch-B synthetic — the repaired-not-dropped pack

The golden that would have caught Task 1's divergence. **Read this first:** `AnyChanges` cannot see a
load fix — `ModpackUpgrader.cs · UpgradeModpack · 70-86` snapshots its per-option baseline *after*
`WizardData.FromModpack` has already run the load fixes, and `:244` writes an output pack only when
`AnyChanges`. A pack whose sole change is the mip repair is therefore a `/upgrade` **no-op**:
ConsoleTools emits nothing, the harness caches a `.noop` marker and compares us against the pack's own
input, and our repaired texture reads as a permanent mismatch. The pack must carry a genuinely
upgrading file alongside the fixtures, which is what the `.mtrl` below is for.

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-load-seam-mipfix.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writeTtmp2Files(..., ttmpVersion)` from Task 3; `buildEwColorsetMaskMtrl(normalTexPath:
  string, maskTexPath: string): Uint8Array` from `./synthetic-mtrl`;
  `buildCanonicalTexHeader(format, width, height, mipCount)` from `../../src/tex/header`.
- Produces: `test/corpus/synthetic/load-seam-mipfix.ttmp2` (gitignored).

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-load-seam-mipfix.ts`:

```ts
// Builds test/corpus/synthetic/load-seam-mipfix.ttmp2 — the /upgrade golden for Branch B of
// EndwalkerUpgrade.ValidateTexFileData (EndwalkerUpgrade.cs:2116-2124), the mip-offset repair
// TTMP.FixOldTexData runs at load on every .tex of an old pack. Deferred from
// docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md §6.2 and built here because
// upstream 1993bf6 changed what this branch DOES: the pre-fix ToBytes ordering guard dropped a
// non-ascending-LoDMips header, and at v3.1.1.4 the header is repaired and kept instead
// (docs/TEXTOOLS_BUGS.md #19).
//
// TTMPVersion "2.0" is load-bearing: DoesModpackNeedFix (TTMP.cs:918-932) returns NeedsTexFix alone
// for exactly that string, so the tex load fix runs and the mdl one does not.
//
// The .mtrl + normal + mask triple is NOT decoration. ModpackUpgrader snapshots its AnyChanges
// baseline AFTER the load fixes have run (ModpackUpgrader.cs:70-86) and writes an output pack only
// when AnyChanges (:244), so a pack whose only change is the mip repair produces NO golden at all —
// ConsoleTools no-ops and the harness compares us against our own input. The colorset material gives
// the transform something real to do. Both textures it binds are power-of-two A8R8G8B8, the shape
// npot-mask-a8 proves is byte-exact, so nothing about the material round is under test here.
//
// The two broken fixtures sit at _d (diffuse) paths bound by no sampler, so no upgrade round claims
// them: the material round only follows the mtrl's own samplers, and the third round's unclaimed
// scan is gated on hair/eye paths (ModpackUpgrader.cs:154-189). Their whole job is to reach the load
// seam and come back repaired.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { buildEwColorsetMaskMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

// e9998, distinct from npot-mask's e9999: no real base-game material lives there, so
// resolveStolenIndexPath misses its table (gate A, EndwalkerUpgrade.cs:923-936) and no index-path
// steal muddies the comparison.
const MTRL = "chara/equipment/e9998/material/v0001/mt_c9998e9998_top_a.mtrl";
const NORMAL = "chara/equipment/e9998/texture/c9998e9998_top_a_n.tex";
const MASK = "chara/equipment/e9998/texture/c9998e9998_top_a_m.tex";
const BROKEN_TWO_MIP = "chara/equipment/e9998/texture/c9998e9998_top_b_d.tex";
const BROKEN_NON_ASCENDING = "chara/equipment/e9998/texture/c9998e9998_top_c_d.tex";

/** Deterministic non-uniform bytes — a flat fill would hide a mis-sized copy. */
function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

/** States the fixture's LoDMips outright instead of inheriting whatever buildCanonicalTexHeader
 *  currently emits — these packs exist to pin a change to that very constructor. */
function withHeaderFields(
  header: Uint8Array,
  lodMips: [number, number, number],
  mip0Offset?: number,
): Uint8Array {
  const out = header.slice();
  const dv = new DataView(out.buffer);
  dv.setUint32(16, lodMips[0], true);
  dv.setUint32(20, lodMips[1], true);
  dv.setUint32(24, lodMips[2], true);
  if (mip0Offset !== undefined) dv.setUint32(28, mip0Offset, true);
  return out;
}

const POT = 64;
const potTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, POT, POT, 1),
  pattern(POT * POT * 4),
]);

// 4x4, two mips (sizes 64 + 16), LoDMips [0,1,0] — the exact canonical header pre-1993bf6 TexTools
// wrote for every two-mip texture, and the one its own ToBytes then refused. mip0's offset is
// clobbered so FixUpBrokenMipOffsets has to rewrite the table and reach the (former) guard.
const twoMip = concatBytes([
  withHeaderFields(buildCanonicalTexHeader(A8R8G8B8, 4, 4, 2), [0, 1, 0], 999),
  pattern(64 + 16),
]);

// 16x16, four mips (1024 + 256 + 64 + 16 = 1360 bytes), LoDMips [0,2,1] — non-ascending without
// being the two-mip special case, so the ascending clamp is exercised independently of hunk 2's
// constructor change. The clamp raises LoD2 to 2, giving [0,2,2].
const nonAscending = concatBytes([
  withHeaderFields(buildCanonicalTexHeader(A8R8G8B8, 16, 16, 4), [0, 2, 1], 999),
  pattern(1024 + 256 + 64 + 16),
]);

writeTtmp2Files(
  "load-seam-mipfix.ttmp2",
  "Load Seam Mip Fix",
  [
    { gamePath: MTRL, data: buildEwColorsetMaskMtrl(NORMAL, MASK) },
    { gamePath: NORMAL, data: potTex },
    { gamePath: MASK, data: potTex },
    { gamePath: BROKEN_TWO_MIP, data: twoMip },
    { gamePath: BROKEN_NON_ASCENDING, data: nonAscending },
  ],
  "synthetic",
  "2.0",
);
```

- [ ] **Step 2: Register it**

In `scripts/generate-synthetics/build-all.ts`, add after the `build-synthetic-npot-guards` line:

```ts
import "./build-synthetic-load-seam-mipfix";
```

- [ ] **Step 3: Build the pack**

```powershell
npx tsx scripts/generate-synthetics/build-synthetic-load-seam-mipfix.ts
```

Expected: `wrote …\test\corpus\synthetic\load-seam-mipfix.ttmp2`.

- [ ] **Step 4: Run the suite and read the result carefully**

```powershell
npm test
```

This spawns ConsoleTools once for the new pack. Three outcomes, and they mean different things:

- **Full match, no baseline entry** — the intended result. The oracle repaired both fixtures and we
  match byte-for-byte.
- **A `.noop` golden** (the harness reports the pack compared against its own input) — the `.mtrl`
  failed to make the transform do anything. Do not paper over it: check that the material round
  actually fired, and fix the fixture rather than accepting the comparison.
- **Any diff** — stop and investigate before Task 5. A new pack is expected to match fully; a
  divergence here is either a real bug in Task 1 or a fixture that reaches a path this pack was not
  meant to exercise (the third round claiming a `_d` texture, say). Do **not** bless it.

- [ ] **Step 5: Full gate**

```powershell
npm run check; npm run typecheck; npm test
```

Expected: all green, new pack fully matched, no new baseline file.

- [ ] **Step 6: Commit**

```powershell
git add scripts/generate-synthetics/build-synthetic-load-seam-mipfix.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(corpus): synthetic /upgrade golden for the ValidateTexFileData Branch-B repair"
```

---

### Task 5: Branch-A synthetic — the NPOT load-seam resize

The second pack the 2026-07-25 item calls for. Same `AnyChanges` constraint as Task 4, same device.

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-load-seam-npot.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: the same three helpers Task 4 consumes.
- Produces: `test/corpus/synthetic/load-seam-npot.ttmp2` (gitignored).

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-load-seam-npot.ts`:

```ts
// Builds test/corpus/synthetic/load-seam-npot.ttmp2 — the /upgrade golden for Branch A of
// EndwalkerUpgrade.ValidateTexFileData (EndwalkerUpgrade.cs:2107-2113), the load-time NPOT resize.
// Deferred from docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md §6.1, whose
// coverage until now was a hand-computed unit test plus one real pack (KK_Sportcar) that reaches the
// branch only on a BC source, where our output is a confirmed divergence rather than a match.
//
// The fixture is 96x192 A8R8G8B8 with two mips. Three things follow, and each is load-bearing:
//   - NPOT with MipCount > 1 is the branch gate (:2107). One mip would fall through to Branch B.
//   - RoundToPowerOfTwo(96) = 64: floor 64 and ceil 128 are equidistant and ties go to the FLOOR
//     (IOUtil.cs:905-930). TexTools then passes WIDTH for BOTH dimensions (:2110), so a 96x192
//     source becomes 64x64 rather than 64x128 — that is registered bug #20, and this pack is its
//     first real-oracle proof.
//   - 64 is exactly the floor of MergePixelData's own size guard (`< 64`, Tex.cs:655-659), so the
//     resize proceeds instead of dropping the file. Choosing a narrower source would test the guard,
//     not the resize; npot-guards.ttmp2 already covers that.
// A8R8G8B8 maps to CompressionFormat.BGRA (Tex.cs:718-747), so the MergePixelData round-trip we
// elide is lossless and the result should be byte-exact — the same reasoning that makes
// npot-mask-a8 a hard check rather than a tolerance.
//
// TTMPVersion "2.0" gates the load fix on; the .mtrl + power-of-two normal/mask triple forces
// AnyChanges so ConsoleTools actually writes a pack. See build-synthetic-load-seam-mipfix.ts's
// header for why both are necessary.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { buildEwColorsetMaskMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const MTRL = "chara/equipment/e9997/material/v0001/mt_c9997e9997_top_a.mtrl";
const NORMAL = "chara/equipment/e9997/texture/c9997e9997_top_a_n.tex";
const MASK = "chara/equipment/e9997/texture/c9997e9997_top_a_m.tex";
const NPOT = "chara/equipment/e9997/texture/c9997e9997_top_b_d.tex";

function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

const POT = 64;
const potTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, POT, POT, 1),
  pattern(POT * POT * 4),
]);

// 96x192, two mips: mip0 = 96*192*4 = 73728, mip1 = 48*96*4 = 18432.
const NPOT_W = 96;
const NPOT_H = 192;
const npotTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, NPOT_W, NPOT_H, 2),
  pattern(NPOT_W * NPOT_H * 4 + (NPOT_W / 2) * (NPOT_H / 2) * 4),
]);

writeTtmp2Files(
  "load-seam-npot.ttmp2",
  "Load Seam NPOT Resize",
  [
    { gamePath: MTRL, data: buildEwColorsetMaskMtrl(NORMAL, MASK) },
    { gamePath: NORMAL, data: potTex },
    { gamePath: MASK, data: potTex },
    { gamePath: NPOT, data: npotTex },
  ],
  "synthetic",
  "2.0",
);
```

- [ ] **Step 2: Register it**

In `scripts/generate-synthetics/build-all.ts`, add after the Task 4 import:

```ts
import "./build-synthetic-load-seam-npot";
```

- [ ] **Step 3: Build and run**

```powershell
npx tsx scripts/generate-synthetics/build-synthetic-load-seam-npot.ts
npm test
```

Expected: full match, no baseline entry. Apply the same three-outcome reading as Task 4 Step 4. One
extra check specific to this pack: confirm the golden's `_d` texture really is **64x64** — read bytes
8-11 of the decompressed output. If it is 64x128, our port has stopped reproducing bug #20 and the
divergence is ours, not the fixture's.

- [ ] **Step 4: Full gate**

```powershell
npm run check; npm run typecheck; npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```powershell
git add scripts/generate-synthetics/build-synthetic-load-seam-npot.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(corpus): synthetic /upgrade golden for the ValidateTexFileData Branch-A resize"
```

---

### Task 6: Measure, re-bless, and close the record

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` (§10 row 1 verdict;
  the baseline-totals table at the end of §10.1)
- Modify: `docs/TEXTOOLS_BUGS.md` (#19 index summary), `docs/textools-bugs/19-mipcount2-lodmips-ordering-guard.md`
- Modify: `test/helpers/upgrade-compare.ts` (`confirmBcResizedAsA8`'s comment)
- Delete: `docs/backlog/2026-08-08-textools-repin-part-b.md`,
  `docs/backlog/2026-07-25-validate-tex-load-seam-synthetics.md`, and both index entries in
  `docs/BACKLOG.md`
- Delete: this plan file

- [ ] **Step 1: Record the pre-bless total**

```powershell
npm run baseline:report
```

Write down the four numbers. Part A's opening total was **166 packs / upgrade 3352 / resave 2457 /
roundtrip 0 / total 5809** (spec §10.1's table). Two packs were added in Tasks 4-5, so the pack count
should now be 168.

- [ ] **Step 2: Snapshot the roundtrip ratchet before blessing**

`UPDATE_UPGRADE_BASELINE=1` re-blesses all three baselines, so a `roundtrip` regression would be
absorbed by the very step meant to record oracle drift — and the baselines are gitignored, so `git`
cannot show it.

```powershell
Copy-Item -Recurse test/corpus/.roundtrip-baseline "$env:CLAUDE_JOB_DIR/tmp/roundtrip-before"
```

- [ ] **Step 3: Bless**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

- [ ] **Step 4: Verify the roundtrip ratchet did not move**

```powershell
Compare-Object (Get-ChildItem -Recurse "$env:CLAUDE_JOB_DIR/tmp/roundtrip-before" -File | Get-FileHash).Hash (Get-ChildItem -Recurse test/corpus/.roundtrip-baseline -File | Get-FileHash).Hash
```

Expected: no output. **Any movement is investigated, never blessed away** — a `roundtrip` entry is our
codec contradicting itself with no oracle involved, a stronger indictment than a golden diff.

- [ ] **Step 5: Record and attribute the new total**

```powershell
npm run baseline:report
```

Append a row to the baseline-totals table at the end of §10.1 of
`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md`, labelled
`after 1993bf6 (row 1)`, and write one sentence naming what moved. Expected movement comes from the
**ascending clamp**, not the `CreateTexFileHeader` change — hunk 2 reaches output only for a
regenerated texture whose smaller dimension is exactly 4, which nothing in the corpus produces (see
register #19's *Reach re-measured*). **A zero-movement result is a legitimate outcome and should be
recorded as such** — this commit's value is the class-1 fix, not a diff reduction. What is not
acceptable is an unattributed change: if a pack moved and you cannot say which hunk moved it, stop and
find out.

- [ ] **Step 6: Close out §10 row 1**

In the same spec, amend row 1's verdict cell: the implementation is no longer "owed to Part B" — state
that it landed, and on which commits. Leave the analysis prose intact; it is the record of why.

- [ ] **Step 7: Update register #19**

In `docs/textools-bugs/19-mipcount2-lodmips-ordering-guard.md`, change the **Status** line from
"reproduced · FIXED UPSTREAM … Our port has NOT yet been changed" to the form §9 of the re-pin spec
prescribes: *"Fixed upstream in `1993bf6` (v3.1.1.4); our port reproduces the fixed behaviour as of
`<commit>`."* Keep the entry and every section of it — it still documents why the old bytes looked as
they did. Rewrite the **Us:** paragraph, which describes a reproduction that no longer exists, and
name the two new synthetics as the goldens that now pin the fixed behaviour. Then update the #19
summary in `docs/TEXTOOLS_BUGS.md:160-164`, whose last sentence points at "What Part B owes" as
outstanding work.

- [ ] **Step 8: Update the divergence-rule comment**

`test/helpers/upgrade-compare.ts`'s `confirmBcResizedAsA8` comment says "a dedicated NPOT-with-mips
A8R8G8B8 synthetic golden is planned, design spec §6.2". It exists now — point at
`test/corpus/synthetic/load-seam-npot.ttmp2` instead.

- [ ] **Step 9: Retire both backlog items**

Per `docs/BACKLOG.md`'s own rule, grep before deleting — every guard, comment and spec that cited an
item has to be updated in the same change or it becomes a dangling pointer:

```powershell
Select-String -Path src,test,scripts,docs -Pattern "2026-08-08-textools-repin-part-b|2026-07-25-validate-tex-load-seam-synthetics" -Recurse
```

Resolve every hit, then delete both files and both index entries (the Prioritized list's item 1, and
the *Textures* bullet). Renumber the Prioritized list — it is a total ordering, so the item that was
2 becomes 1, and the pass log gains a dated line recording that Part B shipped.

- [ ] **Step 10: Final gate**

```powershell
npm run check; npm run typecheck; npm test
```

Expected: all green, skip count zero.

- [ ] **Step 11: Delete this plan and commit**

A completed plan never lands on `main` — it lives in this branch's history from when it was committed,
and the shipped code, tests and git history are the record.

```powershell
Remove-Item docs/superpowers/plans/2026-08-09-textools-repin-part-b.md
git add -A
git commit -m @'
docs: close out the v3.1.1.4 re-pin - 1993bf6 ported, both load-seam synthetics landed

Records the post-bless baseline total, closes spec §10 row 1, reconciles register
#19 to the fixed-upstream status §9 prescribes, and retires the Part B and
load-seam-synthetics backlog items.
'@
```
