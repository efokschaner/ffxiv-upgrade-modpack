// Harness-side mirror of ModpackUpgrader.AnyChanges
// (reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/Mods/ModpackUpgrader.cs
// · AnyChanges · 25-49, called at :186-209 and gating the write at :212-219).
//
// This is NOT ported business logic and does not belong in src/: our product deliberately diverges
// from TexTools by ALWAYS resaving rather than declining to write when nothing changed. The harness
// needs the predicate only to interpret the oracle's SILENCE -- a missing golden means "/upgrade's
// transform changed no option's file set", and this asserts our transform agrees.
// See docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §3.2 and §4.
//
// Scope is file sets ONLY, matching the C#: AnyChanges compares each option's
// StandardData.Files (count, keys, FileStorageInformation equality) and nothing else. TexTools
// still no-ops when its transform mutates manipulations or group structure, so a faithful port must
// be free to do the same. Do NOT tighten this to whole-model identity -- upgrade-noop.test.ts pins
// that deliberately.
//
// C# captures `originals` AFTER WizardData.FromModpack (:58 then :64-80), so load-time fixes are
// baked into the baseline and are invisible to the predicate. Our caller mirrors that by passing
// the POST-LOAD, PRE-TRANSFORM model as `before`. This is therefore the ONLY assertion on the no-op
// branch that bypasses the writer, deliberately: it is about the transform alone.
//
// TWO deliberate departures from the C#, both of which make this predicate WEAKER, never stronger:
//
//  1. Pairing. C# keys `originals` by WizardOptionEntry REFERENCE (:64, :76), which works because
//     its transform mutates options in place; ours clones, so we pair by group index then option
//     index. Neither pipeline adds or removes options, so position aligns them -- the same
//     assumption 2026-07-04-upgrade-golden-harness-design.md §3 already relies on. A count mismatch
//     is reported rather than silently truncated.
//
//  2. Equality. C# compares FileStorageInformation.Equals, and that type is a plain struct with NO
//     custom Equals (TransactionDataHandler.cs:42-71) -- so it is field-wise over StorageType,
//     RealOffset, RealPath, FileSize, and RealPath is a TEMP FILE PATH. In C#, rewriting a file to
//     byte-identical content is therefore still a change. We compare bytes, because ModpackFile
//     carries no such descriptor.
//
//     Safe precisely because it is weaker: a byte change implies a FileStorageInformation change, so
//     anything we flag C# would have flagged too. The converse gap cannot arise HERE -- had C# seen
//     any change it would have written a golden and we would be on the real-golden branch. On the
//     no-op branch the two verdicts cannot disagree.

import type {
  ModpackData,
  ModpackFile,
  ModpackOption,
} from "../../src/model/modpack";
import { bytesEqual } from "./compare";
import type { FileDiff } from "./upgrade-diff";

/** `<group index>/<option index>|<gamePath>` — the identity a transform change is keyed by. The
 *  option coordinates are part of the key because AnyChanges compares PER OPTION: the same gamePath
 *  in two options is two independent entries, and a file moving between options is a removal plus an
 *  addition, not a match. (diffUpgrade's whole-pack multiset flattens exactly that away.) */
function changeKey(group: number, option: number, gamePath: string): string {
  return `g${group}/o${option}|${gamePath}`;
}

function describe(f: ModpackFile): string {
  return f.data === undefined ? "absent" : `${f.data.length}`;
}

/** Byte comparison that treats an ABSENT payload (a PMP `Files` entry naming a zip member the
 *  archive does not contain — see ModpackFile's doc comment) as equal only to another absent
 *  payload, never to empty bytes. */
function sameContent(a: ModpackFile, b: ModpackFile): boolean {
  if (a.data === undefined || b.data === undefined) {
    return a.data === undefined && b.data === undefined;
  }
  return bytesEqual(a.data, b.data);
}

function optionChanges(
  before: ModpackOption,
  after: ModpackOption,
  group: number,
  option: number,
): FileDiff[] {
  const diffs: FileDiff[] = [];
  for (const [gamePath, b] of before.files) {
    const a = after.files.get(gamePath);
    if (a === undefined) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(group, option, gamePath),
        index: 0,
        status: "removed",
        detail: undefined,
      });
      continue;
    }
    if (!sameContent(b, a)) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(group, option, gamePath),
        index: 0,
        status: "mismatch",
        detail: `${describe(b)} vs ${describe(a)} bytes`,
      });
    }
  }
  for (const gamePath of after.files.keys()) {
    if (!before.files.has(gamePath)) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(group, option, gamePath),
        index: 0,
        status: "added",
        detail: undefined,
      });
    }
  }
  return diffs;
}

/** Every file-set change our transform made, per option. EMPTY means our upgrade satisfies the same
 *  condition ConsoleTools branches on when it declines to write a golden.
 *
 *  `before` must be the POST-LOAD, PRE-TRANSFORM model and `after` the transform's result. Safe to
 *  pass the same `source` object the caller handed `upgradeModpack`: it clones and never mutates its
 *  argument (src/upgrade/upgrade.ts). */
export function transformChanges(
  before: ModpackData,
  after: ModpackData,
): FileDiff[] {
  const diffs: FileDiff[] = [];
  const groupCount = Math.max(before.groups.length, after.groups.length);
  for (let g = 0; g < groupCount; g++) {
    const bg = before.groups[g];
    const ag = after.groups[g];
    if (bg === undefined || ag === undefined) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(g, 0, "<group>"),
        index: 0,
        status: bg === undefined ? "added" : "removed",
        detail: undefined,
      });
      continue;
    }
    const optionCount = Math.max(bg.options.length, ag.options.length);
    for (let o = 0; o < optionCount; o++) {
      const bo = bg.options[o];
      const ao = ag.options[o];
      if (bo === undefined || ao === undefined) {
        diffs.push({
          kind: "transform",
          gamePath: changeKey(g, o, "<option>"),
          index: 0,
          status: bo === undefined ? "added" : "removed",
          detail: undefined,
        });
        continue;
      }
      diffs.push(...optionChanges(bo, ao, g, o));
    }
  }
  return diffs;
}
