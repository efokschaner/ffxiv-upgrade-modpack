# PMP writer: regenerate from the model (and the write-side oracle that proves it)

Status: proposed. Supersedes the round-trip half of `writePmp`, closes the top `BACKLOG.md`
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
| `.meta` → manipulation JSON; `.rgsp` → manipulation JSON | `MetadataToManipulations` / `RgspToManipulations`, `PmpExtensions.cs:417` |
| Manifests serialized from the typed model — every initialized field written; `default_mod.json` gets `Version` and loses `Name`/`Description` (`ShouldSerialize*` on `IsDataContainerOnly`, `PMP.cs:1496-1501`); `meta.json` always carries `Image` | `PMP.WritePmp`, `PMP.cs:830-869`; `WizardData.WritePmp`, `WizardData.cs:1460-1560` |
| Blank group or option name → `InvalidDataException` | `WizardData.cs:1520-1523` |

Two behaviours worth naming because they surprised us:

- **Dedup is global across options.** In `[Jaque] Romeo & Juliet` one `common/1/…` member is
  shared by 9 game paths *in two different options*. Our model duplicates the bytes per file;
  the writer must re-derive the sharing from content, not from the source layout.
- **`ResolveDuplicates` has a known zero-hash bug** for absent files
  (`PmpExtensions.cs:509-514` inserts a default `SHA1HashKey()`), already registered in
  `docs/TEXTOOLS_BUGS.md` §7. Reproduce it; do not fix it.

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
4. converts `.meta`/`.rgsp` files to `Manipulations` (only reachable from a TTMP-sourced
   model — a PMP-sourced one holds no `.meta`);
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
| B | New `/resave` write-side oracle check per corpus pack: `writeModpack(loadModpack(pack))` vs `ConsoleTools /resave`, same content-addressed cache + ratchet. PMP→PMP pins the writer; **TTMP→PMP** pins the `.meta`/`.rgsp` → `Manipulations` conversion (`/resave` re-saves "to a new path **or type**", `Program.cs:441`), over the ~50 real TTMPs already in the corpus | §2.4 |
| C | `checkPayloadMembers` on unconditionally for PMP. A member name *is* `optionPrefix + gamePath`, so this also catches a file landing in the **wrong option** — which `diffUpgrade`'s gamePath-keyed multiset flattens away | §2.3 |
| D | Manifest diffs keyed **per difference** (JSON pointer, e.g. `default_mod.json#/Files/chara~1…`) instead of per document, so a blessed diff cannot blind the ratchet to the rest of the document | §2.2 |
| E | Self-consistency invariant on our own output: re-read the written PMP and assert no `Files` key resolves to nothing, and no payload member is orphaned — i.e. every member is either named by an option's `Files`/`Image` or was already an `ExtraFile` of the source (`PMP.cs:213-215`). No oracle needed; fails closed where no golden exists | belt-and-braces for §2.1 |

**A alone would have caught this bug**: the orphan member re-reads as an `ExtraFile`, so its
`gamePath` vanishes from our multiset and shows as `added` against the golden.

### 4.4 Sequencing

Harness first, so each new check is *seen failing on the bug it exists to catch* (AGENTS.md:
"a found divergence is a test-coverage gap too").

1. **Harness (A, D, E, and B's oracle plumbing)**, with baselines blessed to today's — broken —
   state. The defect now shows as red diffs the harness can actually see; record what they are.
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
- **Ratchet churn** across every PMP is expected, and is the point.
- **ConsoleTools concurrency**: adding a second oracle command multiplies cold-cache spawns.
  The known "ConsoleTools is not safe to run concurrently" backlog item bites harder here — the
  cross-process mutex it asks for is now closer to a prerequisite than a nicety.

## 6. Out of scope

- The `mergeManipulations = true` import path (`PMP.cs:1141-1205`).
- `writeTtmp2` regeneration parity (`/resave x.ttmp2 → y.ttmp2` would be the oracle; worth a
  follow-up backlog entry now that the plumbing exists).
- The remaining `BACKLOG.md` texture-round gaps (T2/T3/T4), the partials round, and everything
  else that is about the *transform* rather than the writer.
