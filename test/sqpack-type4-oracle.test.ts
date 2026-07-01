// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import { extractGameFile, wrap, gameAvailable } from "./helpers/oracle";

const GAME_TEX_PATHS = [
  "chara/common/texture/eye/eye01_base.tex",
  "chara/common/texture/eye/eye01_mask.tex",
];

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe.skipIf(!gameAvailable())("sqpack Type 4 /wrap bridge", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sqpack-tex-"));

  for (const gamePath of GAME_TEX_PATHS) {
    it(`decode(SE-wrapped) === extracted raw for ${gamePath}`, () => {
      const rawPath = join(tmp, "raw.tex");
      const sePath = join(tmp, "se.bin");
      let raw: Uint8Array;
      try {
        extractGameFile(gamePath, rawPath);       // uncompressed .tex from the game
        raw = new Uint8Array(readFileSync(rawPath));
        wrap(rawPath, sePath, gamePath);           // SE re-compresses to a Type 4 entry (/sqpack)
      } catch (err) {
        // Path not present on this install — treat as inconclusive skip, but log it so a fully-skipped
        // bridge (green with zero assertions) is visible rather than silently passing.
        console.log(`[type4 /wrap bridge] INCONCLUSIVE skip for ${gamePath}: ${(err as Error).message}`);
        return;
      }
      const seEntry = new Uint8Array(readFileSync(sePath));
      const decoded = decodeSqPackFile(seEntry);
      expect(decoded.type).toBe(SqPackType.Texture);
      expect(bytesEqual(decoded.data, raw)).toBe(true);
    }, 300_000);
  }
});
