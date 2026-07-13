# PMP writer: regenerate from the model (and the write-side oracle that proves it)

Status: implemented (2026-07-13). Supersedes the round-trip half of `writePmp`, closes the top `docs/BACKLOG.md`
item (the generated texture with no `Files` key) and the "`writePmp` round-trips the source
pack where TexTools *regenerates* it" item, and adds the write-side AB test the harness has
never had.

## 1. Problem

Two problems, one root cause.

**The shipping defect.** `writeGeneratedTex` (`src/upgrade/texture.ts:122`) builds its
replacement `ModpackFile` with **no `pmpPath`**, while `optionToJson`
(`src/container/pmp.ts:284`) re-emits the source option's `Files` map **verbatim** and
`writePmp`'s payload loop writes each file at `f.pmpPath ?? f.gamePath`. So whenever the
texture round fires on a PMP:

- a **generated** file (index map, gear mask — new to the option) gets a zip member at its
  `gamePath` with **no `Files` key naming it**. Penumbra cannot find it; the upgrade is a
  no-op from the mod's point of view.
- an **in-place regenerated** file (hair normal/mask) **loses its `pmpPath`**, so its member
  is written at `gamePath` while the retained `Files` value still names the *original* zip
  path — which no longer has a member. A dangling key plus an orphan member.

This is not a byte-parity nit: **the packs we emit are broken.** It is live on three real
corpus packs — `Westlaketea's Constellation Crown`, `[Jaque] Marcellus`, and
`[Jaque] Romeo & Juliet` (the last one: 18 orphan `_id.tex` members).

**The root cause.** TexTools' PMP writer never round-trips. It rebuilds the whole pack from
its fully-defaulted typed model: zip member names, the `Files` map, and the manifest
documents are all *regenerated*. Ours re-emits the source manifest (`data.meta.raw` / `o.raw`)
and reuses the source zip names (`pmpPath`). Because we carry the source `Files` map through
as an immutable artifact, any file the pipeline **adds or repoints** is unnameable — which is
exactly the bug above. TexTools cannot hit it, because it has no carried-through map to go
stale.

## 2. Why no test caught it

Four distinct blind spots, each worth fixing on its own merits.

1. **The payload diff compares the in-memory model, not the artifact.**
   `corpus-upgrade.ts:46` feeds `oursModel` — straight out of `upgradeModpack` — into
   `diffUpgrade`. The generated texture is present and byte-correct *there*. `writeModpack`
   runs one line earlier, but its output only reaches `diffArchives`. **Nothing ever re-reads
   our own archive as a modpack**, so every writer bug is invisible to the payload diff by
   construction.

2. **The ratchet's manifest granularity is a document, not a difference.** `diffArchives`
   deep-equals each manifest JSON and emits one `mismatch` token per document. All three
   affected packs already carry `default_mod.json#0:mismatch` / `group_00N…#0:mismatch` in
   their baselines (from the unrelated manifest-regeneration gap). A missing `Files` key
   inside an already-known-mismatched document therefore adds nothing the ratchet can see.
   **One accepted diff blinds the ratchet to every future difference in that document.**

3. **Payload member names are compared only on the no-op branch** (`checkPayloadMembers`,
   `upgrade-archive-diff.ts:272`) — and a pack whose texture round fires is by definition not
   a no-op. The one check that could see an orphan member is switched off exactly where it
   fires. It is switched off *because* of the round-trip naming divergence this spec removes.

4. **There is no write-side oracle.** `oracle.ts:130` already exposes `resave()` — and
   nothing in the suite calls it. The harness oracles the *transform* only; on the no-op
   branch it treats our own writer as ground truth by comparing against the input archive. The
   writer has never been AB-tested against TexTools.

(3) and (4) are both blocked by the same round-trip writer. Porting the regeneration does not
just fix the bug — it is what lets these checks be turned on.

## 3. What TexTools does (the spec)

`/resave` is `WizardData.FromModpack(src)` → `data.WriteModpack(dest, true)`
(`Program.cs:191-221`) — the **same load path** `/upgrade` takes
(`ModpackUpgrader.cs:58 → WizardData.FromModpack`), minus the transform. So the write side of
`/upgrade` and the whole of `/resave` are the same code, and `/resave` is a pure writer oracle.

**Load (for context, already ported).** `WizardData.cs:818` calls
`UnpackPmpOption(o, null, unzipPath, **false**)` — `mergeManipulations = false`. TexTools does
**not** materialize `.meta` from a PMP's `Manipulations` on this path; it carries them through
as `OtherManipulations` and writes them straight back. Our opaque `manipulations` carry-through
is therefore faithful, and `readPmp` is correct to hold no `.meta` files for a PMP source.
(The `mergeManipulations = true` branch, `PMP.cs:1141-1205`, is the *import* path. Out of scope.)

**Write.**

| Step | C# |
|---|---|
| Option folder prefix from group/option *names* (`pagePrefix + safeGroup + "/" [+ safeOption + "/"]`, with the count/uniqueness rules) | `MakePagePrefix`/`MakeGroupPrefix`/`MakeOptionPrefix`, `WizardData.cs:1362-1458` |
| `pmpPath = OptionPrefix + gamePath`, then content-dedup: a repeat SHA1 moves the shared file to `common/{idx}/{filename}` | `ResolveDuplicates`, `PmpExtensions.cs:476-566` |
| Payload write + `opt.Files.Add(fi.Path, fi.PmpPath.Replace("/", "\\"))`; a file whose payload does not exist is dropped from *both*; a `.meta`/`.rgsp` becomes `Manipulations` instead of a member | `PopulatePmpStandardOption`, `PMP.cs:871-928` |
| `.meta` → manipulation JSON; `.rgsp` → manipulation JSON — **deliberately NOT ported**, see §4.2 | `MetadataToManipulations` / `RgspToManipulations`, `PmpExtensions.cs:417` |
| Manifests serialized from the typed model — every initialized field written; `default_mod.json` gets `Version` and loses `Name`/`Description` (`ShouldSerialize*` on `IsDataContainerOnly`, `PMP.cs:1496-1501`); `meta.json` always carries `Image` | `PMP.WritePmp`, `PMP.cs:830-869`; `WizardData.WritePmp`, `WizardData.cs:1460-1560` |
| Blank group or option name → `InvalidDataException` | `WizardData.cs:1520-1523` |

**Output format follows the source, by default.** `WriteModpack` (`WizardData.cs:1312-1326`)
dispatches purely on the destination *extension* — `.pmp` → `WritePmp`, `.ttmp2` →
`WriteWizardPack` — and `/upgrade` calls the same method (`ModpackUpgrader.cs:218`), so format
is the caller's choice, not a property of the operation. What the caller chooses:
the GUI upgrade handler (`MainWindow.xaml.cs`) reuses the source extension
(`ext = Path.GetExtension(path)`, falling back to the `Default_Modpack_Format` setting only for
an extensionless source — a Penumbra folder), naming the output `<name>_dt<ext>`. So a `.ttmp2`
upgrades to a `.ttmp2` and a `.pmp` to a `.pmp`, which is exactly what our harness does
(`target` from the source extension). **Format conversion is not an upgrade flow**, and that is
what makes `.meta` on the PMP write path unreachable (§4.2).

Two behaviours worth naming because they surprised us:

- **Dedup is global across options.** In `[Jaque] Romeo & Juliet` one `common/1/…` member is
  shared by 9 game paths *in two different options*. Our model duplicates the bytes per file;
  the writer must re-derive the sharing from content, not from the source layout.
- **`ResolveDuplicates` has a known zero-hash bug** for absent files
  (`PmpExtensions.cs:509-514` inserts a default `SHA1HashKey()`), already registered in
  `docs/TEXTOOLS_BUGS.md` §8. Reproduce it; do not fix it.

## 4. The fix

### 4.1 Parity bar

**Payload members: byte-equal. Manifest JSONs: semantic deep-equal.** JSON is standardized
enough that serializer quirks (property order, indentation) are not a fidelity question — the
parsed objects must be deep-equal, and that is what `diffArchives` already asserts. Note this
does *not* excuse value spelling: `Files` values are backslashed strings
(`PMP.cs:914`), and a forward-slashed value is a different value, not different formatting.

### 4.2 Writer

`writePmp` stops reading `pmpPath` and `o.raw`/`data.meta.raw` for payload naming and for the
`Files` map, and instead:

1. computes each option's prefix (port of the three `Make*Prefix` functions — new module,
   e.g. `src/container/option-prefix.ts`, citing `WizardData.cs:1362-1458`);
2. assigns `pmpPath = prefix + gamePath` for every file, then content-dedups into
   `common/{idx}/…` (port of `ResolveDuplicates` — e.g. `src/container/resolve-duplicates.ts`);
3. emits each option's `Files` map from the model, dropping absent files (the existing
   `PMP.cs:883-888` drop, now a natural consequence rather than a manifest carve-out);
4. **throws** on a `.meta`/`.rgsp` file, citing `PMP.cs:891-900` +
   `PmpExtensions.cs:417` as unported. A `.meta` can only reach the PMP writer from a
   **TTMP-sourced** model (a PMP-sourced one holds none — see §3's `mergeManipulations = false`),
   i.e. only via a TTMP→PMP conversion, and no upgrade flow performs one. Porting the conversion
   would mean porting the whole manipulation-serialization surface for a path nothing exercises.
   Backlog it, noting that `/resave x.ttmp2 → y.pmp` is the golden waiting for it if format
   conversion ever becomes a product feature;
5. regenerates `meta.json` / `default_mod.json` / `group_NNN_*.json` from the model.

`o.raw` / `g.raw` / `meta.raw` remain the carriers for fields the model does not type
(`Imc` group extras, `DefaultPreferredItems`, …) — regeneration means *the writer owns the
fields TexTools' typed model owns*, not that we discard everything else.

`writeGeneratedTex`'s missing `pmpPath` then cannot break anything: nothing reads `pmpPath` at
write time any more. The field stays on the model as the **source** zip path (the reader needs
it for the `ExtraFiles` referenced-set, `PMP.cs:213-215`), but it is no longer an output.

### 4.3 Harness

| # | Change | Closes |
|---|---|---|
| A | `diffUpgrade` consumes `loadModpack(name, oursArchive)` — the artifact we ship, not the in-memory model | §2.1 |
| B | New `/resave` **write-side oracle** check per corpus pack — `writeModpack(loadAndFix(pack), sourceFormat)` vs `ConsoleTools /resave pack out.<same ext>`, same content-addressed cache + ratchet. Covers **both** formats (see §4.3.1): PMP→PMP pins `writePmp`, TTMP2→TTMP2 pins `writeTtmp2` across ~50 corpus packs. Neither writer has ever been AB-tested | §2.4 |
| C | `checkPayloadMembers` on unconditionally for PMP. A member name *is* `optionPrefix + gamePath`, so this also catches a file landing in the **wrong option** — which `diffUpgrade`'s gamePath-keyed multiset flattens away | §2.3 |
| D | Manifest diffs keyed **per difference** (JSON pointer, e.g. `default_mod.json#/Files/chara~1…`) instead of per document, so a blessed diff cannot blind the ratchet to the rest of the document | §2.2 |
| E | Self-consistency invariant on our own output: re-read the written PMP and assert no `Files` key resolves to nothing, and no payload member is orphaned — i.e. every member is either named by an option's `Files`/`Image` or was already an `ExtraFile` of the source (`PMP.cs:213-215`). No oracle needed; fails closed where no golden exists | belt-and-braces for §2.1 |

**A alone would have caught this bug**: the orphan member re-reads as an `ExtraFile`, so its
`gamePath` vanishes from our multiset and shows as `added` against the golden.

### 4.3.1 The load-fix seam that B needs

`/resave` is *load + write*, and TexTools' load is not inert: for an old pack
(`DoesModpackNeedFix`, `TTMP.cs:916`) it runs every `.mdl` through `FixOldModel`
(`WizardData.cs:716-727`) and every `.tex` through `FixOldTexData`
(`TTMP.cs:1367-1379/1413-1460`) **at load time**. Our equivalents — `modelRound` and
`texFixRound` — live *inside* `upgradeModpack`, so `writeModpack(loadModpack(x))` is not the
same thing as TexTools' resave and would diff spuriously on every old TTMP.

Fix by naming the seam TexTools already has: export `applyLoadFixes(data)` (`texFixRound` +
`modelRound`, gated by `needsMdlFix` exactly as today), called by `upgradeModpack` first — as it
effectively is now — and by the resave check. Net behaviour of `upgradeModpack` is unchanged;
`loadModpack` stays pure (other corpus checks depend on it returning the pack's real bytes).
This is a **fidelity improvement in its own right**: our current structure blends TexTools'
load-time fixes into the upgrade transform, and this un-blends them.

**Correction (2026-07-13, Task 8 review): this is false.** `texFixRound`/`modelRound` are
TTMP-gated (`DoesModpackNeedFix`, `TTMP.cs:916`), but PMP has its OWN load-time `.tex` fixup:
`ResolvePMPBasePath` runs every unzipped `.tex` through `EndwalkerUpgrade.FastValidateTexFile`
right after unzip (`PMP.cs:86`), and `UnpackPmpOption` runs it again per-file when not already
unzipped (`PMP.cs:1084-1091`). `FastValidateTexFile` (`EndwalkerUpgrade.cs:2132-2165`) both fixes
broken mip offsets (`FixUpBrokenMipOffsets`) and truncates trailing null padding ("Textools would
repeatedly add 80 null bytes to the end of textures", `EndwalkerUpgrade.cs:2149-2165`) — unrelated
to, and NOT covered by, `texFixRound`'s `FixOldTexData`. Confirmed by the `/resave` oracle itself:
`[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp`'s one remaining residual after the writer port
(§4.2) is a payload **length** mismatch on `common/24/…id.tex` — this fixup's signature (a length
diff), not `FixOldTexData`'s (same-length, differing header bytes). **Consequence: `applyLoadFixes`
is missing a PMP branch.** The PMP half of B is therefore NOT a clean writer oracle — it has an
unported load-time seam of its own, tracked in `docs/BACKLOG.md` ("PMP load-time `.tex` fixup
(`FastValidateTexFile`) is unported"). Not fixed as part of this spec/plan; recorded here so the
claim this paragraph used to make doesn't stand uncorrected.

### 4.4 Sequencing

Harness first, so each new check is *seen failing on the bug it exists to catch* (AGENTS.md:
"a found divergence is a test-coverage gap too").

0. **ConsoleTools mutex** (existing backlog item) — B multiplies cold-cache spawns, and the
   concurrency failure reads as a spurious hard failure. Prerequisite, not optional.
1. **Harness (A, D, E, and B — oracle + the §4.3.1 load-fix seam)**, with baselines blessed to
   today's — broken — state. The defect now shows as red diffs the harness can actually see;
   record what they are. The TTMP half of B lands here too, and whatever it finds about
   `writeTtmp2` gets blessed and filed, not fixed here.
2. **Writer port** (§4.2). Those diffs go green. Re-bless: every PMP baseline moves, most of
   them *toward* zero.
3. **C** on, once names regenerate the TexTools way.
4. Land `scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts` (register it in
   `build-all.ts`) — it was blocked solely by the manifest-regeneration gap this closes.

## 5. Divergences and open risks

- **`common/{idx}` numbering** depends on C#'s `Dictionary` enumeration order (insertion order
  in practice — no removals). We must build the same insertion order: page → group → option,
  then each option's `Files` order. The `/resave` oracle adjudicates this; it is not something
  to settle by reading.
- **`meta.json`'s `Image`** goes through `WizardHelpers.WriteImage` (`WizardData.cs:1497`),
  which may rewrite the image into the pack under a new name. Pin against `/resave`; do not
  guess.
- **`.rgsp` support** needs `RacialGenderScalingParameter` + `CMP.GetRgspPath`, neither ported.
  Step one of the plan is to scan the corpus for a `.rgsp`; if none exists, fail loud on it and
  backlog the conversion rather than port it blind (there would be no golden to pin it).
- **Which of our rounds are load-time in C#** is settled for two of them and open for a third.
  `texFixRound` and `modelRound` are load-time (cited in §4.3.1). `metadataRound` is assumed to
  be upgrade-time and therefore *excluded* from `applyLoadFixes` — but if TexTools in fact
  reconstructs `.meta` at load, `/resave` will show it, and the resave check will go red on
  every pack with a `.meta`. **Do not settle this by reading; let the first resave golden say so**
  and move `metadataRound` into the seam if it does.
- **`writeTtmp2` has never been oracled either.** The TTMP half of B is expected to surface its
  own divergences (`ModOffset`/`ModSize` blob layout is already known and normalized away in
  `upgrade-archive-diff.ts:26`; anything else is new information). Those are *findings*, not
  blockers — bless them into the baseline, file what they are, and keep them out of this
  change's critical path.
- **Ratchet churn** across every PMP is expected, and is the point.
- **ConsoleTools concurrency**: B roughly doubles the oracle commands, so a cold cache spawns
  many more ConsoleTools. The known "ConsoleTools is not safe to run concurrently" backlog item
  bites much harder here — its cross-process mutex is now a **prerequisite**, not a nicety, and
  should be step zero of the plan.

## 6. Out of scope

- **`.meta`/`.rgsp` → `Manipulations` on the PMP write path** (`PMP.cs:891-900`,
  `PmpExtensions.cs:417`): fail loud, backlog. Unreachable without a TTMP→PMP conversion, and no
  upgrade flow performs one (§3). `/resave x.ttmp2 → y.pmp` is the golden if we ever want it.
- The `mergeManipulations = true` import path (`PMP.cs:1141-1205`).
- The remaining `docs/BACKLOG.md` texture-round gaps (T2/T3/T4), the partials round, and everything
  else that is about the *transform* rather than the writer.

## 7. What actually happened

The plan (`docs/superpowers/plans/2026-07-12-pmp-writer-regeneration.md`, now deleted per
AGENTS.md) executed close to this spec's shape, but the oracle contradicted several things this
document asserted or left open. Recorded here because the plan is gone and this spec is what
survives.

- **The page-prefix question (§5, "which of our rounds are load-time") was answered wrong at
  first, then corrected.** The plan's Fact 7 (and an early pass of this spec) claimed
  `FromPMP`'s page-index bug (`WizardData.cs:1152-1157`: a group meant for page 0 lands on the
  synthesized Default page instead of its own, now-empty page) leaves that empty page *alive* in
  `DataPages`, so `pN/` prefixing switches on pack-wide whenever a real page and a `Default` page
  coexist. **False.** `ClearNulls` also prunes any page with no groups carrying data
  (`WizardData.cs:1240-1244`), unconditionally — not gated on the GUI import wizard the plan
  assumed — and it runs on the headless `/upgrade`/`/resave` path too. So in the common
  single-real-page case the empty page never survives to influence `DataPages.Count`, and there
  is no `pN/` prefix at all. The bug's only surviving, observable effect is that the misrouted
  page-0 group's content merges onto the Default page's own folder instead of getting a page
  folder of its own. Ported faithfully in `src/container/option-prefix.ts` (see its header
  comment and `docs/TEXTOOLS_BUGS.md` #1/#6) — the fix was catching our own misreading, not a
  divergence in TexTools.
- **`Manipulations` re-serialization was not predicted by this spec at all.** §4.2 only mentions
  `Files`/`FileSwaps` regeneration; it says nothing about manipulations needing their own pass.
  The `/resave` oracle found otherwise: TexTools re-serializes manipulations from its typed
  model too, so a source document's `Entry.AttributeAndSound` (IMC) and `ShiftedEntry` (EQDP) —
  both `[JsonIgnore]` on the C# types (`PmpManipulation.cs:318`, `:435-473`) and therefore
  dropped by any real typed round-trip — survived in our re-emitted-from-source output and had to
  be stripped. A second, unrelated mismatch (a `SetId` value, not a field's presence) turned out
  to be Newtonsoft's numeric-string coercion: a source `"SetId": "295"` (JSON string) on an
  Eqp/Eqdp manipulation deserializes fine into the typed `uint SetId` and re-serializes as the
  JSON *number* `295`. Both are ported in `src/container/pmp-manipulation.ts`
  (`normalizeManipulations`) — see that module's doc comment for the reasoning and the residual
  risk.
- **The `metadataRound` seam question (§5) was answered: no, it does not move.** The spec
  explicitly deferred this to the first `/resave` golden rather than guessing. The answer: our
  `/resave` path leaves a source `.meta` byte-for-byte untouched (182 bytes on the
  `Tight&Firm-YorhaCollection-2B.ttmp2` evidence pack), while ConsoleTools' `/resave` grows it to
  192 bytes — i.e. TexTools' TTMP load/write pair *does* reconstruct `.meta` on a pure resave,
  which would argue for `metadataRound` living in `applyLoadFixes` alongside `texFixRound`/
  `modelRound`. It was deliberately **not** moved: our `/upgrade` output is already
  byte-identical to the `/upgrade` golden for `.meta` (`reconstructMeta` itself is correct; only
  its seam differs from TexTools'), so moving it risks the `/upgrade` goldens for no `/upgrade`-side
  benefit, purely to make `/resave` prettier. Left as a filed, open finding — see docs/BACKLOG.md's
  "`.meta` reconstruction is a LOAD/WRITE behaviour in TexTools, but lives in our UPGRADE
  transform" entry under the `/resave` findings section — rather than a code change.
- **§4.3.1's original claim that "PMP has no load-time fixes at all (both are TTMP-gated)" was
  false**, caught in Task 8 review, not by the harness catching a red test: `ResolvePMPBasePath`
  runs every unzipped `.tex` through `EndwalkerUpgrade.FastValidateTexFile` on the PMP load path
  itself (`PMP.cs:78-90/1084-1091`), independent of `DoesModpackNeedFix`/`FixOldTexData`'s
  TTMP-only gate. The lesson wasn't just "fix the sentence" — it's that a design doc's confidence
  ("no load-time fixes *at all*") is only as good as the C# it actually walked, and this was
  asserted without walking the PMP load path specifically. `applyLoadFixes` still has no PMP
  branch for it; tracked as its own BACKLOG item ("PMP load-time `.tex` fixup
  (`FastValidateTexFile`) is unported"), confirmed by `[Jaque] Romeo & Juliet`'s one remaining
  `/resave` residual (a payload length mismatch, a multiple of the 80-byte null-padding chunk —
  this fixup's signature, not `FixOldTexData`'s).
- **The write-side oracle's biggest catch wasn't in this spec's scope at all.** Building the
  `/resave` oracle (§4.3, item B) to prove the writer port surfaced `writeTtmp2` writing the
  legacy `"Multi Selection"`/`"Single Selection"` `SelectionType` spelling — which our *reader*
  never matched (`"Multi Selection"` != the modern bare `"Multi"`/`"Single"` TexTools actually
  writes), so every `Multi`-select group we ever emitted was silently downgraded to single-select.
  Worse: 643 `SelectionType` JSON-pointer diffs were **already sitting blessed** in the
  `/upgrade` ratchet baselines (`test/corpus/.upgrade-baseline/`) across 36 packs, invisible
  because the harness used to report one opaque manifest-mismatch token per document (Task 2's
  whole reason for existing) rather than per pointer. This is the sharpest evidence in the whole
  branch for why the harness-first sequencing (§4.4) mattered: a real, user-facing shipping
  defect had been passing the ratchet for who knows how long, and only became *legible* — greppable,
  nameable, countable — once the reporting granularity was fine enough to say what, specifically,
  was different. Filed as the (still-open, deliberately not fixed here) top item in
  `docs/BACKLOG.md`'s Prioritized section.
- **Turning on `checkPayloadMembers` for every PMP (harness fix C, done in Task 9) surfaced no new
  bug.** Every new diff it produced on the three real packs it touched
  (`Westlaketea's Constellation Crown`, `[Jaque] Marcellus`, `[Jaque] Romeo & Juliet`) traced
  one-for-one to a payload byte mismatch already sitting in that pack's baseline under
  `diffUpgrade`'s bare-gamePath key — mostly the `.tex` length differences the
  `FastValidateTexFile` null-padding gap above already explains, plus a few same-length `.mdl`/
  `.tex` content mismatches from other already-tracked, deferred gaps (texture-round T2/T3/T4).
  The member-name check reports the identical divergence again under a *second*, differently-shaped
  key (`<optionPrefix><gamePath>` instead of bare `gamePath`), so it needed its own baseline
  re-bless — mechanical, like Task 2's, not a new finding.
