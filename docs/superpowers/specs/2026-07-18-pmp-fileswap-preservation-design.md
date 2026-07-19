# PMP FileSwap preservation — the first user-benefit divergence

Filed 2026-07-18 · Status: **implemented**, except the in-game gate (§7), which is manual and
outstanding. The synthetic (§6.1), the semantic-comparison mode (§5.2) and the manifest carve-out
(§5.1) have landed.

This closed out the "PMP write path" backlog's FileSwap-preservation item (filed 2026-07-13,
deleted once this landed — its remaining work is what this spec covers). This is also the first
application of AGENTS.md's first principle ("a working upgrader is the goal; byte-parity is how we
get there"), amended in the commit immediately preceding this spec.

## 1. The problem (as filed)

*This section is framed in the present tense of the problem as originally filed, before any of this
spec's work landed — see the status line at the top for what has since shipped. `resolveDuplicates`
no longer throws (§6), and the "commonly" claim below turned out to be wrong: §6.1's later scan of
826 real PMPs found the true rate is 1 in 826, not common at all. Kept here as the historical
record of why this was picked up, not as a claim still true of the code.*

`resolveDuplicates` (`src/container/resolve-duplicates.ts:116-128`) throws when any option carries a
non-empty `fileSwaps` map. Real Penumbra `.pmp` mods were assumed to carry file swaps often enough to
matter, so this reads as a hard crash on a common real input — the highest-priority backlog item. No
corpus pack trips it (all 13 real PMPs then in the corpus have `fileSwaps=0`), so it is latent rather
than observed.

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
2. **Corpus-confirmed** — §5. Every byte this moves — a *populated* `FileSwaps` map — is confirmed by
   a rule, not baselined; no ratchet baseline suppresses that shape. (Precisely: no baseline holds a
   `/FileSwaps` divergence *of this feature's* shape, golden-empty-vs-ours-populated. One baseline
   entry does mention `/FileSwaps` today — `Flower Child - by Solona.pmp`, a swap-FREE pack — but it
   is the unrelated empty-vs-omitted-key asymmetry documented in
   `docs/backlog/2026-07-18-empty-vs-omitted-fileswaps-key.md`, which the carve-out correctly does
   not confirm since it never reaches the "ours populated" branch.)
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
`test/helpers/upgrade-archive-diff.ts` (`dropConfirmedAbsentKeys`), alongside the existing
absent-payload `Files`-key confirmation, which is the established shape to follow.

The confirmation and value fidelity are deliberately split across two different mechanisms, because
the golden carries no signal on the latter at all — TexTools always writes `FileSwaps: {}`
(`PMP.cs:873-875`), so there is no golden *value* to compare ours against:

- **The golden-harness carve-out confirms PRESENCE, not VALUE.** It fires only when the golden's
  option `FileSwaps` is empty and ours is non-empty; either wrong shape (both empty — we lost the
  swaps — or both non-empty but differing — we mangled them) is still reported as a mismatch. What it
  does **not** do is check ours' value against anything from the input pack — once the shape matches,
  it adopts ours' value unread. Read narrowly, a mangled or even wholly invented swap value would
  still be blessed by this rule alone.
- **Value fidelity — that the emitted `FileSwaps` are the verbatim key/value pairs the source pack
  carried — is pinned separately**, by a synthetic writer round-trip unit test:
  `test/container/pmp-write.test.ts`'s `"carries a non-empty FileSwaps map through read -> write
  unchanged"` case reads a pack with known swap values (including the backslashed path form Penumbra
  writes) and asserts the written `FileSwaps` equal the input exactly, for both a `default_mod.json`
  option and a `group_NNN.json` option.

Together the two cover the property §5.1 originally claimed as one rule; neither alone does.

**5.2 `common/N` numbering — needs a semantic-comparison mode.** TexTools' zero-hash class burns one
`idx` once it reaches **two members**, shifting `common/N` for every duplicate promoted after that
point. Duplicates promoted before it are unaffected, so each unpaired pair differs by exactly +1, and
the golden's index set carries exactly one gap (the burned `idx`'s own name is never emitted).

**Threshold correction.** An earlier draft of this spec said the burn required swaps *and* ≥1 absent
file, and proposed keeping the divergence unreachable by building the synthetic without absent files.
That was wrong: **≥2 valid swaps clear the threshold on their own.** Staying unreachable would
require a pack with fewer than two swaps — a degenerate shape. This is the ordinary case, not a
corner, so it must be handled rather than dodged.

**A third confirmation site.** A member-name shift surfaces as `structure` added/removed diffs;
`confirmDivergence` is consulted only on content mismatches of *name-matched* pairs
(`upgrade-archive-diff.ts:223`), and `diffPayloadMembers` buckets by the full member name (`:199-209`),
so `common/1/x` and `common/2/x` never pair — neither of AGENTS.md's two existing confirmation sites
(payload content via `DIVERGENCE_RULES`; manifest JSON via a `upgrade-archive-diff.ts` carve-out, §5.1)
can express this shape on its own. It would otherwise fall through to the gitignored ratchet baseline,
which AGENTS.md explicitly does not count as documenting a divergence. `diffPayloadSemantic`, below, is
a **third** confirmation site added for exactly this shape — a re-keying of the payload comparison from
member name to the Penumbra redirect table, so a pure `common/N` renumbering is recognized as identical
behaviour rather than merely tolerated.

**The manifest half this section originally missed.** A `Files` map VALUE is a zip path too — pure
layout, exactly what §5.2 declares invisible to Penumbra — so a `common/N` renumbering reappears as an
ordinary `jsonPointerDiff` mismatch on `group_NNN.json`/`default_mod.json` even once the payload-member
diff above is silenced. `dropConfirmedAbsentKeys` therefore gained a second, narrower exemption
alongside its existing confirmed-absent-key drop (§5.1): a `Files` value present on both sides that
resolves (after backslash normalization) to `common/…` on both sides is treated as equal. Both this and
`diffPayloadSemantic` are gated on the same `layoutEquivalent` flag, computed once per pack from the
*input*'s FileSwaps — §5.2's cause gate, never the diff's shape.

That coupling is load-bearing, not incidental: `diffArchives` **throws** if `layoutEquivalent` is set
without `checkPayloadMembers` also being `true`. The manifest `Files`-value exemption is sound only
because `diffPayloadSemantic` (which `checkPayloadMembers` enables) independently proves the redirect
resolves to identical content on both sides — without it, the exemption would accept a `Files` value
that renames the redirect to entirely different bytes, with no content check anywhere in the comparison
to catch it.

**The mechanism: a cause-gated semantic-comparison mode.** Penumbra's runtime model is the authority
on what must be preserved. `SubMod.AddContainerTo`, in the separate **Penumbra** repository
(`C:\dev\efokschaner\Penumbra`, *not* vendored under this repo's `reference/`) at
`Penumbra/Mods/SubMods/SubMod.cs:23-32`, reduces an option to:

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
becomes unreproducible. Measured 2026-07-18, before either FileSwap-carrying pack below existed:
**0 of 18 corpus PMPs** carried swaps — the observation that motivated gating on cause rather than
symptom in the first place, since a gate that fires on nothing is cheap to get right. That measurement
is now stale: with `torn bassment glow.pmp` (§6.1) added to the real corpus and the synthetic
`file-swaps.pmp` (§6.1) built, exactly **two** packs take the relaxed path today, out of **20** corpus
PMPs in total (real + synthetic + the `upgrade-error` root's one pack) — matching the PR description's
"2 of 20 local PMPs." Every other corpus pack still keeps full byte-and-name exactness, unchanged —
the gate remains as narrow as intended, just no longer empty.

**The gate is deliberately broader than the precise condition, and that is an honest trade, not an
oversight.** `packHasFileSwaps` fires on **≥1** swap in any option. The actual `idx` burn this mode
exists to tolerate needs TexTools' shared zero-hash class (§4) to reach **≥2 members**, and — as
`resolve-duplicates.ts`'s own header records (point 2) — that class is fed by *two* origins, not one:
a genuinely absent `Files` entry (present in both ports, `docs/TEXTOOLS_BUGS.md` #8) AND a FileSwap
whose source *resolves* in the live game index (§4's `Get8xDataOffset` check — only a resolving swap
becomes a zero-hash placeholder at all; TexTools-only, since we never construct one). So the precise
sufficient condition is at least one resolving swap plus at least one other zero-hash-class member —
which could be a second resolving swap, but could equally be an ordinary absent file elsewhere in the
pack; a *lone* swap already suffices for the burn if the pack happens to carry an unrelated absent
file too. Even then, the shift is only *observable* in a PMP's member layout if some duplicate content
exists whose `common/N` numbering the burn would shift; with none, the burn is invisible regardless of
how it was reached (exactly `torn bassment glow.pmp`'s case, above). The gate cannot evaluate any of
this: index resolution needs the live game index, which §4 deliberately does not bundle; whether an
absent file exists elsewhere in the pack is knowable but not currently wired to this gate; and
observability depends on the dedup result, which does not exist until *after* the comparison this gate
controls has already decided how to run. So `packHasFileSwaps` over-approximates on purpose, on the
only property that is both cheap and always sufficient: "the input carries a swap at all" is a
necessary condition for every path to the divergence, so gating on it never relaxes a pack that
strict-mode exactness actually requires — it can only relax some swap-carrying packs that turn out not
to need it. The cost of over-approximating is bounded and one-sided — a pack that could not actually
produce the `common/N` divergence still takes the relaxed path, and only surrenders the two coverage
gaps `diffPayloadSemantic` carries relative to strict mode (documented in
`docs/backlog/2026-07-18-semantic-payload-part2-coverage.md`). In practice the ≥1-vs-≥2-swaps question
does not currently distinguish anything either way: both packs on the relaxed path today
(`torn bassment glow.pmp`, `file-swaps.pmp`) carry ≥2 swaps, so ≥1 and ≥2 pick the same two packs — the
gap would only show up on a single-swap pack, which the corpus does not have. Tightening the gate is a
candidate for whoever picks up the coverage-gap backlog item above, not something argued to be worth
doing here.

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
- **`test/helpers/upgrade-archive-diff.ts`** — the §5.1 carve-out; it will carry the §7 evidence once
  the in-game gate (still outstanding, see §7) has actually been performed.
- **`docs/BACKLOG.md`** — delete the "PMP write path" item this spec supersedes and its index entry
  (its file was `docs/backlog/2026-07-13-pmp-write-fileswaps.md`); grep for citations first
  (`docs/TEXTOOLS_BUGS.md` #10 referenced it). §5.2 landed in full, so no residual gap from it needs
  filing — but closing this out surfaced an unrelated, pre-existing one: `test/helpers/corpus-resave.ts`
  does not forward `confirmDivergence` to `diffArchives` the way `corpus-upgrade.ts` does, so
  `DIVERGENCE_RULES` never fire for `/resave`'s structural comparison. Filed separately as
  `docs/backlog/2026-07-18-resave-confirmdivergence-not-forwarded.md`.

### 6.1 Corpus coverage

**Real pack (added 2026-07-18): `torn bassment glow.pmp`.** Found by scanning the operator's entire
user directory — **1 of 826 PMPs** carries FileSwaps, so this is the only real coverage that exists.
6 swaps, all unshadowed by `Files` keys, all 6 sources verified present in the game index (so
ConsoleTools takes the placeholder branch, not the `offset <= 0` skip at `PMP.cs:1118-1122`).
**`/upgrade` genuinely no-ops on this pack** — this was originally assumed otherwise (it carries
`.mtrl`/`.mdl`, which "should" transform), but that was inference, not measurement: the cached golden
is a `test/corpus/.upgrade-cache/<key>.noop` marker (`<key>` = `sha256` of the pack's bytes), meaning
ConsoleTools wrote no output file at all, so the `/upgrade` check compares our output against the
pack's own INPUT, never anything TexTools produced. **`/resave` is therefore the oracle for this
pack** — it is load-then-write and always emits a real TexTools-written archive, unlike `/upgrade`'s
no-op. The pack is still valuable real coverage: it remains the only mod (of 826 scanned) found to
carry FileSwaps at all, and `/resave` puts its full load -> write round-trip, `.mtrl`/`.mdl` included,
under a genuine TexTools oracle even though `/upgrade` has nothing to transform.

Its `/resave` diff is the empirical confirmation of §3: six
`default_mod.json#/FileSwaps/…#0:removed` entries — present in ours, absent from the golden.
`docs/TEXTOOLS_BUGS.md` #10 observed on a real mod, not inferred from the C#.

It does **not** reach §5.2: it has no duplicate content, so no `common/N` member exists for the
burned `idx` to shift. It DOES take §5.2's `layoutEquivalent` (relaxed) comparison path, though — the
gate is on the input carrying any FileSwap, not on whether a `common/N` shift is actually reachable
(see the §5.2 gate-honesty paragraph below) — so both its `/upgrade` and `/resave` checks compare
payload through `diffPayloadSemantic` rather than `diffPayloadMembers`.

It also arrived with two unrelated defects it is the first pack to expose — a default-only option
prefix (`docs/backlog/2026-07-18-default-only-pmp-option-prefix.md`) and a `.mdl` unused-LoD offset
bug (`docs/backlog/2026-07-18-mdl-self-roundtrip-byte21.md`). **Its blessed baseline is weak on member
NAMES, not on content.** The prefix bug renames every member, so `diffPayloadSemantic` part 2 (the
name-only comparison outside `common/`, `test/helpers/upgrade-archive-diff.ts`) pairs nothing and
reports every non-`common/` member as added/removed — that half of the baseline is not evidence of
member-name parity. But payload CONTENT is a separate comparison unaffected by member names:
`diffPayloadSemantic` part 1 (`resolveRedirects`, walking each option's `Files` map) and
`diffUpgrade` (`test/helpers/upgrade-diff.ts`) both key by `gamePath`, not by zip member name, and
both run regardless of the prefix bug. Their evidence: the `/upgrade` baseline (compared against the
no-op input) has no `"kind": "payload"` entries at all — `diffUpgrade` found zero gamePath-content
differences, so content parity IS established there, even though every non-`common/` member is
reported `added`/`removed` by name. Do not read the STRUCTURE (member-name) half of either baseline as
evidence of anything beyond names, and re-bless once the prefix item lands.

**Synthetic still required: `test/corpus/synthetic/file-swaps.pmp`**, via `pmp-builder.ts` (which
hardcodes `FileSwaps: {}` at `:88` and needs extending first). Requirements:

- **≥2 FileSwaps whose sources are real base-game paths**, so ConsoleTools' index lookup succeeds and
  the zero-hash class reaches the 2-member threshold. A pack whose sources do not resolve proves
  nothing — TexTools skips them (`offset <= 0`, `PMP.cs:1118-1122`) and the goldens agree trivially.
- **At least one genuine duplicate pair** (two distinct gamePaths and zip members carrying identical
  bytes), so a `common/N` member exists for the burned `idx` to shift.
- **Two groups, not one** — the swaps in one option, the duplicate pair in another.
  `UnpackPmpOption` appends an option's placeholders *after* that same option's Files
  (`PMP.cs:1104-1137`), and `FileIdentifier.IdentifierListFromDictionaries` walks option-by-option
  building the flattened dictionary `ResolveDuplicates` then dedupes
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
- Whether the upgrade transform should ever *rewrite* a swap's paths. Verified not to arise:
  the rounds rewrite `option.files` keys (`repath-hair-mashups.ts`, `unclaimed-hair.ts`) but never
  touch `fileSwaps`, and TexTools cannot either, since its swaps are dataless placeholders. Both
  implementations pass swaps through untransformed.
- Broadening the user-benefit principle to other registered bugs. #8's zero-hash `idx` burn in
  particular stays faithfully reproduced: it is invisible to users and costs us nothing.
