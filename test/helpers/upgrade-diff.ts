import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
} from "../../src/model/modpack";
import { decodeSqPackFile } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";

export type DiffStatus = "added" | "removed" | "mismatch";
export interface FileDiff {
  gamePath: string;
  index: number; // position within this path's sorted diff list — a stable id for the ratchet
  status: DiffStatus;
  detail?: string;
}
export interface PackDiff {
  pack: string;
  matched: number; // exact + confirmed-divergence pairs (not listed individually)
  files: FileDiff[]; // ONLY non-matched entries
}

function uncompressed(f: ModpackFile): Uint8Array {
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

function byGamePath(d: ModpackData): Map<string, Uint8Array[]> {
  const m = new Map<string, Uint8Array[]>();
  for (const f of allFiles(d)) {
    const list = m.get(f.gamePath) ?? [];
    list.push(uncompressed(f));
    m.set(f.gamePath, list);
  }
  return m;
}

function lex(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
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
    oFinal.sort(lex);
    gRemaining.sort(lex);
    const n = Math.min(oFinal.length, gRemaining.length);
    let index = 0;
    for (let i = 0; i < n; i++) {
      files.push({
        gamePath: gp,
        index: index++,
        status: "mismatch",
        detail: `${oFinal[i]!.length} vs ${gRemaining[i]!.length} bytes`,
      });
    }
    for (let i = n; i < gRemaining.length; i++) {
      files.push({
        gamePath: gp,
        index: index++,
        status: "added",
        detail: `${gRemaining[i]!.length} bytes`,
      });
    }
    for (let i = n; i < oFinal.length; i++) {
      files.push({
        gamePath: gp,
        index: index++,
        status: "removed",
        detail: `${oFinal[i]!.length} bytes`,
      });
    }
  }

  return { pack, matched, files };
}
