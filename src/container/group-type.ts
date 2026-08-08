// Port of WizardData's group-KIND discriminator: the `EGroupType` enum (WizardData.cs · EGroupType ·
// 32-37) and `WizardGroupEntry.GroupType` (WizardData.cs · WizardGroupEntry.GroupType · 611-625).
// Its own module rather than a helper inside pmp.ts/option-prefix.ts because those port different C#
// symbols (PMP.cs's container reader/writer and WizardData's prefix builders respectively), and
// several call sites across both need this one.
//
// `WizardOptionEntry.GroupType` (WizardData.cs · WizardOptionEntry.GroupType · 344-350) is a pure
// delegation to `_Group.GroupType`, so an option-level `o.GroupType` test in the C# — e.g. WritePmp's
// `if (o.GroupType != EGroupType.Standard) continue;` (WizardData.cs:1532-1535) — reads the OWNING
// GROUP's kind, and is ported here by calling this on the group.

import type { ModpackGroup } from "../model/modpack";

/** WizardData.cs · EGroupType · 32-37. `Combining` was added upstream by commit `76535f4` ("Add PMP
 * Combining group import support"), which is also what moved the refusal of a Combining group from
 * load time to write time — see `groupType` below and `writePmp` (src/container/pmp.ts). */
export enum EGroupType {
  Standard = "Standard",
  Imc = "Imc",
  Combining = "Combining",
}

/** Port of `WizardGroupEntry.GroupType` (WizardData.cs · WizardGroupEntry.GroupType · 611-625):
 *
 *     if (ImcData != null)                      return EGroupType.Imc;
 *     if (ModOption is PMPCombiningGroupJson)   return EGroupType.Combining;
 *     return EGroupType.Standard;
 *
 * The C# reads two fields the flattened port does not carry, but both are decided by the SOURCE
 * GROUP'S `Type` string and nothing else, so `selectionType` (which is exactly that string —
 * `readPmp` sets `selectionType: g.Type`) is a faithful stand-in:
 *  - `ImcData` is assigned by `FromPMPGroup` (WizardData.cs · FromPMPGroup · 790-801) if and only if
 *    `pGroup as PMPImcGroupJson` is non-null, i.e. `Type == "Imc"` (the JsonSubtypes registration,
 *    PMP.cs:1493).
 *  - `ModOption` is the source `PMPGroupJson` itself (`group.ModOption = pGroup`, :773), so
 *    `is PMPCombiningGroupJson` holds exactly when `Type == "Combining"` (PMP.cs:1494).
 *
 * A TTMP-sourced group takes the same path: `FromWizardGroup` (:651-767) sets `ModOption` to a
 * `ModGroupJson` and never touches `ImcData`, and both TTMP readers only ever produce
 * `"Single"`/`"Multi"` (src/container/ttmp2.ts, src/container/ttmp-legacy.ts) — Standard, as the C#
 * gives it.
 *
 * Note this is NOT `EOptionType` (WizardData.cs · EOptionType · 26-30, Single/Multi), which the same
 * `Type` string ALSO feeds via `pGroup.Type == "Single" ? Single : Multi` (:775) — that one is read
 * off `selectionType` directly at its own call sites (`groupSelection`, src/container/pmp.ts). */
export function groupType(group: ModpackGroup): EGroupType {
  if (group.selectionType === "Imc") return EGroupType.Imc;
  if (group.selectionType === "Combining") return EGroupType.Combining;
  return EGroupType.Standard;
}
