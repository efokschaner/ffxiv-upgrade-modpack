import { describe, expect, it } from "vitest";
import {
  emptyMeta,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../../src/model/modpack";
import { transformChanges } from "./upgrade-noop";

function file(...bytes: number[]): ModpackFile {
  return {
    storage: FileStorageType.RawUncompressed,
    data: new Uint8Array(bytes),
  };
}

function option(
  files: Record<string, ModpackFile>,
  manipulations: unknown[] = [],
): ModpackOption {
  return {
    name: "o",
    description: "",
    image: "",
    priority: 0,
    files: new Map(Object.entries(files)),
    fileSwaps: {},
    manipulations,
  };
}

function group(...options: ModpackOption[]): ModpackGroup {
  return {
    name: "g",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options,
  };
}

function pack(...groups: ModpackGroup[]): ModpackData {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: emptyMeta(),
    groups,
  };
}

describe("transformChanges", () => {
  it("reports nothing when every option's file set is unchanged", () => {
    const before = pack(group(option({ "chara/a.mdl": file(1, 2) })));
    const after = pack(group(option({ "chara/a.mdl": file(1, 2) })));
    expect(transformChanges(before, after)).toEqual([]);
  });

  it("reports a gamePath the transform ADDED", () => {
    const before = pack(group(option({ "chara/a.mdl": file(1) })));
    const after = pack(
      group(option({ "chara/a.mdl": file(1), "chara/b.tex": file(2) })),
    );
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/b.tex",
        index: 0,
        status: "added",
        detail: undefined,
      },
    ]);
  });

  it("reports a gamePath the transform REMOVED", () => {
    const before = pack(
      group(option({ "chara/a.mdl": file(1), "chara/b.tex": file(2) })),
    );
    const after = pack(group(option({ "chara/a.mdl": file(1) })));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/b.tex",
        index: 0,
        status: "removed",
        detail: undefined,
      },
    ]);
  });

  it("reports CHANGED content under the same gamePath", () => {
    const before = pack(group(option({ "chara/a.mdl": file(1, 2) })));
    const after = pack(group(option({ "chara/a.mdl": file(1, 9) })));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/a.mdl",
        index: 0,
        status: "mismatch",
        detail: "2 vs 2 bytes",
      },
    ]);
  });

  // PINS THE DELIBERATE SCOPE (spec §3.2). TexTools' AnyChanges compares ONLY
  // StandardData.Files, so a transform that rewrites manipulations still no-ops and still
  // writes nothing. Tightening this predicate to whole-model identity would diverge from the
  // oracle's own branch condition -- this test must fail if someone tries.
  it("does NOT report a manipulation change when the file set is identical", () => {
    const before = pack(
      group(option({ "chara/a.mdl": file(1) }, [{ Type: "Eqp", SetId: 1 }])),
    );
    const after = pack(
      group(option({ "chara/a.mdl": file(1) }, [{ Type: "Eqp", SetId: 999 }])),
    );
    expect(transformChanges(before, after)).toEqual([]);
  });

  it("keys changes per OPTION, so a file moving between options is caught", () => {
    const before = pack(group(option({ "chara/a.mdl": file(1) }), option({})));
    const after = pack(group(option({}), option({ "chara/a.mdl": file(1) })));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/a.mdl",
        index: 0,
        status: "removed",
        detail: undefined,
      },
      {
        kind: "transform",
        gamePath: "g0/o1|chara/a.mdl",
        index: 0,
        status: "added",
        detail: undefined,
      },
    ]);
  });

  it("reports a structural change when option counts differ", () => {
    const before = pack(group(option({}), option({})));
    const after = pack(group(option({})));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o1|<option>",
        index: 0,
        status: "removed",
        detail: undefined,
      },
    ]);
  });

  it("reports a structural change when group counts differ", () => {
    const before = pack(group(option({})), group(option({})));
    const after = pack(group(option({})));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g1/o0|<group>",
        index: 0,
        status: "removed",
        detail: undefined,
      },
    ]);
  });

  it("treats an absent payload as equal only to another absent payload", () => {
    const absent: ModpackFile = { storage: FileStorageType.RawUncompressed };
    const before = pack(group(option({ "chara/a.mdl": absent })));
    const sameAbsent = pack(group(option({ "chara/a.mdl": absent })));
    expect(transformChanges(before, sameAbsent)).toEqual([]);

    const nowPresent = pack(group(option({ "chara/a.mdl": file(1) })));
    expect(transformChanges(before, nowPresent)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/a.mdl",
        index: 0,
        status: "mismatch",
        detail: "absent vs 1 bytes",
      },
    ]);
  });
});
