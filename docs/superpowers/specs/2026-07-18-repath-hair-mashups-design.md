# Round-6 pre-round: `RepathHairMashups` (material-only mashup hair)

**Date:** 2026-07-18
**Status:** Design signed off; implementation pending.
**Foundation:** extends the roadmap design
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`, §5 bundled reference
assets, §8 burndown) and completes the `ResolveHighlightOptionsAndMashupHair` pre-round whose
highlight-resolution half shipped 2026-07-17
(`docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md`). Closes backlog item
`docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md` (the top prioritized item).

**Goal:** Port the still-deferred **`RepathHairMashups`** half of the pre-round
(`ModpackUpgrader.cs:379-482`), replacing the fail-loud throw in `src/upgrade/resolve-highlight.ts`.
It retargets pre-Dawntrail hair/`zear`/`tail` material texture suffixes (`_n→_norm`, `_m→_mask`/
`_mult`, `_s→_mask`/`_mult`, `_d→_base`, stripping the `--` high-res marker) to their Dawntrail
names, **but only when the old texture is gone from the game and the renamed one exists** — a
decision gated on the live game index (`rtx.FileExists`).

---

## 1. Why this needs game data, and how much (measured, not assumed)

`RepathHairMashups` calls `rtx.FileExists(path, true)` on the material's sampler paths and their
suffix-swapped variants. The port has no game install at runtime, so — as with the eye/hair partials
— we pre-extract the minimum surface into a bundled, generated table. Unlike those partials (which
need canonical *material* content, keyed by material path), this pass needs only a general
**existence oracle over the hair/`zear`/`tail` *texture* namespace**. Its shape was chosen from
measurement against the real DT `040000` index (330,421 entries), not assumption:

- **Old-suffix textures never exist in DT.** Across all 3,430 canonical hair/tail/ear sampler refs,
  0 of the reversed old-suffix paths (`_n`/`_m`/`_s`/`_d`, with or without `--`) exist. SE fully
  renamed them in Dawntrail. So the `!FileExists(oldPath)` guard is, in practice, always true for
  the paths this pass processes — but we still reproduce it faithfully (a mod already using a DT-form
  path must *not* be double-repathed; see §4).
- **DT textures exist only in plain form, never `--`-prefixed** (0 of 3,430 dashed). This is why the
  port strips `--` when forming the new path: the real game file has no `--`.
- **Pure logic cannot match TexTools.** The repath fires only when the DT target actually exists —
  true for base-game `(race,id)`, false for custom hair ids. "Always repath" would point a sampler at
  a nonexistent file where TexTools leaves it alone: a byte divergence. Some existence data is
  unavoidable.
- **Reusing the committed `hair-materials.ts` is not faithful.** Its 2,984 texture paths cover only
  2,984 of the **3,378** files in the full hair/`zear`/`tail` texture namespace — missing **394
  (~12%)** (secondary materials, `_mult` variants) a mashup mod could reference, which would then
  silently not repath. Rejected.
- **A dedicated namespace-scoped oracle is tiny.** The whole namespace is 3,378 files across 808
  folders; a `(folderHash:fileHash)` set for exactly that namespace is ~27 KB — smaller than the
  470 KB `hair-materials.ts` we already ship, and far below the 2.6 MB a full-index bundle would cost.

---

## 2. Decomposition

Three coupled pieces land together, mirroring the eye/hair-partials structure (spec §2):

| Piece | Deliverable |
|---|---|
| **A. Logic** | `src/upgrade/repath-hair-mashups.ts` — ports `ModpackUpgrader.cs:379-482`; called from `resolve-highlight.ts` in place of the current throw. |
| **B. Oracle** | `scripts/extract-hair-texture-index.ts` → generated `src/upgrade/reference/hair-texture-index.ts`, plus a small runtime `hairTextureExists(path)` in `src/upgrade/reference/hair-texture-index-lookup.ts` (or colocated) that ports `HashGenerator` CRC32 and does the membership check. |
| **C. Coverage** | a synthetic mashup-hair pack under `scripts/generate-synthetics/` through the `/upgrade` golden harness, plus synthetic unit tests for the paths a golden can't isolate. |

Per "split, don't blend": A is its own module citing `ModpackUpgrader.cs · RepathHairMashups`; it
reuses `parseMtrl`/`serializeMtrl`/`dx11Path` and the oracle, and does not merge into
`resolve-highlight.ts` beyond the thin call site.

---

## 3. The oracle (piece B)

### 3.1 Shape — CRC32 hash-set, namespace-scoped

Two generated constants, mirroring `IndexFile.FileExists`' hash mechanics exactly
(`IndexFile.cs:516-621`, `HashGenerator.cs:154-205`):

- `HAIR_TEX_ENTRIES: ReadonlySet<string>` — the `` `${folderHash}:${fileHash}` `` pairs for every
  file under the hair/`zear`/`tail` texture folders that exist in the `040000` index (~3,378).

Stored packed (e.g. an array of `uint32` reconstructed into the set at module load) to keep the file
compact; the exact packing is an implementation detail of the generator, chosen to keep the emitted
file small and diff-stable (sorted).

### 3.2 Runtime lookup — `hairTextureExists(path): boolean`

Ports `computeHash` (already present as extraction-only code in `scripts/lib/game-index.ts`; the
runtime copy lives in the shipped module and is cited to `HashGenerator.cs:154-205`):

1. Split `path` into `folder` + `file` at the last `/`.
2. `fh = computeHash(folder)`, `xh = computeHash(file)`.
3. Return `HAIR_TEX_ENTRIES.has(`${fh}:${xh}`)`.

Because this hashes whatever string it is given and checks the same index-derived pairs TexTools
would, it reproduces `FileExists` — including its hash-collision behaviour — by construction. An
out-of-namespace path (not enumerated at extraction time) is simply a miss → `false`.

### 3.3 Faithfulness of "out-of-namespace → false" (proven, not assumed)

A repath only *fires* when the DT **target** path exists, and the suffix swaps never change the
directory — so the target always lands in the same texture folder as the sampler. For every real
hair/`zear`/`tail` material that folder is in-namespace, so the decisive check is always answered
authoritatively. Returning `false` for an out-of-namespace path (e.g. a `dummy.tex` empty sampler,
which has no swap suffix and is a repath no-op anyway) is therefore harmless: the only way it could
change output is a sampler whose *old* path is out-of-namespace **and** whose DT-swapped target also
exists out-of-namespace — a hair material referencing textures in a non-standard tree that SE also
shipped a DT rename for. That does not occur in real data, and (per the operator's call, 2026-07-18)
we do **not** add a guard for it: a plain `false` keeps the oracle a faithful membership check with no
non-TexTools branch. If it ever surfaces, the golden diff catches it.

### 3.4 Extraction — `scripts/extract-hair-texture-index.ts`

Following the `extract-hair-materials.ts` pattern (committed script → generated `.ts`, regenerable on
a machine with the game via `npx tsx`):

1. Read `040000.win32.index` once (reuse the `scripts/lib/game-index.ts` reader) to get all
   `(folderHash, fileHash)` pairs and a `folderHash → present` set.
2. Enumerate candidate texture folders: `chara/human/c{race}/obj/{hair,zear,tail}/{h,z,t}{id}/texture`
   over the full `IDRaceDictionary` race grid (the 38 codes already in `extract-hair-materials.ts`)
   × id `1..500` (`_SCAN_LIMIT`). Compute each folder hash.
3. Keep the index pairs whose `folderHash` is a candidate folder hash → `HAIR_TEX_ENTRIES`.
4. Emit the generated `.ts`, sorted for a stable diff, with a `// GENERATED` header citing the C#
   reads. The script asserts it probed the full grid (completeness is load-bearing, per the
   existence-oracle invariant) and fails loud if the index is unavailable.

**Dependency:** the game's sqpack `040000` index — the same "run on a machine with the game" contract
the other `extract-*` scripts carry. Regeneration is a no-op given a matching game version.

---

## 4. The logic port (piece A)

`src/upgrade/repath-hair-mashups.ts`, header-cited to `ModpackUpgrader.cs:379-482`. One exported
function run for the three material regexes in order (hair, `zear`, `tail`):

```
chara/human/c[0-9]{4}/obj/hair.*\.mtrl
chara/human/c[0-9]{4}/obj/zear.*\.mtrl
chara/human/c[0-9]{4}/obj/tail.*\.mtrl
```

For each option (iterating `data.groups → group.options`, the port's `ForAllOptions` equivalent, as
`resolve-highlight.ts` already does), snapshot `option.files` and for each `.mtrl` key matching the
regex:

1. Resolve + `parseMtrl` (a resolve miss or parse failure → C# would throw inside `GetUncompressedFile`/
   `GetXivMtrl`; reproduce the same seam — this pass has no per-file try/catch in C#, unlike the
   highlight half, so **do not** swallow. Verify against the C# before finalizing.).
2. Shader gate: continue unless `ShaderPack == Hair` **or** `== Character` (`:401`). (Note: `Character`,
   not `CharacterLegacy` — transcribe exactly.)
3. `norm`/`mask`/`diff` = first sampler with `g_SamplerNormal`/`g_SamplerMask`/`g_SamplerDiffuse`
   (`FirstOrDefault`, mirror with `Array.find`). If `norm == null || mask == null` → continue (`:410`).
   **Note the unguarded `x.Sampler.SamplerId`** — reproduce the same NRE-on-null-sampler behaviour the
   highlight half already models via `findSamplerUnguarded` (reuse it).
4. **Normal** (`:414-421`): if `!hairTextureExists(norm.Dx11Path)`, form `newPath = Dx11Path` with
   `_n.tex→_norm.tex` and `--` stripped; if `hairTextureExists(newPath)`, set `norm.TexturePath` with
   the same `_n.tex→_norm.tex`, `--`-stripped rewrite. (The rewrite is on `TexturePath`, not
   `Dx11Path`; transcribe the exact `.Replace` chain.)
5. **Mask** (`:423-453`): if `!hairTextureExists(mask.Dx11Path)`, try in order — `_m→_mask`, `_m→_mult`,
   `_s→_mask`, `_s→_mult` — each `--`-stripped, taking the **first** whose `hairTextureExists` is true
   (the `found` flag). Reproduce the ordering exactly; it is load-bearing when a material could match
   more than one.
6. **Diffuse** (`:455-463`): only if `diff != null` and `!hairTextureExists(diff.Dx11Path)` — note this
   one call uses the **1-arg** `FileExists(diff.Dx11Path)` in C# (no `forceOriginal`), a transcription
   detail to preserve — then `_d→_base`, `--`-stripped, gated on `hairTextureExists(newPath)`.
7. If anything changed, `serializeMtrl(mtrl)` and write the bytes back into `option.files[m]` in the
   option's storage form (reuse the storage-mirroring the other passes use; C# writes an
   `UncompressedIndividual` temp file — our no-transaction adaptation mutates `option.files` directly,
   exactly as `updateSkinPaths`/`resolve-highlight` do).

### 4.1 Wiring — replace the throw

In `src/upgrade/resolve-highlight.ts`, the material-only-mashup branch
(`badOptions.length === 0 && containers.size === 0`) currently throws. Replace that throw with a call
to `repathHairMashups(data)` (the three regex passes). The surrounding highlight-resolution logic and
its own fail-loud throws are unchanged.

### 4.2 No-transaction adaptation

`rtx = BeginReadonlyTransaction()` + `rtx.FileExists` maps to the bundled `hairTextureExists`. The
`FileStorageInformation` temp-file write maps to a direct `option.files` mutation. Parity-neutral,
matching the already-ported passes.

---

## 5. Coverage (piece C)

No corpus mod reaches this branch (0 of 1,131 scanned — shipped-spec §1.1), so a **synthetic pack**
proves it, run through the `/upgrade` golden harness (AB-tested against ConsoleTools):

- **Primary synthetic** — a single-option pack whose only file is a Hair-shader `.mtrl` for a real DT
  `(race,id)` with old-suffix (`_n`/`_m`) sampler texture paths and **no** textures and **no** split
  options (so the pre-round reaches `badOptions == 0 && containers == 0 → RepathHairMashups`). The
  golden locks the repathed material bytes. Built by a committed
  `scripts/generate-synthetics/build-synthetic-mashup-hair.ts` (byte-reproducible via `pmp-builder.ts`).
- **Synthetic unit tests** (`test/upgrade/repath-hair-mashups.test.ts`) for paths a whole-pack golden
  can't isolate: the `_m→_mask`-before-`_mult` (and `_s`) tie-break ordering; the "old path already
  DT-form → no double-repath" case; and the diffuse `_d→_base` path. Fixtures hand-derived from the C#
  and cited.
- **Expected-failure synthetic (if warranted).** The parse/resolve-miss seam (§4 step 1) is a *throw*
  in C# with no per-file try/catch. Where it is cheap to author a mashup-hair pack whose `.mtrl`
  ConsoleTools also rejects, add it under the `upgrade-error` corpus root (the expected-failure
  `/upgrade` capability, `docs/backlog/2026-07-11-expected-failure-golden.md`) so we confirm *both*
  sides error rather than only asserting our throw — matching the operator's steer (2026-07-18). If no
  input makes ConsoleTools throw at the same seam, pin the throw with a synthetic unit test instead
  and note why a golden couldn't reach it.

Coverage: `npm run test:coverage` should show `repath-hair-mashups.ts` and the oracle lookup reached;
any line reachable by neither must be a fail-loud guard.

---

## 6. Fidelity notes / known gaps

- **Existence-oracle completeness** is the load-bearing assumption (§1, §3): the generator asserts a
  full-grid probe and fails loud on an unavailable index rather than emitting a partial set that would
  silently mis-skip.
- **`--` handling:** old paths keep `--` (the sampler's `Dx11Path` form); new paths strip it, because
  the real game texture has none (measured, §1). Transcribe the `.Replace("--","")` on the *new* path
  only.
- **Shader gate is `Hair || Character`** (not `CharacterLegacy`) — a deliberate transcription, unlike
  the highlight half's `Hair`-only gate.
- **The diffuse `FileExists` is the 1-arg overload** in C# — preserve it; if it proves behaviourally
  identical to the 2-arg form for these paths, note that in a comment rather than "fixing" it.

---

## 7. Work order

1. **B first** — extraction script + generated oracle (needs the game machine, available here) +
   runtime lookup. Regenerate; commit the generated table.
2. **A** — `repath-hair-mashups.ts` + the `resolve-highlight.ts` wiring replacing the throw.
3. **C** — synthetic pack + builder + unit tests; produce the ConsoleTools golden; bless the baseline;
   `npm run test:coverage` sweep.
4. End-of-task gate: `npm run check`, `npm run typecheck`, `npm test` all green.
5. Close backlog item `2026-07-15-resolve-highlight-mashup-hair-preround.md` (delete file + index
   entry, grep for dangling references — the throw comment in `resolve-highlight.ts` cites it) and
   update the shipped-preround spec's deferral note. Delete this branch's plan checklist before the PR.
```
