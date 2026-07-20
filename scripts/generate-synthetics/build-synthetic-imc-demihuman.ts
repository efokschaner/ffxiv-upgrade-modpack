// Builds test/corpus/synthetic/imc-demihuman.ttmp2: a demihuman .meta whose IMC segment is
// DELIBERATELY SHORT — two entries where the base game's
// chara/demihuman/d1001/obj/equipment/e0001/e0001.imc yields eight for the `top` column.
//
// Why demihuman gets its own pack rather than riding on the weapon one. The backlog item this
// closes (docs/backlog/2026-07-10-nonset-imc-reference-table.md) grouped demihuman with
// weapon/monster as "NonSet", and it is not: d1001e0001.imc has TypeIdentifier 31 (ImcType.Set),
// the same five-slot subset layout as equipment, so its entries are SLOT-SELECTED by a 30-byte
// stride rather than read sequentially — XivDependencyRoot.GetImcEntryPaths
// (XivDependencyRoot.cs:1186-1191) sizes the stride as `subEntrySize * 5` for anything but NonSet
// and then adds `Imc.SlotOffsetDictionary[Info.Slot] * subEntrySize`. This pack is the only thing
// in the corpus that pins that combination — a Set-shaped, slot-selected root that is neither
// equipment nor accessory. Until this branch it did not even parse: parseMetaRoot threw
// `unrecognized root path` on demihuman outright.
//
// The slot column really is load-bearing here, and the reference table shows it: the eight entries
// seeded for `_top` differ from those seeded for `_met` / `_glv` / `_sho` / `_dwn` at the same
// root. A sequential (NonSet-style) read would hand every slot the same bytes, so a wrong stride
// is visible in this pack's golden rather than silently benign.
//
// The .mtrl is not incidental. /upgrade writes a pack only `if (data.AnyChanges || ...)`
// (ModpackUpgrader.cs:216 — the second disjunct is `rewriteOnNoChanges`, which ConsoleTools leaves
// false), and .meta reconstruction is a LOAD/WRITE behaviour, not a transform round — a meta-only
// pack no-ops, ConsoleTools emits nothing, and the harness would fall back to diffing against the
// untouched input, which has no oracle behind it (see
// docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §2). The EW 256-entry
// colorset makes DoesMtrlNeedDawntrailUpdate (EndwalkerUpgrade.cs:550) fire, so the upgrade really
// writes and the .meta growth lands in a real golden.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS PACK SHIPS WITH A RATCHET BASELINE (and what is NOT in it)
// ---------------------------------------------------------------------------------------------
// Identical in shape to the sibling build-synthetic-imc-weapon.ts, and for the same reasons — read
// that file's equivalent section for the full argument. In brief:
//
// The thing this pack exists to test PASSES with no tolerance of any kind: on the /upgrade path the
// payload comparison is byte-exact against the ConsoleTools golden. Both payloads match — the EW
// .mtrl and, crucially, the reconstructed .meta, whose IMC segment our pipeline grows 2 -> 8
// entries, in the right slot column, exactly as TexTools does. The /upgrade baseline contains ZERO
// payload entries: no divergence rule, no baseline entry, and no fuzz on the .meta.
//
// Everything the baselines DO record is a pre-existing, already-registered gap, unrelated to IMC
// growth and already baselined on ~60 real corpus ttmp2 packs plus the weapon pack:
//
//   - docs/backlog/2026-07-13-resave-meta-reconstruction-seam.md
//       The /resave baseline's PAYLOAD entry on this .meta. Reconstruction is a load/write
//       behaviour in TexTools but sits in our upgrade transform, so a pure /resave leaves the
//       source .meta untouched while ConsoleTools grows it. The byte delta is exactly the six
//       grown IMC entries (36 bytes) — the same growth this pack tests, which our /upgrade path
//       gets byte-right and our /resave path does not yet reach. A SEAM defect, not a correctness
//       one.
//   - docs/backlog/2026-07-13-resave-ttmp2-missing-mpl-fields.md
//       `IsChecked`, `ModsJsons[].ModPackEntry`, `SimpleModsList` — keys TexTools always writes and
//       writeTtmp2 omits, so they show up as [added] on the golden side.
//   - docs/backlog/2026-07-13-resave-ttmp2-name-category.md
//       `ModsJsons[].Name` / `.Category` — TexTools RE-DERIVES both from the game path where we
//       round-trip what the source declared.
//
// Nothing there is specific to this fixture: ANY ttmp2 pack with a real (non-noop) /upgrade golden
// hits all three. When those items are closed, this pack's baseline should empty out along with the
// real packs'; delete its entry then rather than re-blessing.

import { IMC_TABLE } from "../../src/meta/reference/imc-table";
import { serializeMeta } from "../../src/meta/serialize";
import { buildEwColorsetMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const META_PATH =
  "chara/demihuman/d1001/obj/equipment/e0001/d1001e0001_top.meta";

// d1001e0001.imc is ImcType.Set with subsetCount 7, so the `top` column yields 8 entries
// (the default plus seven subsets — XivDependencyRoot.cs:1195 loops `i <= subsetCount`).
// Supplying two forces a grow to 8. Distinctive bytes so "the mod's entries win at 0 and 1" is
// unambiguous in the golden, and distinct from each other so a swapped pair would show.
const SHORT_IMC = [
  new Uint8Array([5, 1, 0, 0, 2, 3]),
  new Uint8Array([6, 1, 0, 0, 2, 3]),
];

// Inert-fixture guard: the whole point of this pack is that reconstruction GROWS the segment, so
// the base seed must be strictly longer than what the mod ships. If a future imc-table.ts regen
// dropped this root (undefined) or shortened it to <= SHORT_IMC.length, the pack would still build
// and still pass — while silently testing nothing. Fail at build time instead.
const base = IMC_TABLE[META_PATH];
if (base === undefined) {
  throw new Error(
    `imc-demihuman fixture: IMC_TABLE has no entry for ${META_PATH} — the fixture cannot exercise ` +
      "base-seeded growth (regenerate imc-table.ts or pick another demihuman root)",
  );
}
if (base.length <= SHORT_IMC.length) {
  throw new Error(
    `imc-demihuman fixture: base IMC seed for ${META_PATH} has ${base.length} entries, not more ` +
      `than the mod's ${SHORT_IMC.length} — nothing would grow, so the fixture would pass inertly`,
  );
}

const meta = serializeMeta({
  version: 2,
  path: META_PATH,
  imc: SHORT_IMC,
  eqp: null,
  eqdp: null,
  est: null,
  gmp: null,
});

// Order matters only as diff hygiene, and it is EMPIRICAL rather than cited: the .meta goes LAST.
// The TTMP wizard writer applies no sort of its own (there is no OrderBy on the ModsJsons write
// path in TTMP.cs), so the emitted order falls out of the collection the upgrade load path built,
// and observation is the only honest source for it — the ConsoleTools golden for this pack emits
// the .mtrl first and the .meta second, matching what the weapon pack showed.
//
// Note this is NOT a plain FullPath sort, which is what an earlier draft of this file assumed:
// both paths share the `…/e0001/` prefix, after which "d1001e0001_top.meta" would sort BEFORE
// "material/…" ('d' < 'm'), yet TexTools still puts the .meta last. Authoring meta-first cost two
// spurious `ModsJsons[*]/FullPath` mismatches (the two entries simply pairwise swapped) that had
// nothing to do with IMC growth. Keep the .meta last so the golden diff stays focused on this
// pack's subject.
writeTtmp2Files("imc-demihuman.ttmp2", "IMC Demihuman Repro", [
  {
    gamePath:
      "chara/demihuman/d1001/obj/equipment/e0001/material/v0001/mt_d1001e0001_top_a.mtrl",
    data: buildEwColorsetMtrl(
      "chara/demihuman/d1001/obj/equipment/e0001/texture/v01_d1001e0001_top_n.tex",
    ),
  },
  { gamePath: META_PATH, data: meta },
]);
