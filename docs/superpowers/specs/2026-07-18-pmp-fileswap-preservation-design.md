# PMP FileSwap preservation — the first user-benefit divergence

Status: designed, not implemented · Filed 2026-07-18

Closes `docs/backlog/2026-07-13-pmp-write-fileswaps.md`. This is also the first application of
AGENTS.md's first principle ("a working upgrader is the goal; byte-parity is how we get there"),
amended in the commit immediately preceding this spec.

## 1. The problem

`resolveDuplicates` (`src/container/resolve-duplicates.ts:116-128`) throws when any option carries a
non-empty `fileSwaps` map. Real Penumbra `.pmp` mods commonly carry file swaps, so this is a hard
crash on a common real input — the highest-priority backlog item. No corpus pack trips it (all 13
real PMPs have `fileSwaps=0`), so it is latent rather than observed.

The throw was correct when written. It exists because reproducing TexTools *exactly* appeared to
require game data we do not have. That framing is what this spec overturns.

## 2. What TexTools does

`UnpackPmpOption` (`PMP.cs · UnpackPmpOption · 1104-1137`) merges each option's `FileSwaps` into the
same dictionary as its custom `Files`. On the `/upgrade` load path `zipArchivePath` is `null`
(`WizardData.cs:818`), so `includeData` is `false` (`PMP.cs:1015`) and each swap takes the
`:1124-1132` branch: if the swap's **source** resolves in the live game index
(`tx.Get8xDataOffset(src, true) > 0`, `:1117`), it is added as `ret.Add(src, new
FileStorageInformation())` — keyed by the *source* path, carrying a default-valued struct whose
`RealPath` is `null`.

`WizardStandardOptionData` has no separate `FileSwaps` field (`WizardData.cs:69-80`), so that
placeholder flows on as an ordinary `Files` entry and reaches `ResolveDuplicates`
(`PmpExtensions.cs · ResolveDuplicates · 476-566`) indistinguishable from a real file. There it
fails `File.Exists(f.Info.RealPath)` (`:509`) and takes the zero-hash sentinel path (`:509-514`) —
`docs/TEXTOOLS_BUGS.md` #8.

On the way back out, `PopulatePmpStandardOption` (`PMP.cs · PopulatePmpStandardOption · 873-875`)
sets `opt.FileSwaps = new()` and never adds to it. **TexTools writes the swaps away entirely.**
That is `docs/TEXTOOLS_BUGS.md` #10, already adjudicated a genuine defect (silent data loss on
write) rather than a quirk.

## 3. The decision

A Penumbra file swap means "when the game requests path A, serve base-game file B". Discarding it
silently removes mod functionality: the user upgrades a working mod and gets back one that is
quietly missing part of what it did. Nothing warns them.

We therefore **preserve FileSwaps verbatim and do not model the placeholder mechanism at all.**

Evidence, against the three-part bar in AGENTS.md's first principle:

1. **Registered defect** — `docs/TEXTOOLS_BUGS.md` #10, adjudicated before this spec.
2. **Corpus-confirmed** — §5. Every byte this moves is confirmed by a rule, not baselined.
3. **In-game check** — §7. **Outstanding.** This spec is not implementable-to-completion until it
   is done; see the gate there.

`src/container/pmp.ts:437` (`base.FileSwaps = o.fileSwaps`) already does the right thing. It is
retained *deliberately*, not by omission — an earlier draft of this work proposed "fixing" it to
emit `{}` for parity, which would have ported the data loss into the one place a user notices.

## 4. Why no game index is needed

The backlog item concluded we could not proceed without `tx.Get8xDataOffset`. Under §3 that need
disappears, and it is worth recording why the index was ever implicated — so nobody re-derives the
dead end.

A placeholder's *only* observable effect on the emitted pack is whether it burns an `idx`:

- Every placeholder hashes to `ZERO_HASH`, and every zero-hash entry is dropped from
  `resolveDuplicates`' returned map (`:168-170`). None becomes a member.
- The promoted `common/{idx}/{basename}` name derived from a placeholder is read back only by
  zero-hash entries — all of which are dropped. **That name never reaches the output.**
- The zero-hash equivalence class therefore burns **exactly one** `idx`, and only if it has **≥2
  members**. A third member is free (`existing.startsWith("common/")`, `:158`).

So the index was only ever needed to decide a single `idx` increment, and only when the swaps flip
the zero-hash class across the 2-member threshold. Since we no longer chase that increment, we need
nothing from the game.

For the record, bundling it was measured, not assumed: a complete existence oracle is **1,899,383**
`(folderHash, fileHash)` pairs across all dats — 14.5 MB packed, 19.4 MB base64 in a TS module,
~30× the largest table in `src/` (`imc-table.ts`, 1.2 MB). A ~2.3 MB Bloom filter at 1% FPR was
also rejected: a false positive here *is* a silent `common/N` mis-numbering, the exact failure the
throw was protecting against. `scripts/lib/game-index.ts` already has the reader if a future,
narrowly-scoped need arises.

## 5. Divergences this creates

**5.1 Manifest — `FileSwaps` populated where the golden has `{}`.** Present whenever a pack has
swaps. This divergence *is* the feature. Confirmed by a scoped carve-out in
`test/helpers/upgrade-archive-diff.ts`, alongside the existing absent-payload `Files`-key
confirmation, which is the established shape to follow. The rule must confirm narrowly: ours' option
`FileSwaps` equals the **input pack's** for that option, and the golden's is empty. A `FileSwaps`
value that matches neither is still a mismatch.

**5.2 `common/N` numbering — deliberately kept unreachable.** Where a pack has swaps *and* ≥1 absent
file, TexTools' zero-hash class reaches 2 members and burns an `idx` we do not, shifting `common/N`
for every later duplicate.

This one is **not expressible by either confirmation site.** A member-name shift surfaces as
`structure` added/removed diffs, and `confirmDivergence` is consulted only on content mismatches of
name-matched pairs (`upgrade-archive-diff.ts:223`). It would fall through to the gitignored ratchet
baseline — which AGENTS.md now explicitly says does not count as documenting a divergence.

Rather than widen a mechanism to swallow it, we keep it unreachable: the synthetic pack in §6 has
swaps and **no absent files**, so the class never reaches 2 members. Recorded as a known gap in the
backlog. If a real pack ever combines the two, we design against a concrete case instead of a
hypothetical — and that is a fail-loud-worthy moment, not a silent baseline entry.

## 6. Changes

- **`src/container/resolve-duplicates.ts`** — delete the `fileSwaps` throw (`:116-128`). Rewrite the
  header: point 1 (`useCompressed` is always false) currently *derives* from that rejection —
  "a pack WITH FileSwaps could in principle push `compCount` above `uncompCount`. It never does here
  because we reject any option with a non-empty FileSwaps map before this point". With the rejection
  gone, the reasoning must instead be that we never construct placeholders, so every hashed entry is
  still a real `RawUncompressed` PMP file and `compCount` is still always 0. **This is the subtlest
  part of the change** — the conclusion survives but its justification does not, and leaving the old
  wording would leave a false claim guarding a live invariant.
- **`src/container/pmp.ts`** — unchanged; add a comment at `:437` recording that the round-trip is
  deliberate and citing this spec, so it is not "fixed" toward TexTools later.
- **`test/container/resolve-duplicates.test.ts`** — the test pinning the throw inverts: a
  swap-carrying option now resolves normally, and swaps contribute no entries and burn no `idx`.
- **`docs/TEXTOOLS_BUGS.md` #10** — update the "Us:" paragraph from "throws" to "we deliberately do
  not reproduce this," citing this spec.
- **`scripts/generate-synthetics/build-synthetic-file-swaps.ts`** (new) + registration in
  `build-all.ts` — see §6.1.
- **`test/helpers/upgrade-archive-diff.ts`** — the §5.1 carve-out, carrying the §7 evidence.
- **`docs/BACKLOG.md` + `docs/backlog/2026-07-13-pmp-write-fileswaps.md`** — delete the item and its
  index entry; grep for citations first (`resolve-duplicates.ts` cites it in the throw message and
  header, and `docs/TEXTOOLS_BUGS.md` #10 references it). File the §5.2 gap as a new item.

### 6.1 The synthetic pack

`test/corpus/synthetic/file-swaps.pmp`, via `pmp-builder.ts` like its siblings. Requirements:

- One option with a non-empty `FileSwaps` map whose source is a **real base-game path**, so
  ConsoleTools' own index lookup succeeds and the golden exercises the placeholder path rather than
  the `offset <= 0` skip (`PMP.cs:1118-1122`). A pack whose swap source does not resolve would prove
  nothing — TexTools would skip it and the goldens would agree trivially.
- At least one genuine duplicate pair, so `common/N` numbering is actually exercised and a future
  `idx` regression is visible.
- **No absent files**, per §5.2.
- `gamePath`s `/upgrade` ignores, so ConsoleTools no-ops and the harness compares against the input
  pack — the `absent-file.pmp` pattern.

The oracle runs against the operator's installed ConsoleTools, which *does* have the game index, so
the golden reflects TexTools' real decision. This is the point of the pack: it converts §2 from
reasoning into a measurement.

## 7. In-game verification gate — outstanding

AGENTS.md requirement 3 is manual and cannot be inferred. Before this ships, someone must:

1. Take a real mod carrying file swaps.
2. Upgrade it with ConsoleTools `/upgrade`, and with ours.
3. Install both in Penumbra and confirm ConsoleTools' output has lost the swapped-file behaviour
   while ours retains it.

Until that is recorded in the §5.1 carve-out, this is an unverified divergence and must not merge.
The reasoning in §3 is strong but it is reasoning; the principle exists precisely because
"obviously better" is where unverified improvements come from.

## 8. Out of scope

- Modelling the placeholder mechanism, `Get8xDataOffset`, or any bundled index table (§4).
- The `common/N` interaction (§5.2) — filed, kept unreachable.
- Whether the upgrade transform should ever *rewrite* a swap's paths. Verified not to arise:
  the rounds rewrite `option.files` keys (`repath-hair-mashups.ts`, `unclaimed-hair.ts`) but never
  touch `fileSwaps`, and TexTools cannot either, since its swaps are dataless placeholders. Both
  implementations pass swaps through untransformed.
- Broadening the user-benefit principle to other registered bugs. #8's zero-hash `idx` burn in
  particular stays faithfully reproduced: it is invisible to users and costs us nothing.
