# The `/upgrade` no-op branch has no writer oracle — stop pretending it does

**Date:** 2026-07-19
**Status:** Design approved (brainstorming); ready for implementation plan.
**Depends on:** `2026-07-04-upgrade-golden-harness-design.md` (the harness this amends),
`2026-07-12-pmp-writer-regeneration-design.md` (which introduced the comparison being removed),
`2026-07-08-modpack-serialization-parity-design.md`.

---

## 1. Problem

When ConsoleTools `/upgrade` no-ops it writes no file, so `registerUpgradeCheck` falls back to the
**untouched input pack** as its reference (`corpus-upgrade.ts`, the `golden.kind === "noop"` branch).
Two different comparisons then run against that reference, and only one of them is sound:

- **`diffUpgrade`** — content, keyed by `gamePath`. **Sound.** This is what the harness spec intended:
  "For the `noop` golden: run the same engine with the **original input pack** as `golden`; any
  non-matched entry means our pipeline changed a file the oracle left alone"
  (`2026-07-04-upgrade-golden-harness-design.md` §4.3).
- **`diffArchives`** with `checkPayloadMembers` — zip member **names** and **manifest JSON**.
  **Unsound.** The input is a third-party Penumbra export whose layout and manifest spelling TexTools'
  writer never produced. Comparing ours against it asserts *"our writer reproduces this author's
  arbitrary choices"*, which has no oracle behind it.

The second was never designed for this branch. It arrived with the PMP writer-regeneration work,
where the reference is a real TexTools golden, and was applied to the no-op branch by extension.

The codebase already records the problem: `corpus-resave.ts:22-24` and `resave-golden.ts:143-145`
both note that the `/upgrade` no-op branch "compares our writer to the INPUT archive … i.e. it takes
our own writer as ground truth."

### 1.1 What it has cost

It passes only for inputs that happened to be TexTools-authored already, and every input that is not
produces false divergences that must be individually suppressed or confirmed:

| Symptom | Where it landed |
|---|---|
| `default/` option-folder prefix on a default-only PMP | A `stripOursPrefix` confirmation in `upgrade-archive-diff.ts` (2026-07-19) |
| `default_mod.json` `#/Name`, `#/Description`, `#/Version`, `meta.json#/Image` | Four baselined entries on **every** no-op synthetic |
| `SetId: "246"` (string) vs `246` (number) | 18 baselined entries across 4 packs — `docs/backlog/2026-07-19-noop-reference-manifest-spelling.md` |

None of these are divergences from TexTools. Each was verified or is presumed to be Penumbra's
spelling versus TexTools' normalization — our output is correct in every confirmed case. The
machinery exists solely to absorb a reference that should not have been used.

## 2. What TexTools actually does

`/upgrade` and `/resave` are **the same call, minus the transform**:

| | load | write |
|---|---|---|
| `/resave` (`Program.cs:204-211`) | `WizardData.FromModpack(src)` | `data.WriteModpack(dest, true)` |
| `/upgrade` (`ModpackUpgrader.cs:58`, `:212-219`) | `WizardData.FromModpack(path)` | `if (AnyChanges) WriteModpack(newPath, true)` |

(The write condition is literally `if (data.AnyChanges || rewriteOnNoChanges)` at `:216`; `HandleUpgrade`
calls the 2-arg overload, so `rewriteOnNoChanges` defaults to `false` — `Program.cs:179`.)

So when `/upgrade` no-ops, `/resave`'s output **is** what `/upgrade` would have written — and
`registerResaveCheck` already diffs our writer against exactly that golden, with
`checkPayloadMembers` on for PMP (`corpus-resave.ts:91-97`).

**`AnyChanges` (`ModpackUpgrader.cs:25-49`)** compares only each option's `StandardData.Files`
dictionary — count, keys, and `FileStorageInformation` equality. Not manipulations, not group or
option structure. Two consequences:

1. A no-op means *no option's file set changed by the transform*, not *nothing changed*. A pack whose
   manipulations needed upgrading but whose files did not is silently left un-upgraded. That is a
   TexTools defect candidate; it is **not** adjudicated by this spec and no behaviour here depends on
   resolving it.
2. `originals` is captured **after** `FromModpack` (`ModpackUpgrader.cs:58` then `:64-80`), so
   load-time fixes are baked into the baseline and are invisible to `AnyChanges`. The predicate
   measures the four transform rounds only.

## 3. Design

Three changes, all confined to the `golden.kind === "noop"` branch of `registerUpgradeCheck`.

### 3.1 Keep `diffUpgrade` against the input

Unchanged. It is the harness spec's original intent and remains the content-identity assertion: our
transform must not alter any `gamePath`'s bytes for a pack the oracle left alone.

### 3.2 Add a transform-no-op assertion

Assert that our upgrade changed no option's file set, mirroring `AnyChanges`. Compare the model
returned by `upgradeModpack(source)` against `source` itself — post-load, pre-transform, matching
where the C# captures `originals`.

**Predicate: file sets only** — per option, paired by **group index then option index**: same
`gamePath` key set, same content bytes. Deliberately *not* whole-model identity: if TexTools'
transform mutates manipulations on such a pack it still no-ops, so a faithful port must be free to do
the same. Anything the transform does outside the file set has no oracle on this branch in either
direction, and this spec does not invent one.

**Why index pairing, and why bytes.** Both differ from the C# and both need justifying:

- C# keys `originals` by `WizardOptionEntry` *reference* (`ModpackUpgrader.cs:64`, `:76`), which works
  because its transform mutates options in place. Our `upgradeModpack` clones, so reference identity
  is unavailable. Positional pairing is the correct substitute: neither our pipeline nor `/upgrade`
  adds or removes options, so options align by structural position — the same assumption the harness
  spec already relies on (`2026-07-04-upgrade-golden-harness-design.md` §3). A count mismatch is
  itself reported as a change rather than silently truncating.
- C# compares `FileStorageInformation.Equals` — and that type is a plain struct with **no custom
  `Equals`** (`TransactionDataHandler.cs:42-71`), so it is field-wise over `StorageType`,
  `RealOffset`, `RealPath`, `FileSize`. `RealPath` is a *temp file path*, so in C# a transform that
  rewrites a file to byte-identical content still counts as a change. Our model has no such
  descriptor (`ModpackFile` is `{ storage, data? }`), so we compare bytes.

  This makes our predicate **strictly weaker, never stronger**, which is what keeps it safe here: a
  byte change implies a `FileStorageInformation` change, so anything we flag C# would have flagged
  too. And the converse gap cannot arise on this branch — had C# seen a change of any kind it would
  have written a golden, and we would be on the real-golden branch instead. So on the no-op branch a
  byte-level report of "no change" and the oracle's own verdict cannot disagree.

**It is the only assertion on this branch that bypasses the writer.** It compares `upgradeModpack`'s
return value against the pre-transform model, deliberately: it is about the transform alone. Writer
behaviour is covered by `diffUpgrade` (which reads back the written archive) and by `/resave`.

**Lives in `test/helpers/`, not `src/`.** It is an oracle-side predicate the harness needs in order to
interpret a missing golden — not behaviour our product performs. See §4.

### 3.3 Drop `diffArchives` from this branch

Member names and manifest JSON are not compared against the input at all. Writer parity for the same
pack is covered by `registerResaveCheck` against a real TexTools `/resave` golden.

`pmpSelfConsistency` **stays** — it is oracle-free (no dangling `Files` key, no orphan member) and
independent of whatever reference the branch uses.

### 3.4 Resulting semantics

A no-op pack's `/upgrade` baseline **should be empty**. The only assertions left are "our transform
changed no content" and "our transform changed no file set", both of which a correct port satisfies
outright. Any entry that appears is a genuine transform divergence.

This restores the harness spec's framing of the baseline as the **transform burndown chart** (§1,
§4.5). Substituting the `/resave` golden as the reference — the other candidate design — would
instead pull writer-parity findings (the `.mdl` v6 bump seam, the `.meta` reconstruction seam) into
the `/upgrade` baselines of every no-op pack, duplicating what `.resave-baseline` already tracks and
muddying that framing. Rejected for that reason.

## 4. Product deviation: we always resave

TexTools declines to write when `AnyChanges` is false. **We deliberately do not** — our upgrader
always rewrites the pack, applying load-time fixes and upgrades regardless. This is an intentional
product divergence, affirmed by the operator (2026-07-19), and this spec does not change it.

It is why §3.2's predicate is harness-only. Our `upgradeModpack` has no `AnyChanges` equivalent and is
not gaining one: nothing in the product branches on it. The harness needs the predicate solely to
interpret the oracle's silence, so porting it into `src/` would add a symbol no shipped code path
calls.

The deviation is compatible with §3.2 because both concern **whether a file gets written**, while
§3.2 measures only **what the transform did**. TexTools declines to write when the transform changed
no file set; we write regardless. Neither choice changes the transform's effect, so mirroring the
oracle's predicate to interpret its silence stays valid whatever we do with the result.

## 5. Scope and boundaries

**Coverage.** `/resave` runs over `real/` + `synthetic/` (`corpus-roots.ts:8-15`,
`corpus-units.ts:45-59`). `upgrade-error/` packs get the `upgrade` check alone, but a pack in that
root has an `.error` golden and returns via `assertMatchedUpgradeFailure` before any comparison — so
in practice every pack reaching the no-op branch is a `real/` or `synthetic/` pack with a `/resave`
counterpart.

This is an observation, not a dependency. The no-op branch does not consult the `/resave` harness or
require its golden to exist (§5, next paragraph); the point is only that dropping `diffArchives` here
leaves no writer-coverage hole in the corpus as it stands. Were an `upgrade-error/` pack ever to
no-op instead of erroring, it would simply have no writer coverage — a gap to notice, not a failure
mode this design has to defend against.

**No crosstalk between the harnesses.** When the `/resave` oracle itself errors on a pack (the
Milktruck CMP-read crash), `registerResaveCheck` does a loud `ctx.skip` and our writer is unverified
for it. The `/upgrade` no-op branch does **not** detect or report that: it will not read
`.resave-cache` error markers, and the two checks stay independent. This is a deliberate call
(operator, 2026-07-19) — the case is rare, today's coverage for it is unsound rather than real, and
coupling the two harnesses to cover it costs more than it is worth. A brief comment on the no-op
branch notes that writer parity lives in the `/resave` check; that is the whole of the linkage.

## 6. What this deletes

- `stripOursPrefix` (added 2026-07-19; becomes dead) — its one external caller
  (`corpus-upgrade.ts`), the two internal forwards inside `diffArchives`, the fail-loud guard, the
  parameter on `diffArchives` / `diffPayloadSemantic` / `dropConfirmedAbsentKeys`, and the doc-block
  paragraphs describing it.
- `defaultOnlyNoop` and the 38-line comment block above it in `corpus-upgrade.ts` — the whole
  justification for a distinction this change removes. The `layoutEquivalent` gate reverts to
  `packHasFileSwaps(readZip(bytes))` alone, and its `console.log` reverts to the FileSwaps-only
  wording (it would otherwise announce "compared SEMANTICALLY" for a reason that no longer exists).
- `docs/backlog/2026-07-19-noop-reference-manifest-spelling.md` and its index entry — the 18 `SetId`
  entries it tracks stop being produced. Delete only after the re-bless confirms they are gone.
- The four-key manifest set (`#/Name`, `#/Description`, `#/Version`, `meta.json#/Image`) from every
  no-op synthetic's baseline.

`test/corpus/synthetic/default-only.pmp` and its builder **stay**. The pack still exercises
load → transform → write for a groups-less PMP and still feeds the `/resave` check, which is now the
thing that pins its `default/` prefix against a real TexTools golden.

## 7. Testing

**Harness unit tests** (`test/helpers/`, oracle-free, following the existing
`upgrade-archive-diff.test.ts` / `corpus-upgrade.test.ts` patterns):

- transform-no-op predicate: identical file sets → no change; an added `gamePath` → change; a removed
  `gamePath` → change; same keys with differing content → change; a differing **manipulation** with
  identical file sets → **no** change (pins §3.2's deliberate scope, so a later "tighten it to
  whole-model" edit fails loudly rather than silently diverging from the oracle's predicate).
There is deliberately **no unit test asserting "`diffArchives` is not consulted on the no-op branch"**.
`diffArchives` is a static import into `registerUpgradeCheck`, which is one monolithic `it()` that
reads files and can spawn ConsoleTools — observing the call would need `vi.mock` or an extraction
refactor this design does not otherwise justify. The meaningful version of that assertion is
empirical and comes free with the corpus run: **every real-golden pack's diff must be unchanged** by
this work. If one moves, the branch condition is wrong.

**Corpus.** The existing no-op packs are the integration test. Expected outcome: every no-op pack's
`/upgrade` baseline becomes empty (§3.4). A pack that does not reach empty is a real finding and must
be explained before blessing — not blessed to make the suite green.

**Removal safety.** Deleting `stripOursPrefix` must not change any *real-golden* pack's diff; those
packs never passed it. The corpus run confirms this.

## 8. Rollout

1. Land the harness change with the transform-no-op assertion and the `diffArchives` removal.
2. Run the suite **before** blessing and read the no-op packs' actual diffs. Confirm each reaches
   empty, and account for any that does not.
3. Re-bless (`UPDATE_UPGRADE_BASELINE=1`). Every no-op pack's baseline should reach **empty** (§3.4)
   — the same bar §7 sets, not the weaker "merely shrinks". The one way a no-op pack can legitimately
   gain an entry is a new `kind: "transform"` diff, which means our transform changed a file set the
   oracle left alone. That is a genuine finding: explain it before blessing, never bless past it.
4. Delete `stripOursPrefix` and the backlog item once the run confirms both are dead.

**Steps 2-4 are not executable on a fresh clone.** `test/corpus/real/` and `test/corpus/synthetic/`
are gitignored and a fresh clone has neither the packs nor ConsoleTools, so the `upgrade` check
no-ops entirely. Every figure in §1.1's cost table was measured on a populated local corpus
(2026-07-19) and is likewise unverifiable without one. Rebuild the synthetics with
`npm run synthetics`; the real packs must be supplied. Baselines are gitignored for the same reason,
so this shrinkage is local-only and each contributor re-derives it.

## 9. Out of scope

- Adjudicating TexTools' `AnyChanges` under-inclusiveness (§2, consequence 1) as a registered bug.
- Changing our always-resave product behaviour (§4).
- `docs/backlog/2026-07-18-empty-vs-omitted-fileswaps-key.md`. It is the same family — a manifest
  difference visible only against a raw Penumbra export — and dropping `diffArchives` from this
  branch will stop producing its `Flower Child - by Solona.pmp` entry. But the item also covers the
  `/resave` side, where the reference *is* a TexTools golden, so it does not fully retire here.
- The `/resave` findings in `docs/BACKLOG.md` (the `.mdl` v6 bump seam, `.meta` reconstruction seam,
  and siblings). Untouched; this spec deliberately keeps them out of the `/upgrade` baselines.
