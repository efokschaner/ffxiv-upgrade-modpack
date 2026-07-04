import { describe, expect, it } from "vitest";
import {
  decodeSqPackFile,
  detectTypeFromGamePath,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";

describe("sqpack dispatch", () => {
  it("detects type from game path", () => {
    expect(detectTypeFromGamePath("chara/x/a.mdl")).toBe(SqPackType.Model);
    expect(detectTypeFromGamePath("chara/x/a.tex")).toBe(SqPackType.Texture);
    expect(detectTypeFromGamePath("chara/x/a.mtrl")).toBe(SqPackType.Standard);
  });

  it("dispatches decode by entry fileType and round-trips via encode", () => {
    const raw = new Uint8Array(1234).map((_, i) => (i * 7) & 0xff);
    const entry = encodeSqPackFile(raw, SqPackType.Standard);
    const decoded = decodeSqPackFile(entry);
    expect(decoded.type).toBe(SqPackType.Standard);
    expect(decoded.data).toEqual(raw);
  });

  it("rejects invalid entry types", () => {
    const bad = new Uint8Array(16);
    new DataView(bad.buffer).setInt32(4, 1, true); // type 1 not supported
    expect(() => decodeSqPackFile(bad)).toThrow();
  });
});
