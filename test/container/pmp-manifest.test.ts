import { describe, expect, it } from "vitest";
import { readPmp, writePmp } from "../../src/container/pmp";
import { readZip, writeZip } from "../../src/zip/zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Build a synthetic PMP with a Multi group (option Priority), an Imc group
 * (option AttributeMask, no Files/Image), and meta with DefaultPreferredItems. */
function makeImcPmp(): Uint8Array {
  const GAME = "chara/x/y.tex";
  const ZIP = "chara\\x\\y.tex";
  const FILE = new Uint8Array([1, 2, 3, 4]);
  const meta = {
    FileVersion: 3,
    Name: "T",
    Author: "a",
    Description: "",
    // A bare "3" fails .NET Version.TryParse (needs at least major.minor) -- WizardData.cs:1474-1475
    // falls back to `new Version("1.0")`. See the "1.0" assertion below.
    Version: "3",
    Website: "",
    Image: "",
    ModTags: [],
    DefaultPreferredItems: ["item-42"],
  };
  const defaultMod = {
    Version: 0,
    Files: {},
    FileSwaps: {},
    Manipulations: [],
  };
  const multi = {
    Version: 0,
    Name: "Models",
    Description: "",
    Image: "",
    Page: 0,
    Priority: 0,
    Type: "Multi",
    DefaultSettings: 0,
    Options: [
      {
        Name: "opt",
        Description: "",
        Priority: 7,
        Files: { [GAME]: ZIP },
        FileSwaps: {},
        Manipulations: [],
        // A foreign key: PmpStandardOptionJson (PMP.cs:1504-1517) owns no such field, so a real
        // typed round-trip drops it -- the same class of drop already proven for meta.json's
        // DefaultPreferredItems, below.
        FavoriteColor: "blue",
      },
      // No `Priority` key at all: PmpMultiOptionJson.Priority is ALWAYS serialized (PMP.cs:1540-1541,
      // no ShouldSerialize gate), so an option that omits it must still get `"Priority": 0` in the
      // golden -- `optionFromJson` (pmp.ts) already defaults `priority` to 0 for a source that omits it.
      {
        Name: "opt2",
        Description: "",
        Files: {},
        FileSwaps: {},
        Manipulations: [],
      },
    ],
  };
  const imc = {
    Version: 0,
    Name: "Ears",
    Description: "",
    Image: "",
    Page: 0,
    Priority: 0,
    Type: "Imc",
    DefaultSettings: 0,
    Identifier: { PrimaryId: 1 },
    // A COMPLETE PMPImcEntry (PmpManipulation.cs:311-321) plus the [JsonIgnore] AttributeAndSound
    // field (:318, dropped on write — see normalizeImcEntry, pmp-manipulation.ts): every OTHER
    // field must be present, since a group-level DefaultEntry is normalized through the same
    // required-field port as a manipulation's own Entry (pmp-manipulation.test.ts).
    DefaultEntry: {
      MaterialId: 1,
      DecalId: 0,
      VfxId: 0,
      MaterialAnimationId: 0,
      AttributeAndSound: 999,
      AttributeMask: 5,
      SoundId: 0,
    },
    AllVariants: false,
    OnlyAttributes: false,
    Options: [
      { Name: "no tufts", Description: "", AttributeMask: 5 },
      // ShouldSerializeIsDisableSubMod/AttributeMask (PMP.cs:1549-1550): IsDisableSubMod only
      // written when true; AttributeMask only written when !IsDisableSubMod -- so a disabled
      // sub-mod option must DROP its (foreign, here) AttributeMask entirely.
      {
        Name: "disabled",
        Description: "",
        IsDisableSubMod: true,
        AttributeMask: 9,
      },
    ],
  };
  return writeZip(
    new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      ["group_001_Models.json", enc.encode(JSON.stringify(multi))],
      ["group_002_Ears.json", enc.encode(JSON.stringify(imc))],
      [GAME, FILE],
    ]),
  );
}

describe("pmp manifest fidelity (Imc/Combining extras)", () => {
  it("preserves Imc AttributeMask and option Priority; regenerates Name/Description/Image for every option; drops meta extras the typed model does not own", () => {
    const out = readZip(writePmp(readPmp(makeImcPmp())));
    // Group filenames are lowercased by safeName (PMP.MakePMPPathSafe port, PMP.cs:1316-1326;
    // see src/container/pmp.ts), so "Models"/"Ears" become "models"/"ears" on disk.
    const imcGroup = JSON.parse(dec.decode(out.get("group_002_ears.json")!));
    const imcOpt = imcGroup.Options[0];
    expect(imcOpt.AttributeMask).toBe(5);
    expect("IsDisableSubMod" in imcOpt).toBe(false); // ShouldSerializeIsDisableSubMod: false -> omitted
    const disabledOpt = imcGroup.Options[1];
    expect(disabledOpt.IsDisableSubMod).toBe(true);
    expect("AttributeMask" in disabledOpt).toBe(false); // ShouldSerializeAttributeMask: !IsDisableSubMod
    // PMPImcGroupJson.DefaultEntry is the SAME PMPImcEntry struct as a manipulation's own `Entry`
    // (PmpManipulation.cs:311-321) -- its [JsonIgnore] AttributeAndSound field (:318) is dropped on
    // write here too, not just inside Manipulations (normalizeImcEntry, pmp-manipulation.ts).
    expect(imcGroup.DefaultEntry).toEqual({
      MaterialId: 1,
      DecalId: 0,
      VfxId: 0,
      MaterialAnimationId: 0,
      AttributeMask: 5,
      SoundId: 0,
    });
    expect("AttributeAndSound" in imcGroup.DefaultEntry).toBe(false);
    // The other three Imc-only group extras (PMP.cs:1426-1436) round-trip verbatim too, alongside
    // DefaultEntry -- all four are the genuinely untyped subtype extras `filteredRaw` (pmp.ts)
    // exists to preserve.
    expect(imcGroup.Identifier).toEqual({ PrimaryId: 1 });
    expect(imcGroup.AllVariants).toBe(false);
    expect(imcGroup.OnlyAttributes).toBe(false);
    expect("Files" in imcOpt).toBe(false); // Imc options have no Files (PmpImcOptionJson, PMP.cs:1544-1551)
    // Every OTHER option (Standard or Imc alike) always regenerates Name/Description/Image, even
    // when the source omitted Image (PMPOptionJson's base ShouldSerialize* default true; only
    // default_mod.json's IsDataContainerOnly override turns them off, PMP.cs:1496-1501) --
    // confirmed empirically against the /resave golden (`[DVNO] Desert Years.pmp`'s Imc group and
    // `[DVNO] DMBX Shoes 1.pmp`'s group options both gain "Image": "").
    expect(imcOpt.Image).toBe("");
    const multiGroup = JSON.parse(
      dec.decode(out.get("group_001_models.json")!),
    );
    const multiOpt = multiGroup.Options[0];
    expect(multiOpt.Priority).toBe(7);
    expect("FavoriteColor" in multiOpt).toBe(false); // foreign key, not owned by PmpStandardOptionJson
    // "opt2" omitted Priority entirely; PmpMultiOptionJson.Priority is always serialized.
    expect(multiGroup.Options[1].Priority).toBe(0);

    const meta = JSON.parse(dec.decode(out.get("meta.json")!));
    // meta.json is always regenerated from PMPMetaJson's flat, fully-typed field set (PMP.cs:1369-1381,
    // no extension-data capture), so a foreign key like Penumbra's own `DefaultPreferredItems` is
    // silently dropped by a real typed round-trip -- confirmed empirically (`[DVNO] DMBX Shoes
    // 1.pmp` /resave golden drops it).
    expect("DefaultPreferredItems" in meta).toBe(false);
    // Version.TryParse("3") fails (needs at least major.minor) -> falls back to "1.0"
    // (WizardData.cs:1474-1475/:1494).
    expect(meta.Version).toBe("1.0");
  });
});

describe("pmp group manifest drops foreign keys (PMPGroupJson, PMP.cs:1387-1408, no [JsonExtensionData])", () => {
  // PMPGroupJson is fully typed and SelectedSettings is [JsonIgnore] (:1400) -- a real typed
  // round-trip drops ANY key the class does not own, the same class of bug already proven for
  // meta.json's DefaultPreferredItems and an option's own foreign keys. Finding 5's fix
  // (`filteredRaw` in pmp.ts) replaced a blanket `...rawObj` spread -- which used to carry every
  // source key forward -- with an explicit pick of the typed fields.
  function makeGroupWithForeignKeys(): Uint8Array {
    const meta = {
      FileVersion: 3,
      Name: "T",
      Author: "",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: {},
      FileSwaps: {},
      Manipulations: [],
    };
    const group = {
      Version: 0,
      Name: "Foreign",
      Description: "",
      Image: "",
      Page: 0,
      Priority: 0,
      Type: "Single",
      DefaultSettings: 0,
      // [JsonIgnore] on the real C# type -- never serialized either way, but a document authored
      // outside TexTools (or an old TexTools version) could still carry it.
      SelectedSettings: 5,
      // Not a field of ANY PMPGroupJson subtype at all.
      SomeToolMetadata: "not a real field",
      Options: [
        {
          Name: "Only",
          Description: "",
          Files: {},
          FileSwaps: {},
          Manipulations: [],
        },
      ],
    };
    return writeZip(
      new Map<string, Uint8Array>([
        ["meta.json", enc.encode(JSON.stringify(meta))],
        ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
        ["group_001_Foreign.json", enc.encode(JSON.stringify(group))],
      ]),
    );
  }

  it("drops SelectedSettings and an arbitrary unrecognized key from the written group_NNN.json", () => {
    const out = readZip(writePmp(readPmp(makeGroupWithForeignKeys())));
    const groupName = [...out.keys()].find((n) =>
      /^group_\d+.*\.json$/i.test(n),
    );
    expect(groupName).toBeDefined();
    const grp = JSON.parse(dec.decode(out.get(groupName as string)!));
    expect("SelectedSettings" in grp).toBe(false);
    expect("SomeToolMetadata" in grp).toBe(false);
    // The typed fields survive untouched.
    expect(grp.Name).toBe("Foreign");
    expect(grp.Type).toBe("Single");
  });
});
