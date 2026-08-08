import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import { ModpackFormat } from "../../src/model/modpack";
import { upgradeModpack } from "../../src/upgrade/upgrade";
import { DiagnosticCode } from "../../src/util/diagnostic";
import { writeZip } from "../../src/zip/zip";

const enc = new TextEncoder();
const j = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v, null, 2));

function baseMeta(): Record<string, unknown> {
  return {
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
  };
}

function packFromMeta(meta: Record<string, unknown>): Uint8Array {
  return writeZip(new Map<string, Uint8Array>([["meta.json", j(meta)]]));
}

function pack(fileVersion: number): Uint8Array {
  return packFromMeta({ FileVersion: fileVersion, ...baseMeta() });
}

/** A `meta.json` that OMITS `FileVersion` entirely — the realistic shape of a genuine pre-v4 pack
 * predating the field, as opposed to `pack(...)` which always serializes an explicit numeric key.
 * `baseMeta()` never sets the property on the object at all (not merely to `undefined`), and
 * `JSON.stringify` drops a key that was never set — the assertion in the test below confirms this
 * end to end through the real reader, rather than relying on that reasoning alone. */
function packWithoutFileVersionKey(): Uint8Array {
  return packFromMeta(baseMeta());
}

describe("upgradeModpack v4 refusal (ModpackUpgrader.cs · UpgradeModpack · 218-241)", () => {
  it("refuses a v4 PMP with TexTools' exact message", () => {
    const result = upgradeModpack(readPmp(pack(4)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const last = result.diagnostics.at(-1);
    expect(last?.code).toBe(DiagnosticCode.UpgradeFailed);
    expect(last?.message).toBe(
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

  it(
    "does not refuse a PMP whose meta.json omits FileVersion (pre-v4 packs predate the field; " +
      "PMP.cs:170-173's NullValueHandling.Ignore deserialize leaves the C# field at its int default " +
      "of 0, PMP.cs:1469)",
    () => {
      const data = readPmp(packWithoutFileVersionKey());
      // Proves what the helper actually serializes, through the real reader, not just by inspection
      // of the builder above: the key is genuinely absent from `meta.raw`, not merely zero-valued.
      expect(
        (data.meta.raw as { FileVersion?: unknown } | undefined)?.FileVersion,
      ).toBeUndefined();
      expect(upgradeModpack(data).ok).toBe(true);
    },
  );
});
