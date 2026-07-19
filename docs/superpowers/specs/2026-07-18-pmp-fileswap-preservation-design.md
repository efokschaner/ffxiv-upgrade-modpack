# PMP FileSwap preservation — the first user-benefit divergence

Filed 2026-07-18 · Status: **partly implemented.** The throw is gone, swaps are preserved, and the
divergence is confirmed against the oracle on a real pack (§6.1). Outstanding: the synthetic that
makes the `common/N` shift observable, the semantic-comparison mode (§5.2), the manifest carve-out
(§5.1), and the in-game gate (§7).

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

**5.2 `common/N` numbering — needs a semantic-comparison mode.** TexTools' zero-hash class burns one
`idx` once it reaches **two members**, shifting `common/N` for every duplicate promoted after that
point. Duplicates promoted before it are unaffected, so each unpaired pair differs by exactly +1, and
the golden's index set carries exactly one gap (the burned `idx`'s own name is never emitted).

**Threshold correction.** An earlier draft of this spec said the burn required swaps *and* ≥1 absent
file, and proposed keeping the divergence unreachable by building the synthetic without absent files.
That was wrong: **≥2 valid swaps clear the threshold on their own.** Staying unreachable would
require a pack with fewer than two swaps — a degenerate shape. This is the ordinary case, not a
corner, so it must be handled rather than dodged.

**Not expressible by either confirmation site.** A member-name shift surfaces as `structure`
added/removed diffs; `confirmDivergence` is consulted only on content mismatches of *name-matched*
pairs (`upgrade-archive-diff.ts:223`), and `diffPayloadMembers` buckets by the full member name
(`:199-209`), so `common/1/x` and `common/2/x` never pair. It would fall through to the gitignored
ratchet baseline, which AGENTS.md explicitly does not count as documenting a divergence.

**The mechanism: a cause-gated semantic-comparison mode.** Penumbra's runtime model is the authority
on what must be preserved. `SubMod.AddContainerTo` (Penumbra `SubMod.cs:23-32`) reduces an option to:

```csharp
foreach (var (path, file) in container.Files)     redirections.TryAdd(path, file);
foreach (var (path, file) in container.FileSwaps) redirections.TryAdd(path, file);
manipulations.UnionWith(container.Manipulations);
```

The effective mod state is exactly `(redirections, manipulations)`. **Zip member layout is invisible
to Penumbra** — it is plumbing, not behaviour. Note also that `Files` and `FileSwaps` share one
keyspace and `TryAdd` is first-wins with `Files` iterated first, so a swap whose `gamePath` is also a
`Files` key is inert.

So for an affected pack we compare payload **through the redirect table** (`gamePath`) rather than by
member name. "For any choice of options" decomposes: if each option's `gamePath → content` map is
equal, any selection yields an equal effective mapping — linear and sufficient. This is a *re-keying*,
not a loosening: along the axis that decides whether the mod works it is the **stronger** comparison,
and member-name equality was only ever a proxy for it.

Still asserted in this mode, or we lose real coverage:
- identical *set* of `gamePath`s per option — a dropped or extra file is still a hard failure;
- byte-identical content per `gamePath` — unchanged strictness;
- identical group/option structure, names, priorities, manipulations;
- **non-`common/` member names still match exactly** — only renumbering *within* `common/N` is free,
  so a writer bug that dropped or misnamed an ordinary member is still caught.

**Gate on cause, not symptom.** The mode activates only when the *input* pack carries ≥1 FileSwap —
a property known before any comparison, and exactly the condition under which member-name parity
becomes unreproducible. Measured 2026-07-18: **0 of 18 corpus PMPs** carry swaps, so every pack we
test today keeps full byte-and-name exactness, unchanged.

The rejected alternative is a **symptom** gate ("if the only diffs are `common/N`-shaped, fall back to
semantic"), which would silently absorb genuine writer regressions in *any* pack. That is the version
that loses exactness on the majority, and it is the tempting one — hence recording it here.

The mode must announce itself in test output: "this pack was compared semantically" is never
invisible.

**Scope note.** This machinery would likely also subsume
`docs/backlog/2026-07-17-pmp-writer-orphan-member-retention.md`, another pure container-layout
divergence currently baselined across real packs and synthetics. Deliberately not folded in here.

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

### 6.1 Corpus coverage

**Real pack (added 2026-07-18): `torn bassment glow.pmp`.** Found by scanning the operator's entire
user directory — **1 of 826 PMPs** carries FileSwaps, so this is the only real coverage that exists.
6 swaps, all unshadowed by `Files` keys, all 6 sources verified present in the game index (so
ConsoleTools takes the placeholder branch, not the `offset <= 0` skip at `PMP.cs:1118-1122`). It
carries `.mtrl`/`.mdl`, so `/upgrade` genuinely transforms it rather than no-opping.

Its `/resave` diff is the empirical confirmation of §3: six
`default_mod.json#/FileSwaps/…#0:removed` entries — present in ours, absent from the golden.
`docs/TEXTOOLS_BUGS.md` #10 observed on a real mod, not inferred from the C#.

It does **not** reach §5.2: it has no duplicate content, so no `common/N` member exists for the
burned `idx` to shift.

It also arrived with two unrelated defects it is the first pack to expose — a default-only option
prefix (`docs/backlog/2026-07-18-default-only-pmp-option-prefix.md`) and a `.mdl` unused-LoD offset
bug (`docs/backlog/2026-07-18-mdl-self-roundtrip-byte21.md`). **Its blessed baseline is therefore
weak**: the prefix bug renames every member, so no payload content is compared at all. Do not read
that baseline as evidence of byte-parity, and re-bless once the prefix item lands.

**Synthetic still required: `test/corpus/synthetic/file-swaps.pmp`**, via `pmp-builder.ts` (which
hardcodes `FileSwaps: {}` at `:88` and needs extending first). Requirements:

- **≥2 FileSwaps whose sources are real base-game paths**, so ConsoleTools' index lookup succeeds and
  the zero-hash class reaches the 2-member threshold. A pack whose sources do not resolve proves
  nothing — TexTools skips them (`offset <= 0`, `PMP.cs:1118-1122`) and the goldens agree trivially.
- **At least one genuine duplicate pair** (two distinct gamePaths and zip members carrying identical
  bytes), so a `common/N` member exists for the burned `idx` to shift.
- **Two groups, not one** — the swaps in one option, the duplicate pair in another.
  `UnpackPmpOption` appends an option's placeholders *after* that same option's Files
  (`PMP.cs:1104-1137`), and `ResolveDuplicates` walks option-by-option
  (`PmpExtensions.cs:594-611`). So in a one-option pack every real file is visited before any
  placeholder, the zero-hash collision happens last, and the burned `idx` lands after every duplicate
  has already been numbered — shifting nothing and proving nothing. **This is precisely why
  `torn bassment glow.pmp` shows no effect** despite carrying 6 valid swaps. Splitting across two
  groups puts the collision first:

      TexTools:  [swaps option: placeholder(src1), placeholder(src2)] -> collide, burn idx 1
                 [dupes option: dupA, dupB]                          -> duplicate -> common/2
      Ours:      [swaps option: nothing — swaps are never placeholders]
                 [dupes option: dupA, dupB]                          -> duplicate -> common/1

  The golden's common index set therefore has a **gap at 1** (the burned `idx`'s own name is never
  emitted — every zero-hash entry is dropped from the returned map) while ours is gapless. That gap
  is the signature §5.2's mode keys on.
- **`/resave` is the oracle for this pack, not `/upgrade`.** Its gamePaths are ones `/upgrade`
  ignores, so ConsoleTools no-ops and the upgrade golden degenerates to the input pack — no
  TexTools-written archive, hence no TexTools `common/N` numbering to compare against. `/resave` is
  load-then-write and therefore always emits a real archive. An `/upgrade`-transforming synthetic
  would need real game-file bytes, which would break these packs' "reproducible from a committed
  builder with no third-party mod" property.

Optional third pack: a swap whose `gamePath` collides with a `Files` key, exercising the `TryAdd`
precedence in §5.2. Worth noting TexTools dedupes placeholders by the swap **source**
(`PMP.cs:1126`, `ret.ContainsKey(src)`) while Penumbra keys redirections by the **destination** —
different keyspaces, so a pack can collide in one and not the other. Build it last, if at all.

Deliberately **not** built: a swap whose source does not exist in-game. TexTools discards all swaps
on write regardless, so the golden is identical either way; we preserve verbatim.

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
