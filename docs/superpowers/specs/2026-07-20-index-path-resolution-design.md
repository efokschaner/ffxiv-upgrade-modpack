# Faithful index-path (`_id.tex`) resolution — design

Filed: 2026-07-20 · Supersedes the corpus-scoped `INDEX_PATH_OVERRIDES` table.
Closes backlog item T4 (`index-path-overrides`; shipped 2026-07-20, its item file deleted per
`docs/BACKLOG.md`'s "when an item ships" convention) and is the template its sibling consideration
[`hair-texture-exists` namespace scope](../../backlog/2026-07-20-hair-texture-exists-namespace-scope.md)
should adopt — the item-seeded enumeration pattern (§3.3) both should share.

## 1. Problem

`EndwalkerUpgrade.cs:912-936` adds an index (`_id.tex`) sampler to every upgraded colorset material.
The path is derived from the mod's normal texture by naming convention (`_n.tex` → `_id.tex`), **except**
when the mod overwrites a base-game material — then TexTools *steals that base material's own
index-sampler path* (`:923-936`), gated on two game reads:

```csharp
idPath = convention(normalTex.Dx11Path);                       // from the MOD's normal
var rtx = ModTransaction.BeginReadonlyTransaction();
if (await rtx.FileExists(mtrl.MTRLPath, true)                   // gate A: mod overwrites a base material
    && !await rtx.FileExists(idPath))                           // gate B: convention path not in game
{
    var original = await Mtrl.GetXivMtrl(mtrl.MTRLPath, true, rtx);
    var idSamp = original.Textures.FirstOrDefault(... Index);   // the STOLEN path
    if (idSamp != null && !string.IsNullOrWhiteSpace(idSamp.Dx11Path)) idPath = idSamp.Dx11Path;
}
```

Our port (`src/upgrade/material.ts:135-147`) approximates all three reads with an 11-entry,
**corpus-derived** `INDEX_PATH_OVERRIDES` string table applied **unconditionally** (gate B skipped), and —
critically — **falls back silently** on a miss (`:144-147`, keep the convention path with no throw). This
violates AGENTS.md's rule for bundled data ("bundle for the *complete* set of inputs… let the table *be*
the existence oracle, so a miss means the file is genuinely absent"). A base-game material our corpus never
referenced gets the wrong `_id.tex` path silently, with a blast radius unknowable from the ratchet.

### 1.1 Severity — precisely characterised (this drove the design)

The generated index texture is **written into the modpack at `idPath`** (`texture.ts:222-223`,
`CreateIndexFromNormal` → `WriteFile(res.data, res.indexFilePath)`), and the material *references* that
same `idPath` (`material.ts:157`). Reference and shipped file are the **same string by construction**, so:

- **Common case (normal texture present in the option → index generated & shipped):** the upgraded mod
  renders correctly *regardless* of which `idPath` string we pick — the reference always resolves to the
  file the mod ships at that path. The divergence from TexTools is then **cosmetic byte-parity** on the
  `.mtrl` bytes and the index member name, not a broken mod.
- **Edge case (base-material overwrite where the normal texture *file* is not in the same option → index
  reference added but no index generated):** here it is **not** cosmetic. TexTools' stolen canonical path
  (e.g. `v01_c0201e0194_top_id.tex`) **exists in the base game**, so the game falls back to it; our
  convention path (e.g. `c0201e0194_top_a_id.tex`) exists nowhere → a **dangling index reference**. This is
  a real, potentially-degraded render where TexTools' output is more robust.

The fix must close both — the byte-parity gap in the common case and the dangling reference in the edge —
and, per AGENTS.md, must stop being *silent*.

## 2. Why there is no shortcut (verified, not assumed)

Two candidate shortcuts were tested against real game data and **rejected**:

1. **A derivation rule** (`v{NN}_{name sans mt_ sans trailing _letter}_id.tex`) — disproven by
   `scripts/probes/probe-idpath-rule.ts`: `chara/equipment/e0194/…top_a.mtrl` **drops** the variant letter
   (`…top_id.tex`) while `chara/equipment/e0100/…top_a.mtrl` **keeps** it (`…top_a_id.tex`) — same namespace,
   same slot, and nothing in the path predicts which. The base material's index path is **authored game
   data**; it must be *read* from the material file. (This is why the C# reads the material.)
2. **A namespace-scoped membership oracle for the gates** — unsafe because `idPath` is
   `convention(normalTex.Dx11Path)` and `mtrl.MTRLPath` are both **mod-author-controlled** strings of
   unbounded shape. A namespace scope would answer "absent" for a real file in an unscoped namespace — the
   exact silent-miss class we are fixing. The only safe scoping is by **file extension** (the gates only
   ever query a `.mtrl` path and an `_id.tex` path).

And there is **no path manifest** to enumerate from: the SqPack index is a one-way CRC32 membership
structure (`IndexFile.GetAllHashes` returns hashes, never strings; `FileExists`/`FolderExists` only hash a
path you already hold). TexTools recovers paths via its **dependency graph** (`XivDependencyGraph.
GetChildFiles`), reading them out of the parent files: `GetChildFiles(model)` → `Mdl.
GetReferencedMaterialPaths` (materials live inside the `.mdl`), `GetChildFiles(material)` →
`Mtrl.GetTexturePathsFromMtrlPath` (textures live inside the `.mtrl`), seeded from `item_sets.db` roots +
root formulas + IMC material-set counts. **We reproduce that graph** rather than guess.

## 3. Design

### 3.1 Runtime (`src/upgrade/material.ts`)

Replace the unconditional string-table lookup at `:140-147` with a faithful port of all three reads:

```
idPath = convention(normal)                              // unchanged (:129-133)
stolen = INDEX_TABLE.lookup(mtrl.mtrlPath)               // undefined unless a base material w/ index sampler
if (stolen !== undefined && !ID_TEX_MEMBERSHIP.has(idPath))   // gate B
    idPath = stolen
```

- **Gate A is subsumed by table membership.** A base material with *no* index sampler, or a non-base path,
  is simply absent from `INDEX_TABLE` → convention kept — identical to what C# does after reading the
  material and finding `idSamp == null` / the file absent. No separate `.mtrl` membership set is needed.
- **Gate B is ported** (operator decision 2026-07-20): the `_id.tex` membership set answers
  `!FileExists(idPath)` for the arbitrary author-derived convention path. This closes the "second
  approximation" the old comment documented.
- Both structures are **hash-keyed** `(folderHash, fileHash)` CRC pairs, exactly like
  `src/upgrade/reference/hair-texture-index.ts`. The runtime hashes the author path and does a membership
  lookup — uniform for any input shape (the safe answer to §2.2). For a `INDEX_TABLE` hit, the value is
  reconstructed from the mod's material-path string (which the runtime holds) plus the stored bit; see §3.2.

### 3.2 The two bundled tables (generated; lazy-loadable)

- **`INDEX_TABLE`** — one entry per enumerated base material that has an index sampler:
  `hash(materialPath) → value`, where `value` is **compressed**. The index path is almost always
  `{root}/texture/v{VER}_{name±letter}_id.tex` — everything but `VER` and the letter is derivable from the
  material path — so:
  - *Regular:* store the pair **`(VER, keepLetterBit)`** in a packed, hash-keyed table (10-byte records:
    `folderHash u32, fileHash u32, version u16` with the keep-letter flag in the version's high bit). The
    runtime reconstructs `{root}/texture/v{VER}_{name±letter}_id.tex` from the material-path string + these
    two values. **`VER` is NOT the material's folder version** — empirically they diverge for the majority
    of equipment (e.g. `e0001/material/v0002 → texture/v01_…`, `v0001 → v18_…`); the index-texture version
    tracks a separate grouping not derivable from the path, which is exactly why it must be stored. (An
    earlier draft assumed `VER == folderVersion` and stored only a bit; measurement over the full game
    falsified that — see the plan's Task 3.)
  - *Exception (cross-root / non-conforming):* the **full index path string** in a small side map — only the
    ~1.9k materials whose index sampler does not match the `{root}/texture/v{VER}_{name±letter}_id.tex`
    shape at all. Measured over the full game this population is **dominated by monster (~42%) and
    human-customization hair/tail/ear (~28%) materials**, with ~54% of all exceptions pointing at the shared
    `chara/common/texture/id_N.tex` namespace (the corpus `tightandfirmmaxfilia` case) and the rest other
    cross-root / non-conforming index paths — not the "chiefly hair `_acc`" an earlier draft assumed.
  - The extractor emits raw `(materialPath, indexPath)` pairs; the encoder derives `(VER, keepLetter)` by
    parsing the observed index path and **verifies** the reconstruction round-trips to the exact observed
    string before choosing the packed bucket — anything that does not round-trip falls to the full-string
    exception map, so the compression can never silently corrupt a value.
- **`ID_TEX_MEMBERSHIP`** — the `(folderHash, fileHash)` set of base-game `_id.tex` paths, for gate B.

Provenance headers cite `EndwalkerUpgrade.cs:923-936` (the behaviour) and the extractor (the data source),
per AGENTS.md.

### 3.3 The enumerator (`scripts/extract-index-table.ts`, replacing `extract-index-overrides.ts`)

Strategy **C — item-seeded**, reproducing TexTools' dependency graph most canonically (operator decision
2026-07-20):

1. **Roots** — read the `roots` table from `item_sets.db` over every `Imc.UsesImc` primary type
   (equipment, accessory, weapon, monster, demihuman) — the same canonical, exhaustive source
   `extract-meta-reference.ts:299-306` already trusts. Add **hair** roots via the race×hairID grid
   (`extract-hair-materials.ts` / `extract-hair-texture-index.ts` share it) since hair is customization, not
   an item.
2. **Models** — derive each root's model path(s) by the known root formulas
   (`XivDependencyRoot.GetRawModelPath` per type), keep those present in the game index.
3. **Materials** — read each model natively (§3.4) → `pathData.materialList` (the referenced material
   basenames), and expand across material **version folders** by existence-probing: for each basename, test
   `{root}material/v{N:D4}/{basename}` in the game index for `N = 1..MAX` and keep every hit. This is more
   faithful than an IMC-set expansion *for this purpose*: gate A is a pure `FileExists(MTRLPath)`
   (`EndwalkerUpgrade.cs:926`), so we want every version folder the game actually has, including any an IMC
   set does not reference. `MAX` is a generous fixed bound (material-set counts are low double digits) with a
   **fail-loud** guard — if any material exists at `v{MAX}`, the bound is too low and the extractor errors.
   (`Mdl.GetReferencedMaterialPaths` is the C# that combines the model basename with
   `{root}/material/v{set:D4}/`; we substitute existence-probing for its IMC-set source, deliberately.)
4. **Index sampler** — read each material natively → `parseMtrl` → the index-sampler `texturePath`
   (`samplerIdToTexUsage(...) === XivTexType.Index`). Emit `(materialPath, indexPath)`. Materials with no
   index sampler emit nothing (→ convention at runtime, faithfully).
5. Emit `INDEX_TABLE` (§3.2) and, in the same pass, `ID_TEX_MEMBERSHIP` from every distinct index path
   observed **plus** the base-game `_id.tex` files the model/material walk encounters (so gate B's membership
   is drawn from the same enumerated domain).

### 3.4 Native game-dat reader (`scripts/lib/game-index.ts`, extended) — no ConsoleTools

**The generator spawns no ConsoleTools process.** This is a deliberate improvement over
`extract-index-overrides.ts`, which spawned ConsoleTools `/extract` once per base material (~0.9s each) — a
single-use, serialized bottleneck. Everything the reader needs already exists in the port; only the
index-offset → dat-slice plumbing is new:

- **Have already:** `decodeSqPackFile` (+ `decodeType2/3/4`, `src/sqpack/sqpack.ts`) to decompress an entry
  blob; `read-model.ts` (`pathData.materialList`) and `parseMtrl` to parse it; `GameIndex` membership.
- **Add:** retain each index entry's `dataOffset`, decoding `(datFileId, byteOffset)` per `IndexFile.cs`
  (`dataFileId = (raw & 0x0E) >> 1`, `byteOffset = (raw & ~0xF) * 8`); then `read(gamePath): Uint8Array` —
  hash → offset → read the SqPack entry from `040000.win32.dat{N}` (read the entry header to compute its
  on-disk length, slice) → existing `decodeSqPackFile`. Extraction-only tooling (not shipped port code),
  cited against `IndexFile.cs` / `Dat.cs` like the rest of `scripts/lib`.

Result: the extractor's inputs are `item_sets.db` (SQLite), the game `.dat` files (native read), and the
already-generated IMC table — reading thousands of models/materials in-process, with the per-file spawn
bottleneck gone. (ConsoleTools remains only in the *test* harness as the golden oracle — unrelated to this
generator.)

### 3.5 Completeness — the test gap the item demands

The enumerated domain **is** the oracle: a runtime `INDEX_TABLE` miss means "genuinely not a base material
with an index sampler" → faithful convention, not a silent gap. To guarantee the domain is not silently
narrow (operator decision 2026-07-20 — the fail-loud corpus cross-check, not a broader self-audit):

- The extractor **exits non-zero** if any base material referenced anywhere in the local corpus is outside
  the enumerated set or did not receive a table entry (the pattern `extract-index-overrides.ts:179-184`
  already uses). A forgotten namespace is caught at build time against real data, not at a user's upload.
- **Documented residual risk:** completeness is bounded by the item-seed + model-formula coverage. There is
  no reversible hash→path source for materials, so a root type absent from both `item_sets.db` and the hair
  grid, and touched by no corpus pack, is the honest boundary. Stated at the extractor header and here.

## 4. What ships / what is deleted

- **New:** `scripts/extract-index-table.ts`; `GameIndex` dat-read extension; generated
  `src/upgrade/reference/index-table.ts` (compressed `INDEX_TABLE`) and `id-tex-membership.ts`; runtime
  rewire in `material.ts`.
- **Deleted:** `scripts/extract-index-overrides.ts` and `src/upgrade/reference/index-path-overrides.ts`
  (the 11-entry corpus table and the silent fallback). `scripts/probes/probe-idpath-rule.ts` is kept as the
  backing probe for §2.1 (like `probe-v1-meta.ts` backs its item).

## 5. Testing

Per AGENTS.md "a found divergence is a test-coverage gap too":

1. **Corpus ratchet (primary):** the affected `.upgrade-baseline` entries (the `e0208`/`The_Final_Requiem`,
   `tightandfirmmaxfilia` common, `Camp Site` monster cases in the item) must burn to empty. Re-bless after.
2. **Synthetic golden:** an authored pack that overwrites a base-game material **without** shipping its
   normal texture in the same option — the §1.1 edge case — so the dangling-vs-canonical difference gets a
   real ConsoleTools golden. Built under `scripts/generate-synthetics/`.
3. **Synthetic unit tests:** the compression encoder (bit round-trips; exception path), gate-B behaviour
   (steal suppressed when the convention `_id.tex` exists), and the native dat reader against a known file.
4. **Completeness assertion** (§3.5) is itself the regression guard for the enumeration.

## 6. Non-goals

- No change to how the index texture is *generated* (`createIndexFromNormal`) — only which path it is
  written to / referenced at.
- The sibling `hair-texture-exists` namespace item is not fixed here, but this establishes the
  item-seeded enumeration pattern it should adopt.
- Cross-format (TTMP↔PMP) conversion is out of scope (`src/index.ts:80-84` rejects it).
```
