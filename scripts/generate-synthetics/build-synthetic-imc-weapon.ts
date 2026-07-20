// Builds test/corpus/synthetic/imc-weapon.ttmp2: a weapon .meta whose IMC segment is DELIBERATELY
// SHORT — one entry where the base game's chara/weapon/w2021/obj/body/b0001/b0001.imc carries two.
//
// This is the NonSet base-seed case no real corpus mod exercises, and the one
// docs/superpowers/specs/2026-07-19-imc-reference-table-unification-design.md §4.2 exists to pin:
// the load path re-materializes the .meta, base-seeding ImcEntries from the
// game (ItemMetadata.cs · CreateFromRaw · 238-241) so the segment GROWS to the base entry count,
// with the mod's own entry winning at index 0. Before the IMC table covered weapon roots, ours
// passed the short segment straight through — silently, with no throw and nothing to catch it.
// This pack is the golden that catches it.
//
// The .mtrl is not incidental. /upgrade writes a pack only
// `if (data.AnyChanges || rewriteOnNoChanges)` (ModpackUpgrader.cs:216) — and ConsoleTools calls the
// two-argument overload, `UpgradeModpack(src, dest)` (Program.cs:179), so `rewriteOnNoChanges` takes
// its `false` default (ModpackUpgrader.cs:212) and only `AnyChanges` can make it write.
// .meta reconstruction is a LOAD/WRITE behaviour, not a transform
// round — a meta-only pack no-ops, ConsoleTools emits nothing, and the harness would fall back to
// diffing against the untouched input, which has no oracle behind it (see
// docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §2). The EW 256-entry
// colorset makes DoesMtrlNeedDawntrailUpdate (EndwalkerUpgrade.cs:550) fire, so the upgrade really
// writes and the .meta growth lands in a real golden.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS PACK SHIPS WITH A RATCHET BASELINE (and what is NOT in it)
// ---------------------------------------------------------------------------------------------
// The thing this pack exists to test PASSES with no tolerance of any kind: on the /upgrade path the
// payload comparison is byte-exact against the ConsoleTools golden. Both payloads match — the EW
// .mtrl and, crucially, the reconstructed .meta, whose IMC segment our pipeline grows 1 -> 2 entries
// exactly as TexTools does. The /upgrade baseline contains ZERO payload entries: no divergence rule,
// no baseline entry, and no fuzz on the .meta. ConsoleTools agrees with us byte-for-byte.
//
// Everything the two baselines DO record is a pre-existing, already-registered gap, unrelated to IMC
// growth and already baselined on ~60 real corpus ttmp2 packs:
//
//   - docs/backlog/2026-07-13-resave-meta-reconstruction-seam.md
//       The /resave baseline's single PAYLOAD entry (this .meta, "84 vs 90 bytes"). Reconstruction
//       is a load/write behaviour in TexTools but sits in our upgrade transform, so a pure /resave
//       leaves the source .meta untouched while ConsoleTools grows it. Note the 6-byte delta is
//       exactly one IMC entry — the same 1 -> 2 growth this pack tests, which our /upgrade path gets
//       byte-right and our /resave path does not yet reach. That item is a SEAM defect, not a
//       correctness one, and this pack now demonstrates both halves of it in one fixture.
//
// The remaining entries in both baselines are `.mpl` MANIFEST diffs from one writer gap:
//
//   - docs/backlog/2026-07-13-resave-ttmp2-name-category.md
//       `ModsJsons[].Name` / `.Category` — TexTools RE-DERIVES both from the game path (resolving
//       this fixture's weapon path to a real item) where we round-trip what the source declared.
//
// Nothing here is specific to this fixture: ANY ttmp2 pack with a real (non-noop) /upgrade golden
// hits it. This pack is simply the first SYNTHETIC ttmp2 to get a non-noop golden — every earlier
// synthetic .ttmp2 uses a gamePath /upgrade ignores, so those packs no-op and the harness skips the
// manifest diff entirely — and therefore the first synthetic to run the TTMP manifest comparison at
// all. When that backlog item is closed, this pack's baseline should empty out along with the real
// packs'; delete its entry then rather than re-blessing.
//
// A third gap used to live here — `IsChecked` / `ModsJsons[].ModPackEntry` / `SimpleModsList`, keys
// TexTools always writes and writeTtmp2 omitted. This pack was its primary reproduction target and
// it SHIPPED on 2026-07-20 (see docs/superpowers/specs/2026-07-20-ttmp2-mpl-manifest-fidelity-design.md);
// those entries are gone from both baselines.

import { IMC_TABLE } from "../../src/meta/reference/imc-table";
import { serializeMeta } from "../../src/meta/serialize";
import { buildEwColorsetMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const META_PATH = "chara/weapon/w2021/obj/body/b0001/w2021b0001.meta";

// One entry where the base .imc yields two (16 bytes: 4-byte header + default + 1 subset).
// Distinctive bytes so the "mod entry wins at index 0" half of the assertion is unambiguous.
const SHORT_IMC = [new Uint8Array([7, 1, 2, 0, 3, 4])];

// Inert-fixture guard: the whole point of this pack is that reconstruction GROWS the segment, so
// the base seed must be strictly longer than what the mod ships. If a future imc-table.ts regen
// dropped this root (undefined) or shortened it to <= SHORT_IMC.length, the pack would still build
// and still pass — while silently testing nothing. Fail at build time instead.
const base = IMC_TABLE[META_PATH];
if (base === undefined) {
  throw new Error(
    `imc-weapon fixture: IMC_TABLE has no entry for ${META_PATH} — the fixture cannot exercise ` +
      "base-seeded growth (regenerate imc-table.ts or pick another weapon root)",
  );
}
if (base.length <= SHORT_IMC.length) {
  throw new Error(
    `imc-weapon fixture: base IMC seed for ${META_PATH} has ${base.length} entries, not more than ` +
      `the mod's ${SHORT_IMC.length} — nothing would grow, so the fixture would pass inertly`,
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
// the .mtrl first and the .meta second. The sibling build-synthetic-imc-demihuman.ts observed the
// same order on a root where a FullPath sort would predict the opposite, confirming it is not a
// sort. (An earlier draft of this file claimed TexTools ordered ModsJsons by FullPath; it does not
// — that claim happened to agree with the observation here only by coincidence.) Authoring the
// fixture .meta-last keeps the golden diff focused on this pack's subject (the .meta payload)
// instead of also reporting a ModsJsons ordering difference unrelated to IMC growth.
writeTtmp2Files("imc-weapon.ttmp2", "IMC Weapon Repro", [
  {
    gamePath:
      "chara/weapon/w2021/obj/body/b0001/material/v0001/mt_w2021b0001_a.mtrl",
    data: buildEwColorsetMtrl(
      "chara/weapon/w2021/obj/body/b0001/texture/v01_w2021b0001_n.tex",
    ),
  },
  { gamePath: META_PATH, data: meta },
]);
