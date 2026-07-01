// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const CONSOLE_TOOLS = "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
const CORPUS_INPUTS = join(__dirname, "..", "corpus", "inputs");
const GOLDEN_UPGRADE = join(__dirname, "..", "corpus", "golden-upgrade");

export function oracleAvailable(): boolean {
  return existsSync(CONSOLE_TOOLS);
}

export function corpusInputs(): string[] {
  if (!existsSync(CORPUS_INPUTS)) return [];
  return readdirSync(CORPUS_INPUTS)
    .filter((f) => /\.(ttmp2?|pmp)$/i.test(f))
    .map((f) => join(CORPUS_INPUTS, f));
}

function run(args: string[]): void {
  // execFileSync throws on non-zero exit; ConsoleTools returns -1 on error (Program.cs:94-138).
  execFileSync(CONSOLE_TOOLS, args, { stdio: "pipe" });
}

export function resave(src: string, dest: string): void { run(["/resave", src, dest]); }
export function upgrade(src: string, dest: string): void { run(["/upgrade", src, dest]); }

/** Runs /upgrade into test/corpus/golden-upgrade/ and returns the golden path. */
export function generateUpgradeGolden(inputPath: string): string {
  mkdirSync(GOLDEN_UPGRADE, { recursive: true });
  const out = join(GOLDEN_UPGRADE, basename(inputPath).replace(/\.[^.]+$/, ".ttmp2"));
  upgrade(inputPath, out);
  return out;
}

/** Unwraps a sqpack-compressed blob to raw bytes (Types 2 & 3 only). Use a neutral matching extension (e.g. `.bin`) for both paths. */
export function unwrap(src: string, dest: string): void { run(["/unwrap", src, dest]); }
/** Wraps raw bytes back into a sqpack-compressed blob. `ffPath` is the FFXIV game path used to select the compression scheme. */
export function wrap(src: string, dest: string, ffPath: string): void {
  run(["/wrap", src, dest, ffPath, "/sqpack"]);
}
/** Extracts a file directly from the game by its game path. `dest` extension should match `gamePath` to get raw uncompressed output. */
export function extractGameFile(gamePath: string, dest: string): void {
  run(["/extract", gamePath, dest]);
}
/** ConsoleTools present (game-path resolution is validated lazily by extract calls). */
export function gameAvailable(): boolean { return oracleAvailable(); }
