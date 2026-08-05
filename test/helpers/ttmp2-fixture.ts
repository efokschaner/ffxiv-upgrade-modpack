// Fixture builders for wizard .ttmp2 archives used by the container tests exercising the
// zero-option group drop and the dense PageIndex renumber (Task 7,
// docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md §1.3/§6). Shapes
// mirror scripts/generate-synthetics/ttmp2-builder.ts — its .mpl key order, its encodeSqPackFile
// dummy payload, its pinned mtime — but these builders return bytes directly instead of writing
// into test/corpus/: they back unit fixtures, not golden-harness packs.
import { zipSync } from "fflate";
import type { ModPackJson } from "../../src/container/manifest-types";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { readZip } from "../../src/zip/zip";

/** See ttmp2-builder.ts: fflate stamps Date.now() into every entry unless pinned. Not load-bearing
 *  for these in-memory fixtures (nothing caches them by hash), kept for consistency with the
 *  generator these shapes are built from. */
const FIXED_MTIME = new Date("2024-01-01T00:00:00");

const DUMMY_GAME_PATH = "chara/dummy/selection_type_dummy.bin";

/** TTMP payloads live in the .mpd as SQPACK-COMPRESSED blobs; a bare byte string won't decode. */
const DUMMY_PAYLOAD = encodeSqPackFile(
  new Uint8Array([0, 1, 2, 3]),
  SqPackType.Standard,
);

interface FixtureGroup {
  name: string;
  options: string[];
}

function modsJsonFor(name: string) {
  return {
    Name: name,
    Category: "Unknown",
    FullPath: DUMMY_GAME_PATH,
    ModOffset: 0,
    ModSize: DUMMY_PAYLOAD.length,
    DatFile: "040000",
    IsDefault: false,
  };
}

function modGroupJsonFor(g: FixtureGroup) {
  return {
    GroupName: g.name,
    SelectionType: "Single",
    OptionList: g.options.map((optName) => ({
      Name: optName,
      Description: "",
      ImagePath: "",
      GroupName: g.name,
      SelectionType: "Single",
      IsChecked: false,
      ModsJsons: [modsJsonFor(optName)],
    })),
  };
}

function buildArchive(
  pages: { pageIndex: number; groups: FixtureGroup[] }[],
): Uint8Array {
  const mpl = {
    TTMPVersion: "2.1w",
    Name: "Fixture",
    Author: "synthetic",
    Version: "1.0.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: pages.map((p) => ({
      PageIndex: p.pageIndex,
      ModGroups: p.groups.map(modGroupJsonFor),
    })),
  };
  return zipSync(
    {
      "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
      "TTMPD.mpd": DUMMY_PAYLOAD,
    },
    { mtime: FIXED_MTIME },
  );
}

/** One-page wizard .ttmp2. A group with `options: []` emits an empty `OptionList`. */
export function buildWizardTtmp2(groups: FixtureGroup[]): Uint8Array {
  return buildArchive([{ pageIndex: 0, groups }]);
}

/** Multi-page wizard .ttmp2. `pageIndex` is written verbatim as ModPackPageJson.PageIndex, and
 *  pages are emitted in ARRAY order — so the caller can author sparse, duplicated, or
 *  out-of-order indices, which is the whole point of the three renumbering tests. */
export function buildWizardTtmp2Pages(
  pages: { pageIndex: number; groups: FixtureGroup[] }[],
): Uint8Array {
  return buildArchive(pages);
}

/** Parse TTMPL.mpl back out of a written .ttmp2. */
export function readMplFrom(archive: Uint8Array): ModPackJson {
  const entries = readZip(archive);
  const name = [...entries.keys()].find((k) =>
    k.toLowerCase().endsWith(".mpl"),
  )!;
  return JSON.parse(
    new TextDecoder().decode(entries.get(name)!),
  ) as ModPackJson;
}
