# Modpack-serialization / manifest parity — design

**Status:** approved design, pre-implementation.
**Roadmap:** closes the ★ headline finding of
[`docs/audits/2026-07-07-porting-guideline-audit.md`](../../audits/2026-07-07-porting-guideline-audit.md)
and is priority #1 (and #2, F1) of that report. Fits under the foundation design
[`2026-06-30-dawntrail-modpack-upgrader-design.md`](./2026-06-30-dawntrail-modpack-upgrader-design.md).

## 1. Problem

The `/upgrade` golden harness proves **game-file content parity** but never checks **archive
structure or the manifest**, and never runs our writers on the oracle path.
`registerUpgradeCheck` compares `upgradeModpack(loadModpack(...))` — an in-memory `ModpackData`
model — against the parsed golden, keyed by `gamePath` on decompressed payloads
(`diffUpgrade` → `byGamePath` → `allFiles`; `test/helpers/upgrade-diff.ts`). Blind spots, all
passing silently today:

1. **Wrong top-level file *names*** — F1's `group_002_WEAREABLE_EARS_OPTIONS.json` vs the
   golden's `group_002_weareable ears options.json`. Same payloads → passes.
2. **Wrong file *count / inventory*** — a dropped/added/renamed/merged/split `group_*.json` is
   invisible while the *union* of game files is unchanged.
3. **Wrong manifest *content*** — `meta.json`, `TTMPL.mpl`, `group_*.json`, `default_mod.json`
   fields (names, `page`, `priority`, `selectionType`, `defaultSettings`, descriptions) — none compared.
4. **Wrong group/option *assignment*** — the `flatMap` union collapses groups/options before
   keying by `gamePath`, so a file in the wrong option still matches.
5. **The writers never execute on the oracle path** — `writePmp`, `writeTtmp2`, `safeName`,
   manifest emission are covered only by self-consistency round-trip tests, never against the oracle.

## 2. Decisions (locked with the operator)

- **Manifest comparison is semantic, not byte-exact.** Parse both manifests and deep-equal the
  object trees. This dissolves the "reproduce TexTools' JSON serializer byte-for-byte" cost the
  audit flagged (property order / indentation / escaping / number / newline stop mattering).
- **Keep the existing payload byte-diff untouched**; layer STRUCTURE + MANIFEST on top. Payload
  bytes are written verbatim by both writers, so the in-memory payload diff already reflects what
  we ship — only STRUCTURE + MANIFEST require going through the writer.
- **Ratchet via a `kind` field**, not a separate baseline file. Manifest/structure diffs flow
  through the existing content-addressed bless / `compareToBaseline` machinery.
- **Synthetic modpacks run the *identical* pipeline/caching as real**, in a gitignored sister
  directory. This spec builds only the real/synthetic *boundary*; whether to commit synthetic
  test data (packs/goldens) is a **separate, deferred** decision.
- **Fix F1 in this spec**, TDD-first: author a synthetic PMP that **fails first**, then port
  `MakePMPPathSafe` so it goes green.

**Non-goals.** Byte-exact JSON. Changing the payload comparison. Committing test data.

## 3. Architecture

The upgrade check gains one step — serialize `ours` through the real writer — then compares both
archives at three levels:

```
oursModel   = upgradeModpack(loadModpack(input))
oursArchive = writeModpack(oursModel, target)      // NEW: exercises writePmp/writeTtmp2 (blind spot #5)
goldenBytes = cached ConsoleTools /upgrade output  // or input bytes, on a no-op

readZip(oursArchive)  vs  readZip(goldenBytes)      // both PMP and TTMP are zip-family
  ├─ STRUCTURE   set of manifest member NAMES              → blind spots #1, #2
  ├─ MANIFEST    deep-equal parsed JSON per shared member  → blind spots #3, #4
  └─ PAYLOAD     existing byGamePath byte-diff (UNCHANGED) → game-file content, byte-exact + DIVERGENCE_RULES
```

- `target` = `pmp` for PMP input, `ttmp2` for every TTMP-family input — matches `goldenExt()` and
  what ConsoleTools emits (`test/helpers/upgrade-golden.ts:37`). `writeModpack` already throws on
  cross-format re-emit (`src/index.ts:59`).
- **No-op golden:** the reference archive is the original **input bytes** (golden ≡ input), so
  STRUCTURE/MANIFEST compare `oursArchive` vs `readZip(input)`.

### Member classification (per side)

`readZip` → `Map<memberName, bytes>`. Classify:

- **Manifest members (JSON):** PMP → `meta.json`, `default_mod.json`, `group_*.json`; TTMP → the
  `*.mpl`. Parse each.
- **Payload / blob members:** PMP game files; TTMP `*.mpd`. **Not** compared here — payload content
  is the existing PAYLOAD diff's job.

### STRUCTURE check

Compare the **set of manifest member names**. For PMP this catches F1 (a renamed/mis-cased
`group_*.json`) and dropped/added groups. For TTMP the manifest set is fixed (`TTMPL.mpl` +
`TTMPD.mpd`), so TTMP structure lives inside the `.mpl` and is caught by MANIFEST instead.

### MANIFEST check

For each shared manifest name, `deepEqual` the parsed JSON, after a **documented, cited**
normalization (mirrors the `DIVERGENCE_RULES` philosophy — start strict; add a normalization only
with a reason, so any *other* difference still fails):

- **TTMP `TTMPL.mpl`:** strip `ModOffset` / `ModSize` from each mod entry before deep-equal. They
  are artifacts of `.mpd` blob packing (our `buildBlob` dedup vs .NET's layout;
  `src/container/ttmp2.ts:121`) and the bytes they address are already validated by PAYLOAD.
- **PMP `Files` map values (conditional):** map *keys* are gamePaths (semantic); *values* are
  internal zip storage paths. If TexTools' storage paths prove to differ from ours, normalize to a
  key-set comparison — decided per-case once the baseline reveals whether they actually diverge.

Wrong-option assignment (blind spot #4) is caught here for free: the group/option→file listing
lives in the manifest JSON, so a misplaced file changes `group_*.json` / `ModPackPages` and fails
deep-equal — no change to payload keying needed.

## 4. Ratchet extension

Add `kind: "payload" | "manifest" | "structure"` to `FileDiff` (`test/helpers/upgrade-diff.ts`)
and include it in `idOf` (`test/helpers/upgrade-baseline.ts:29`). Manifest/structure diffs then use
the **existing** content-addressed baseline, subset-ratchet, and bless flow unchanged. Blessing
captures today's manifest/structure diffs, making the blind spot visible + regression-proof
immediately; they burn down like the 705 tex diffs (audit U4). Diff identity for the new kinds:

- `structure`: member name + `added` / `removed` status.
- `manifest`: member name + a stable path into the object tree (or whole-member `mismatch` when a
  finer locator is not worth it) + status.

## 5. Directory restructuring

Rename `test/corpus/inputs/` → `test/corpus/real/`, add `test/corpus/synthetic/` as a gitignored
sister. Both flow through the **identical** discovery → golden-cache → baseline pipeline by
parameterizing the enumeration over both roots. Touched:

- `test/helpers/corpus-units.ts` (`CORPUS_INPUTS` → enumerate both roots).
- `test/helpers/oracle.ts` (`CORPUS_INPUTS`, `assertCorpusPresent` messages).
- `test/helpers/corpus-models.ts` (`INPUTS` constant + messages).
- `test/corpus-guard.test.ts` (require *real/*; unchanged intent).
- `.gitignore` (both roots + `.upgrade-cache` / `.upgrade-baseline`, as today).

This delivers only the *boundary*. Committing synthetic packs/goldens is deferred; a gitignored
synthetic pack is consistent with how every real-corpus golden already lives locally.

## 6. F1 fix — port `MakePMPPathSafe`, synthetic PMP fails first

**TDD order (author the failing data first):**

1. **Author a synthetic wizard PMP** under `test/corpus/synthetic/` whose group name forces the
   divergence — e.g. `"Weareable Ears Options"` (spaces + capitals). Hand-build the zip:
   `meta.json`, `default_mod.json`, `group_001_*.json` (+ any referenced files). Run the new
   harness: our writer emits `group_001_WEAREABLE_EARS_OPTIONS.json` while the ConsoleTools golden
   emits `group_001_weareable ears options.json` → **STRUCTURE check fails (RED)**. This is the
   AGENTS.md-preferred "synthetic golden" that would have caught the bug.
2. **Port the fix.** Replace `safeName` (`src/container/pmp.ts:110`) with a faithful port of
   `PMP.MakePMPPathSafe` (`reference/.../Mods/FileTypes/PMP.cs:1316-1326`) →
   `IOUtil.MakePathSafe(fileName, rep, makeLowercase)` (`.../Helpers/IOUtil.cs:738-759`):
   - NFKC-normalize the name (`fileName.Normalize(NormalizationForm.FormKC)`).
   - Replace **only** chars in `Path.GetInvalidFileNameChars()` with `'_'` (`_PMPSafeNameReplacement`,
     PMP.cs:47) — *not* the current whitelist `[^A-Za-z0-9._-]`, which is why spaces became `_`.
   - **Lowercase** every other char (`makeLowercase = true`) — the current TS does not lowercase.
   - `.Trim()` the result. No `(s || "_")` empty fallback (C# has none).
   - Special cases: `"."` → `"_"` (1 char), `".."` → `"__"` (2 chars).
3. **Green.** The synthetic PMP now emits `group_001_weareable ears options.json`; STRUCTURE passes.

**Documented quirk (cite in the port):** `Path.GetInvalidFileNameChars()` is **platform-dependent**
— Windows returns ~41 chars (control 0–31 plus `" < > | : * ? \ /`), Unix returns only `\0` and `/`.
We reproduce the **Windows** set, because the goldens are generated on the operator's Windows
machine. Transcribe the exact Windows set and cite it.

## 7. Testing, coverage, burndown

- **Bless run** records the new manifest/structure baseline across the real corpus
  (`UPDATE_UPGRADE_BASELINE=1`).
- **F1 synthetic pack** goes green after the fix; its RED-first state is the coverage that would
  have caught the bug (AGENTS.md: "a found divergence is a test-coverage gap too").
- **End-of-task gate** — `npm run check`, `npm run typecheck`, `npm test` all green.
- **Follow-up burndown** of newly-exposed manifest/structure diffs across the real corpus is
  separate work, tracked against the ratchet.

## 8. Risks / open questions

- **Deep-equal may surface *semantic* field changes** TexTools makes on `/upgrade` that our `raw`
  passthrough (`src/model/modpack.ts:36,49,62`) does not replicate. Those are real burndown items —
  expected; that is the measurement working, not a harness bug.
- **PMP `Files`-value divergence** (§3) — resolve to normalize-or-not once the real-corpus baseline
  shows whether storage paths actually differ.
- **Exact Windows `GetInvalidFileNameChars()` set** must be transcribed and cited (§6).
- **Manifest diff locator granularity** (§4) — start with whole-member `mismatch`; refine to a
  tree-path locator only if burndown needs finer ratchet slots.
