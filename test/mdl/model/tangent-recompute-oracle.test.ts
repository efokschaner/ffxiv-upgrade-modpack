import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../../src/index";
import { allFiles } from "../../../src/model/modpack";
import { decodeSqPackFile } from "../../../src/sqpack/sqpack";
import { corpusPacks } from "../../helpers/corpus-roots";
import { resaveGoldenCached } from "../../helpers/resave-golden";

const PACK = "SM-Cherry Blossom Upscale.ttmp2";
const TARGET = "bgcommon/hou/outdoor/general/0112/bgparts/gar_b0_m0112.mdl";

function extractMdl(name: string, bytes: Uint8Array): Uint8Array | null {
  const data = loadModpack(name, bytes);
  for (const { gamePath, file } of allFiles(data)) {
    if (gamePath === TARGET) {
      return decodeSqPackFile((file as { data: Uint8Array }).data).data;
    }
  }
  return null;
}

/**
 * Real-oracle proof for the ported CalculateTangents recompute. TexTools' load path
 * (FromWizardGroup -> FixOldModel -> FromRaw -> CalculateTangents) runs for BOTH /upgrade and
 * /resave; /resave always writes the load-fixed model, so its golden carries the recomputed
 * binormals even though this pack's /upgrade golden is a no-op. We assert byte-equality with the
 * /resave golden EXCEPT byte 0 — the MDL version (v6-bump seam,
 * docs/backlog/2026-07-13-resave-mdl-v6-bump-seam.md), out of scope here.
 */
describe("CalculateTangents recompute vs /resave golden (gar_b0_m0112.mdl)", () => {
  it("matches the golden binormals byte-for-byte (except the v6 version byte)", () => {
    const packPath = corpusPacks().find((p) => basename(p) === PACK);
    if (packPath === undefined) {
      // Corpus is gitignored/machine-local; a clone without this pack no-ops (not a silent pass —
      // the recompute is also covered by the synthetic unit tests in this directory).
      return;
    }
    const bytes = new Uint8Array(readFileSync(packPath));
    const golden = resaveGoldenCached(PACK, bytes);
    if (golden === null || golden.kind !== "pack") {
      // No cached golden and no oracle available on this machine — nothing to diff against.
      return;
    }

    const ours = extractMdl(PACK, bytes);
    const theirs = extractMdl(`golden.ttmp2`, golden.bytes);
    expect(ours).not.toBeNull();
    expect(theirs).not.toBeNull();
    expect(ours!.length).toBe(theirs!.length);

    const diffs: number[] = [];
    for (let i = 0; i < ours!.length; i++) {
      if (ours![i] !== theirs![i]) diffs.push(i);
    }
    // Only byte 0 (MDL version) may differ; every binormal/handedness byte must match.
    expect(diffs).toEqual([0]);
  }, 1_200_000);
});
