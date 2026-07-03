import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readPmp, writePmp } from "../../src/container/pmp";
import { readZip } from "../../src/zip/zip";
import { structurallyEqual } from "./compare";

const dec = new TextDecoder();
const manifestNames = (z: Map<string, Uint8Array>) =>
  [...z.keys()].filter((k) => /^group_\d+.*\.json$/i.test(k)).sort();

/** Register the PMP manifest-fidelity round-trip for one .pmp pack (re-emit every manifest JSON
 * structurally unchanged). Independently validates PMP fidelity against the original on-disk JSON. */
export function registerPmpManifestChecks(pack: string): void {
  describe(`pmp manifest round-trip: ${basename(pack)}`, () => {
    it("re-emits every manifest JSON structurally unchanged", () => {
      const inZ = readZip(readFileSync(pack));
      const outZ = readZip(writePmp(readPmp(readFileSync(pack))));
      for (const fixed of ["meta.json", "default_mod.json"]) {
        const a = JSON.parse(dec.decode(inZ.get(fixed)!));
        const b = JSON.parse(dec.decode(outZ.get(fixed)!));
        expect(structurallyEqual(a, b), `${fixed} differs`).toBe(true);
      }
      const inG = manifestNames(inZ);
      const outG = manifestNames(outZ);
      expect(outG.length).toBe(inG.length);
      for (let i = 0; i < inG.length; i++) {
        const a = JSON.parse(dec.decode(inZ.get(inG[i]!)!));
        const b = JSON.parse(dec.decode(outZ.get(outG[i]!)!));
        expect(structurallyEqual(a, b), `${inG[i]} vs ${outG[i]} differ`).toBe(true);
      }
    }, 600_000);
  });
}
