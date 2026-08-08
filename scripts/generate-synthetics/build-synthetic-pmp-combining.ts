// Builds test/corpus/upgrade-error/pmp-combining-group.pmp: a PMP carrying a Penumbra "Combining"
// group alongside an ordinary Single group whose .mtrl genuinely upgrades. It lands in
// test/corpus/upgrade-error/ because ConsoleTools /upgrade FAILS on it, which is the point — the
// expected-failure check pins that our port refuses it at the same STAGE and with the same MESSAGE.
//
// WHY THIS PACK EXISTS. Upstream commit `76535f4` ("Add PMP Combining group import support") moved
// where TexTools refuses a Combining group. Before it, the base `PMPGroupJson.Options` virtual threw
// `Unimplemented PMP group type: Combining` (PMP.cs:1517) on first access, during LOAD. At the
// v3.1.1.4 pin the subtype is registered (`[JsonSubtypes.KnownSubType(typeof(PMPCombiningGroupJson),
// "Combining")]`, PMP.cs:1494) and overrides `Options` (:1565), so the pack loads fine and is refused
// at the WRITE seam instead — `WizardGroupEntry.ToPmpGroup`'s first statement
// (WizardData.cs:897-900), reached from `WizardData.WritePmp`'s group-assembly loop (:1613).
//
// What the oracle does, measured (ConsoleTools /upgrade v3.1.1.4, 2026-08-08): exit -1, NO output
// file, and a trace of
//
//     System.IO.InvalidDataException: Editing or exporting PMP Combining groups is not supported.
//        at xivModdingFramework.Mods.WizardGroupEntry.<ToPmpGroup>d__18.MoveNext()
//        ...
//        at xivModdingFramework.Mods.WizardData.<WritePmp>d__21.MoveNext()
//        at xivModdingFramework.Mods.WizardData.<WriteModpack>d__15.MoveNext()
//        at xivModdingFramework.Mods.ModpackUpgrader.<UpgradeModpack>d__2.MoveNext()
//        at ConsoleTools.ConsoleTools.<HandleUpgrade>d__7.MoveNext()
//
// The same probe run WITHOUT the Combining group (identical otherwise) exits 0 and writes a pack —
// so the refusal is attributable to the Combining group alone, not to anything else in the fixture.
//
// WHY THE UPGRADING .mtrl IS LOAD-BEARING. `ModpackUpgrader.UpgradeModpack` only writes
// `if (data.AnyChanges || rewriteOnNoChanges)` (ModpackUpgrader.cs:244-247), and ConsoleTools calls
// the two-argument overload so `rewriteOnNoChanges` is false. A Combining group carries no upgradable
// data of its own (`FromPMPGroup` populates neither StandardData nor ImcData for one,
// WizardData.cs:822-843), so a Combining-only pack would NO-OP and never reach the write seam at all.
// The Single group's EW-colorset .mtrl is what makes `AnyChanges` true and the write happen. See
// synthetic-mtrl.ts for why that material upgrades; its referenced normal texture is deliberately not
// packed, so the second upgrade round generates nothing extra (EndwalkerUpgrade.cs:1840's guard
// misses).
//
// SHAPE OF THE COMBINING GROUP (PMP.cs · PMPCombiningGroupJson · 1555-1603). `Options` is the
// `OptionData` list of `PmpCombiningOptionJson` (:1559-1560, :1701-1703 — Name/Description/Image
// only, no Files), and `Containers` is a list of `PmpCombiningContainerJson` (:1562-1563, :1705-1707
// — a `PmpStandardOptionJson`, so it is the thing that actually carries Files). `OnDeserialized`
// (:1567-1591) requires `1 << Options.Count` containers and pads or truncates to reach it, so ONE
// option means TWO containers — supplied explicitly here so the fixture is not relying on that
// fixup. Exactly ONE option, deliberately: two would make `DefaultSettings` (a bitmask for any
// non-"Single" type, WizardData.cs:775 + :817-818) a less obvious value without testing anything
// more.
//
// Our port does not model any of that: it accepts the `Type` (manifest-types.ts's
// KNOWN_PMP_GROUP_TYPES), carries `Containers` opaquely through `PmpGroupJson`'s index signature, and
// throws at the write seam. Combining SUPPORT is not ported.
//
// The .pmp is gitignored; regenerate with `npm run synthetics`.

import type { PmpGroupJsonRaw } from "../../src/container/manifest-types";
import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";
import { buildEwColorsetMtrl } from "./synthetic-mtrl";

// The material that genuinely upgrades — same shape/paths as absent-file-upgraded.pmp's.
const mtrlGamePath =
  "chara/equipment/e9999/material/v0001/mt_c0101e9999_top_a.mtrl";
const normalTexPath = "chara/equipment/e9999/texture/v01_c0101e9999_top_n.tex";
const mtrlZipPath = "real/on/files/mt_c0101e9999_top_a.mtrl";

// One container's payload, so the group is not degenerately empty. Nothing reads it: TexTools
// records it in `allPmpFiles` (PMP.cs:236-250) and then refuses the pack before writing anything.
const containerGamePath = "chara/dummy/combining_container.bin";
const containerZipPath = "combining/c1/files/combining_container.bin";
const CONTAINER_PAYLOAD = new Uint8Array([0, 1, 2, 3]);

/** A Penumbra Combining group. Key order follows `singleOptionGroup`'s base-field order plus
 *  `Options` then `Containers` — the order `PMPCombiningGroupJson` declares them in
 *  (`[JsonProperty(Order = 98)]` / `(Order = 99)`, PMP.cs:1559/:1562). Load-bearing: it fixes the
 *  member bytes and therefore the golden-cache key (see pmp-builder.ts's header). */
const combiningGroup: PmpGroupJsonRaw = {
  Version: 0,
  Name: "Combining",
  Description: "",
  Image: "",
  Page: 0,
  Priority: 0,
  Type: "Combining",
  DefaultSettings: 0,
  Options: [{ Name: "Alpha", Description: "", Image: "" }],
  Containers: [
    {
      Name: "",
      Description: "",
      Image: "",
      Files: {},
      FileSwaps: {},
      Manipulations: [],
    },
    {
      Name: "",
      Description: "",
      Image: "",
      Files: { [containerGamePath]: containerZipPath.replace(/\//g, "\\") },
      FileSwaps: {},
      Manipulations: [],
    },
  ],
};

writePmp(
  "pmp-combining-group.pmp",
  {
    meta: syntheticMeta("PMP Combining Group Repro"),
    defaultMod: EMPTY_DEFAULT_MOD,
    groups: {
      // The Standard group comes FIRST so the pack proves the refusal is not merely "the first group
      // fails": ConsoleTools processes this one normally and only then throws on the Combining group.
      "group_001_real.json": singleOptionGroup("Real", {
        [mtrlGamePath]: mtrlZipPath.replace(/\//g, "\\"),
      }),
      "group_002_combining.json": combiningGroup,
    },
    files: {
      [mtrlZipPath]: buildEwColorsetMtrl(normalTexPath),
      [containerZipPath]: CONTAINER_PAYLOAD,
    },
  },
  "upgrade-error",
);
