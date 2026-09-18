# Real Penumbra v4 packs are absent from the corpus — two are in hand, deferred

Filed: 2026-08-09 · Status: **deferred by operator decision, 2026-08-09** — see *Decision and scope*

Every `.pmp` in the corpus was scanned 2026-08-09 while sourcing a subject pack for the bug #23 in-game
test ([`2026-08-08-bug23-in-game-verification.md`](2026-08-08-bug23-in-game-verification.md)). Of 38
packs, **37 are `FileVersion 3` with zero inline groups and no `DefaultData`**; the only v4 pack is the
708-byte synthetic `pmp-v4-extrafiles.pmp`. So the whole v4 read path — the `LoadPMP` pull-back
(`PMP.cs:217-225`, ported at `src/container/pmp.ts:275-280`), the ExtraFiles classification it feeds,
and our one deliberate divergence inside it (`docs/TEXTOOLS_BUGS.md` #23) — is exercised only by a pack
we authored to exercise it: the synthetic proves we reproduce the shape *we predicted*, and nothing
proves a real Penumbra export has that shape.

## `/upgrade` refuses v4; `/resave` does not — the block is only half a block

Established 2026-08-09, by code and by running the oracle:

| ConsoleTools command | v4 input | why |
| --- | --- | --- |
| `/upgrade` | **refused** | `ModpackUpgrader.cs:226-232` pre-checks the manifest version and throws for a `.pmp` *or* `.ttmp2` destination, before the loader is ever asked |
| `/resave` | **works** | `HandleResaveModpack` calls `WizardData.FromModpack(src)` (`Program.cs:204`) with the **default** `enforceCompatibility = false`, so `PMP.cs:176`'s v4 throw never fires |

The version gate lives in `ModpackUpgrader`, not in `LoadPMP` — `LoadPMP`'s own v4 throw is
compatibility-mode-only. Confirmed empirically: ConsoleTools produced real `/resave` goldens for
**both** v4 packs below, including the 34 MB one, and bug #23 exists at all *because* `/resave` ingests
v4 packs.

So "TexTools cannot rewrite a v4 pack" is true for `/upgrade` only. A v4 pack in the corpus would still
get:

- a real, byte-comparable **`/resave` golden** — genuine writer-parity coverage, available today;
- a **matched-failure `/upgrade` check** — both implementations refuse, which is itself a real
  assertion (it is what `pmp-v4-extrafiles.pmp`'s upgrade check already does).

## Decision and scope (operator, 2026-08-09)

**No new real v4 packs as `/upgrade` corpus inputs for now**, deferred while TexTools refuses to
rewrite them — there is no upgrade golden to compare against, only a refusal.

Two things the decision deliberately does **not** cover:

- The existing synthetic `pmp-v4-extrafiles.pmp` **stays** as a v4 upgrade input; its check is a
  matched failure and it is the end-to-end proof that our refusal gate reproduces TexTools' message.
- The **`/resave` half is not blocked.** Adding a real v4 pack for writer-parity coverage alone is
  possible today and was not ruled out.

## The `/upgrade` half needs no baseline machinery at all

Worth stating, because "let the baseline machinery absorb the upgrade error" is the natural assumption
and the harness is already stronger than that. `registerUpgradeCheck` (`test/helpers/corpus-upgrade.ts:505`)
branches on `golden.kind === "error"` into `assertMatchedUpgradeFailure`: **a matched failure is a
PASS**, and our upgrade *succeeding* where the oracle refused is a loud fail. Nothing is recorded in a
ratchet and nothing is suppressed — it is a real assertion that both implementations refuse identically.
The branch's own comment (`:506`) already anticipates this exact case: *"A v4 PMP input lands here every
time"*.

So a v4 pack in `test/corpus/real/` gets the full unit set — `assets`, `golden`, `upgrade`
(matched-failure assertion), `resave` (real golden diff, ratcheted) — with no harness change. Only
`test/corpus/upgrade-error/` scoping would forgo the writer checks (`test/helpers/corpus-units.ts:51-54`).

## What bringing Leisurewear in would actually record — measured 2026-08-09

Run through `corpus-resave.ts`'s own diff pipeline verbatim, without touching the corpus. **94 entries**,
and every one traces to a **single already-filed gap** plus its knock-on effects:

| # | entries | what |
| --- | --- | --- |
| 1 | **72** `mismatch` | 6 gamePaths × 12 occurrences — the 80-byte null-padding truncation ([`2026-07-13-pmp-load-time-tex-fixup.md`](2026-07-13-pmp-load-time-tex-fixup.md)) |
| 2 | **6** `mismatch` | the same 6 textures re-reported under their `common/N/` member names — the known payload-shadow phenomenon ([`2026-07-21-common-n-tex-hash-shadows.md`](2026-07-21-common-n-tex-hash-shadows.md)) |
| 3 | **6** `added` | `files/common/N/*.tex` — bug #23 duplicates the confirmation rule could **not** confirm, see below |
| 4 | **10** `added` | `meta.json#/Groups/*/…` — a **NEW BUG**, see below |

**The v4 confirmation rule fired and worked.** `makeV4ExtraFileDuplicateConfirmation` armed on this
input and silently confirmed **79 of the 85** golden-only duplicate members — its first exercise
against a pack big enough to test criteria (c)/(d) at all, which is exactly what it was tightened for.

**Row 3 is a cascade, not a second bug.** The 6 it could not confirm are the padded textures: criterion
(b) requires the input member's bytes to equal the golden member's bytes at that name, and TexTools
truncates the padding *at load*, so even its verbatim ExtraFiles copy is 80 bytes shorter than our
input member. Criterion (d) fails for the same reason. **These 6 should disappear on their own when the
truncation is ported** — a useful, falsifiable prediction to check at that time, and a concrete example
of two gaps interacting that no synthetic in the corpus reproduces.

**Row 4 is a genuine new find** — [`2026-08-09-imc-group-json-field-defaults.md`](2026-08-09-imc-group-json-field-defaults.md).
Our Imc-group writer passes `Identifier`/`AllVariants`/`OnlyAttributes` through verbatim, so a source
omitting a declared field omits it on write, where TexTools materializes the C# default. Zero of the
92 `.resave-baseline` and 78 `.upgrade-baseline` files contain such an entry, so **no existing pack
reaches it**. This is the case for bringing the pack in, in one line: the first real v4 pack measured
found a real bug on day one.

## Both packs are now in the corpus — 2026-08-10

The 2026-08-09 deferral above was **superseded the next day by the operator**, who asked for
Leisurewear to be brought in. That is consistent rather than contradictory: the deferral was about v4
packs as `/upgrade` *golden* inputs, and this pack contributes no upgrade golden — its `/upgrade` unit
is a matched-failure assertion, which records nothing.

Both were sourced from the official dev Discord and are **copied** (not moved) into
`test/corpus/real/`. `test/corpus/**` is gitignored, so **neither is durable in git and both will be
lost if that directory or the operator's Downloads folder is cleared** — they are not re-sourceable
without the dev Discord.

1. **`hs-Yet Another Leisurewear (+Rue!)-1.1.1-Zx8j.pmp`** — a Heliosphere-distributed Penumbra export.
   `FileVersion 4`, 7 inline groups, no `DefaultData`, 88 members, 34.1 MB, real equipment content
   (`e6195`/`e6196` tops + `mt_c0201a0106_wrs_a.mtrl`). Member names are `files/common/N/…` /
   `files/<option>/…`, i.e. **different** from the paths TexTools regenerates — the condition bug #23
   needs to bite.

   **Measured through the real harness, 2026-08-10.** All four units run. The `/upgrade` unit passes as
   a **matched failure** (`matched expected failure (oracle + our port both error)`) with no harness
   change and **no `/upgrade` baseline file**. Every asset-level check is clean on a real 34 MB v4 pack
   — `173/173` decoded; self round-trip types 2/3/4; **24 `.mtrl` exact** (0 unstable, 0
   semantic-break); **72 `.tex` byte-exact**; **77 `.mdl` byte-exact** (0 trailing-bytes). The `resave`
   unit records `101 matched, 94 diffs`, blessed into
   `.resave-baseline/f01df13c….json` as **78 `mismatch` + 16 `added`** — matching the standalone
   prediction below exactly, entry for entry.
2. **`Parent Settings.pmp`** — **IN THE CORPUS as of 2026-08-09** (`test/corpus/real/`); the paragraph
   below is superseded and kept for the reasoning. A Penumbra feature-test pack. `FileVersion 4`,
   8 groups (3 `Combining` with 8 containers each; the rest `Single`/`Multi`), **zero payload files**,
   no `DefaultData`. It loads (2 pages) and both writers refuse it loudly — `writePmp` on the
   Combining group, `writeTtmp2` with an `UnportedGapError`.

   *Superseded verdict:* "It is **not** a `real/` candidate as-is: `resave` would fail rather than
   ratchet." True of the harness as it then stood, and the reason was the harness, not the pack:
   `corpus-resave.ts` wrote *before* fetching the golden, so our refusal escaped the test instead of
   meeting the oracle's matching refusal. ConsoleTools `/resave` refuses this pack for the **same**
   reason we do (`WizardData.cs:897-900`), which makes it a **matched failure and therefore a PASS** —
   no baseline entry, nothing suppressed. That capability landed in
   [`docs/superpowers/specs/2026-08-09-resave-matched-failure-design.md`](../superpowers/specs/2026-08-09-resave-matched-failure-design.md),
   and the pack is now asserted rather than skipped, on all four units. It remains the **schema**
   specimen for
   [`2026-08-09-penumbra-schema-keys-dropped.md`](2026-08-09-penumbra-schema-keys-dropped.md) as well.

   Note what it does *not* buy: it carries no payload, so it exercises no writer parity and no bug #23
   confirmation. Its coverage value is the refusal seam plus the zero-payload archive shape.

The baseline's payload entries are the unported `FastValidateTexFile` truncation
([`2026-07-13-pmp-load-time-tex-fixup.md`](2026-07-13-pmp-load-time-tex-fixup.md)) — a pre-existing gap
this pack merely reaches, not a regression.

One thing only a real pack bought, and it worked: the bug #23 confirmation rule
(`makeV4ExtraFileDuplicateConfirmation`) had only ever run against a 2-payload pack. On Leisurewear it
armed and confirmed **79 of 85** golden-only members, rejecting the rest — the first real exercise of
criteria (c) and (d), which were added precisely because a 2-file pack cannot reach them.

## Status — what remains of this item

The coverage gap this item was filed for is **closed**: the v4 read path now has real-pack coverage on
all four unit families. What keeps it open is the deferral in *Decision and scope* — v4 as an
`/upgrade` golden input, which is gated on TexTools rewriting v4 at all and is really
[`2026-08-09-v4-pmp-input-refused.md`](2026-08-09-v4-pmp-input-refused.md)'s question — plus the
durability problem above, which is the more immediate risk. Consider closing this item and folding the
remainder into that one once the packs have a durable home.
