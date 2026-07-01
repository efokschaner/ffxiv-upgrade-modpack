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

describe.skipIf(inputs.length === 0)("mtrl corpus", () => {
  for (const path of inputs) {
    const name = basename(path);
    it(`self round-trips every .mtrl in ${name}`, () => {
      const files = mtrlFiles(path);
      let tested = 0;
      const mismatches: string[] = [];
      for (const f of files) {
        const decoded = decodeSqPackFile(f.data);
        if (decoded.type !== SqPackType.Standard) continue; // materials are Type 2
        const re = serializeMtrl(parseMtrl(decoded.data, f.gamePath));
        if (bytesEqual(re, decoded.data)) tested++;
        else mismatches.push(`${f.gamePath} (${decoded.data.length} vs ${re.length})`);
      }
      console.log(`[mtrl] ${name}: ${tested}/${files.length} round-tripped`);
      if (mismatches.length) {
        expect.fail(`mtrl round-trip mismatch (${mismatches.length}): ${mismatches.join(", ")}`);
      }
    }, 1_200_000);
  }
});
