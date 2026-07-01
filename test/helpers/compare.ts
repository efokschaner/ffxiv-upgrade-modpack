// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { allFiles, type ModpackData } from "../../src/model/modpack";

export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => structurallyEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>; const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const av = ao[k]; const bv = bo[k];
    if ((av === null || av === undefined) && (bv === null || bv === undefined)) continue;
    if (!structurallyEqual(av, bv)) return false;
  }
  return true;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function compareBytesLex(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { if (a[i] !== b[i]) return a[i]! - b[i]!; }
  return a.length - b.length;
}

export function compareInnerFilesByteIdentical(a: ModpackData, b: ModpackData): { ok: boolean; mismatches: string[] } {
  // A game path may appear in multiple options with different bytes; compare the
  // full multiset of payloads per path, order-independently.
  const group = (d: ModpackData) => {
    const m = new Map<string, Uint8Array[]>();
    for (const f of allFiles(d)) {
      const list = m.get(f.gamePath) ?? [];
      list.push(f.data);
      m.set(f.gamePath, list);
    }
    for (const list of m.values()) list.sort(compareBytesLex);
    return m;
  };
  const am = group(a); const bm = group(b);
  const mismatches: string[] = [];
  const paths = new Set([...am.keys(), ...bm.keys()]);
  for (const path of paths) {
    const al = am.get(path) ?? [];
    const bl = bm.get(path) ?? [];
    if (al.length !== bl.length) { mismatches.push(`payload count differs for ${path}: ${al.length} vs ${bl.length}`); continue; }
    for (let i = 0; i < al.length; i++) {
      if (!bytesEqual(al[i]!, bl[i]!)) mismatches.push(`bytes differ: ${path} (payload ${i})`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
