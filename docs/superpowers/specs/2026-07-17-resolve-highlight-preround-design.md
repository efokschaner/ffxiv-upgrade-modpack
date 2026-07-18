# Resolve-Highlight pre-round + expected-failure `/upgrade` goldens

**Date:** 2026-07-17
**Status:** Shipped. The **highlight-resolution half** shipped 2026-07-17 (this spec); the
**`RepathHairMashups`** half shipped 2026-07-18 — see
`docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md`. Backlog item
`2026-07-15-resolve-highlight-mashup-hair-preround` is now **closed** (deleted). The sections below
describe the state at the time this spec was written, when `RepathHairMashups` was still deferred;
read the 2026-07-18 spec for the shipped design of that half.
**Roadmap:** foundation design `2026-06-30-dawntrail-modpack-upgrader-design.md` §8 — this is a
missing pre-round of the `ModpackUpgrader` orchestration, run before round 1.

---

## 1. What & why

`ModpackUpgrader.UpgradeModpack` runs `ResolveHighlightOptionsAndMashupHair(data)` at
`ModpackUpgrader.cs:83` — **unconditionally, before round 1** (not gated by `includePartials`).
Our `upgradeModpack` (`src/upgrade/upgrade.ts`) has **no pre-round**, so any pack this transform
would mutate diverges from the `/upgrade` golden. This spec ports it.

The transform (`ModpackUpgrader.cs:267-377`) has two halves:

- **Highlight resolution** — pure cross-option pointer stapling plus a fail-loud throw. Needs **no**
  game index. **Ported here.**
- **`RepathHairMashups`** (`:379-482`) — repaths hair/zear/tail material sampler suffixes gated on
  `rtx.FileExists` against the **live Dawntrail game index** we have no runtime access to. **Deferred
  at the time of this spec; shipped 2026-07-18** (`docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md`)
  via a bundled, namespace-scoped hair/zear/tail texture index oracle.

### 1.1 Reachability — measured against the real library

The C# resolution algorithm was replicated and run over the maintainer's full local mod library
(1131 packs) plus the corpus, to decide what proof is possible (findings drive §4):

| Branch | Real mods reaching it |
|---|---|
| no-op (every hair normal/mask pair complete in the option that holds either) | 266 + 3 corpus |
| clean staple (missing texture held by exactly one container) | **0** |
| `InvalidDataException` throw (missing texture held by ≠1 container) | **18** |
| `RepathHairMashups` / mashup (`badOptions` empty AND `containers` empty) | **0** |

Two consequences:

1. **The throw is the dominant real-world outcome.** All 18 hair mods that reach the stapling code
   hit the "unresolveable — too much complexity" throw (missing textures held by many options —
   duplicate-inflated container counts of 25/126/192…). ConsoleTools `/upgrade` **errors** on every
   one. Reproducing the throw faithfully matters more than the staple.
2. **The clean-staple happy path has zero real coverage** anywhere in the library, so it can only be
   AB-tested via a **synthetic** golden. The corpus as-is only reaches no-op, so adding the pre-round
   is a **clean no-op on the current corpus** — no baseline regression.

---

## 2. Part A — the port

### 2.1 `src/mtrl/dx11-path.ts` (new)

Extract `dx11Path(tex: MtrlTexture): string` — the `XivMtrl.Dx11Path` getter
(`XivMtrl.cs:667-680`) — out of its current private home in `src/upgrade/material.ts`. Both
`material.ts` and the new pre-round import it. Pure relocation; `material.ts`'s existing tests
confirm no behaviour change. Rationale: it is an `XivMtrl` member, so it belongs with the mtrl
codec, not an `EndwalkerUpgrade` transform module (keep a member with its owner — AGENTS.md).

### 2.2 `src/upgrade/resolve-highlight.ts` (new)

`resolveHighlightOptionsAndMashupHair(data: ModpackData): void`, mutating in place. Cited to
`ModpackUpgrader.cs:267-377`. Three stages:

**Stage 1 — scan (`ForAllFiles`, `:275-311`).** For every option's every `.mtrl`:
`resolveFile` → `parseMtrl` (inner `try/catch` → skip on parse failure, `:283-290`); keep only
`shaderPackRaw === "hair.shpk"`; find the `g_SamplerNormal` and `g_SamplerMask` textures; if either
absent, skip; else push `{ normal: dx11Path(norm), mask: dx11Path(mask) }` onto an **ordered list**
`mData` (C# `List<(Normal, Mask)>`, `:272` — duplicates preserved; order is load-bearing for the
duplicate-inflated container counts). If `mData` is empty → **return** (`:308-311`).

**Stage 2 — containers + badOptions (`ForAllOptions`, `:314-344`).**
`containers: Map<string, ModpackOption[]>` (C# `Dictionary<string, List<option>>`) and
`badOptions: ModpackOption[]` (C# `List`, dups allowed). For each option, for each `pair` in
`mData`: if the option has the normal, append it to `containers[pair.normal]`; likewise the mask;
then if it has both or neither, `continue`; else append the option to `badOptions`.

**Stage 3 — resolve (`:346-376`).**
- `badOptions` empty: if `containers` empty → `repathHairMashups(data)` (**deferred throw**, §2.3),
  else **return**.
- Otherwise, for each `o` in `badOptions`, for each `pair` in `mData` (reading `o.files` **live**):
  process the pair **unconditionally** — there is **no** both/neither guard in stage 3 (that guard is
  stage 2 only, `:340-341`); recompute `hasMask` and set `missingTex = hasMask ? normal : mask`; look
  up `containers[missingTex]`; staple `o.files.set(missingTex, { …src })` from the sole container.
  Every `(badOption, pair)` combination is probed, including pairs unrelated to why `o` is bad —
  which is why real multi-pair mods throw. Throws are faithful to the C# `Dictionary` indexer +
  `Dictionary.Add` (§2.4).

### 2.3 `RepathHairMashups` (deferred at the time of this spec; shipped 2026-07-18)

As written, this spec deferred the material-only-mashup branch: `repathHairMashups(data)` threw
immediately, because it needs the live DT `FileExists` path-set — the same bundled-reference
dependency the eye partials awaited. Zero corpus/library mods reach it, so it was latent and
fail-loud was safe. **It shipped 2026-07-18** — the branch now calls the ported
`src/upgrade/repath-hair-mashups.ts`, backed by a bundled namespace-scoped texture index oracle. See
`docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md` for that design.

### 2.4 Fidelity points reproduced (not smoothed over)

- **Unguarded `x.Sampler.SamplerId` (`:294-295`).** C# NREs on a null-sampler texture reached before
  the Normal/Mask match, caught by the outer `try/catch → return` (`:301-304`) — so the whole `.mtrl`
  is skipped. Mirror with a throwing predicate wrapped in a skip, exactly as `material.ts`'s
  `findSpecDiffuse` does. (The reachability scan used a *guarded* lookup; documented divergence from
  the port, immaterial to the reachability verdict given the throw margins.)
- **Live-mutating staple loop.** `o.Files.Add` mutates `o.Files`, and the inner `foreach (pair in
  mData)` sees it — a later pair for the same option can find a just-stapled file. Do **not** snapshot.
- **Two distinct throws from `containers[missingTex]`.** The C# `Dictionary` indexer runs before the
  `.Count != 1` check: a missing texture in **no** container throws `KeyNotFoundException`; in **≠1**
  container throws `InvalidDataException` (`:369`). Reproduce both (a `.get` miss must throw, not
  silently pass). All 18 real mods hit the `InvalidDataException` case.
- **`Dictionary.Add` throw-on-duplicate (`:374`).** `Map.set` overwrites silently; guard so a repeat
  key throws, matching C#.
- **Dead `hairMaterials` set (`:273,298`).** Collected, never read in C#. Dropped, with a note.

### 2.5 Wiring

Call `resolveHighlightOptionsAndMashupHair(out)` in `upgradeModpack` immediately after
`cloneModpack(data)` and before the pass-1 loop (`ModpackUpgrader.cs:83`). Its throws propagate out
of `upgradeModpack` unchanged — the C# pre-round is **outside** the per-option `try/catch` that wraps
round 1 (`:97-116`), so a pre-round failure aborts the whole upgrade (ConsoleTools error exit).

---

## 3. Part B — expected-failure `/upgrade` goldens (executes backlog `2026-07-11`)

The `/upgrade` harness models only `pack | noop`; a pack ConsoleTools errors on hard-fails uncached
every run. The 18 throwing hair mods make this real on the `/upgrade` side for the first time, so we
finish the deferred half of `docs/backlog/2026-07-11-expected-failure-golden.md`.

**Design correction (found during implementation — the crux).** The first cut mirrored the shipped
`/resave` error handling, which reads ConsoleTools' error text from **stdout/stderr**. That does not
work for `/upgrade`: `ConsoleTools.HandleUpgrade` reports a failure via **`Trace.WriteLine(ex)`, not
`Console.WriteLine`** (`Program.cs:185`; `/resave` uses `Console.WriteLine`, `:217`). So a genuine
`/upgrade` error produces exit −1 with **empty stdout/stderr** — invisible to a stdout-based
classifier, which would (safely but uselessly) propagate every real error as a lock-race and never
record it. We therefore capture the **Trace channel** instead. This was proven by attaching to the
Trace output and observing ConsoleTools throw the **identical** `System.IO.InvalidDataException`
("Highlight/Visibility options are unresolveable…") from `ModpackUpgrader.ResolveHighlightOptionsAndMashupHair`
— a real semantic match with our port, not a coincidence.

**One-time manual setup (documented, checked, fail-loud).** ConsoleTools' `.NET Framework 4.8`
`ConsoleTools.exe.config` has no trace listener (Trace → `DefaultTraceListener` → `OutputDebugString`
only, no file). There is no external/env way to redirect a .NET Framework app's config, so the
maintainer adds a `TextWriterTraceListener` to `ConsoleTools.exe.config` (elevated, one-time) that
writes Trace to `%USERPROFILE%\.ffxiv-consoletools-trace.log`. `upgradeWithTraceCapture` — the one
function every uncached `/upgrade` spawn goes through, success or error alike — **validates** this
config first (`assertUpgradeTraceListenerConfigured`, `test/helpers/oracle.ts`) and throws an
actionable setup error if it is missing. So the listener is required to regenerate **any** `/upgrade`
golden cold, not only an erroring pack's — it just happens to matter most there, since a genuine
`/upgrade` error's only observable signal is the Trace channel (see above). A loud, documented
dependency, never a silent one.

**Capture + classification** (`test/helpers/oracle.ts`, `upgrade-golden.ts`):
- Run ConsoleTools at its **install dir** (`cwd`). Empirically, `/upgrade` output is **byte-identical**
  regardless of CWD (verified on material packs; the transform never reads the CWD-relative shader DB,
  `EndwalkerUpgrade.cs` uses only the material's own `ShaderConstants` — and our DB-less port already
  matches byte-exact), so this changes no golden; it just resolves ConsoleTools' resources cleanly and
  keeps the trace free of `LoadShaderInfo` SQLite noise.
- `upgradeWithTraceCapture(src, dest)`: truncate the trace log, run, read it back — all **inside the
  ConsoleTools lock** so the trace read is this run's. A genuine failure's trace carries the
  `ConsoleTools.ConsoleTools.<HandleUpgrade>` frame (`isGenuineUpgradeError`); the non-fatal async
  `LoadShaderInfo` SQLite noise does not. On a genuine failure it throws `OracleUpgradeError(trace)`;
  any other non-zero exit (lock-race / harness bug) propagates raw.
- `upgrade-golden.ts`: `GoldenResult` gains `{ kind: "error"; message }`; the catch caches an
  `OracleUpgradeError` as a content-addressed `<sha>.error` marker and returns `{kind:"error"}`. This
  **replaces** the stdout-based classifier (its three helpers, copied from `resave-golden.ts`, are
  removed — `/resave` keeps its own).
- `test/helpers/corpus-upgrade.ts`: on `{ kind: "error" }`, run our `upgradeModpack` and compare the
  *outcome* (`assertMatchedUpgradeFailure`):
  - **our upgrade also throws → PASS** — a verified match: we refuse exactly the packs TexTools refuses.
  - **our upgrade succeeds → FAIL (loud)** — a divergence (output where TexTools errored).

  This deliberately **departs from the `/resave` precedent** (loud *skip*), which was right there
  because `/resave`'s only oracle error is *environmental* (a TexTools CMP-layout crash unrelated to
  our port). A `/upgrade` error is transform logic our port is expected to reproduce, so a mismatch is
  a real divergence to fail on, and matched-failure-is-pass makes the added mod a live regression guard.

**Tests:** `isGenuineUpgradeError` / `traceListenerConfigured` (pure, with a real captured-trace
fixture) and the `OracleUpgradeError → {kind:"error"}` vs propagate classification, all via the
`opts.produce` injection seam (no real spawn); plus the `assertMatchedUpgradeFailure` match→pass /
mismatch→fail unit test.

The backlog item `2026-07-11` is marked **done** (both halves) but **kept** (not deleted): it has
become the cited design-rationale doc for the whole expected-failure design (referenced by
`resave-golden.ts`, `corpus-resave.ts`, `corpus-upgrade.ts`, the eye-mask spec, and a synthetic
builder), so deleting it would dangle all of those.

---

## 4. Part C — proof

Ordered strongest-first per AGENTS.md; §1.1 dictates the mix (no real staple data exists).

1. **Unit tests** — `test/upgrade/resolve-highlight.test.ts`, hand-built minimal `ModpackData`:
   clean staple (2-option split → both options gain both textures, sharing bytes); `InvalidDataException`
   (missing texture in ≠1 container); `KeyNotFoundException`-equivalent (missing texture in 0
   containers); no-op (no hair mtrls; all-paired); the material-only mashup branch (hair mtrls
   present, `badOptions` empty, `containers` empty) — originally a deferred-throw assertion, updated
   2026-07-18 to assert fall-through to `repathHairMashups`; plus the unguarded-sampler file-skip and
   the live-mutation staple. Fixtures cite the C# they derive from.
2. **Synthetic golden** — `scripts/generate-synthetics/build-synthetic-highlight.ts` (committed
   builder; built pack gitignored, `npm run synthetics` regenerates). A minimal `.pmp` whose hair
   `.mtrl` is **already-Dawntrail** (`hair.shpk` with a normal+mask sampler but no pre-DT shader
   constants, so `doesMtrlNeedDawntrailUpdate` is false and no later round touches the stapled
   files), split across two options so each holds exactly one texture of the pair. The pre-round
   staples cleanly; the stapled **content is byte-exact** vs the ConsoleTools `/upgrade` golden — the
   only AB-test of the happy path. The residual diff is purely the **known container-manifest orphan
   gap** (§8.3): ConsoleTools retains the now-unreferenced original source zip members, our writer
   drops them (same class already baselined on real packs and `synthetic-f1`). So the pack is
   baselined with exactly those orphan-member entries — not a re-bless of the whole corpus, and its
   staple correctness is proven by the baseline being **content-free of any payload/manifest diff**.
   Uses the shared `pmp-builder.ts` (pinned zip mtime → byte-reproducible → stable cached golden).
3. **Real corpus add** — `[Inako] Lilith Wish.pmp` (9.8 MB, smallest of the 18) into a new
   `test/corpus/upgrade-error/` root (gitignored) that is **scoped to the `upgrade` check only**
   (`corpus-roots.ts` `isUpgradeErrorPack` → `corpus-units.ts`). Via Part B: ConsoleTools errors
   (`InvalidDataException`, captured off the Trace channel), our port throws the same, the check
   **passes** (matched failure). The pack is scoped out of `/resave`/`assets`/`golden` because it was
   added only to exercise the `/upgrade` throw; it *also* trips an **unrelated pre-existing** `/resave`
   tex divergence (a constant +80 bytes on ~30 eye/face `.tex`, distinct from the ±1 BC-decode
   tolerance — this branch never touches tex writing, and the rest of the corpus passes `/resave`),
   which is **backlogged** (`docs/backlog/2026-07-17-lilith-wish-resave-tex-divergence.md`), not
   baselined. *(Verified against the real oracle: ConsoleTools genuinely throws the highlight
   `InvalidDataException` from `ResolveHighlightOptionsAndMashupHair` — the replication was correct.)*
4. **Corpus no-regression** — the 3 existing corpus hair packs (`Misty_Hairstyle_Female`,
   `[DVNO] Desert Years`, `[Jaque] Marcellus`) stay no-op through the pre-round; full `npm test`
   green, no new diffs on any existing pack.

---

## 5. Out of scope / follow-ups

- **`RepathHairMashups`** — shipped 2026-07-18 (`docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md`);
  backlog `2026-07-15` is closed (deleted).
- **The other 17 throwing mods** — not added; one real expected-failure mod is enough to prove the
  path. They stay available locally if broader coverage is ever wanted.
- **`includePartials = false`** — not modelled; our pipeline always runs partials, unchanged here.
- **Lilith Wish `/resave` +80-byte tex divergence** — backlogged
  (`docs/backlog/2026-07-17-lilith-wish-resave-tex-divergence.md`); pre-existing, unrelated to the
  pre-round.
- **Container-manifest orphan-member gap** — the synthetic's residual diff (and a corpus-wide known
  gap, §8.3); backlogged (`docs/backlog/2026-07-17-pmp-writer-orphan-member-retention.md`).

---

## 6. File-change summary

**New:** `src/mtrl/dx11-path.ts`, `src/upgrade/resolve-highlight.ts`,
`scripts/generate-synthetics/build-synthetic-highlight.ts`, `test/upgrade/resolve-highlight.test.ts`,
`test/mtrl/dx11-path.test.ts`, `test/helpers/upgrade-golden.test.ts`,
`test/helpers/corpus-upgrade.test.ts`, `test/helpers/corpus-roots.test.ts`.
**Edited:** `src/upgrade/material.ts` (import extracted `dx11Path`), `src/upgrade/upgrade.ts`
(wire the pre-round), `test/helpers/upgrade-golden.ts` + `test/helpers/corpus-upgrade.ts` +
`test/helpers/corpus-geometry.ts` (Part B error kind + consumers),
`test/helpers/oracle.ts` (`/upgrade` Trace-channel capture + install-dir CWD + config check),
`test/helpers/corpus-roots.ts` + `test/helpers/corpus-units.ts` + `test/corpus-units.test.ts`
(upgrade-error root scoping), `scripts/generate-synthetics/build-all.ts` (register the new synthetic),
`docs/backlog/2026-07-15-…-preround.md` (narrow to `RepathHairMashups`),
`docs/backlog/2026-07-11-expected-failure-golden.md` (mark done, kept as the cited design reference),
`docs/BACKLOG.md`. **New backlog:** `docs/backlog/2026-07-17-lilith-wish-resave-tex-divergence.md`,
`docs/backlog/2026-07-17-pmp-writer-orphan-member-retention.md`. **Corpus (gitignored):**
`test/corpus/upgrade-error/[Inako] Lilith Wish.pmp`, plus the synthetic `highlight.pmp` builder output.

**Manual, machine-local setup (not in the repo):** the `TextWriterTraceListener` added to
`ConsoleTools.exe.config` (see Part B) — required on any machine that regenerates **any** `/upgrade`
golden cold (every uncached run goes through `upgradeWithTraceCapture`, not only packs ConsoleTools
errors on); the harness fails loud with the exact fix if it is absent.
