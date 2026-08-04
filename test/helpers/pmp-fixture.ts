// Minimal in-memory .pmp builder for unit tests. Unlike
// scripts/generate-synthetics/pmp-builder.ts's `writePmp` (which zips a corpus fixture to disk so
// it can be replayed through the /upgrade golden harness), this returns bytes directly for readPmp
// to consume in a synchronous unit test. Reuses that module's meta.json / default_mod.json JSON
// shapes (`syntheticMeta`, `EMPTY_DEFAULT_MOD`) so a hand-built pack parses exactly like a real
// Penumbra-authored one; the group shape below generalizes `singleOptionGroup` (which hardcodes
// exactly one option named "On") to an arbitrary list of empty, no-payload option names — these
// fixtures only need option/group IDENTITY, not file content.
import { zipSync } from "fflate";
import {
  EMPTY_DEFAULT_MOD,
  syntheticMeta,
} from "../../scripts/generate-synthetics/pmp-builder";
import type {
  PmpGroupJsonRaw,
  PmpOptionJsonRaw,
} from "../../src/container/manifest-types";

// Pinned, arbitrary zip mtime — see pmp-builder.ts's FIXED_MTIME for why (byte-reproducible
// output). Not load-bearing for these in-memory fixtures (nothing caches them), kept for
// consistency with the corpus builders.
const FIXED_MTIME = new Date("2024-01-01T00:00:00");

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

function testGroup(
  name: string,
  page: number,
  optionNames: string[],
): PmpGroupJsonRaw {
  return {
    Version: 0,
    Name: name,
    Description: "",
    Image: "",
    Page: page,
    Priority: 0,
    Type: "Single",
    DefaultSettings: 0,
    Options: optionNames.map(
      (optionName): PmpOptionJsonRaw => ({
        Name: optionName,
        Description: "",
        Image: "",
        Files: {},
        FileSwaps: {},
        Manipulations: [],
      }),
    ),
  };
}

export function buildTestPmp(spec: {
  defaultModFiles: Record<string, string>;
  groups: { name: string; page: number; optionNames: string[] }[];
}): Uint8Array {
  const defaultMod: PmpOptionJsonRaw =
    Object.keys(spec.defaultModFiles).length === 0
      ? EMPTY_DEFAULT_MOD
      : {
          Name: "",
          Description: "",
          Files: spec.defaultModFiles,
          FileSwaps: {},
          Manipulations: [],
        };
  const members: Record<string, Uint8Array> = {
    "meta.json": encodeJson(syntheticMeta("Test Pack")),
    "default_mod.json": encodeJson(defaultMod),
  };
  spec.groups.forEach((g, i) => {
    const fileName = `group_${String(i + 1).padStart(3, "0")}_${g.name}.json`;
    members[fileName] = encodeJson(testGroup(g.name, g.page, g.optionNames));
  });
  return zipSync(members, { mtime: FIXED_MTIME });
}
