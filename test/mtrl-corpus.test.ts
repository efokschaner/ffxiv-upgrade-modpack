// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadModpack } from "../src/index";
import { allFiles, FileStorageType, type ModpackFile } from "../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";
import { corpusInputs } from "./helpers/oracle";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function mtrlFiles(path: string): ModpackFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f) => f.storage === FileStorageType.SqPackCompressed && f.gamePath.toLowerCase().endsWith(".mtrl"),
  );
}

const inputs = corpusInputs();

// Correctness gate for the MTRL codec over real SE/TexTools materials.
//
// Canonical inputs round-trip byte-identical: serializeMtrl(parseMtrl(x)) === x.
//
// Non-canonical inputs do NOT round-trip byte-identical, and that is expected (design spec §7):
// serializeMtrl faithfully reproduces C#'s Mtrl.XivMtrlToUncompressedMtrl, which normalizes such
// files exactly as we do — string-block re-padded to 4 (§5.1), shader-constant data size recomputed
// with zero-filled overflow constants (§6.4/§8), stale 0x08 dye flag cleared when no dye (§5.3).
// For these we require the normalization to be a STABLE FIXED POINT: re-round-tripping our own
// output reproduces it byte-for-byte. A non-fixed-point (unstable/nondeterministic) result would be
// a real codec bug and fails the test. The exact-match count (logged per pack) anchors faithfulness.
describe.skipIf(inputs.length === 0)("mtrl corpus", () => {
  for (const path of inputs) {
    const name = basename(path);
    it(`round-trips or stably normalizes every .mtrl in ${name}`, () => {
      const files = mtrlFiles(path);
      let exact = 0;
      let normalized = 0;
      const unstable: string[] = [];
      for (const f of files) {
        const decoded = decodeSqPackFile(f.data);
        if (decoded.type !== SqPackType.Standard) continue; // materials are Type 2
        const re = serializeMtrl(parseMtrl(decoded.data, f.gamePath));
        if (bytesEqual(re, decoded.data)) {
          exact++;
          continue;
        }
        // Non-canonical input: require our normalization to be a stable fixed point.
        const re2 = serializeMtrl(parseMtrl(re, f.gamePath));
        if (bytesEqual(re2, re)) {
          normalized++;
          continue;
        }
        unstable.push(`${f.gamePath} (${decoded.data.length}->${re.length}->${re2.length})`);
      }
      const total = exact + normalized + unstable.length;
      console.log(`[mtrl] ${name}: ${exact} exact, ${normalized} normalized, ${unstable.length} unstable (of ${total})`);
      if (unstable.length) {
        expect.fail(`mtrl round-trip UNSTABLE — not a fixed point (real codec bug): ${unstable.join(", ")}`);
      }
    }, 1_200_000);
  }
});
