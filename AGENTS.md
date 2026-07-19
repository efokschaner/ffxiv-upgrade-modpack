# Contributing & agent guide

Canonical guidance for humans and coding agents in this repo. Keep it short; if a
rule changes, change it here.

## What we're building — read this first

This repo hand-ports **TexTools / xivModdingFramework's modpack *upgrade*** logic
(the ConsoleTools `/upgrade` transform that migrates mods to Dawntrail) from C# to
TypeScript. Several principles follow from that, and they **override contrary
intuition** when the two conflict:

- **A working upgrader is the goal; byte-parity is how we get there.** The product is a
  modpack upgrader whose output *works in-game and does what the user expects*. Matching
  TexTools byte-for-byte is our default route to that — it is an extraordinarily strong
  correctness signal and our only mechanical oracle — but it is the **means, not the end**.
  Where faithfully reproducing TexTools would hand the user a **worse modpack** (silent data
  loss, a broken mod, a dropped feature), we make the better modpack and diverge
  deliberately.

  This is not a licence to improve on TexTools wherever we think we know better. The bar for
  a user-benefit divergence is **evidence, not judgement**:

  1. The behaviour traces to a registered defect in `docs/TEXTOOLS_BUGS.md` — adjudicated a
     genuine bug, not a quirk we merely dislike.
  2. The divergence is exercised over the **corpus**, and every byte it moves is accounted
     for by a confirmation rule (see *Upgrade golden harness*) — we know exactly what changed
     and why.
  3. Someone has **verified in the real game** that our output is better than TexTools' — the
     mod works where TexTools' output is broken or degraded. This step is manual and cannot
     be skipped or inferred; an untested "improvement" is just an unverified divergence.

  Absent all three, reproduce TexTools faithfully — including its bugs.
- **Byte-parity is the definition of correct — for everything else.** Our upgraded output
  must be **byte-identical** to what ConsoleTools `/upgrade` produces, except for the small,
  explicitly documented list of divergences above (see *Upgrade golden harness*). "Looks
  right" or "our own tests pass" is not the bar — matching TexTools byte-for-byte is. This
  still governs quirks and apparent bugs *that do not harm the user*: reproduce them
  faithfully and note the quirk rather than correcting it.
- **Ask what TexTools does, first.** When deciding how something should behave, the
  question is never "what's the best design?" but "what does TexTools /
  xivModdingFramework do here?" — then reproduce it, from the symbol the oracle
  *actually executes*. Trace the call path (the `/upgrade` and `/resave` load runs
  through `WizardData.FromWizardGroup`, not the look-alike `MakeFileStorageInformationDictionary`);
  a plausible sibling symbol — a different loader, an overload — can behave differently,
  and porting from it is a divergence even though the citation looks right. The C# is
  the spec; `reference/` is the map. Port behaviour; don't invent it. This extends to quirks and apparent
  bugs: reproduce them faithfully (a "fix" diverges from the golden) and note the
  quirk in a comment rather than correcting it. When what you are reproducing is a genuine
  **defect** rather than a transcribed oddity — a null deref, a guard that can never fire, a
  loop that can't terminate — also add an entry to `docs/TEXTOOLS_BUGS.md`, the register of
  TexTools bugs we knowingly reproduce and could propose upstream.
- **Every line of business logic has TexTools provenance.** All non-test, non-
  scaffolding code traces to a named C# source, cited as `file · symbol · lines` in a
  header or comment. If you can't point to the TexTools code a behaviour came from, it
  does not belong in the port. Verify each citation against `reference/` itself — read
  the C#, don't port from memory, a secondhand summary, or an unreviewed draft.
- **Split, don't blend.** Carving one large C# file into several focused TS modules
  is encouraged; merging logic from *different* C# files/symbols into one TS module is
  not. Details in *Porting fidelity* below.
- **Fail loud, never silently diverge.** Meet a structure or code path the port does
  not yet reproduce faithfully? **Throw.** A documented gap that fails loudly is safe;
  a best-effort wrong output corrupts a mod and can slip past the golden diff.
- **Confidence comes from AB-testing TexTools.** We prove parity by running our
  pipeline over the mod corpus and diffing every byte against the cached TexTools
  golden, backed by synthetic unit tests for logic real mods don't exercise, with
  **coverage** confirming what the corpus and tests actually reach. See *Upgrade
  golden harness* and *Synthetic tests*.
- **A found divergence is a test-coverage gap too.** When we discover our output
  differs from TexTools (or any correctness bug), the first question is *why didn't a
  test catch this?* — close that gap as part of the fix. Prefer a **real golden** (add
  a corpus mod that exercises the path) or a **synthetic golden** (an authored modpack
  run through the `/upgrade` harness) that reproduces the divergence first and then
  proves the fix. Fall back to a **synthetic unit test** derived from our reading of
  the C# only when the case is too deep or edge-casey for a golden to reach it. A fix
  without a test that would have caught the bug is incomplete.

## Glossary

- **xivModdingFramework / TexTools** — the C# library (and its GUI app) we port from;
  `reference/` vendors it.
- **ConsoleTools** — TexTools' CLI; its `/upgrade` command is our oracle.
- **golden** — the ConsoleTools `/upgrade` output we diff our result against, byte-for-byte.
- **corpus** — the mod packs we test over, both gitignored / local and both driving the
  same `/upgrade` golden harness: `test/corpus/real/` (real third-party mods) and
  `test/corpus/synthetic/` (minimal packs we author ourselves). "Corpus" means both roots.
- **ratchet / baseline** — the per-pack record of currently-known diffs; a pack passes while
  its diff stays a subset of its baseline, so regressions fail but pre-existing gaps don't block.
- **divergence** — an intended, documented deviation from the golden, confirmed by a
  `DIVERGENCE_RULES` entry.

## Commands

- `npm run check` — format + lint + organize imports (Biome, applies safe fixes).
- `npm run lint` — lint only, no writes.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — full suite via the custom parallel runner.
- `npm run test:coverage` — coverage report (v8) over the full suite incl. corpus;
  opt-in, **not** part of the required gate. Writes `coverage/`.
- `npm run build` — production build (Vite).

## End-of-task ritual (required)

Before considering ANY task complete, run and confirm all green:

1. `npm run check`
2. `npm run typecheck`
3. `npm test`

This is the primary test gate — there is no CI and no pre-push hook. Tests run at
end-of-task (more often than pushes, less often than commits). A pre-commit hook
(lefthook) already runs Biome + typecheck on every commit; it does **not** run the
tests.

## Upgrade golden harness — how we prove parity

This is the AB test that anchors the whole port. `npm test` includes an end-to-end
`upgrade` check per corpus pack: it runs our `upgradeModpack` pipeline and diffs the
result against a cached ConsoleTools `/upgrade` golden (per `gamePath`, on
decompressed content).

The **corpus** spans two **gitignored / local-only** sister roots, both driving the same
`upgrade` check: `test/corpus/real/` (real third-party mods we don't redistribute) and
`test/corpus/synthetic/` (minimal packs we author to exercise paths real mods don't reach —
e.g. the F1 filename repro). Because both are gitignored, a fresh clone starts empty and the
`upgrade` check no-ops until you populate `real/` (supply the mods) and/or rebuild the
synthetic packs (`npm run synthetics` — see *Synthetic tests*). Edge cases no
pack reaches at all are pinned by synthetic unit tests instead (see *Synthetic tests*).

- **Goldens are cached** content-addressed under `test/corpus/.upgrade-cache/`
  (gitignored). First run spawns ConsoleTools per pack; later runs read the cache. A
  no-op upgrade caches a `<key>.noop` marker (ConsoleTools writes no file when nothing
  changes) and the pack is then compared against its own input.
- **Ratchet baseline** lives in `test/corpus/.upgrade-baseline/` (gitignored — it
  describes packs that only exist locally). A pack passes while its actual diff is a
  subset of its baseline; a regression (or a new pack that does not fully match)
  fails. Record/refresh baselines with the bless step:

      $env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE

  A newly added corpus mod has no baseline and is expected to fully match; if it does
  not, either it is a real bug, or the difference is an intended divergence.
- **A third ratchet covers the SQPack self round-trip**, `test/corpus/.roundtrip-baseline/`
  (same key, same bless env var). Read its entries differently from the other two: they
  record `decode(encode(x)) != x` — **our codec contradicting itself, with no TexTools
  output involved** — so a `roundtrip` entry is a stronger indictment than a golden diff,
  not a weaker one. The goal state is an all-`[]` baseline set. When fixing one, delete
  its entry rather than re-blessing.
- **Intended divergences from TexTools are never ignored.** Every deviation we allow is
  *confirmed* by a rule that proves it is exactly the one we meant — never merely tolerated.
  Anything matched by no such rule must be byte-identical to the golden. There are three
  existing confirmation sites, by the shape of what diverges:
  - **Payload content** — add a rule to `DIVERGENCE_RULES`
    (`test/helpers/upgrade-compare.ts`), whose `confirm` narrowly verifies the difference
    (e.g. same tex shape, pixels within our documented encoder precision) with a cited
    reason.
  - **Manifest JSON** — a scoped carve-out in `test/helpers/upgrade-archive-diff.ts`
    (see the FileSwaps-preservation confirmation in `dropConfirmedAbsentKeys`'s `option()` helper
    there for the established shape).
  - **Zip layout that cannot match at all** — `diffPayloadSemantic` / `diffArchives`'
    `layoutEquivalent` mode (`test/helpers/upgrade-archive-diff.ts`), which re-keys the
    payload comparison from zip member name to the Penumbra redirect table
    (`gamePath -> content`). Applies only to packs whose *input* carries Penumbra
    FileSwaps, where TexTools' write-time swap destruction shifts our `common/N`
    dedup numbering away from the golden's even though runtime behaviour is identical.

  Add to whichever fits, or — if a divergence's shape fits none of them — build something like
  them rather than widening a tolerance: it must **confirm** the specific expected
  difference and reject everything else. Whatever you add, **call the intentional
  divergence out clearly** at the site: what differs, why we accept it, and (for a
  user-benefit divergence) the evidence required by the first principle above. A
  divergence recorded only in a gitignored ratchet baseline is *not* documented — the
  baseline suppresses a diff, it does not confirm one.
- **Use coverage to find blind spots.** `npm run test:coverage` runs the same suite
  under v8 and writes a text + HTML + json-summary report to `coverage/`. It is
  report-only (no thresholds — the gate stays unbrittle); its job is to show which
  ported logic the corpus and tests actually exercise. Close a gap by adding a corpus
  mod that hits it (preferred — it reuses the golden oracle) or a synthetic unit test;
  code reachable by neither should be a fail-loud guard.

## Synthetic tests

The golden harness only covers behaviour some real corpus mod happens to exercise.
Everything else is pinned by **synthetic unit tests** — hand-built minimal inputs with
asserted expected output — living beside the code under `test/` (e.g.
`test/mdl/model/*.test.ts`). Reach for one when the logic is precision-sensitive, no
corpus mod hits the path, or you want a fast, isolated regression that fails closer to
the cause than a whole-pack byte diff. Fixtures are hand-derived from the C# (we can't
run TexTools per-unit), so cite the reasoning like any other port.

**Synthetic modpacks.** Real mods can't cover everything — some structures never appear in
the wild — so we also keep *authored* modpacks under `test/corpus/synthetic/` that flow
through the same `/upgrade` golden harness, AB-testing TexTools on constructed inputs and
locking the result instead of only asserting our own expectations in a unit test. Each pack
is produced by a **committed builder script** under `scripts/generate-synthetics/` (e.g.
`scripts/generate-synthetics/build-synthetic-f1.ts`); the built `.pmp`/`.ttmp2` is gitignored like
the real corpus, so a fresh clone regenerates the whole set with `npm run synthetics` — no
third-party mod needed. (Whether to *also* check in the built packs
and their goldens is still open.) Cases too deep or edge-casey for a golden to reach still
fall to synthetic unit tests.

The builders share `scripts/generate-synthetics/pmp-builder.ts`, which types the emitted JSON with
the reader's own `PmpMetaJson` / `PmpGroupJson` / `PmpOptionJson` and pins the zip mtime so a pack is
**byte-reproducible** — rebuilding it keeps the cached golden, which is keyed by `sha256(input pack)`.
The JSON key order and zip member order in that module are load-bearing (they decide the member
bytes the harness compares); don't reorder them.

## Porting fidelity — split, don't blend

The C# source is the map we navigate by, so keep the port traceable back to it.

- **Splitting is encouraged.** A large C# file may become several focused TS modules
  (e.g. `Mdl.cs` is carved into
  `src/mdl/geometry/{decode,encode,declaration,offsets}.ts`). Each such module maps to
  a named C# symbol and cites its source (`file · symbol · lines`) in a header comment.
- **Blending is not.** Do not merge logic from *different* C# files/symbols into one
  TS module, and keep a member with its original owner (e.g.
  `TTModel.Getv6BoneSet` / `GetUsageInfo` belong with the `TTModel` equivalent, not the
  serializer). Traceability beats tidier-looking groupings — prefer it over reshuffling
  already-merged, tested port code purely for aesthetics.
- **Mirror the C# data structure, not just its values.** A keyed or unique C# collection
  (`Dictionary`, `HashSet`, `SortedDictionary`) ports to the JS type that mirrors it (`Map`,
  `Set`) — not a plain array. An array can represent states the C# type forbids (a duplicate
  key it would collapse or throw on), a latent divergence that hides behind green byte-parity
  until an edge input reaches it; the mirror also lets every `ContainsKey` / indexer / `Add`
  transcribe 1:1.
- **Reproduce the C# control flow, not just its output.** When the C# fuses steps in one loop
  — a per-item fix *then* a collapse, a specific visitation order, an interleaving — reproduce
  that shape at the same seam. A tidier phase-split that is behaviourally equivalent for the
  common case can still diverge on an edge the original ordering handled (e.g. a duplicate whose
  fix fails, where fix-then-collapse keeps the earlier good copy but collapse-then-fix drops it).
- **Bundle the minimum data surface, but enough to port any input faithfully.** When the C#
  reads live game data we have no runtime access to (the SqPack index, a canonical material, a
  base-game index-override), pre-extract it into a *generated* constants table via a committed
  `scripts/extract-*` script, citing the C# read it stands in for (`file · symbol · lines`).
  Bundle only the **fields the ported logic actually reads** — never a whole game file when a few
  resolved paths or flags suffice — but bundle them for the **complete** set of inputs the
  transform can encounter, so any mod ports faithfully, not just the ones a corpus happens to
  reach. Where an existence check drives control flow (`FileExists`), let the table *be* the
  existence oracle: enumerate exactly the game files that exist, so a lookup **miss** means the
  file is genuinely absent — a faithful skip (the `FileExists == false` branch), not a silent
  divergence hiding a gap. Prefer TexTools' own cheap in-process primitive over a brute probe
  (e.g. CRC32-hash a candidate path against the once-read `.index`, as `IndexFile.FileExists`
  does — do not spawn a subprocess per candidate).

## Conventions

- **Formatting is mechanical.** Biome owns it. Do not hand-format and do not
  re-introduce the old compact single-line style — run `npm run check`.
- **No per-file license headers.** Licensing lives in the top-level `LICENSE`
  (GPL-3.0) and `NOTICE` (third-party attributions). Do not add SPDX or copyright
  headers to individual source files. A file that ports third-party code may cite its
  upstream origin in a brief comment, but the license notice itself belongs in
  `NOTICE`.
- **Supply chain.** Install new deps pinned-exact (`.npmrc save-exact`) with a ≥
  7-day min release age (e.g. `npm install -D <pkg> --before=<date 7+ days ago>`).
- **`reference/` is off-limits to edits.** It is the vendored third-party C#
  (xivModdingFramework / TexTools) we port from — the map referenced throughout this
  guide. Read it freely; never edit, lint, or format it (it is gitignored).
- **Design lives in `docs/superpowers/`.** Specs in `specs/`, implementation plans in
  `plans/`. Follow spec-then-plan discipline for non-trivial work.
  - **Start here:** `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`
    is the **foundation / roadmap design** — the project overview, the sub-project
    decomposition, and the living burndown (§8). Read it first to see where a piece of
    work fits; new specs link back to it.
  - **Specs are durable; plans are transient.** A spec captures *why* and *what*
    (decisions, invariants, trade-offs) and is kept indefinitely — other docs and
    source READMEs link to it. A plan is an execution checklist for a spec: commit it
    when written (so it lives in history), then **delete it on the branch before opening
    the pull request** — so the PR under review is already clean (reviewers and the merge
    see only the durable spec and the shipped work, never the transient checklist), and a
    completed plan never lands on the default branch, while still living in the branch's
    history from when it was committed. The shipped code, tests, and git history are the
    record of what was done; a plan on the main line is just bloat.
- **Deferred work is recorded in the backlog.** When we decide to defer something —
  a feature known to be unported, hardening parked behind a decision, cleanup that
  outlives the current change — record it in `docs/BACKLOG.md` rather than leaving a
  silent TODO. That file explains how to file an item and how to cite one from code.

## Blame hygiene

A one-time Biome reformat is recorded in `.git-blame-ignore-revs`. Opt in once so
`git blame` skips it:

    git config blame.ignoreRevsFile .git-blame-ignore-revs
