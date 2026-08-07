import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import { ModpackFormat } from "../../src/model/modpack";
import { upgradeModpack } from "../../src/upgrade/upgrade";
import { writeZip } from "../../src/zip/zip";

const enc = new TextEncoder();
const j = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v, null, 2));

function pack(fileVersion: number): Uint8Array {
  return writeZip(
    new Map<string, Uint8Array>([
      [
        "meta.json",
        j({
          FileVersion: fileVersion,
          Name: "P",
          Author: "",
          Description: "",
          Version: "1.0",
          Website: "",
          Image: "",
          ModTags: [],
          Groups: [
            {
              Version: 0,
              Name: "G",
              Description: "",
              Image: "",
              Page: 0,
              Priority: 0,
              Type: "Single",
              DefaultSettings: 0,
              Options: [{ Name: "On", Description: "", Image: "", Files: {} }],
            },
          ],
          DefaultData: null,
        }),
      ],
    ]),
  );
}

describe("upgradeModpack v4 refusal (ModpackUpgrader.cs · UpgradeModpack · 218-241)", () => {
  it("refuses a v4 PMP with TexTools' exact message", () => {
    const result = upgradeModpack(readPmp(pack(4)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.at(-1)?.message).toBe(
      "Cannot convert v4+ Penumbra modpack to ttmp/pmp.",
    );
  });

  it("does not refuse a v3 PMP (the gate is `> 3`, ModpackUpgrader.cs:226)", () => {
    expect(upgradeModpack(readPmp(pack(3))).ok).toBe(true);
  });

  it("does not refuse a non-PMP model (the GetModpackType branch, ModpackUpgrader.cs:220-222)", () => {
    const data = readPmp(pack(4));
    data.sourceFormat = ModpackFormat.Ttmp2;
    expect(upgradeModpack(data).ok).toBe(true);
  });
});
