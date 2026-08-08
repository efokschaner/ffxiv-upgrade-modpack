import { describe, expect, it } from "vitest";
import type { ModPackJson } from "../../src/container/manifest-types";
import { readTtmp2, writeTtmp2 } from "../../src/container/ttmp2";
import {
  allGroups,
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { UnportedGapError } from "../../src/util/errors";
import { readZip, writeZip } from "../../src/zip/zip";
import { filesMap } from "../helpers/make-packs";

const enc = new TextEncoder();
const dec = new TextDecoder();

const PATH = "chara/human/c0101/obj/body/b0001/model/c0101b0001.mdl";
const BLOB = new Uint8Array([0xaa, 0x01, 0x02, 0x03]);

/** A group JSON authored as a raw object, not the typed TtmpModGroupJson: only a raw object can
 *  OMIT SelectionType, which is one of the cases WizardData.cs:658 has to answer for. */
function groupJson(selectionType?: string): Record<string, unknown> {
  const sel =
    selectionType === undefined ? {} : { SelectionType: selectionType };
  return {
    GroupName: "G",
    ...sel,
    OptionList: [
      {
        Name: "A",
        Description: "",
        ImagePath: "",
        GroupName: "G",
        ...sel,
        ModsJsons: [
          {
            Name: "N",
            Category: "C",
            FullPath: PATH,
            ModOffset: 0,
            ModSize: BLOB.length,
            DatFile: "040000.win32.dat0",
            IsDefault: false,
          },
        ],
      },
    ],
  };
}

function wizardPack(group: Record<string, unknown>): Uint8Array {
  const mpl = {
    TTMPVersion: "2.1w",
    Name: "sel",
    Author: "test",
    Version: "1.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [{ PageIndex: 0, ModGroups: [group] }],
  };
  return writeZip(
    new Map<string, Uint8Array>([
      ["TTMPL.mpl", enc.encode(JSON.stringify(mpl))],
      ["TTMPD.mpd", BLOB],
    ]),
  );
}

function dataWith(selectionType: string): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "m",
      author: "a",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    pages: [
      {
        groups: [
          {
            name: "G",
            description: "",
            image: "",
            priority: 0,
            selectionType,
            defaultSettings: 0,
            options: [
              {
                name: "A",
                description: "",
                image: "",
                priority: 0,
                selected: false,
                fileSwaps: {},
                manipulations: [],
                files: filesMap([
                  [
                    PATH,
                    { data: BLOB, storage: FileStorageType.SqPackCompressed },
                  ],
                ]),
              },
            ],
          },
        ],
      },
    ],
  };
}

function writtenMpl(data: ModpackData): ModPackJson {
  const entries = readZip(writeTtmp2(data));
  return JSON.parse(dec.decode(entries.get("TTMPL.mpl")!)) as ModPackJson;
}

// WizardData.cs:658 — `tGroup.SelectionType == "Single" ? Single : Multi`. The comparison is against
// "Single" only, so every other value — an unrecognized string, an absent key — lands on Multi.
// ConsoleTools confirms each row: test/corpus/synthetic/selection-type{,-absent}.ttmp2.
describe("readTtmp2 SelectionType (WizardData.cs:658)", () => {
  it.each([
    ["Single", "Single"],
    ["Multi", "Multi"],
    ["Single Selection", "Multi"],
    ["Multi Selection", "Multi"],
  ])("maps %j to %j", (raw, expected) => {
    const data = readTtmp2(wizardPack(groupJson(raw)));
    expect(allGroups(data)[0]!.selectionType).toBe(expected);
  });

  it("maps an absent SelectionType to Multi", () => {
    const data = readTtmp2(wizardPack(groupJson(undefined)));
    expect(allGroups(data)[0]!.selectionType).toBe("Multi");
  });
});

// WizardData.cs:883 (group) / :421 (option) — `SelectionType = OptionType.ToString()`, where
// OptionType is the two-valued EOptionType (:26-30) both readers collapse into (:658 TTMP, :775 PMP),
// and an option delegates to its group (:337-343).
describe("writeTtmp2 SelectionType (WizardData.cs:883/:421)", () => {
  it.each([
    ["Single", "Single"],
    ["Multi", "Multi"],
    // Any value that is not literally "Single" collapses to Multi, exactly as FromPMPGroup (:775)
    // and FromWizardGroup (:658) collapse it on the way in.
    //
    // This row used to be `["Combining", "Multi"]`, and that was pinning a BUG. `EGroupType`
    // (WizardData.cs:32-37) gained a `Combining` member in the v3.1.1.4 re-pin, and TexTools refuses
    // such a group on this path rather than collapsing it — `ToModGroup` passes it (:874-877 guards
    // only `ImcData`) and `WizardOptionEntry.ToModOption` throws at :425-428. Our writer now refuses
    // it too (see the two refusal cases below), so asserting the collapse here would assert the
    // silent-wrong-output this branch removed. An arbitrary string keeps the collapse itself pinned:
    // `groupType` classifies it Standard, matching the C# (`ImcData == null` and `ModOption` is not a
    // `PMPCombiningGroupJson`, WizardData.cs:611-625), so it reaches the collapse the way it always
    // did.
    ["Anything Else", "Multi"],
  ])("writes %j as %j at group and option level", (input, expected) => {
    const mpl = writtenMpl(dataWith(input));
    const g = mpl.ModPackPages![0]!.ModGroups[0]!;
    expect(g.SelectionType).toBe(expected);
    expect(g.OptionList[0]!.SelectionType).toBe(expected);
  });

  // EOptionType.ToString() can only ever yield the bare enum name, never a "… Selection" string.
  it("writes only the bare enum name", () => {
    const raw = dec.decode(
      readZip(writeTtmp2(dataWith("Multi"))).get("TTMPL.mpl")!,
    );
    expect(raw).not.toContain('Selection"');
    expect(raw).toContain('"SelectionType":"Multi"');
  });

  // ToModGroup throws InvalidDataException at its first statement (WizardData.cs:874-877),
  // before it builds the ModGroup or visits any option.
  it("throws on an Imc group (ToModGroup, WizardData.cs:874-877)", () => {
    expect(() => writeTtmp2(dataWith("Imc"))).toThrow(
      /TTMP Does not support IMC Groups/,
    );
  });

  // The Combining sibling, which the C# refuses one level DOWN and with a different message:
  // `WizardOptionEntry.ToModOption`'s `if (StandardData == null)` throw (WizardData.cs:425-428),
  // reached because `StandardData`'s getter returns null off-Standard (:376-388). We do not
  // reproduce that option-level seam, so ours is an `UnportedGapError` — asserted by TYPE, since the
  // point is the port-gap signal (which any ported catch must re-throw), not the wording. The
  // structural pin lives in ttmp2-write.test.ts; this one is here because this file is where the
  // "Combining writes as Multi" expectation used to live.
  it("throws UnportedGapError on a Combining group (ToModOption, WizardData.cs:425-428)", () => {
    expect(() => writeTtmp2(dataWith("Combining"))).toThrow(UnportedGapError);
  });
});
