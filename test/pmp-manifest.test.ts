import { describe, expect, it } from "vitest";
import { readPmp, writePmp } from "../src/container/pmp";
import { readZip, writeZip } from "../src/zip/zip";

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
    Version: "1.0",
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
    DefaultEntry: { MaterialId: 1 },
    AllVariants: false,
    OnlyAttributes: false,
    Options: [{ Name: "no tufts", Description: "", AttributeMask: 5 }],
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
  it("preserves Imc AttributeMask, option Priority, meta extras; adds no spurious keys", () => {
    const out = readZip(writePmp(readPmp(makeImcPmp())));
    const imcOpt = JSON.parse(dec.decode(out.get("group_002_Ears.json")!))
      .Options[0];
    expect(imcOpt.AttributeMask).toBe(5);
    expect("Files" in imcOpt).toBe(false); // Imc options have no Files
    expect("Image" in imcOpt).toBe(false); // and no Image
    const multiOpt = JSON.parse(dec.decode(out.get("group_001_Models.json")!))
      .Options[0];
    expect(multiOpt.Priority).toBe(7);
    const meta = JSON.parse(dec.decode(out.get("meta.json")!));
    expect(meta.DefaultPreferredItems).toEqual(["item-42"]);
  });
});
