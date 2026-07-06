// Dev-time regenerator for the Type-4 (texture) SQPack golden. NOT part of the test gate.
// Requires ConsoleTools (FFXIV TexTools); override its path with the CONSOLE_TOOLS env var.
//
//   npx tsx test/sqpack/fixtures/regen.ts
//
// Why a committed golden (see also fixtures/README.md): our Type-4 texture DECODER is validated
// against SE's real Type-4 COMPRESSOR output. The corpus /unwrap oracle cannot help — it does NOT
// decompress Type 4 (corpus-sqpack.ts: "/unwrap doesn't decompress Type 4") — and no independent
// tool reproduces SE's exact Type-4 bytes. So we capture ONE SE-wrapped entry from a synthetic
// (our-pixels) uncompressed tex, commit it, and decode it at test time with no game and no
// ConsoleTools. The input pixels are ours, so the compressed output is a mechanical transform of our
// own data — committable, exactly like the bcn decode goldens.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSqPackFile, SqPackType } from "../../../src/sqpack/sqpack";
import { encodeUncompressedTex } from "../../../src/tex/encode";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSOLE_TOOLS =
  process.env.CONSOLE_TOOLS ??
  "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";

// Synthetic 64x64 A8R8G8B8 source with decorrelated channels + a full mip chain, so the Type-4 entry
// spans multiple mip blocks. Deterministic — the same bytes every run.
const W = 64;
const H = 64;
function buildRawTex(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      rgba[o] = (x * 4) & 0xff;
      rgba[o + 1] = (y * 4) & 0xff;
      rgba[o + 2] = ((x ^ y) * 3) & 0xff;
      rgba[o + 3] = 255 - ((x + y) & 0xff);
    }
  }
  return encodeUncompressedTex(rgba, W, H, { mips: true });
}

function main(): void {
  const raw = buildRawTex();
  const tmp = mkdtempSync(join(tmpdir(), "type4-regen-"));
  const rawPath = join(tmp, "sample.tex");
  const entryPath = join(tmp, "sample.bin");
  writeFileSync(rawPath, raw);
  // The ff-path is metadata only for Type-4 tex compression (a synthetic path works — no game lookup).
  execFileSync(
    CONSOLE_TOOLS,
    [
      "/wrap",
      rawPath,
      entryPath,
      "chara/common/texture/-synthetic-type4-golden.tex",
      "/sqpack",
    ],
    { stdio: "pipe" },
  );
  const entry = new Uint8Array(readFileSync(entryPath));
  rmSync(tmp, { recursive: true, force: true });

  // Gate at generation time: SE must produce a Type-4 entry and OUR decoder must round-trip it exactly.
  const decoded = decodeSqPackFile(entry);
  if (decoded.type !== SqPackType.Texture) {
    throw new Error(
      `expected a Type-4 (Texture) entry, got type ${decoded.type}`,
    );
  }
  if (
    decoded.data.length !== raw.length ||
    !decoded.data.every((b, i) => b === raw[i])
  ) {
    throw new Error(
      "decode(SE-wrapped) != synthetic raw tex — investigate before committing",
    );
  }

  writeFileSync(join(HERE, "type4-sample.tex"), raw);
  writeFileSync(join(HERE, "type4-sample.bin"), entry);
  console.log(
    `wrote type4-sample.tex (${raw.length}B) + type4-sample.bin (${entry.length}B, Type ${decoded.type})`,
  );
}

main();
