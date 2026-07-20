import { describe, expect, it } from "vitest";
import { readTtmp2 } from "../../src/container/ttmp2";
import {
  makeTtmp2Simple,
  makeTtmp2WizardWithChecked,
} from "../helpers/make-packs";

describe("readTtmp2 selected", () => {
  it("copies IsChecked verbatim", () => {
    const data = readTtmp2(makeTtmp2WizardWithChecked([false, true]).bytes);
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([
      false,
      true,
    ]);
  });

  it("treats an absent IsChecked as false, then backstops option 0", () => {
    const data = readTtmp2(
      makeTtmp2WizardWithChecked([undefined, undefined]).bytes,
    );
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([
      true,
      false,
    ]);
  });

  // WizardData.cs:668 copies verbatim and the :755-757 backstop only fires when ZERO are
  // selected — a Single group with several checked stays several. Guards against inventing
  // an exclusivity invariant the C# model does not have.
  it("does NOT clamp a Single group with multiple IsChecked", () => {
    const data = readTtmp2(makeTtmp2WizardWithChecked([true, true]).bytes);
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([
      true,
      true,
    ]);
  });

  // WizardData.cs:1218-1221 — FromSimpleTtmp synthesizes its fake option with IsChecked = true.
  it("marks the synthesized simple-pack option selected", () => {
    const data = readTtmp2(makeTtmp2Simple().bytes);
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([true]);
  });
});
