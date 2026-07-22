# `CalculateTangents`' full recompute is unported, and the corpus now reaches it

**Filed:** 2026-07-21, surfaced by fixing the furniture `bgparts` `.mdl` overrun — the parse fix let
`gar_b0_m0112.mdl` through to the check that had been masked behind the earlier throw.

**Severity:** **rubric class 1 — silent wrong output**, but **latent**: no golden currently observes
it (see *Why no oracle covers it*). It is a silent path rather than a loud one *deliberately* — see
*Why this must not fail loud*, which is the non-obvious part of this item.

## The gap

`ModelModifiers.CalculateTangentsForMesh` (`reference/…/Models/Helpers/ModelModifiers.cs:2102-2138`)
picks one of two branches per mesh group:

- **Fast path** (`:2127-2137`), taken when any vertex in any part has `Binormal != Vector3.Zero`:
  `CalculateTangentsFromBinormalsForPart` (`:2272-2281`) writes only `v.Tangent` — which our port
  never serializes — then `CopyShapeTangentsForPart`. Byte-neutral apart from the shape copy, which
  IS ported, as `copyShapeBinormals` (`src/mdl/model/model-modifiers.ts`).
- **Full recompute** (`:2140-2253`), taken when no vertex has a binormal: welds the mesh, accumulates
  per-triangle tangents/bitangents, then writes `v.Binormal` **and** `v.Handedness` onto every welded
  base vertex. Both are serialized. **This branch is unported.**

`from-raw.ts` omits `CalculateTangents` entirely on the strength of R2 — the corpus scan asserting
every LoD0 mesh carries binormals, so only the fast path can ever be taken. R2 now has exactly one
counterexample:

```
SM-Cherry Blossom Upscale.ttmp2 :: bgcommon/hou/outdoor/general/0112/bgparts/gar_b0_m0112.mdl mesh 0
```

`normalizeModel` on that model **succeeds** (2708 bytes out) — it is not caught by any fail-loud
guard — so our output carries zero binormals/handedness where TexTools would carry computed ones.

## Why this must not fail loud

The usual response to an unported structure is to throw. **Here that would make things strictly
worse.** The only caller is `makeTtmpLoadFix` (`src/upgrade/load-fixes.ts`), whose `.mdl` branch is a
faithful port of `FixOldModel`'s `catch → continue` (`WizardData.cs:721-727`): **any** throw from
`normalizeModel` **drops the file**. TexTools keeps this model (its `CalculateTangents` succeeds), so
throwing would trade a latent, possibly-correct output for a guaranteed divergence — a model missing
from the pack. That is the same silent-model-drop failure the furniture-overrun item was filed for.

So the honest options are (a) port the recompute, or (b) leave it and track it here. Not (c) throw.

## Why no oracle covers it

`SM-Cherry Blossom Upscale.ttmp2`'s `/upgrade` golden is a **`.noop` marker** — ConsoleTools wrote no
file, and our pipeline also no-ops, so the pack is compared against its own input and the normalized
model bytes never reach a comparison. There is no baseline entry either. Porting the recompute would
therefore be validated only by synthetic unit tests derived from the C#, not by the golden oracle —
worth knowing before starting, since the branch is float-precision-sensitive (normalize, two cross
products, a dot-product handedness sign).

Cheapest way to buy an oracle first: a synthetic pack (`scripts/generate-synthetics/`) carrying a
binormal-less model in a pack that does **not** upgrade to a no-op, so ConsoleTools writes a real
golden to diff against.

## Residual blind spot in the detector

R2 (`test/mdl/model/binormals-present.test.ts`) checks the vertex **declaration** for a Binormal
element; the C# branches on decoded **values** (`x.Binormal != Vector3.Zero`). No element implies
all-zero values, so every mesh R2 flags is a true positive — but a mesh that *declares* binormals and
stores all zeros would take the unported branch unflagged. Widening R2 to decode values would close
this; it was left alone to keep the scan cheap.

## Test that would have caught it

R2 itself, once the parse fix let the model reach it. It now asserts the exception set rather than
unanimity, so a *new* binormal-less mesh fails the suite.
