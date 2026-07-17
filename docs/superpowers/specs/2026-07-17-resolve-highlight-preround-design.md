# Resolve-Highlight pre-round + expected-failure `/upgrade` goldens

**Date:** 2026-07-17
**Status:** Design signed off; ready for plan.
**Backlog item:** `docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md`
(prioritized #1). This spec ships the **highlight-resolution half**; the item is narrowed
in place to the still-deferred `RepathHairMashups` half.
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
  `rtx.FileExists` against the **live Dawntrail game index** we have no runtime access to. **Deferred**
  (fail-loud throw), same bundled-DT-path-set dependency as the eye partials.

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
  recompute `hasMask`/`hasNorm`; both/neither → `continue`; else `missingTex = hasMask ? normal :
  mask`; look up `containers[missingTex]`; staple `o.files.set(missingTex, { …src })` from the sole
  container. Throws are faithful to the C# `Dictionary` indexer + `Dictionary.Add` (§2.4).

### 2.3 Deferred `RepathHairMashups`

`repathHairMashups(data)` throws immediately, citing
`docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md` (narrowed to this half). It needs
the live DT `FileExists` path-set — the same bundled-reference dependency the eye partials still
await. Zero corpus/library mods reach it, so it is latent and fail-loud is safe.

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
finish the deferred half of `docs/backlog/2026-07-11-expected-failure-golden.md`, reusing the
caching machinery of the **already-shipped `/resave` implementation** (`test/helpers/resave-golden.ts`)
but with **different pass/fail semantics** (see below):

- `test/helpers/upgrade-golden.ts`: add `{ kind: "error"; message }` to `GoldenResult`; catch a
  `produce()` throw; cache a content-addressed `<sha>.error` marker (analogous to `<sha>.noop`) so
  ConsoleTools is spawned at most once.
- `test/helpers/corpus-upgrade.ts`: on `{ kind: "error" }`, run our `upgradeModpack` on the source
  and compare the *outcome*:
  - **our upgrade also throws → PASS.** A matched failure is a verified match: we refuse exactly the
    packs TexTools refuses. This is the point of adding a real throwing mod.
  - **our upgrade succeeds → FAIL (loud).** We diverge from the oracle — produced output where
    TexTools errored. `console.error` the pack + the oracle's error text so the divergence is legible.

  This deliberately **departs from the `/resave` precedent**, which treats an oracle error as a loud
  *skip*. That was right there because `/resave`'s only oracle error is *environmental* (a TexTools
  CMP-layout crash in the game-data read, unrelated to our port — backlog `2026-07-11` §Update). On
  the `/upgrade` side an error is attributable to **transform logic our port is expected to
  reproduce**, so a mismatch is a real divergence to fail on, and matched-failure-is-pass makes the
  added mod a live red/green regression guard rather than a permanently-yellow skip. (If a future
  `/upgrade` pack ever errors for an *unreproducible* environmental reason, that surfaces as a loud
  FAIL prompting either a port or an explicit allow — fail-loud, never silent.)
- Unit test via the `opts.produce` injection seam (no real ConsoleTools spawn), matching
  `test/helpers/resave-golden.test.ts`, plus a corpus-upgrade-level test of the match→pass /
  mismatch→fail branching with an injected error golden and a stub upgrade.

Then the backlog item `2026-07-11` is deleted (both halves done) and its index entry removed.

---

## 4. Part C — proof

Ordered strongest-first per AGENTS.md; §1.1 dictates the mix (no real staple data exists).

1. **Unit tests** — `test/upgrade/resolve-highlight.test.ts`, hand-built minimal `ModpackData`:
   clean staple (2-option split → both options gain both textures, sharing bytes); `InvalidDataException`
   (missing texture in ≠1 container); `KeyNotFoundException`-equivalent (missing texture in 0
   containers); no-op (no hair mtrls; all-paired); deferred `RepathHairMashups` throw (hair mtrls
   present, `badOptions` empty, `containers` empty); plus the unguarded-sampler file-skip and the
   live-mutation staple. Fixtures cite the C# they derive from.
2. **Synthetic golden** — `scripts/generate-synthetics/build-synthetic-highlight.ts` (committed
   builder; built pack gitignored, `npm run synthetics` regenerates). A minimal `.pmp` whose hair
   `.mtrl` is **already-Dawntrail** (`hair.shpk` with a normal+mask sampler but no pre-DT shader
   constants, so `doesMtrlNeedDawntrailUpdate` is false and no later round touches the stapled
   files), split across two options so each holds exactly one texture of the pair. The pre-round
   staples cleanly; ConsoleTools `/upgrade` produces a golden that is the input plus the stapled
   pointers — **byte-exact** target, the only AB-test of the happy path. Uses the shared
   `pmp-builder.ts` (pinned zip mtime → byte-reproducible → stable cached golden).
3. **Real corpus add** — `[Inako] Lilith Wish.pmp` (9.8 MB, smallest of the 18) into
   `test/corpus/real/`. Via Part B: ConsoleTools errors (`InvalidDataException`), our port throws the
   same, the harness caches the `<sha>.error` marker and the check **passes** (matched failure).
   **Implementation must first verify ConsoleTools actually errors on it** as the replication
   predicts; a mismatch is itself a finding (the replication is wrong) and reshapes the port.
4. **Corpus no-regression** — the 3 existing corpus hair packs (`Misty_Hairstyle_Female`,
   `[DVNO] Desert Years`, `[Jaque] Marcellus`) stay no-op through the pre-round; full `npm test`
   green; re-bless baselines (expected: no new diffs).

---

## 5. Out of scope / follow-ups

- **`RepathHairMashups`** — remains deferred; backlog `2026-07-15` is narrowed to it (not deleted).
- **The other 17 throwing mods** — not added; one real expected-failure mod is enough to prove the
  path. They stay available locally if broader coverage is ever wanted.
- **`includePartials = false`** — not modelled; our pipeline always runs partials, unchanged here.

---

## 6. File-change summary

**New:** `src/mtrl/dx11-path.ts`, `src/upgrade/resolve-highlight.ts`,
`scripts/generate-synthetics/build-synthetic-highlight.ts`, `test/upgrade/resolve-highlight.test.ts`.
**Edited:** `src/upgrade/material.ts` (import extracted `dx11Path`), `src/upgrade/upgrade.ts`
(wire the pre-round), `test/helpers/upgrade-golden.ts` + `test/helpers/corpus-upgrade.ts` +
`test/helpers/upgrade-golden.test.ts` (Part B), `scripts/generate-synthetics/build-all.ts` (register
the new synthetic), `docs/backlog/2026-07-15-…-preround.md` (narrow to `RepathHairMashups`),
`docs/BACKLOG.md` (re-word #1; drop the `2026-07-11` entry). **Deleted:**
`docs/backlog/2026-07-11-expected-failure-golden.md`. **Corpus (gitignored):** add
`test/corpus/real/[Inako] Lilith Wish.pmp`.
