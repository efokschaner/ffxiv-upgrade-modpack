# IMC reference table unification — covering every root type through one ported code path

Filed 2026-07-19 · Status: **design approved, implementation in progress.**

This closes the top prioritized backlog item, "NonSet (weapon/monster/demihuman) IMC reference
table" (`docs/backlog/2026-07-10-nonset-imc-reference-table.md`, filed 2026-07-10) — a **silent
divergence / fail-loud violation**: a weapon or monster `.meta` whose IMC segment *would* grow
against the base game passes through unchanged, with no throw and no test catching it.

## 1. The problem (as filed)

`src/meta/reference/imc-table.ts` is exhaustive over base-game equipment/accessory but **Set-only**.
`reconstructMeta` (`src/meta/reconstruct.ts:157-186`) keys it on `itemType/primaryId/slot`; for a
weapon or monster root the key never hits, and the `else` branch passes the mod's IMC through
unchanged. That is byte-exact today only because no corpus mod happens to supply a short IMC segment
for such a root — an accident of the corpus, not a property of the code.

The item proposed three pieces of work: a NonSet `.imc` parser, a NonSet extraction pass, and NonSet
column selection in `reconstructMeta`.

## 2. What TexTools actually does — two findings that reshape the fix

### 2.1 Demihuman is `ImcType.Set`, not NonSet

The item groups demihuman with weapon/monster. Extracting the real files disproves that:

| file | length | `subsetCount` | `TypeIdentifier` |
|---|---|---|---|
| `chara/weapon/w2021/obj/body/b0001/b0001.imc` | 16 | 1 | 1 (`NonSet`) |
| `chara/monster/m8045/obj/body/b0001/b0001.imc` | 16 | 1 | 1 (`NonSet`) |
| `chara/demihuman/d1001/obj/equipment/e0001/e0001.imc` | 244 | 7 | **31 (`Set`)** |

244 = `4 + 6*5*(1+7)` — the five-slot subset layout, identical in shape to equipment. Demihuman needs
no new parser at all. What it needs is a path and a key that `parseMetaRoot` and the extractor do not
currently produce: `parseMetaRoot` throws on a demihuman path outright.

### 2.2 The base seed never goes through `GetFullImcInfo`

`ItemMetadata.GetMetadata` (`ItemMetadata.cs · GetMetadata · 233-247`) seeds `ImcEntries` via
`root.GetImcEntryPaths(tx)` → `Imc.GetEntries(...)`, **not** via `Imc.GetFullImcInfo`. That matters
because the two disagree, and we ported against the wrong one's shape.

`XivDependencyRoot.GetImcEntryPaths` (`XivDependencyRoot.cs · GetImcEntryPaths · 1133-1202`) reads
only the 4-byte header and then computes raw byte offsets:

```csharp
const int startingOffset = 4;
const int subEntrySize = 6;
var entrySize = identifier == ImcType.NonSet ? subEntrySize : subEntrySize * 5;
var subOffset = 0;
if (Info.Slot != null && Imc.SlotOffsetDictionary.ContainsKey(Info.Slot))
    subOffset = Imc.SlotOffsetDictionary[Info.Slot] * subEntrySize;
for (int i = 0; i <= subsetCount; i++)
    offset = startingOffset + (i * entrySize) + subOffset;
```

`Imc.GetEntries` (`Imc.cs · GetEntries · 189-238`) then reads six raw bytes at each offset, and
**silently drops** any entry that would run past the end (`:217`,
`if (offset > imcByteData.Length - entrySize) continue;`).

This is a single algorithm that **branches on the identifier read from the file**, not on the item
type. Our `parseImcFile` + `imcSlotColumn` (`scripts/extract-meta-reference.ts:296-350`) is a
Set-specific reimplementation of it that reconstructs the same values by a different route. Porting
`GetImcEntryPaths` + `GetEntries` directly replaces both and covers all five primary types at once —
this is the "port from the symbol the oracle actually executes" rule in AGENTS.md, applied to a place
where we currently do not.

### 2.3 Path resolution carries a quirk

`GetRawImcFilePath` (`XivDependencyRoot.cs · GetRawImcFilePath · 1093-1126`) resolves the `.imc` from
the *secondary* type/id when `SecondaryType != null`, and for weapons applies
`Imc.ImcSharingWeaponTypes` (`Imc.cs:53-59`): offhand fists/twinfangs/daggers/glaives take
`PrimaryId -= 50`, redirecting to the mainhand's folder.

Measured against `item_sets.db` and the game index, that redirect fires for exactly **one** root —
the offhand ranges of `GetWeaponType` (`XivItemType.cs:184-250`: `350<id≤400`, `1650<id≤1700`,
`1850<id≤1900`, `2650<id≤2700`, `3050<id≤3100`, `3150<id≤3200`) barely intersect the root list. It
still must be ported: for that root both the own-path and the redirected `.imc` exist and are
different files, so omitting the redirect reads the wrong base seed silently — exactly the class of
bug this spec exists to remove. But it is a one-root quirk, not a bulk correction.

Separately, 9 of the 6528 roots have no `.imc` at all, and the redirect does not change that (all 9
are still absent after applying it): `w0201/b0166`, `w0501/b0126`, `w1501/b0128`, `w2133/b0003`,
`w2804/b0002`, `w3002/b0001`, `w3103/b0001`, `m9004/b0001`, `m9005/b0001`. These are the `[]`
(seed-nothing) rows of §3.2, and they are why that row has to exist.

## 3. Design

### 3.1 One extractor, ported from the executed symbols

Replace `parseImcFile` / `imcSlotColumn` in `scripts/extract-meta-reference.ts` with:

- a port of `GetRawImcFilePath` (including the `ImcSharingWeaponTypes` redirect), and
- a port of `GetImcEntryPaths` + `GetEntries` — header read, `entrySize` by identifier, `subOffset`
  by slot, the `0..subsetCount` inclusive loop, and the EOF-drop guard.

`IMC_SLOT_OFFSET` survives but is used as C# uses it: a **byte offset multiplier**, not a column
index. The "5-slot subset" concept disappears from our code entirely — it is just a stride.

Enumeration widens from equipment/accessory to all five primary types that satisfy `Imc.UsesImc`
(`Imc.cs · UsesImc · 74-85`): equipment, accessory, weapon, monster, demihuman.

### 3.2 The table is keyed on the root path, and *is* the existence oracle

Key: the `.meta` gamePath, lowercased — which `item_sets.db`'s `roots` table already stores verbatim
as `root_path`, and which `reconstructMeta` already receives as its `gamePath` argument. This
removes the placeholder-`slot` hack `parseMetaRoot` currently invents for weapon/monster roots
(`src/meta/root.ts:86-99`), whose only purpose was to fabricate a key component that could never hit.

Lowercasing at both generation and lookup is deliberate: it makes a path-case difference a hit rather
than a silent miss, and a silent miss here is precisely the failure mode this item exists to remove.

Three outcomes, mirroring what TexTools seeds:

| lookup | meaning | behaviour |
|---|---|---|
| present, non-empty | base seed known | grow to `max(mod.length, base.length)` (unchanged) |
| present, `[]` | `.imc` genuinely absent (`ItemMetadata.cs:236,243-246`) or `ImcType.Unknown` (`XivDependencyRoot.cs:1179-1182`) — TexTools seeds nothing | pass through; falls out of the existing `max(mod, 0)` arithmetic with no special case |
| **absent** | root not in `item_sets.db`; we cannot reproduce the seed | **throw** |

Recording confirmed-absent roots as an explicit `[]` is what makes the third row safe, and is
AGENTS.md's "let the table *be* the existence oracle" rule: a **miss** now means "we have no data",
never "the game has no file". Those are the two cases today's code conflates, and conflating them is
the silent divergence.

### 3.3 Consequential changes

- `src/meta/root.ts` — recognize demihuman roots (`chara/demihuman/d####/obj/equipment/e####/d####e####_<slot>.meta`);
  `estType` is `null` for them (`Est.cs · GetEstType · 91-94`: everything that is not `human` or
  `equipment` falls to `Invalid`). Delete the weapon/monster placeholder slot and its justification
  comment, which this change invalidates.
- `src/meta/reconstruct.ts` — key on `gamePath`; replace the equipment/accessory-scoped throw with
  the unconditional key-absent throw of §3.2.
- `docs/BACKLOG.md` + `docs/backlog/2026-07-10-nonset-imc-reference-table.md` — delete the item and
  its index entry, and update every citation of it (`scripts/extract-meta-reference.ts` header and
  `parseImcFile` throw, `src/meta/root.ts`, `src/meta/reconstruct.ts`, `imc-table.ts`'s generated
  header) in the same change, per the backlog's own deletion rule.

### 3.4 TexTools bug candidates surfaced

Two candidates, held to `docs/TEXTOOLS_BUGS.md`'s bug-vs-quirk bar rather than registered
reflexively. One is a genuine defect; the second is recorded here because it looks like one and is
not, so the next reader does not re-open it:

1. **`GetFullImcInfo`'s NonSet default subset sets `Vfx = variant`** (`Imc.cs:384`) where every other
   entry reads its own `vfx` byte (`:377`, `:401`). A plain defect. **Not on our path** — the seed
   goes through `GetEntries` (§2.2) — so we reproduce nothing here; it is registered as a bug we
   observed, not one we reproduce.
2. **Considered and rejected: an EOF-drop asymmetry across slots.** The inclusive `i <= subsetCount`
   loop combined with a non-zero `subOffset` looks like it should push the last entry of a
   high-numbered slot past EOF. It does not, and the margin is exactly zero. For a Set file,
   `length == 4 + 30*(1 + subsetCount)`; the largest offset is `4 + 30*subsetCount + 4*6`, and the
   guard compares it against `length - 6 == 28 + 30*subsetCount` — the two are **equal**, and the
   guard is `>`, not `>=`. Same for NonSet: largest offset `4 + 6*subsetCount`, guard bound
   `4 + 6*subsetCount`. So `GetEntries`' EOF guard provably never fires on a well-formed `.imc` of
   either type, and every slot yields `subsetCount + 1` entries.

   This is not a bug, so nothing is registered. It *is* a reason to port the guard rather than omit
   it — it fires only on a malformed or truncated file, and dropping it would turn that into an
   out-of-bounds read instead of TexTools' short list. §4.2's unit tests pin both the boundary
   (nothing dropped at exact length) and the truncated case (dropped).

## 4. How this is proven

Two independent obligations, both required.

### 4.1 No corpus byte moves

The equipment/accessory half of the table is being regenerated under new keys by new extraction code.
Every currently-passing pack must remain byte-identical and every ratchet baseline unchanged. This is
the regression signal for the refactor, and it is a strong one: ~7775 existing keys re-derived by a
different algorithm, checked against cached ConsoleTools goldens.

The script's existing golden spot-check (`e6137_top` 2→3, `e0724_top` 4→7) is retained and re-keyed.

### 4.2 The new behaviour gets a golden, not an assertion

No corpus pack exercises NonSet growth, so per AGENTS.md we prefer a synthetic golden over a
synthetic unit test. Two new packs under `scripts/generate-synthetics/`, both flowing through the
`/upgrade` harness against ConsoleTools:

- **weapon** — a `.meta` for a weapon root carrying a deliberately short IMC segment (fewer entries
  than the base file's `1 + subsetCount`), so the upgrade must grow it from `IMC_TABLE`. This is the
  exact case that silently passes through today.
- **demihuman** — a `.meta` for a demihuman root, which moves from "`parseMetaRoot` throws" to
  "works". A functional gain beyond the filed item; it gets an oracle rather than our own expectation,
  and it also pins the §3.4.2 entry-count arithmetic against real ConsoleTools output.

Cases neither pack can reach — `ImcType.Unknown`, the EOF-drop guard on a hand-built file — fall to
synthetic unit tests beside the code, derived from the C# and cited as such.

## 5. Cost and non-goals

Extraction grows from ~1555 ConsoleTools spawns to ~8000. Pre-filtering candidate paths through
`scripts/lib/game-index.ts` (already used by `extract-hair-materials.ts`) keeps us from spawning for
files that do not exist, and — more importantly — makes the confirmed-absent set of §3.2 an
*enumerated* fact from the index rather than an inference from a failed subprocess. Weapon and
monster `.imc` files are 16 bytes, so the generated table grows far less than the root count suggests.

Non-goals: the `human` primary type (`Imc.UsesImc` excludes it), and any change to how IMC entries
are *serialized* — this spec only widens and re-derives the base seed.

## 6. Branch note

Implemented on a branch in the primary working tree rather than a git worktree: `test/corpus/` is
gitignored and local-only, so a fresh worktree would carry no corpus and the `/upgrade` golden
harness — the entire proof in §4 — would silently no-op.
