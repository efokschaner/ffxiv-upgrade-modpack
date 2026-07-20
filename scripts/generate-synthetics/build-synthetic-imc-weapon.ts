// Builds test/corpus/synthetic/imc-weapon.ttmp2: a weapon .meta whose IMC segment is DELIBERATELY
// SHORT — one entry where the base game's chara/weapon/w2021/obj/body/b0001/b0001.imc carries two.
//
// This is the case docs/backlog/2026-07-10-nonset-imc-reference-table.md was filed for and no real
// corpus mod exercises: the load path re-materializes the .meta, base-seeding ImcEntries from the
// game (ItemMetadata.cs · CreateFromRaw · 238-241) so the segment GROWS to the base entry count,
// with the mod's own entry winning at index 0. Before the IMC table covered weapon roots, ours
// passed the short segment straight through — silently, with no throw and nothing to catch it.
// This pack is the golden that catches it.
//
// The .mtrl is not incidental. /upgrade writes a pack only `if (data.AnyChanges)`
// (ModpackUpgrader.cs:216), and .meta reconstruction is a LOAD/WRITE behaviour, not a transform
// round — a meta-only pack no-ops, ConsoleTools emits nothing, and the harness would fall back to
// diffing against the untouched input, which has no oracle behind it (see
// docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §2). The EW 256-entry
// colorset makes DoesMtrlNeedDawntrailUpdate (EndwalkerUpgrade.cs:550) fire, so the upgrade really
// writes and the .meta growth lands in a real golden.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

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

// Order matters only as diff hygiene: TexTools emits ModsJsons ordered by FullPath, and
// "…/material/…" sorts before "…/w2021b0001.meta". Authoring the fixture in that order keeps the
// golden diff focused on this pack's subject (the .meta payload) instead of also reporting a
// ModsJsons ordering difference that has nothing to do with IMC growth.
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
