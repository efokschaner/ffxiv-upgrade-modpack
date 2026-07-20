// Builds two PMPs whose single group carries a `Type` JsonSubtypes cannot resolve to a subtype
// (PMP.cs:1383-1386): one with an unrecognized value, one with the key omitted entirely. Both land
// in test/corpus/upgrade-error/ because ConsoleTools /upgrade FAILS on them, which is the point —
// the expected-failure check pins that our port refuses exactly the packs TexTools refuses.
//
// What the oracle does, measured (ConsoleTools /upgrade, both packs): exit -1, no output file, and a
// trace of `System.NotImplementedException: Unimplemented PMP group type: <Type>` thrown from
// `PMPGroupJson.get_Options()` via `PMPJson.GetHeaderImage()` inside `PMP.LoadPMP`. So there is no
// deserialization-time rejection (no `FallBackSubType` is declared here, unlike
// PmpManipulation.cs:21) — the base class loads fine and its virtual `Options` throws on first
// access, during LOAD, before any transform runs. The absent-`Type` pack interpolates C#'s null
// string as empty, yielding the trailing-colon message verbatim.
//
// They are two SEPARATE packs for the same reason selection-type/selection-type-absent are (see
// those builders): an absent key and a bogus value are distinct inputs, and isolating them keeps one
// pack's result from masking the other's.
//
// The .pmp files are gitignored; regenerate with `npm run synthetics`.

import type { PmpGroupJsonRaw } from "../../src/container/manifest-types";
import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

const dummyGamePath = "chara/dummy/group_type_dummy.bin";
const dummyZipPath = "files/group_type_dummy.bin";

/** A well-formed Single group, minus a resolvable `Type` — `mutate` breaks exactly that one key so
 * nothing else distinguishes these packs from any other passing synthetic. */
function groupWithBrokenType(
  mutate: (g: PmpGroupJsonRaw) => void,
): PmpGroupJsonRaw {
  const group = singleOptionGroup("Probe", {
    [dummyGamePath]: dummyZipPath.replace(/\//g, "\\"),
  });
  mutate(group);
  return group;
}

writePmp(
  "pmp-group-type-unknown.pmp",
  {
    meta: syntheticMeta("PMP Group Type Unknown Repro"),
    defaultMod: EMPTY_DEFAULT_MOD,
    groups: {
      "group_001_probe.json": groupWithBrokenType((g) => {
        g.Type = "Not A Real Type";
      }),
    },
    files: { [dummyZipPath]: DUMMY_PAYLOAD },
  },
  "upgrade-error",
);

writePmp(
  "pmp-group-type-absent.pmp",
  {
    meta: syntheticMeta("PMP Group Type Absent Repro"),
    defaultMod: EMPTY_DEFAULT_MOD,
    groups: {
      "group_001_probe.json": groupWithBrokenType((g) => {
        delete g.Type;
      }),
    },
    files: { [dummyZipPath]: DUMMY_PAYLOAD },
  },
  "upgrade-error",
);
