import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
} from "../../src/model/modpack";
import { decodeSqPackFile } from "../../src/sqpack/sqpack";
import { bytesEqual, compareBytesLex } from "./compare";

export type DiffStatus = "added" | "removed" | "mismatch";
export type DiffKind = "payload" | "manifest" | "structure";
export interface FileDiff {
  kind: DiffKind;
  gamePath: string; // for manifest/structure diffs this holds the archive member name
  index: number; // position within this path's sorted diff list — a stable id for the ratchet
  status: DiffStatus;
  detail?: string;
}
export interface PackDiff {
  pack: string;
  matched: number; // exact + confirmed-divergence pairs (not listed individually)
  files: FileDiff[]; // ONLY non-matched entries
}

function uncompressed(f: ModpackFile): Uint8Array | undefined {
  if (!f.data) return undefined; // absent PMP file: no payload (absent-file design spec §4.1)
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

function byGamePath(d: ModpackData): Map<string, Uint8Array[]> {
  const m = new Map<string, Uint8Array[]>();
  for (const { gamePath, file } of allFiles(d)) {
    const bytes = uncompressed(file);
    // An absent file has no payload and so is not a member of the per-gamePath multiset on either
    // side of the diff — that is the definition of the set, not a special case (design spec §4.1).
    if (!bytes) continue;
    const list = m.get(gamePath) ?? [];
    list.push(bytes);
    m.set(gamePath, list);
  }
  return m;
}

/** Diff our upgraded pack against the golden, keyed by gamePath payload multiset. */
export function diffUpgrade(
  pack: string,
  ours: ModpackData,
  golden: ModpackData,
  confirmDivergence: (
    gamePath: string,
    ours: Uint8Array,
    golden: Uint8Array,
  ) => boolean,
): PackDiff {
  const om = byGamePath(ours);
  const gm = byGamePath(golden);
  const paths = [...new Set([...om.keys(), ...gm.keys()])].sort();
  const files: FileDiff[] = [];
  let matched = 0;

  for (const gp of paths) {
    const oList = om.get(gp) ?? [];
    const gRemaining = (gm.get(gp) ?? []).slice();

    // 1. exact byte-equal pairs
    const oRemaining: Uint8Array[] = [];
    for (const o of oList) {
      const i = gRemaining.findIndex((g) => bytesEqual(o, g));
      if (i >= 0) {
        gRemaining.splice(i, 1);
        matched++;
      } else {
        oRemaining.push(o);
      }
    }

    // 2. confirmed-divergence pairs on the remainder
    // NOTE: This is greedy first-match pairing, NOT maximum bipartite matching.
    // When a single gamePath has multiple distinct payloads that could each confirm
    // against multiple goldens, it may under-match and report a false mismatch.
    // This is acceptable while DIVERGENCE_RULES is empty/simple and multi-payload-per-path
    // is rare; revisit with maximum matching if that changes.
    // (Phase 1 exact-match is unaffected — byte-equality is an equivalence relation, so greedy is optimal there.)
    const oFinal: Uint8Array[] = [];
    for (const o of oRemaining) {
      const i = gRemaining.findIndex((g) => confirmDivergence(gp, o, g));
      if (i >= 0) {
        gRemaining.splice(i, 1);
        matched++;
      } else {
        oFinal.push(o);
      }
    }

    // 3. leftovers, sorted for stable indices
    oFinal.sort(compareBytesLex);
    gRemaining.sort(compareBytesLex);
    const n = Math.min(oFinal.length, gRemaining.length);
    let index = 0;
    for (let i = 0; i < n; i++) {
      files.push({
        kind: "payload",
        gamePath: gp,
        index: index++,
        status: "mismatch",
        detail: `${oFinal[i]!.length} vs ${gRemaining[i]!.length} bytes`,
      });
    }
    for (let i = n; i < gRemaining.length; i++) {
      files.push({
        kind: "payload",
        gamePath: gp,
        index: index++,
        status: "added",
        detail: `${gRemaining[i]!.length} bytes`,
      });
    }
    for (let i = n; i < oFinal.length; i++) {
      files.push({
        kind: "payload",
        gamePath: gp,
        index: index++,
        status: "removed",
        detail: `${oFinal[i]!.length} bytes`,
      });
    }
  }

  return { pack, matched, files };
}
