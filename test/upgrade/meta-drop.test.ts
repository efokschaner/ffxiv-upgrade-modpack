import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import { deserializeMeta } from "../../src/meta/deserialize";
import { serializeMeta } from "../../src/meta/serialize";
import type { ItemMeta } from "../../src/meta/types";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";
import { filesMap } from "../helpers/make-packs";

// A .meta with no segments at all -- byte-identical in shape to the real housing metas in the
// corpus (`bgcommon/hou/indoor/general/0613/i0613.meta` is 60 bytes: 4 version + 43 path + 1 NUL
// + 12 count/size/start, zero header entries, zero segment data).
function metaBytes(path: string, over: Partial<ItemMeta> = {}): Uint8Array {
  const m: ItemMeta = {
    version: 2,
    path,
    imc: null,
    eqp: null,
    eqdp: null,
    est: null,
    gmp: null,
    ...over,
  };
  return encodeSqPackFile(serializeMeta(m), SqPackType.Standard);
}

function packWithFiles(entries: [string, Uint8Array][]): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: ["t"],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [
      {
        name: "G",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "O",
            description: "",
            image: "",
            priority: 0,
            selected: false,
            fileSwaps: {},
            manipulations: [],
            files: filesMap(
              entries.map(([p, data]) => [
                p,
                { data, storage: FileStorageType.SqPackCompressed },
              ]),
            ),
          },
        ],
      },
    ],
  };
}

const outFiles = (d: ModpackData) => d.groups[0]!.options[0]!.files;

describe("metadataRound: manipulation-less .meta files are dropped", () => {
  it("drops a housing .meta with no segments instead of throwing", () => {
    const path = "bgcommon/hou/indoor/general/0613/i0613.meta";
    const out = upgradeModpack(
      packWithFiles([
        [path, metaBytes(path)],
        [
          "bgcommon/hou/indoor/general/0613/asset/fun_b0_m0613.mdl",
          new Uint8Array([1, 2, 3]),
        ],
      ]),
    );
    expect([...outFiles(out).keys()]).toEqual([
      "bgcommon/hou/indoor/general/0613/asset/fun_b0_m0613.mdl",
    ]);
  });

  it("drops a segment-less CHARA .meta too -- the rule is segment-based, not path-based", () => {
    // PMPExtensions.MetadataToManipulations emits nothing for this meta either, so
    // ManipulationsToMetadata never materializes the root. Same drop, no path check involved.
    // Note the `_met` suffix: parseMetaRoot's equipment regex (root.ts:50) requires a slot, so a
    // slot-less `e0208.meta` would throw for an unrelated reason and prove nothing.
    const path = "chara/equipment/e0208/e0208_met.meta";
    const out = upgradeModpack(packWithFiles([[path, metaBytes(path)]]));
    expect(outFiles(out).size).toBe(0);
  });

  it("keeps failing loud on an unknown root that DOES carry a segment", () => {
    // An IMC segment yields a manipulation (PmpExtensions.cs:456), so control reaches
    // reconstructMeta -> parseMetaRoot, which throws. Mirrors FromImcEntry's direct index into
    // XivItemTypeToPenumbraObject (PmpManipulation.cs:395), which has no indoor/outdoor key
    // (PmpExtensions.cs:216-224) and so would raise KeyNotFoundException in C#.
    const path = "bgcommon/hou/indoor/general/0613/i0613.meta";
    expect(() =>
      upgradeModpack(
        packWithFiles([[path, metaBytes(path, { imc: [new Uint8Array(6)] })]]),
      ),
    ).toThrow(/unrecognized root path/);
  });

  it("does not drop a meta whose only segment is EQP", () => {
    // Sanity: the predicate's null-check arm (PmpExtensions.cs:429) keeps a real chara meta alive.
    // EQP-only means reconstructMeta touches no IMC_TABLE / EST_TABLE lookup, and primaryId 208
    // is not 0, so the ItemMetadata.cs:522-528 set-0 EQP-drop quirk does not fire either.
    const path = "chara/equipment/e0208/e0208_met.meta";
    const out = upgradeModpack(
      packWithFiles([[path, metaBytes(path, { eqp: new Uint8Array(8) })]]),
    );
    expect([...outFiles(out).keys()]).toEqual([path]);
  });

  it("drops a meta whose segments are all present-but-empty", () => {
    // EST and IMC gate on `Count > 0` for real (PmpExtensions.cs:436,456) because their C#
    // deserializers -- v2 DeserializeEstData (ItemMetadata.cs:834-844) and DeserializeImcData
    // (:715-728) -- have no backfill, unlike EQDP (see the companion "present-but-empty EQDP"
    // test below), so an empty EST/IMC segment really is empty on both sides.
    const path = "chara/equipment/e0208/e0208_met.meta";
    const out = upgradeModpack(
      packWithFiles([[path, metaBytes(path, { imc: [], est: new Map() })]]),
    );
    expect(outFiles(out).size).toBe(0);
  });

  it("keeps a meta whose only segment is a present-but-empty EQDP, and backfills it to 18 races", () => {
    // EQDP's `Count > 0` gate (PmpExtensions.cs:446) can never be false in the C#: DeserializeEqdpData
    // unconditionally backfills every missing Eqp.PlayableRaces race after parsing
    // (ItemMetadata.cs:779-788), so a PRESENT segment always yields >= 18 entries there, even when the
    // mod's own segment carried zero. yieldsManipulations mirrors that EFFECTIVE gate with a bare
    // non-null check -- this pins the regression a literal `.size > 0` port would reintroduce (a
    // present-but-empty EQDP meta silently dropped, where TexTools keeps and backfills it).
    const path = "chara/equipment/e0208/e0208_met.meta";
    const out = upgradeModpack(
      packWithFiles([[path, metaBytes(path, { eqdp: new Map() })]]),
    );
    expect([...outFiles(out).keys()]).toEqual([path]);
    const decoded = decodeSqPackFile(outFiles(out).get(path)!.data!);
    const reconstructed = deserializeMeta(decoded.data);
    expect(reconstructed.eqdp?.size).toBe(18);
  });
});
