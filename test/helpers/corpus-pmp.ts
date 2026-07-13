import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { readPmp, writePmp } from "../../src/container/pmp";
import { readZip } from "../../src/zip/zip";
import { structurallyEqual } from "./compare";
import { dropConfirmedAbsentKeys, memberKeys } from "./upgrade-archive-diff";

const dec = new TextDecoder();
const manifestNames = (z: Map<string, Uint8Array>) =>
  [...z.keys()].filter((k) => /^group_\d+.*\.json$/i.test(k)).sort();

/** Register the PMP manifest-fidelity round-trip for one .pmp pack (re-emit every manifest JSON
 * structurally unchanged). Independently validates PMP fidelity against the original on-disk JSON.
 *
 * A `Files` key our writer dropped is allowed through the SAME confirmation the golden harness
 * uses (`dropConfirmedAbsentKeys`, upgrade-archive-diff.ts) — not a second copy of the rule: it is
 * a real drop (PMP.cs:883-888, absent-file design spec §4.1) only when the ORIGINAL pack's own
 * archive never contained that key's payload under `looseKey` normalization (deliberately NOT the
 * reader's `windowsPathKey` — see that function's doc comment). Anything else (a changed value, a
 * key whose payload IS present, any other field) still fails structurallyEqual. */
export function registerPmpManifestChecks(pack: string): void {
  describe(`pmp manifest round-trip: ${basename(pack)}`, () => {
    it("re-emits every manifest JSON structurally unchanged", () => {
      const inZ = readZip(readFileSync(pack));
      const outZ = readZip(writePmp(readPmp(readFileSync(pack))));
      const present = memberKeys(inZ);
      for (const fixed of ["meta.json", "default_mod.json"]) {
        const a = JSON.parse(dec.decode(inZ.get(fixed)!));
        const b = JSON.parse(dec.decode(outZ.get(fixed)!));
        expect(
          structurallyEqual(dropConfirmedAbsentKeys(b, a, present), b),
          `${fixed} differs`,
        ).toBe(true);
      }
      const inG = manifestNames(inZ);
      const outG = manifestNames(outZ);
      expect(outG.length).toBe(inG.length);
      for (let i = 0; i < inG.length; i++) {
        const a = JSON.parse(dec.decode(inZ.get(inG[i]!)!));
        const b = JSON.parse(dec.decode(outZ.get(outG[i]!)!));
        expect(
          structurallyEqual(dropConfirmedAbsentKeys(b, a, present), b),
          `${inG[i]} vs ${outG[i]} differ`,
        ).toBe(true);
      }
    }, 600_000);
  });
}
