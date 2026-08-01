# A complete `FileExists` oracle for the chara category

Filed: 2026-07-31 · Closes
[`docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md`](../../backlog/2026-07-20-hair-texture-exists-namespace-scope.md)
(the #1 prioritized backlog item) · Roadmap: `2026-06-30-dawntrail-modpack-upgrader-design.md` §8

## 1. The problem

`src/upgrade/reference/hair-texture-exists.ts` is our stand-in for `rtx.FileExists` — the runtime
question "does this file exist in the base game?". It answers from a bundled set of 3,378
`(folderHash, fileHash)` pairs scoped to the hair / zear / tail **texture** folders. Outside that
namespace every lookup returns a hard `false`, regardless of what the game index really says.

`RepathHairMashups` (`ModpackUpgrader.cs:379-482`) only *visits* materials under
`chara/human/c####/obj/{hair,zear,tail}/…`, but such a material may bind a **sampler pointing
anywhere**. All three rewrite sites are shaped `if (!exists(old)) { if (exists(candidate)) rewrite }`,
so an unjustified `false` on the *candidate* silently suppresses a rename TexTools performs — no
throw, no warning, and the material is re-serialized either way (`repath-hair-mashups.ts:98`).

The same shape appears a second time: `idTexExists` (`index-path-resolver.ts:83-88`) answers gate B of
the index-path steal (`EndwalkerUpgrade.cs:926`) from a separately-enumerated `_id.tex` set, and the
hair/eye material tables answer their `FileExists` gates by `Map.has()`.

## 2. Evidence

**The bug is reachable.** Enumerating the live 040000 index for out-of-namespace
`(old absent, candidate present)` pairs found **47** in face-texture folders alone, e.g.

    chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_n.tex   (absent)
    chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_norm.tex (exists)

A hair material mashing in a face texture — a normal thing for a mashup mod to do — gets that rename
from TexTools and silently does not get it from us.

**It is latent on today's corpus.** Replaying the exact query set `RepathHairMashups` asks, over all
85 real packs plus the synthetic and `upgrade-error` roots:

| measurement | value |
| --- | --- |
| oracle queries / distinct paths | 280 / 89 |
| out-of-namespace distinct paths | 17 |
| …that exist in the live game index | **0** |
| in-namespace answers disagreeing with the live index | **0** |

So no corpus pack is mis-upgraded today. The 17 out-of-namespace paths are mod-authored
(`chara/human/mpdytail_n.tex`, `chara/human/c0801/obj/hair/common/ears_normal.tex`) and genuinely
absent from the game — a correct `false` reached for the wrong reason.

**That evidence rules out the backlog item's option 2** (fail loud on an out-of-namespace query): it
would fire on two real packs (`[DVNO] Desert Years.pmp`, `[Jaque] Marcellus [May 2024].pmp`), hard-
failing mods TexTools upgrades without complaint. We take option 1 — widen the domain — instead.

## 3. Decisions

Two calls, both the operator's (2026-07-31):

1. **Bundle the complete 040000 (chara) index**, not a filtered subset. 333,072 entries. A miss then
   *provably* means the file is absent, per AGENTS.md's "let the table **be** the existence oracle".
   The considered alternative — keeping only SqPack type-4 (texture) entries, 81,938 of 333,072, at
   0.42 MB instead of 1.75 MB — was rejected because it rests on an assumption I could not prove: that
   a game file named `*.tex` is always a type-4 entry. A scan of every nameable chara `/texture` folder
   (74,856 entries) found **65 type-2 and 3 type-3 entries living inside texture folders** — `.pap`
   animations and VFX files carrying texture content — which I could not name well enough to rule out.
   Zero assumptions beats 1.3 MB.
2. **Throw for a valid FFXIV path outside `chara/`.** Only 040000 is bundled; bundling all 14
   categories is 1,240,789 entries (~6 MB packed) and is not worth it for a webpage. A path that is not
   an FFXIV internal path at all still returns a *faithful* `false` (§4). No corpus query reaches the
   throw — all 17 out-of-namespace paths were under `chara/`.

## 4. The oracle — `src/upgrade/reference/file-exists.ts`

`hair-texture-exists.ts` → `file-exists.ts`, `hairTextureExists` → `fileExists`. The rename is the
point: the module ports a chain that has nothing to do with hair, and three more call sites (§6) will
use it. `computeHash` (`HashGenerator.ComputeCRC`, `HashGenerator.cs:154-205`) keeps its current home
and its current per-table-copy convention.

`fileExists(path)` reproduces `ModTransaction.FileExists` (`ModTransaction.cs:1125-1137`) →
`IOUtil.IsFFXIVInternalPath` (`IOUtil.cs:551-570`) → `IOUtil.GetDataFileFromPath` (`:312-329`) →
`IndexFile.GetRawDataOffsetIndex1` (`IndexFile.cs:546-576`), in that order:

| step | C# | behaviour |
| --- | --- | --- |
| 1 | `string.IsNullOrWhiteSpace(path)` | `false` |
| 2 | `_InvalidRegex` = `[^a-z0-9\./\-_{}]` (`IOUtil.cs:550`) | `false` — note this is **case-sensitive**: an uppercase path is not an internal path |
| 3 | no `XivDataFile` folder-key prefix (`XivDataFile.cs:35-91`) | `false` |
| 4 | prefix resolves to a category other than `chara/` | **throw** — unported, only 040000 bundled |
| 5 | otherwise | membership in the bundled 040000 index1 set |

Steps 1-3 are new. Today those paths happen to answer `false` by hash-miss coincidence; making the
guard explicit is what lets step 4 distinguish "not a game path" (faithful `false`) from "a game path
in a category we did not bundle" (an honest gap). `chara/` cannot be shadowed by a more specific
folder key, so the reverse-order scan of `GetDataFileFromPath` collapses to a single prefix test here.

**Two deliberate non-ports, both commented at the site:**

- `GetRawDataOffset` (`IndexFile.cs:516-526`) requires the index1 and index2 offsets to **agree**, and
  returns 0 when they differ. That is a corrupted-index guard: on a vanilla install the two are
  consistent by construction, and with full 64-bit `(folderHash, fileHash)` keys a false positive
  needs a 2⁻⁶⁴ collision, so the index2 half buys nothing for 0.76 MB.
- The index1 **synonym table** (`GetRawDataOffsetIndex1`'s second half, `:562-573`). I verified
  040000's index1 synonym segment is 256 bytes — exactly one entry, and `GetSynTableEndingEntry`
  (`IndexFile.cs:1370-1379`) says the ending sentinel is always present, so 040000 index1 has **zero**
  real synonyms. (Index2 has 28, i.e. 14 colliding pairs, consistent with its 333,058 vs 333,072
  entries; index2 is not consulted.) I also verified **no** entry in the data segment has a zero
  offset, so `offset != 0` never excludes one. The data segment alone is exact.

## 5. The bundled table — `src/upgrade/reference/chara-index.ts`

Generated by `scripts/extract-chara-index.ts` (replacing `extract-hair-texture-index.ts`), which drops
the race × `ID_MAX` folder grid entirely and keeps **every** entry in the 040000 index1 data segment.

Three base64 payloads, so each typed-array view starts at offset 0 and is alignment-safe:

| export | contents | packed |
| --- | --- | --- |
| `CHARA_INDEX_FOLDERS` | u32 LE folder hashes, ascending (82,369) | 330 KB |
| `CHARA_INDEX_COUNTS` | varint file-count per folder, same order | ~90 KB |
| `CHARA_INDEX_FILES` | u32 LE file hashes, grouped by folder in that order, ascending within a group | 1.33 MB |

≈1.75 MB packed / ~2.3 MB base64 of generated source, against 36 KB today. For scale, the repo already
ships `imc-table.ts` at 2.34 MB, and lazy-loading the reference tables is already on the Round 7
backlog entry.

At runtime the module wraps `Uint32Array` views directly over the decoded folders and files (no copy),
walks the counts once into a prefix-sum `Uint32Array`, then answers a query by binary-searching the
folder array and binary-searching that folder's file slice. Heap ≈1.7 MB. This replaces today's `Set`
of `"folder:file"` template strings, which at 333,072 entries would cost tens of MB and a visible
module-load pause.

Grouping by folder is what makes the size tolerable: 82,369 folder hashes are shared across 333,072
files, so the flat alternative (a sorted array of 64-bit keys) costs 2.66 MB packed for the same
answers.

## 6. Call sites

I audited all 60 `FileExists(` occurrences in the framework (19 files) and traced which ones our port
actually executes.

**Converted by this change:**

| C# | question | today | after |
| --- | --- | --- | --- |
| `ModpackUpgrader.cs:414,417,423,427,434,441,448,455,459` | hair/zear/tail sampler paths and their rewrite candidates | `hairTextureExists` | `fileExists` |
| `EndwalkerUpgrade.cs:926` gate B — `!rtx.FileExists(idPath)` | does the convention `_id.tex` already exist | `idTexExists` over `ID_TEX_PACKED` | `fileExists`; **`idTexExists` and `ID_TEX_PACKED` deleted** |
| `EndwalkerUpgrade.cs:926` gate A — `rtx.FileExists(mtrl.MTRLPath, true)` | is the mod overwriting a base-game material | fused into `resolveStolenIndexPath`'s table membership (`material.ts:143`) | `fileExists(mtrl.mtrlPath)` as its own gate, then the resolver answers only "which index path" |
| `EndwalkerUpgrade.cs:1430, :1615` | does the canonical hair material exist | `HAIR_MATERIALS.get()` (`unclaimed-hair.ts:157,281`) | `fileExists(matPath)` gate, then `get()`, then **throw** on a table miss |
| `EndwalkerUpgrade.cs:2049` | does the iris material exist | `EYE_MATERIALS.has()` (`eye-mask.ts:197`) | same shape |

Gate B is the one that can **move output bytes**: if `ID_TEX_PACKED` omits any real `_id.tex`, the
conversion flips gate B from pass to fail and changes which index path is stolen. That would be a fix,
and it gets the same harness scrutiny as the main change.

Gate A is behaviour-neutral — a base material with no index sampler misses the table today and returns
`undefined` from the resolver either way. It is un-fused purely so the port has the C#'s two gates in
the C#'s shape, per "reproduce the C# control flow, not just its output".

The hair/eye tables **stay**: the C# reads the material immediately after the existence check, so we
need its content, not just its presence. What changes is that the two questions stop being one lookup.
When the index says a canonical material exists and the table does not carry it, that is a table gap,
and it now **throws** instead of silently skipping the option — the same silent-scope shape this spec
exists to remove. For that throw to be sound the two tables must be current, so
`scripts/extract-hair-materials.ts` and `scripts/extract-eye-materials.ts` are re-run in this change.

**Not converted, and why:**

- `EndwalkerUpgrade.cs:65` (`AssertIsDawntrail`) validates the *installed game*; we have none, and it
  is not ported.
- `EndwalkerUpgrade.cs:1742` / `:1777` (`Exists` / `ResolveFile`) take a `ModTransaction`, but the
  dictionary overload of `UpdateEndwalkerFiles` — the one `ModpackUpgrader.cs:99` calls — hard-sets
  `ModTransaction tx = null` (`:166`). On our path they are pure `files.ContainsKey`, which is what
  `contained` / `requireBytes` already are.
- The remaining 14 files (`Mtrl.cs`, `Mdl.cs`, `Tex.cs`, `ItemMetadata.cs`, `Imc.cs`, `RootCloner.cs`,
  `XivDependencyRoot.cs`, …) hold `FileExists` inside game read/import paths — `GetXivMtrl(path, tx)`,
  `ItemMetadata.GetMetadata`, `ImportMtrl` — that our port never executes. We parse bytes we already
  hold and read bundled IMC/EST tables instead.

## 7. Tests

**Synthetic modpack** — the test gap the backlog item names. `build-synthetic-mashup-hair-outofns.ts`,
a sibling of the existing `build-synthetic-mashup-hair.ts`, emits a wizard PMP whose single Hair-shader
`.mtrl` points its **normal** sampler at `chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_n.tex`
— one of the 47 verified pairs, out of the bundled namespace, old absent, `_norm` present. The mask
sampler stays on an existing DT path so `!exists(mPath)` is false and only the normal branch fires.
It runs through the `/upgrade` golden harness against a real ConsoleTools golden, so it AB-tests the
answer rather than asserting our reading of the C#: it must **fail before** the fix (the golden renames,
we don't) and byte-match after.

**Unit tests** — `test/upgrade/file-exists.test.ts`, replacing `hair-texture-exists.test.ts`:

- out-of-namespace true: `…/c0101f0001_fac_norm.tex` → `true`, `…_fac_n.tex` → `false`
- `chara/common/texture/catchlight_1.tex` → `true` (it is `false` today — proves the widening landed)
- the existing in-namespace true/false assertions, carried over
- blank, uppercase, invalid-character and non-FFXIV-prefix paths → `false` (steps 1-3)
- `bgcommon/…` → throws (step 4)
- a table-miss on a `fileExists`-true canonical hair/iris material → throws (§6)

`test/upgrade/repath-hair-mashups.test.ts`'s four `vi.doMock` sites move to the new module path.

**Corpus** — the probe predicts zero baseline movement on the hair oracle. Gate B and the regenerated
hair/eye tables can legitimately move bytes. Anything that moves is investigated, not blessed.

## 8. Risks

- **Table currency vs cached goldens.** The bundled tables are regenerated from *this machine's*
  current install; the hair texture namespace has grown 3,378 → 3,447 entries since the last
  extraction, so even a plain regeneration changes some in-namespace answers. Cached ConsoleTools
  goldens are keyed on `sha256(input pack)` only and carry no game version, so a golden cached before
  a patch can disagree with a table extracted after one. If unexplained diffs appear, purge the
  affected `.upgrade-cache` entries and re-run ConsoleTools so goldens and tables come from the same
  game version — do not bless around it.
- **Step 2 is case-sensitive.** A mod that authored a sampler path with an uppercase character gets
  `false` where today's lowercasing hash might have found it. That is faithful to `_InvalidRegex`, but
  it is a behaviour change that could surface in the corpus.
- **The hair/eye throw is new failure surface.** It is gated on the index saying the file exists, so it
  can only fire on a genuine table gap — but a stale table is exactly such a gap, which is why they are
  regenerated here.
- **Bundle size.** +2.3 MB of generated source, roughly doubling the eagerly-evaluated reference
  tables. Accepted deliberately (§3); Round 7's lazy-loading item is where that gets repaid, and
  `upgradeModpack` being synchronous is what stops it being repaid now.

## 9. Documentation

- Delete `docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md` and its index entry, and fix
  the references the delete would strand: `docs/backlog/2026-07-20-index-extractor-tooling-nits.md:20`
  cites `extract-hair-texture-index.ts:16-55`'s race grid as one of three copies — this change deletes
  that copy — and `2026-06-30-dawntrail-modpack-upgrader-design.md:380,392-393,481-484` describes the
  oracle as namespace-scoped with an open follow-up.
- `2026-07-18-repath-hair-mashups-design.md` §3 and §3.2/3.4 describe the namespace-scoped table and its
  extractor; restate for the complete table.
- `2026-07-20-index-path-resolution-design.md` §3.3 documents `ID_TEX_PACKED`; note its retirement.
