import { describe, expect, it } from "vitest";
import { readTtmp2 } from "../../src/container/ttmp2";
import { allGroups } from "../../src/model/modpack";
import {
  makeTtmp2Simple,
  makeTtmp2WizardWithChecked,
} from "../helpers/make-packs";
import { buildWizardTtmp2 } from "../helpers/ttmp2-fixture";

describe("readTtmp2 selected", () => {
  it("copies IsChecked verbatim", () => {
    const data = readTtmp2(makeTtmp2WizardWithChecked([false, true]).bytes);
    expect(allGroups(data)[0]!.options.map((o) => o.selected)).toEqual([
      false,
      true,
    ]);
  });

  it("treats an absent IsChecked as false, then backstops option 0", () => {
    const data = readTtmp2(
      makeTtmp2WizardWithChecked([undefined, undefined]).bytes,
    );
    expect(allGroups(data)[0]!.options.map((o) => o.selected)).toEqual([
      true,
      false,
    ]);
  });

  // WizardData.cs:674 copies verbatim and the :761-763 backstop only fires when ZERO are
  // selected — a Single group with several checked stays several. Guards against inventing
  // an exclusivity invariant the C# model does not have.
  it("does NOT clamp a Single group with multiple IsChecked", () => {
    const data = readTtmp2(makeTtmp2WizardWithChecked([true, true]).bytes);
    expect(allGroups(data)[0]!.options.map((o) => o.selected)).toEqual([
      true,
      true,
    ]);
  });

  it("drops a zero-option group entirely (FromWizardGroup:749-753 + FromWizardModpackPage:986)", () => {
    const data = readTtmp2(
      buildWizardTtmp2([
        { name: "Empty", options: [] },
        { name: "Real", options: ["On"] },
      ]),
    );
    expect(allGroups(data).map((g) => g.name)).toEqual(["Real"]);
  });

  // WizardData.cs:1237-1240 — FromSimpleTtmp synthesizes its fake option with IsChecked = true.
  it("marks the synthesized simple-pack option selected", () => {
    const data = readTtmp2(makeTtmp2Simple().bytes);
    expect(allGroups(data)[0]!.options.map((o) => o.selected)).toEqual([true]);
  });
});
