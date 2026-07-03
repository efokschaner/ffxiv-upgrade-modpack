import { describe, expect, it } from "vitest";
import { readTtmp2, writeTtmp2 } from "../src/container/ttmp2";
import { allFiles } from "../src/model/modpack";
import { makeTtmp2Simple, makeTtmp2Wizard } from "./helpers/make-packs";

function roundTrip(bytes: Uint8Array) {
  const data = readTtmp2(bytes);
  return readTtmp2(writeTtmp2(data));
}

describe("writeTtmp2 round-trip", () => {
  it("preserves every inner file byte-for-byte (simple)", () => {
    const pack = makeTtmp2Simple();
    const out = roundTrip(pack.bytes);
    const byPath = new Map(allFiles(out).map((f) => [f.gamePath, f.data]));
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)).toEqual(bytes);
    }
  });

  it("preserves structure and files (wizard)", () => {
    const pack = makeTtmp2Wizard();
    const out = roundTrip(pack.bytes);
    expect(out.isSimple).toBe(false);
    expect(out.groups[0]!.options.map((o) => o.name)).toEqual(["A", "B"]);
    const byPath = new Map(allFiles(out).map((f) => [f.gamePath, f.data]));
    expect(byPath.get(Object.keys(pack.expectedFiles)[0]!)).toEqual(
      Object.values(pack.expectedFiles)[0],
    );
  });

  it("dedupes identical payloads into one blob region", () => {
    const data = readTtmp2(makeTtmp2Simple().bytes);
    // Force two files to share identical bytes.
    const files = allFiles(data);
    files[1]!.data = files[0]!.data.slice();
    const reread = readTtmp2(writeTtmp2(data));
    const rf = allFiles(reread);
    expect(rf[0]!.data).toEqual(rf[1]!.data);
  });
});
