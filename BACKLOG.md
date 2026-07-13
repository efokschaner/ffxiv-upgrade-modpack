# Backlog

Follow-up work deferred out of the change that surfaced it. See `AGENTS.md` → Conventions
("Deferred work lives in `BACKLOG.md`") for when to add here. Each item cites the audit
finding and/or C# source it traces to, so it can be picked up cold.

## Prioritized

Roughly highest-priority first. Mostly `/upgrade`-pipeline work still to port — the rounds our
pipeline stubs — plus any correctness defect that makes our *output* wrong. Reference:
`src/upgrade/upgrade.ts`, `reference/.../Mods/EndwalkerUpgrade.cs`.

- **A generated texture is written into the PMP with no `Files` key naming it — our upgraded packs
  are functionally broken whenever the texture round fires.** This is a **shipping defect**, not a
  byte-parity nit: the mod we emit does not work in Penumbra. It is the only item here that makes
  our *output* wrong rather than merely different, which is why it leads.

  `writeGeneratedTex` (`src/upgrade/texture.ts`) builds its replacement `ModpackFile` with **no
  `pmpPath`**, while `optionToJson`'s raw branch (`src/container/pmp.ts`) re-emits the source
  option's `Files` map **verbatim** and `writePmp`'s payload loop writes each file at
  `f.pmpPath ?? f.gamePath`. Two distinct failures follow, both silent:
  - A **generated** file that did not previously exist in the option (index map, gear mask —
    `existing < 0` in `writeGeneratedTex`) gets a new zip member at `gamePath`, but **no `Files` key
    is added to name it** (the raw `Files` map is untouched). Penumbra has no way to find it, so the
    upgrade is a no-op from the mod's point of view — the whole point of the texture round is lost.
  - An **in-place regenerated** file (HairMaps normal/mask — `existing >= 0`, the array slot is
    replaced wholesale) **loses its `pmpPath`**, so its new member is written at `gamePath` while the
    retained `Files` value for that same `gamePath` still names the *original* zip path — which no
    longer has a member. The result is a dangling `Files` entry pointing at nothing, plus an orphan
    zip member no `Files` key names.

  **Why no test catches it.** `diffUpgrade` is a model-level payload-multiset diff that runs *before*
  the write, so it never sees `writePmp`'s output. `diffArchives` compares payload member names only
  on the **no-op** branch (`test/helpers/upgrade-archive-diff.ts`) — and a pack whose texture round
  fires is by definition *not* a no-op. So the one comparison that could see it is switched off
  exactly where it would fire.

  **Pre-existing** — `optionToJson` returned `o.raw`'s `Files` map verbatim long before the
  absent-file work; that work only made it visible (spec
  `docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md` §4.2).

  **To fix:** give `writeGeneratedTex` a `pmpPath` and add/repoint the option's `Files` key for the
  gamePath it writes — i.e. stop treating the carried-through raw `Files` map as immutable once the
  pipeline adds or replaces a file. Note this overlaps the *"`writePmp` round-trips the source pack
  where TexTools regenerates it"* item below (TexTools regenerates the whole `Files` map from its
  typed model, which is why it cannot hit this); fixing that item's manifest-regeneration half would
  subsume this, but this is the part that makes packs **broken** and can be fixed on its own first.
  **Needs a test that would have caught it** — the natural one is to extend the payload-member-name
  comparison to the non-no-op branch, which is currently blocked by the writer-regeneration
  divergence below.

- **`writeTtmp2` writes the LEGACY `SelectionType` spelling, and our READER only understands the
  legacy one — so a `Multi` group is silently downgraded to single-select. This makes our
  *output* wrong for users**, the same class as the `Files`-key item above: a mod author's
  multi-select group becomes single-select in the pack we emit, which is a functional
  regression for whoever installs it, not merely a byte-parity nit. `src/container/ttmp2.ts`
  reader: `g.SelectionType === "Multi Selection" ? "Multi" : "Single"`; writer:
  `g.selectionType === "Multi" ? "Multi Selection" : "Single Selection"`. Modern TexTools writes
  the bare enum name (`"Single"` / `"Multi"`), not the legacy `"… Selection"` string.
  **Evidence:** `Fantasia.ttmp2`'s source `.mpl` declares its one group as `["Race","Multi"]`;
  our reader does not match `"Multi Selection"`, so it falls through to `Single`, and our writer
  emits `"SelectionType":"Single Selection"` — while the `/resave` golden emits `"Multi"`. Shows
  as `#/ModGroups/N/SelectionType [mismatch]` + `#/OptionList/N/SelectionType [mismatch]` on 36
  packs in the `/resave` baselines (`test/corpus/.resave-baseline/`).

  **This defect is ALSO already sitting in the `/upgrade` ratchet baselines, not just `/resave`'s**
  (checked 2026-07-13: `Select-String -Pattern SelectionType -Path test/corpus/.upgrade-baseline/*.json`).
  It hits the exact same 36 files as the `/resave` baselines, 643 `SelectionType`-pointer lines total
  (e.g. `7f8d4701a82d….json` alone carries 25: `TTMPL.mpl#/ModPackPages/0/ModGroups/N/SelectionType`
  and `…/OptionList/N/SelectionType` for every group/option in the pack, all `status: "mismatch"`).
  That means the `/upgrade` harness has been **blessing** this defect all along — every affected
  pack's baseline already records the mismatch as "known, ratchet-passing" rather than catching it
  as a regression. It only became legible as a *named, greppable* finding once manifest diffs
  started being reported **per JSON pointer** (Task 2) instead of a single opaque manifest-mismatch
  count; before that this was invisible noise inside an aggregate diff. That is the sharpest
  statement of why the per-pointer harness work mattered: it turned a silently-tolerated defect
  into something you can literally `grep` for and name.

  **Fix (not done here — deliberately deferred):** accept both spellings on read; write the bare
  enum name on write. Note the reader fix changes `ModpackData`, so the `/upgrade` baselines will
  move (in the good direction — the 643 lines above should mostly disappear) once it lands.

- **Partials round.** `partials` (`src/upgrade/upgrade.ts`) is a no-op stub for
  `UpdateUnclaimedHairTextures` / `UpdateEyeMask` / `UpdateSkinPaths` (roadmap round 6).
  Needs the bundled reference assets (eye textures, iris `(race,face)→path`, canonical
  hair/ear/tail sampler tables) — no corpus coverage exercises it yet.

## Unprioritized

### Findings from the `/resave` write-side oracle (2026-07-13)

The `/resave` harness (`test/helpers/corpus-resave.ts`) is the first thing in the suite to AB-test our
**writers** against TexTools (`/resave` = `WizardData.FromModpack` → `WriteModpack`, `Program.cs:191-221`
— the same load path `/upgrade` takes, minus the transform). It immediately surfaced the items below.
All are recorded in the per-pack ratchet baselines under `test/corpus/.resave-baseline/`; none are fixed.

**Read this first — what these findings do NOT mean.** A `/resave` divergence is *not* automatically a
bug in our shipped `/upgrade` output. In the two biggest classes below (`.mdl`, `.meta`) our `/upgrade`
output is **byte-identical to the `/upgrade` golden**; the divergence is that we apply a transform at a
*different seam* than TexTools does, which only a load-then-write oracle can see. Fixing them is about
**seam fidelity**, and any fix must keep the `/upgrade` goldens byte-exact.

- **`writeTtmp2` re-emits a SIMPLE pack as simple; TexTools always writes a WIZARD pack.** Confirmed on
  13 corpus packs. `Black Widow.ttmp2`: source `TTMPVersion` `"1.3s"` with a 21-entry `SimpleModsList`
  and `ModPackPages: null`. Our writer emits `"2.1s"` + `SimpleModsList[21]` (`src/container/ttmp2.ts`,
  `TTMPVersion: data.isSimple ? "2.1s" : "2.1w"`). ConsoleTools `/resave` emits `"2.1w"` with
  `SimpleModsList: null` and `ModPackPages: [1]` — one page holding a single group
  `{"GroupName":"Default Group","SelectionType":"Single","OptionList":[1 option]}`. So TexTools'
  `WriteModpack` **has no simple-pack writer at all**: `WizardData` is page/group/option-shaped, and
  everything it writes is a wizard pack. Shows in the baselines as
  `TTMPL.mpl#/ModPackPages [added]` + `#/SimpleModsList [mismatch]` + `#/TTMPVersion [mismatch]`
  (13 packs each). Decide deliberately whether to match this (our simple round-trip is arguably nicer,
  but it is not what TexTools does).

- **`writeTtmp2` omits `.mpl` fields TexTools always writes.** All on 36 packs, all `[added]` (i.e.
  present in the golden, absent from ours):
  - `#/ModPackPages/N/ModGroups/N/OptionList/N/IsChecked` — TexTools writes the option's checked state
    (`true` for the first option of a Single group, `false` otherwise, per the `Fantasia` / `Tight&Firm`
    goldens).
  - `#/ModPackPages/N/ModGroups/N/OptionList/N/ModsJsons/N/ModPackEntry` — TexTools writes
    `"ModPackEntry": null` on **every** mod json (1443 instances).
  - `#/SimpleModsList` — TexTools writes the key as an explicit `null` on a wizard pack; we omit it.
  - Option `Description`: TexTools writes `null` where we write `""` (25 packs,
    `#/OptionList/N/Description [mismatch]`).

- **`writeTtmp2` round-trips `ModsJsons[].Name`/`Category` where TexTools RE-DERIVES them from the game
  path.** `Fantasia.ttmp2`, `chara/bibo/midlander_d.tex`: ours keeps the source's
  `{"Name":"Body - c0201b0001_top","Category":"Body"}`; the golden writes
  `{"Name":"Unknown","Category":"Unknown"}` — TexTools recomputes both from the game path and yields
  `Unknown` for a path it cannot classify (`chara/bibo/…` is not a real game path). 10 packs
  (`ModsJsons/N/Name [mismatch]`), 5 packs (`…/Category [mismatch]`).

- **`writeTtmp2` emits an option's files in a different ORDER than TexTools.** `#/ModsJsons/N/FullPath
  [mismatch]` on 20 packs is (at least largely) an ordering difference, not a content one:
  `Tight&Firm-YorhaCollection-2B.ttmp2` option "Large" — our `ModsJsons[0]` is
  `chara/equipment/e0649/e0649_top.meta`, the golden's is
  `chara/equipment/e0649/material/v0001/mt_c0101e0649_top_a.mtrl`. Both lists have 13 entries. Worth
  confirming it is *only* order before fixing.

- **Our load-fix seam bumps `.mdl` to v6; TexTools' load does not — the v6 bump belongs to the UPGRADE
  caller.** 483 `.mdl` payload diffs across the TTMP corpus, and the single most interesting finding
  here. `normalizeModel` (`src/upgrade/model.ts`) hard-sets `model.mdlVersion = 6` — with the comment
  *"FixOldModel emits v6 (R1: caller-set, ShrinkRay.cs:108)"*, which already says the version is set by
  the **caller**, not by `FixOldModel`. On `/upgrade` that is exactly right; on `/resave` TexTools leaves
  the model at v5. **Evidence** (`Tight&Firm-YorhaCollection-2B.ttmp2`,
  `chara/equipment/e0649/model/c0101e0649_dwn.mdl`): source is 84376 bytes; all three normalized outputs
  are 56184 bytes; TexTools `/resave` = sha `4afb2e51a5bc`, TexTools `/upgrade` = sha `d1b66f709ede`,
  **ours (both paths) = sha `d1b66f709ede`** — i.e. *our `/upgrade` output is byte-identical to the
  `/upgrade` golden*. Diffing the two goldens against each other: 57 differing bytes out of 56184, and
  **byte 0 is `0x05` in `/resave` vs `0x06` in `/upgrade`** (the MDL version), the remaining 56 being the
  v5-vs-v6 bone-set encoding. So TexTools' *load* runs `FixOldModel` **without** the v6 bump, and
  `/upgrade` applies it afterwards. Our `applyLoadFixes` therefore over-reaches. Fix = move the v6 bump
  out of the load seam into the upgrade caller — and keep the `/upgrade` goldens byte-exact while doing it.

- **`.meta` reconstruction is a LOAD/WRITE behaviour in TexTools, but lives in our UPGRADE transform.**
  62 `.meta` payload diffs. TexTools' TTMP load turns a `.meta` file into typed metadata/manipulations
  and its writer turns them back into `.meta` bytes, so a pure `/resave` **grows** the file. Our
  `metadataRound` does the same reconstruction but sits inside `upgradeModpack`, so our `/resave` path
  leaves the source `.meta` untouched. **Evidence** (`Tight&Firm-YorhaCollection-2B.ttmp2`,
  `chara/equipment/e0649/e0649_dwn.meta`): source 182 bytes (sha `24db7b7fd262`); `/resave` golden 192
  bytes (sha `33423dcdfb29`); ours on the resave path = 182 bytes, **unchanged**; ours on the upgrade
  path = 192 bytes, sha `33423dcdfb29` — **byte-identical to the golden**. So `reconstructMeta` is
  *correct*; only its seam is wrong. Same shape as the `.mdl` finding above: decide whether
  `metadataRound` belongs in `applyLoadFixes`, and keep the `/upgrade` goldens byte-exact.

- **`/resave` empirically confirms the unported `FixOldTexData` offset fixup (T2 below).** The remaining
  `.tex` payload diffs are neither format nor dimension nor length changes: `Bloodlust - Bibo+.ttmp2`
  `v01_c0201e0256_top_m.tex` — ours and golden are both `fmt=0x3420 2048x2048 mips=12`, both 2796296
  bytes, and the **first differing byte is at offset 72**; `chained_collars_v1_1_0.ttmp2`
  `v01_c0101a0004_nek_d.tex` — both `16x16 mips=1`, both 208 bytes, first differing byte at **offset 20**.
  Both offsets fall inside the 80-byte `.tex` header, in the **LoD/mipmap offset tables**. That is
  precisely the `ValidateTexFileData` "fix up broken mip offsets" half of `FixOldTexData` that the T2 item
  records as unported. Cross-reference this evidence from T2.

- **PMP: TexTools re-serializes MANIPULATIONS from its typed model too — a third sub-symptom of the
  `writePmp` round-trip item.** Beyond the two predicted PMP classes (manifest regeneration and payload
  member renaming — both already recorded under *"`writePmp` round-trips the source pack where TexTools
  regenerates it"*), the oracle shows the option `Manipulations` arrays differ as well, because TexTools
  serializes its **typed** `Manipulation` objects while we re-emit the source JSON verbatim. **Evidence**
  (`Westlaketea's Constellation Crown (Dawntrail Edition).pmp`, `group_001_options.json`, first `Imc`
  manipulation): ours carries `Entry.AttributeAndSound: 1023`, the golden does not (it writes only
  `AttributeMask` + `SoundId`). Baseline pointer classes: `…/Manipulation/Entry/AttributeAndSound
  [removed]` and `…/Manipulation/ShiftedEntry [removed]` (ours-only keys TexTools' typed model has no
  field for), plus `…/Manipulation/SetId [mismatch]` (a **value** difference — not explained by field
  presence alone and worth investigating on its own). Fold into the `writePmp` regeneration work.

- **Make the ConsoleTools oracle async, so the cross-process lock can heartbeat.**
  `withConsoleToolsLock` (`test/helpers/oracle.ts`) is a hand-rolled filesystem mutex: atomic
  `O_EXCL` create, a random ownership token, and break-on-staleness after `LOCK_STALE_MS`. It has a
  documented residual race — breaking a "stale" lock is a *guess* that the holder died, so a live
  holder that overruns `staleMs` can have its lock taken, and its own release then races a
  successor's. Worst case is two concurrent ConsoleTools, which fails loudly (exit -1) and a re-run
  clears; the cache is content-addressed, so nothing wrong is persisted.

  **The proper fix is a heartbeat**, as `proper-lockfile` does it: rewrite the lock's mtime every
  `stale/2` ms so a live-but-slow holder is *never* judged stale (`onCompromised` when that fails).
  We cannot use it — or any heartbeat — today: the critical section is `execFileSync`, which blocks
  the event loop for the whole multi-minute ConsoleTools run, so no timer fires, and `proper-lockfile`
  with `stale` cranked to ~20min degrades to exactly what we already have.

  So: convert the oracle to async (`run`, `unwrapCached`, `upgradeGoldenCached`, `resaveGoldenCached`
  and their sync corpus call sites — Vitest supports async `it`), then adopt `proper-lockfile`
  (`lockSync`→`lock`, `mkdir` acquire, live heartbeat) and delete the hand-rolled lock. Operator's
  call, 2026-07-13: keep the hand-rolled lock for now, do this properly later — it is the better
  long-term shape. See the `withConsoleToolsLock` doc comment for the full reasoning.

- **Port IBM437 (CP437) zip entry-name decoding, matching `Ionic.Zip`.** `src/zip/zip.ts`'s
  `readZip` currently THROWS when a zip entry's UTF-8 general-purpose flag (bit 11) is unset and
  its raw name contains a byte >= 0x80, rather than silently decoding it: fflate's `unzipSync`
  falls back to latin1 for that case, but TexTools unzips via `Ionic.Zip` (`IOUtil.UnzipFiles`,
  `IOUtil.cs:625/654/669`), whose non-UTF-8 fallback is IBM437 — a different mapping above 0x7F, so
  we would otherwise silently resolve a different member name than TexTools does. Porting a real
  IBM437 decode table (256-entry byte→codepoint) would let these packs load, instead of failing
  loud. **No pack in the corpus currently trips the throw** (real corpus mods use ASCII or
  UTF-8-flagged names), so this is deferred until one does, or until we want to widen coverage
  proactively. See `src/zip/zip.ts`'s `findNonUtf8HighByteEntryNames` doc comment for the full
  reasoning, and the CRITICAL review finding that added the throw (PR for
  `feat/pmp-absent-file-tolerance`, 2026-07-12).

  **Empirically confirmed (2026-07-12), not just read from Ionic's docs.** Probe:
  `scripts/probes/probe-cp437-zip.ts` hand-assembles
  a PMP zip byte-for-byte (local file headers + central directory + EOCD, method 0/stored) with a
  payload entry named `[0x78, 0x81, 0x78]` (`'x'`, CP437 `0x81`, `'x'` -- CP437 decodes this to `"xüx"`;
  the same bytes under latin1, fflate's fallback, decode to a control char instead of `'ü'`) and the
  UTF-8 general-purpose flag bit CLEARED, alongside a `default_mod.json` whose `Files` map spells the
  game path's target as real UTF-8 `"xüx"` (`{"chara/test.file": "xüx"}`). Ran ConsoleTools `/resave`
  (pure load -> write, `Program.cs:191-221`) on it and inspected the output:
  - **Output `Files` map:** `{"chara/test.file": "default\\chara\\test.file"}` -- the key **survived**
    (a dropped/absent file would have removed it, per `PMP.cs:883-888`, the same signal
    `probe-resave-absent.ts` uses).
  - **Output zip members:** `default_mod.json`, `meta.json`, `default/chara/test.file` -- a payload
    member exists at the renamed path (`/resave` renames every payload entry, see the `writePmp`
    round-trip item below), and its bytes are the original `[0, 1, 2, 3]` payload verbatim (checked
    directly), not empty or zeroed.
  - **VERDICT: ConsoleTools RESOLVED the CP437-named member.** Ionic decoded the raw `0x81` byte as
    CP437 `'u with diaeresis'`, matched it against the `Files` value, and round-tripped the real payload.
  A control run (folded into the same script, `scripts/probes/probe-cp437-zip.ts`, same hand-rolled zip
  format, plain-ASCII entry name `"xyx"` instead of the CP437 byte) was necessary and used to validate the harness itself:
  the FIRST attempt used a `Files`/game-path key (`"some/random/path.file"`) that doesn't start with a
  recognized `XivDataFile` folder key, so `PMP.cs:752-770` (`CanImport`) silently dropped the file in
  BOTH the CP437 and the ASCII-control run -- a false negative unrelated to zip name decoding. Switching
  the game path to `"chara/test.file"` (a real `XivDataFile` prefix) made the ASCII control resolve
  correctly, confirming the zip-construction and harness were sound, and only then did the CP437 run
  above give the real answer. **This confirms the premise behind the fail-loud throw is correct**:
  Ionic really does fall back to CP437 (not latin1, not UTF-8, not a load error) for an unflagged
  high-byte name, so `readZip`'s divergence from that behaviour is real, and porting an IBM437 decode
  table remains the right fix once a pack needs it.

- **`modelRound` propagates a model-normalizer throw and kills the whole pack; TexTools drops just
  the file.** `src/upgrade/upgrade.ts` (`modelRound`) calls `requireBytes` + `normalizeModel`
  unguarded, so a throw from `normalizeModel` (an unported/unparseable model structure) propagates
  out of `upgradeModpack` and fails the entire `/upgrade`. TexTools does not fail the pack here:
  every caller of `FixOldModel` on the `/upgrade` path wraps it in
  `try { … } catch (Exception ex) { Trace.WriteLine(ex); continue; }` — `WizardData.cs:716-727`
  (the one `ModpackUpgrader.cs:58 -> WizardData.FromModpack` actually takes), and the same shape at
  `TTMP.cs:741-754` and `:1380-1393` — and the `continue` skips the `data.Files.Add` a few lines
  below (`WizardData.cs:729-737`), so the file is silently DROPPED from the option rather than
  killing the pack. Pre-existing (true before the absent-file-tolerance change; unrelated to it —
  an absent file can never reach `modelRound` at all, since absent files are PMP-only and this
  round is gated off for PMP by `needsMdlFix`/`DoesModpackNeedFix`, `TTMP.cs:916`). **Deliberate,
  not an oversight:** fail-loud here is what exposes an unported model structure as a loud failure
  during development instead of silently shipping a pack with a missing model — matching TexTools'
  *outcome* (dropping the file) would require catching the normalizer's throw and removing the file
  from the option, the same shape as `materialRound`'s per-file try/catch. Revisit once model
  normalization coverage is broad enough that a throw here is more likely a real unported case than
  a bug worth surfacing loudly.

- **Audit the port for TexTools bugs we already reproduce, and register them.**
  `docs/TEXTOOLS_BUGS.md` is the register of upstream **bugs** (null derefs, dead guards,
  non-terminating loops, lying exit codes) that we deliberately reproduce for byte-parity, or
  deliberately don't reach, or fail loud on instead. It was seeded from the PMP absent-file
  investigation plus a grep for existing `QUIRK` / `NRE` comments, so it is **not** exhaustive —
  it captures what was in reach, not what is there. Sweep `src/` (and the `reference/` C# it cites)
  for the rest and add an entry per finding. Candidates to adjudicate on the way through, all of
  which are currently only noted in code comments: the EQP set-0 omission
  (`src/meta/reconstruct.ts:190`, `ItemMetadata.cs:522-528`); the `PlayableRaces` vs
  `PlayableRacesWithNPCs` race-order disagreement (`src/meta/playable-races.ts:1`, `Eqp.cs:48-92`);
  `MakePMPPathSafe`'s platform-dependent `Path.GetInvalidFileNameChars()`
  (`src/container/pmp.ts:151`, `PMP.cs:1316-1326`). Each needs the bug-vs-quirk call the register's
  header describes — a faithfully transcribed SE oddity is a quirk and stays a code comment; only a
  genuine defect gets an entry. Useful both as a correctness audit (a reproduced bug we *think* we
  reproduce may not actually match) and as the shortlist of patches we could offer upstream.

- **`writePmp` round-trips the source pack where TexTools *regenerates* it.** TexTools' PMP writer
  never round-trips: it rebuilds the whole pack from its fully-defaulted typed model. Ours re-emits
  the source manifest verbatim (`data.meta.raw` / `o.raw`) and reuses the source zip names
  (`pmpPath`). Two confirmed sub-symptoms of the one root cause:
  1. **Manifest content** — *empirically confirmed* (2026-07-12, see below). TexTools serializes its
     typed model, so every initialized field is written: a `meta.json` that Penumbra wrote without
     `Image` comes back **with** `"Image": ""`, and `default_mod.json` comes back as
     `{"Version": 0, "Files": …, "FileSwaps": …, "Manipulations": …}` — the source's `Name` /
     `Description` **dropped**, a `Version` **added** (`PMP.cs:830-869`; `WizardData.cs:1496` even
     forces `FileVersion`). Ours keeps the source document verbatim.
  2. **Zip member names** — anticipated, still unconfirmed directly. `ResolveDuplicates`
     (`PmpExtensions.cs:534`) **renames every payload entry** to `<optionPrefix><gamePath>` —
     `optionPrefix` being the lowercased, path-safe group name (plus option name when the group has
     more than one option; `WizardData.cs:1362-1458`) — and content-dedups shared files into
     `common/{idx}/<filename>` (`:537-551`). The source names are never retained: `UnpackPmpOption`
     (`PMP.cs:1071-1102`) uses the `Files` value only to locate the unzipped temp file and keys its
     dict by *game path*.
  3. **Functional breakage whenever the texture round fires.** Same root cause — we round-trip the
     source `Files` map instead of regenerating it — but this one makes our output **broken**, not
     merely different: a generated index map / gear mask is written into the zip with no `Files` key
     naming it, and a regenerated hair normal/mask is left with a dangling key.
     **Promoted to its own item at the top of *Prioritized*** — see there for the detail. Fixing
     sub-symptom (1) here (regenerate the manifest from the model) would subsume it, but it can and
     should be fixed on its own first, because it is the half that ships broken mods.

  **Why the corpus is green anyway.** Penumbra already lays packs out as `<group>/<option>/<gamePath>`,
  so "regenerated" and "verbatim" coincide for (2); and every real pack that exhibits (1) predates
  the ratchet, so its `meta.json` / `default_mod.json` mismatch is **already sitting in its baseline**
  (e.g. `test/corpus/.upgrade-baseline/dec0279….json`, `bd7130d….json`). A **newly added** pack gets
  no such grandfathering and must match fully — which is how this surfaced.

  **How it surfaced, and the repro.** The absent-file work (spec
  `docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md` §4.2) tried to add a
  synthetic pack that both carries an absent `Files` entry and genuinely upgrades, so ConsoleTools
  would actually *write* it. ConsoleTools did write it, and the repro target matched **byte-for-byte**
  (`group_001_absent.json` — TexTools drops the absent key, we drop it identically). The pack still
  could not land, blocked solely by (1): `default_mod.json#0:mismatch, meta.json#0:mismatch`. The
  builder now lives at `scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts` —
  it is a single-option group named `Absent` holding a hand-built EW 256-entry-colorset `.mtrl` at
  `chara/equipment/e9999/…` plus an absent `Files` entry — but it is **not** registered in
  `build-all.ts` yet, since it cannot reach a clean 0-diff until this item is fixed. **Land it by
  adding `import "./build-synthetic-absent-file-upgraded";` to `build-all.ts` once this item is
  fixed** — it was the only thing blocking a clean 0-diff, so it should go green immediately, and it
  is the golden that pins both this fix and the absent-file drop on a real (non-noop) write.

  **Fixing it** means porting TexTools' regenerate-from-typed-model write: the `PMPMetaJson` /
  `PmpDefaultMod` Newtonsoft serialization shape for (1), and `ResolveDuplicates` + `MakeOptionPrefix`
  (with their dedup/`common/N` behaviour, incl. the zero-hash bug in `docs/TEXTOOLS_BUGS.md` §7) for
  (2). Nontrivial: it affects **every** genuinely-upgraded PMP, so expect ratchet baselines to move.
  Originally found while investigating whether ConsoleTools `/resave` could serve as a write-side
  round-trip oracle — it cannot, for exactly this reason.

- **PMP group with an unrecognized `Type` yields an empty group instead of failing loud.**
  `parsePmpGroup` (`src/container/manifest-types.ts`) defaults `Options` to `[]`, so a group whose
  `Type` is neither `Single`, `Multi` nor `Imc` (or is absent entirely) reads as a group with **no
  options** — its files silently vanish from the model, and `/upgrade` would emit a pack missing
  them. C# cannot produce that outcome: `PMPGroupJson.Options` is a virtual property that **throws**
  on the base class — `NotImplementedException($"Unimplemented PMP group type: {Type}")`
  (`PMP.cs:1407`) — and only the three known subtypes override it with a real `OptionData = new()`
  (`:1413` / `:1421` / `:1434`, selected by `JsonSubtypes` off `Type`, `:1383-1386`). So TexTools
  fails loudly where we quietly drop content, which inverts the port's fail-loud rule (a
  best-effort wrong output that the golden diff could miss, since an empty group also writes back
  empty). Pre-existing — the `?? []` predates the raw/parsed split and was carried through it
  unchanged, so this is not a regression.
  **To fix:** throw from `parsePmpGroup` when `Type` is not a known subtype, mirroring the C#
  message. **First check** what `JsonSubtypes` actually does with an unrecognized discriminator —
  it may throw at *deserialization* rather than reaching the base property, which would change the
  failure point (and whether `LoadPMP` can even load such a pack) — and scan the corpus for an
  unknown/absent `Type` before flipping it, or the ratchet will light up. Presumed latent (a pack
  that hit this would likely already show as missing files against its golden), but that scan has
  **not** been run — do it as step one rather than trusting this note.

- **Serial cache-warm entry point for the corpus.** A cold corpus (new corpus mods, rebuilt
  synthetics, a cleared `.upgrade-cache/`) still spawns ConsoleTools once per uncached entry across
  Vitest's parallel `forks` pool; `withConsoleToolsLock` (`test/helpers/oracle.ts`) now serializes
  those spawns so they succeed instead of failing together, but a full cold-corpus run still pays for
  each spawn's wait-in-queue serially. A dedicated entry point that warms the cache in one pass
  up front (outside the parallel test run) would let a newcomer populate a cold corpus faster.
  Harness convenience; no correctness impact on the port itself.

- **Expected-failure golden capability for the upgrade harness.** The golden harness models only
  two ConsoleTools `/upgrade` outcomes: a produced **pack** or a **noop** marker
  (`GoldenResult = { kind: "pack" } | { kind: "noop" }`, `test/helpers/upgrade-golden.ts:29-31`).
  It has **no way to represent (or cache) an input on which `/upgrade` is *expected to error***. When
  ConsoleTools returns `-1`, `execFileSync` throws inside `run()` in `test/helpers/oracle.ts`, the
  exception propagates out of `upgradeGoldenCached` uncaught, the test hard-fails, and nothing is
  cached — so every subsequent run re-spawns ConsoleTools and throws again. There is no "bless this as
  an expected failure" path (the ratchet baseline only covers known byte-diffs on a *produced* pack).
  If we ever want a corpus pack to assert "TexTools errors here and our port should error the same
  way," add: (1) a third `GoldenResult` kind (e.g. `{ kind: "error", … }`) capturing the failure, (2)
  a cached error-marker analogous to `<sha>.noop` so the outcome is content-addressed and not re-run,
  and (3) a bless path to record it. **Not needed today:** the only expected-failure case in flight is
  the `Mdl.cs:2822` vertex-buffer hard cap, which is covered by a synthetic unit test that drives the
  serializer directly (see `docs/superpowers/specs/2026-07-11-mdl-half-precision-fallback-design.md`
  §4.2-4.3) — the right vehicle regardless, since a ConsoleTools error can't be cached/blessed under
  the current harness anyway. Recorded so the capability is picked up deliberately if a real
  expected-failure corpus pack ever appears.

  **Update (2026-07-13): it has appeared — and it is now a RED test, not a hypothetical.** The `/resave`
  harness has exactly the same two-outcome limitation, and one corpus pack trips it:
  **`Milktruck Bust Scaling Tweaks v1.0.0.ttmp2`** (the only pack of 63 with no `/resave` golden;
  62/63 cached). ConsoleTools exits `-1` and `execFileSync` throws, so the unit hard-fails on every run
  and nothing is cached. The pack is 12 `.rgsp` files (racial scaling) and nothing else. The failure is
  in ConsoleTools' **write** path, and it is **environmental, not a defect in the pack or in our port**:

      System.Exception: CMP Format Changed - Unable to read all CMP data.
         at xivModdingFramework.General.DataContainers.CharaMakeParameterSet..ctor(Byte[] data)
         at xivModdingFramework.General.CMP.GetScalingParameter(...)
         at xivModdingFramework.Mods.FileTypes.PMP.PMP.ManipulationsToMetadata(...)
         at xivModdingFramework.Mods.WizardOptionEntry.ToModOption(...)      [...]
         at xivModdingFramework.Mods.WizardData.WriteModpack(...)
         at ConsoleTools.ConsoleTools.HandleResaveModpack(...)

  On write, TexTools converts each `.rgsp` into an RSP manipulation, which reads the **installed game's**
  `human.cmp`; this TexTools build does not recognize the current game's CMP layout and throws. `/upgrade`
  never hit it because `/upgrade` on this pack is a no-op — ConsoleTools writes nothing, so `WriteModpack`
  is never reached. **This is the real, general reason `/upgrade` can never see a whole class of write-side
  oracle failures**, not a one-off: `/upgrade` only reaches TexTools' writer when the transform actually
  changes something, so any pack whose upgrade happens to be a no-op gets a free pass on every defect in
  TexTools' own writer, this CMP crash included. `/resave` always writes, so it is the only oracle that can
  see this class at all.

  **Update (2026-07-13): the `/resave` half of this item is now DONE.** `resaveGoldenCached`
  (`test/helpers/resave-golden.ts`) gained a `ResaveGoldenResult = { kind: "pack"; bytes } | { kind: "error";
  message }` (mirroring `upgrade-golden.ts`'s `GoldenResult`), catches a `produce()` throw, and caches it as a
  content-addressed `<sha>.error` marker (analogous to `<sha>.noop`) so ConsoleTools is spawned at most once
  for this pack instead of throwing on every run. `registerResaveCheck` (`test/helpers/corpus-resave.ts`)
  treats `{ kind: "error" }` as neither pass nor generic skip: it `console.error`s a loud, explicit message
  naming the pack and the oracle's error text, then calls `ctx.skip(message)` so the test reports as
  **skipped with a note**, not green — the writer is explicitly UNVERIFIED for this pack, never silently
  treated as matching. Covered by a focused unit test (`test/helpers/resave-golden.test.ts`) exercising the
  `opts.produce` injection seam (no real ConsoleTools spawn). Scoped to `/resave` only, per the request that
  landed this.

  **The `/upgrade` half is still NOT done** — `upgradeGoldenCached` / `GoldenResult`
  (`test/helpers/upgrade-golden.ts:29-31`) remains two-outcome (`pack` | `noop`) with no `error` kind, so an
  `/upgrade` input on which ConsoleTools itself errors would still hard-fail every run uncached, exactly as
  described above. No corpus pack currently forces this on the `/upgrade` side (Milktruck's `/upgrade` is a
  no-op, so it never reaches `WriteModpack` there), so it remains deferred until one does — extend
  `upgrade-golden.ts` the same way (`{ kind: "error" }` + `<sha>.error` marker + loud skip in
  `corpus-upgrade.ts`) if/when it's needed.

- **v1 metadata support.** `src/meta/deserialize.ts` now throws on any `.meta` with
  `version !== 2` rather than silently mis-upgrading it. An empirical probe
  (`scripts/probes/probe-v1-meta.ts`: downgrade a real pack's v2 equipment meta to v1 --
  `version=1`, EST/GMP stripped -- run it through ConsoleTools `/upgrade`, inspect the golden)
  confirmed ConsoleTools cleanly upgrades v1 -> v2 by **injecting base-game data** the v1 meta
  lacks, per C#'s `dataVersion==1` default-injection branches:
  - `DeserializeEstData` (`ItemMetadata.cs:823-826`) defaults a missing EST segment to
    `Est.GetExtraSkeletonEntries(root)` -- the est-table (`src/meta/reference/est-table.ts`)
    already supports computing this, so EST injection is portable today.
  - `DeserializeGmpData` (`ItemMetadata.cs:851-855`) defaults a missing GMP segment to
    `GetGimmickParameter(root, true)` -- this needs a **new per-item base-game GMP reference
    table + extraction**, which round 5 deliberately skipped (Task 6 extracted IMC/EST but not
    GMP). Without it, a v1 upgrade can't be reproduced faithfully.
  Extinct in the wild (0 v1 metas across 1431 real corpus `.meta`s), so deferred behind the
  fail-loud guard in `deserialize.ts` rather than ported. Re-run the probe script (still present,
  not wired into the harness) to re-verify against a fresh ConsoleTools build if this is ever
  picked up. `src/meta/serialize.ts` always writes version `2` on output regardless of input
  version (`ItemMetadata.Serialize`, `ItemMetadata.cs:509`), so this is purely a read-side gap.

- **NonSet (weapon/monster/demihuman) IMC reference table.** `src/meta/reference/imc-table.ts`
  (`scripts/extract-meta-reference.ts`) is now **exhaustive over base-game equipment/accessory** —
  it extracts every `(item, slot)` root in the framework's `item_sets.db` `roots` table (~1555
  items / ~7775 keys), so `reconstructMeta`'s IMC step (`src/meta/reconstruct.ts`) covers every
  base-game equipment/accessory item, not just corpus-referenced ones. What remains: `IMC_TABLE`
  is **Set-only**. NonSet items — weapon/monster/demihuman — use a different on-disk `.imc` shape
  (`Imc.cs` `ImcType.NonSet`, a 1-entry default + 1-entry subsets vs Set's 5-slot subsets), so they
  are never extracted, and weapon/monster `.meta`s take the pass-through branch (verified byte-exact
  on the corpus, ratchet-guarded). `parseMetaRoot` recognizes weapon/monster roots (Task 8b) only to
  produce a lookup key that misses `IMC_TABLE`. A general tool wanting NonSet IMC growth needs: (1) a
  NonSet `.imc` parser (the current `parseImcFile` handles only `ImcType.Set`), (2) its own NonSet
  extraction pass over the `weapon`/`monster`/`demihuman` `item_sets.db` roots, and (3) the NonSet
  column selection in `reconstructMeta`. Until then a NonSet meta that *would* grow its IMC silently
  passes through — no corpus pack exercises this, so the ratchet would flag it if a real one did.
  (Note: an equipment/accessory item genuinely absent from the exhaustive table — e.g. added to the
  game after the last `imc-table.ts` regen — now **fails loud** in `reconstructMeta`, signalling
  "regenerate the table", not a silent wrong output.)

- **EQDP reconstruction drops mod rows for non-playable races (latent).** `reconstructMeta`'s EQDP
  step (`src/meta/reconstruct.ts`, round 5) emits exactly the 18 `Eqp.PlayableRaces` in canonical
  order (mod value or 0). C#'s `DeserializeEqdpData` (`ItemMetadata.cs:773-788`) instead keeps
  *every* race the mod file carries and then backfills the missing playable races — so a mod EQDP
  row for a **non-playable** race would be preserved by C# but is silently dropped by our port.
  Unreachable today: game EQDP files are playable-race-scoped, so no real `.meta` carries a
  non-playable EQDP row (flagged in the round-5 final review as a latent fail-loud/fidelity
  asymmetry, unlike the EST/IMC out-of-range cases which were made to throw). Revisit only if a real
  pack ever exercises it; the honest fix is to keep the mod's extra rows (matching C#) rather than
  drop or throw.

- **M1/M2 — empty-sampler placeholder serialization (audit Theme D).** Reproduce, byte-for-byte,
  C#'s quirk where `XivMtrlToUncompressedMtrl` lowercases texture paths (`Mtrl.cs:560`) before its
  UPPERCASE `StartsWith(EmptySamplerPrefix)` exclusion checks, so placeholders are written as
  ordinary textures. `src/mtrl/serialize.ts` currently throws on any empty-sampler placeholder.
  Reproduction also requires matching C#'s placeholder path (`_empty_sampler_` + lowercased
  ESamplerId *name*, whereas `parse.ts` uses the numeric raw id). Needs an authored synthetic
  modpack with an orphan sampler to pin the golden bytes before implementing. Latent (0 unstable on
  the current corpus).
- **F6 — "real data in padding" throw (audit Theme A).** `src/sqpack/blocks.ts` `readBlock`
  omits C#'s `readBlockPadding` throw (`Dat.cs:2400-2405`) because that throw is gated on
  whole-`.dat` context (`lastInFile && i != blockCount - 1`) our single-file block reader does
  not carry. Documented as a code comment rather than ported, since a partial reproduction would
  risk over-throwing on legitimately-tolerated padding. Revisit if we ever thread archive-level
  read context (which file/block is last) into the block loop. Malformed-input-only + latent.

- **T2 — full `FixOldTexData` load-time round (only the drop-malformed subset is ported).** The
  texture round (round 4) surfaced that TexTools runs every `.tex` in an old pack (TTMP major < 2,
  or exactly 2.0) through `FixOldTexData` at **load** time (`TTMP.cs:1413-1460`, called from
  `MakeFileStorageInformationDictionary` `TTMP.cs:1367-1379`), gated by `DoesModpackNeedFix`
  (`TTMP.cs:916-930`). We ported **only the drop-on-decode-failure slice** (`src/upgrade/texfix.ts`
  `needsTexFix` + `texFixRound`, mirroring the `try { FixOldTexData } catch { continue }` that drops
  malformed placeholder textures — the fix for the 8 `hd_bunny_sluts` index regressions). The
  **remaining** `FixOldTexData` behaviour is unported: (1) `ValidateTexFileData`
  (`EndwalkerUpgrade.cs:2100`) — resize a NPOT texture that has >1 mip up to power-of-two (needs the
  **ImageSharp Bicubic resampler**, still deferred — same dependency as the texture round's resize
  gap), and fix up broken mip offsets; (2) the **unconditional recompress** of every kept `.tex` via
  `Tex.CompressTexFile` (`TTMP.cs:1436`). The recompress is invisible to our golden harness (it
  compares decompressed content, and recompression preserves it), so it is low-priority; the
  NPOT-resize *does* change decompressed content and would show as a golden diff if any old-pack
  corpus texture is NPOT-with-mips. This is a load-time round analogous to the model round's
  `FixOldModel`; scope it as its own spec→plan when the resampler lands or a corpus pack demands the
  resize. No corpus coverage forces it today (the ratchet will flag it if a real pack does).

  **Update (2026-07-13): the `/resave` write-side oracle now forces the *mip-offset-fixup* half.** It is
  no longer coverage-free: the `.tex` payload diffs in the `/resave` baselines are exactly this. Same
  format, same dimensions, same mip count, same total length — only the LoD/mipmap **offset tables**
  inside the 80-byte header differ (`Bloodlust - Bibo+.ttmp2` `v01_c0201e0256_top_m.tex`, first differing
  byte at offset 72; `chained_collars_v1_1_0.ttmp2` `v01_c0101a0004_nek_d.tex`, at offset 20). The
  offset fixup needs no resampler, so it can be ported independently of the NPOT-resize half (and of T3).
  See the `/resave` findings section above.

- **T3 — ImageSharp Bicubic/NearestNeighbor resampler (texture-round resize skips + T2).** The
  texture round throws `TextureResizeUnsupported` (caught → skipped, baselined) whenever a
  generation source is non-power-of-two (`CreateIndexFromNormal` `:1098`, `UpgradeMaskTex` `:2088`)
  or a hair normal/mask pair differs in size (`ResizeImages`, `:1205`). C# resizes via ImageSharp
  (Bicubic, or NearestNeighbor for the pow2 pre-step). **Real corpus case:** `Misty_Hairstyle_Female.ttmp2`
  hits the hair size-mismatch branch twice (normal 4096² vs mask 1024², c0101/c0201 h0170) — currently
  baselined skips. **No NPOT source exists anywhere in the ~940-pack scan**, so the NPOT branch has zero
  real coverage (synthetic-only when built). Porting an ImageSharp-faithful Bicubic resampler is the
  shared dependency for these skips AND T2's `ValidateTexFileData` NPOT-resize; byte-parity against
  ImageSharp's float math may be machine-dependent (see texture-round spec §4.4) — likely needs a
  scoped per-pixel-threshold `DIVERGENCE_RULES` entry for resized outputs. Own spec→plan.

- **T4 — `index-path-overrides` table missing `chara/equipment/e0208` (and likely other) base-game
  entries.** `The_Final_Requiem_veil.ttmp2` overwrites base-game e0208 materials; the golden's index
  path uses the canonical override (`EndwalkerUpgrade.cs:923-936`) but `src/upgrade/reference/index-path-overrides.ts`
  has no e0208 c0101 entry, so we emit at the convention path (golden has `_met_id.tex` we don't →
  `#0:added`) and the two e0208 `.mtrl` mismatch. The index generation itself is byte-exact once pointed
  at the right path (triage-confirmed). Fix mechanically by re-running `scripts/extract-index-overrides.ts`
  against a game install to widen the table; the ratchet baselines the gap until then.

- **Vet page-load and upgrade-operation performance once a working webpage exists.** The
  library is consumed client-side, but there is no real page to profile yet. When one lands,
  measure the two things that matter to a user: (1) **initial page load** — JS parse/eval and
  time-to-interactive, and (2) the **upgrade operation itself** — wall-clock and peak memory of
  running `upgradeModpack` over representative packs. Profile the real app on real hardware
  (include a low-end/mobile-class device), find where the time and bytes actually go, and only
  then decide whether anything is worth optimizing. Keep the investigation unbiased — do not
  presume a culprit. One incidental data point already gathered (2026-07-11): the current lib
  build is `dist/index.js` 1,568 KB raw / 111 KB gzip, of which the two generated base-game
  reference tables (`src/meta/reference/imc-table.ts`, `est-table.ts`) are ~90% of the raw bytes
  but only ~62% of the gzip (they're highly repetitive, so gzip/brotli crush them). That suggests
  wire size is already small and any real cost is more likely eager parse/eval or the upgrade
  compute path — but treat that as a hypothesis to test, not a conclusion, and let the profiler
  point at whatever is actually hot. Housekeeping / perf; no correctness impact.

- **Audit temp-dir usage for leaks (`mkdtemp` cleanup).** Several helpers create OS temp working
  directories via `mkdtempSync(join(tmpdir(), …))` but never remove the *directory* (only inner
  files), so they accumulate across runs. The worst offenders run on **every `npm test`**:
  `ORACLE_TMP` in `test/helpers/oracle.ts` (`oracle-*`, a per-worker module singleton, never rm'd)
  and `test/helpers/upgrade-golden.ts:49` (`upgrade-*`, `UPGRADE_TMP`, never rm'd) — these left the
  stale `oracle-*`/`upgrade-*` dirs found on 2026-07-10. Occasional offenders: `scripts/extract-index-overrides.ts:87`
  (`idxover-*`) and `scripts/extract-shader-params.ts:26` (`shparam-*`) (manual runs), and the test
  files `test/oracle-cache.test.ts` (`oc-*`) / `test/upgrade-harness.test.ts` (`ug-*`/`ub-*`).
  **Good examples to follow:** `test/sqpack/fixtures/regen.ts:64` and `test/tex/fixtures/bcn/regen.ts:431`
  both `rmSync(tmp, { recursive: true, force: true })` when done. Fix: give each `mkdtemp` site a
  guaranteed cleanup (try/finally, `afterAll`, or a `process.on("exit")` unlink for the singleton
  harness dirs), and consider a lint/grep guard so new `mkdtemp` calls without a paired removal are
  caught. Note `sweepStaleTemps` in `test/helpers/oracle.ts` already sweeps stale `.tmp` files in its
  *cache* dir — extend
  that discipline to the mkdtemp working dirs. Housekeeping; no correctness impact.
