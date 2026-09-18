# In-game verification of the bug #23 divergence (AGENTS.md evidence bar 3)

Filed: 2026-08-08 · Status: **open — artifacts built, waiting on the operator's Penumbra step** ·
**Requires the operator — no agent can discharge it.**

`docs/TEXTOOLS_BUGS.md` **#23** is the repo's one deliberate divergence *from* TexTools' behaviour
rather than a faithful reproduction of it. AGENTS.md sets three evidence bars for that, and the third
has not been met:

> Someone has **verified in the real game** that our output is better than TexTools' — the mod works
> where TexTools' output is broken or degraded. This step is manual and cannot be skipped or
> inferred; an untested "improvement" is just an unverified divergence.

Bars 1 and 2 **are** met — the behaviour traces to a registered defect (#23), and the divergence is
confirmed corpus-side by `makeV4ExtraFileDuplicateConfirmation`
(`test/helpers/pmp-v4-extrafile-divergence.ts`), wired into the `/resave` check and exercised by the
purpose-built `test/corpus/synthetic/pmp-v4-extrafiles.pmp`. **Bar 3 is the sole outstanding one**, so
today the divergence ships on the operator's 2026-08-06 ruling, not on satisfied evidence.

## What the divergence is

`PMP.cs · LoadPMP · 191-208` builds its "extra files" set from the on-disk `groups` list, but the v4
pull-back at `:217-225` never assigns that local — it assigns `pmp.Groups` instead. So the
referenced-file scan at `:234` sees nothing for a v4 pack's inline groups, misclassifies every such
payload member as "extra", and `WizardData.WritePmp`'s `saveExtraFiles` path writes each one **twice**.
Our reader feeds the scan from the groups it actually loaded, so it emits each member once.

The reproduction and the suggested upstream patch live in the register entry itself
(`docs/TEXTOOLS_BUGS.md` #23).

## The synthetic pack cannot discharge this bar — found 2026-08-09

The original plan named `test/corpus/synthetic/pmp-v4-extrafiles.pmp` as the subject. Both outputs
were produced for it (839 bytes ours, 948 bytes ConsoleTools'), and the bug reproduces exactly as #23
documents — but **two of the bar's three confirmations are unobservable on that pack**, so a pass
against it would mean nothing:

1. **"the in-game result is identical" — vacuous.** The payload is two 4-byte files at
   `chara/dummy/v4_group.bin` / `chara/dummy/v4_default.bin`, deliberately placed at a gamePath the
   transforms ignore (`scripts/generate-synthetics/build-synthetic-pmp-v4.ts:36-41`). The game never
   requests those paths, so neither pack changes anything rendered. "Identical" would hold of any two
   packs here, including two that differ arbitrarily.
2. **"ours is roughly half the size" — false on it.** 839 vs 948 bytes: the duplicated member is
   4 bytes and the manifest dominates. #23's "roughly twice" is about a *typical* pack where payload
   dominates; it does not transfer to a 708-byte repro.
3. Only **"both load in Penumbra"** is testable on it.

The bar needs a v4 pack whose payload is a **visibly-different real game asset**. Two traps in
choosing one, both worth re-reading if this pack is ever replaced:

- **Not a TexTools-exported `.pmp`.** TexTools writes `FileVersion = 4` too
  (`PMP._WriteFileVersion`, `PMP.cs:47`, forced at `WizardData.cs:1515`), but its member names already
  *are* the regenerated `<option folder>/<game path>` paths, so the duplicate lands on the same name
  and overwrites in place — the bug goes invisible. Same property #23 cites for "does not compound
  across repeated re-saves". A **Penumbra**-exported pack has its own layout and is the right subject.
- **Not a corpus pack.** All 38 `.pmp` packs in the local corpus were scanned 2026-08-09: every real
  one is `FileVersion 3`, zero inline groups, no `DefaultData`. The port's v4 read path has **no real-pack
  coverage of any kind**.

## Subject pack and artifacts (built 2026-08-09)

`hs-Yet Another Leisurewear (+Rue!)-1.1.1-Zx8j.pmp` — a Heliosphere-distributed Penumbra export the
operator sourced from the official dev Discord. It is the right shape on every count: `FileVersion 4`,
7 inline groups, no `DefaultData`, 88 members, 34.1 MB, and its payload members are named
`files/common/N/…` / `files/<option>/…` — i.e. **different** from the paths TexTools regenerates, so
the duplication bites rather than overwriting in place. Its content is a real equipment top
(`e6195`/`e6196`, plus `mt_c0201a0106_wrs_a.mtrl`), so an in-game difference would be *visible*.

Both outputs are in `test/corpus/.bug23-ingame/leisurewear/` (gitignored scratch — regenerate rather
than rely on it):

|  | members | on disk | uncompressed |
| --- | --- | --- | --- |
| input | 88 | 34,125,961 | 70,765,205 |
| `ours-resave.pmp` | 88 | 34,739,560 | 70,767,951 |
| `consoletools-resave.pmp` | **173** | **68,126,526** | 141,259,090 |

**1.96× on disk** — #23's "roughly twice" confirmed on a real pack. The 85 golden-only members are
every one of the pack's inline-group payload files, each byte-identical to the input member of the
same name, and **zero of them are referenced by the golden's own `meta.json`** — dead weight exactly
as #23 predicts.

Reproducing the pair is ~15 lines: read the pack, `writeModpack(loadModpack(name, bytes), "pmp")` for
ours, `resaveGoldenCached(name, bytes)` (`test/helpers/resave-golden.ts`) for TexTools', `readZip`
both to list members.

**Keep the input pack somewhere durable.** It is currently only in the operator's Downloads. Moving it
into `test/corpus/real/` would give the port its first real v4 coverage in the `/resave` harness —
worth doing on its own merits, and it needs a deliberate bless (see *A second divergence* below, which
would land in its baseline).

## A second divergence rides along — know it before comparing in-game

The two artifacts differ in **two** ways, not one. Besides the 85 duplicate members, 6 of the 13
redirected files differ in content:

```
chara/equipment/e619{5,6}/texture/v01_c0{2,1}01e619{5,6}_top_{mask,norm,id}.tex
   ours = golden + 80 bytes, common prefix byte-identical, our extra 80 bytes ALL ZERO
```

That is the unported null-padding truncation half of
[`2026-07-13-pmp-load-time-tex-fixup.md`](2026-07-13-pmp-load-time-tex-fixup.md)
(`FastValidateTexFile`, `EndwalkerUpgrade.cs:2149-2165`), not anything to do with #23 — our members
are byte-identical to the input (87 of 88; the 88th is the regenerated `meta.json`), TexTools strips
the padding at load. Everything else about the redirect table matches: same 13 `gamePath` keys on both
sides, byte-identical content behind the other 7.

Practically: both differences are expected to be inert in-game, but if the two packs *do* render
differently, **do not attribute it to #23 without ruling out the 80-byte tails first** — reproduce
with a pack whose textures carry no trailing padding, or wait until that item ships.

## What to do

1. Install **both** `test/corpus/.bug23-ingame/leisurewear/*.pmp` in Penumbra. (One unknown the
   operator resolves at this step: **both artifacts are v4** — ours writes `FileVersion: 4`
   (`src/container/pmp.ts:1176`) and so does TexTools — so a Penumbra that cannot read v4 cannot run
   this test at all, whatever the input was.)
2. Confirm: both load; the top renders identically on a character wearing it; ours is roughly half the
   size (1.96×, measured above).
3. Record the outcome in **both** places that currently say bar 3 is outstanding —
   `test/helpers/pmp-v4-extrafile-divergence.ts` and `docs/TEXTOOLS_BUGS.md` #23 — and clear the
   **OPEN** note in `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §9.

## If it fails

A negative result is the useful one, and it is not merely a documentation change: if TexTools'
duplicated output behaves differently in-game than our de-duplicated output, then the duplication is
load-bearing somehow and **the divergence has to be withdrawn** — our reader would go back to
reproducing the bug faithfully, with the confirmation rule and the synthetic pack re-pointed at the
reproduction instead. Plan for that outcome rather than treating this as a formality.

## What holding it open costs — measured 2026-08-09

Recorded because the item was filed on the argument that "every day it stays open, more work is built
on top of an unverified divergence", and that argument deserves a number.

- **The divergence cannot reach `/upgrade` output for a genuine v4 pack.** `upgradeModpack`
  (`src/upgrade/upgrade.ts:445-451`) throws *"Cannot convert v4+ Penumbra modpack to ttmp/pmp."* on any
  `FileVersion > 3` PMP source, faithfully mirroring `ModpackUpgrader.cs:218-241`. The product is an
  upgrader, not a resaver, so on the shipping path a v4 pack is refused by both implementations before
  the reader's classification can affect a written byte. `/resave` — a test-harness oracle — is the
  only path that reaches it, exactly as #23's *Reachability* section says.
- **One shape does reach `/upgrade`, and it fails closed.** The pull-back is gated on *content*, not
  version (`src/container/pmp.ts:275-276`, mirroring `PMP.cs:217`), so a pack carrying inline
  `meta.Groups`/`meta.DefaultData` but numbered `FileVersion <= 3` slips past the refusal and reaches
  the divergence. `makeV4ExtraFileDuplicateConfirmation` deliberately gates on `FileVersion > 3` and is
  therefore disarmed on that shape — which its own doc comment already records as failing closed: the
  difference is *reported* as an unconfirmed diff, never blessed. So the exposure is a red test, not a
  silently wrong pack. No corpus pack has that shape, and it is inconsistent enough that only a
  hand-edited manifest is likely to produce it — but per this backlog's *deploying changes the
  probability term* note, a hand-editable trigger is precisely the class that stops being rare once the
  site takes arbitrary uploads.
- **Withdrawal stays cheap, and is not getting more expensive.** If bar 3 comes back negative the
  rollback is three sites: `readPmp`'s `referencedKeys` source, the confirmation rule, and the
  synthetic's expectation. Nothing in `src/` consumes the divergence's effect except `writePmp`'s
  verbatim extras re-emit, so no dependent work is accumulating on top of it.

Net: the cost of holding was **principle, not compounding risk** — the concrete wrong-output exposure
is nil today and starts only when the site ships *and* meets the `FileVersion <= 3`-with-inline-groups
shape. That argument is now moot for scheduling purposes, the artifacts being built.
