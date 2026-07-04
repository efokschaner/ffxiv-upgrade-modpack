// Dev-time regenerator for the BCn golden decode fixtures. NOT part of the test gate.
// Requires DirectXTex `texconv` on PATH (or set env TEXCONV=C:\path\to\texconv.exe). See README.md.
//
//   npx tsx test/tex/fixtures/bcn/regen.ts
//
// Two-tier oracle (see README "Oracle"):
//   - BC7 is standardized bit-exact (BPTC), so the golden IS texconv's decode (independent). channelMap "swapRB".
//   - BC1/BC2/BC3/BC4/BC5 (S3TC/RGTC) are NOT bit-exact across implementations (the 1/3,2/3 midpoint rounding
//     is implementation-defined). Our decoder faithfully ports rgbcx's default cBC1Ideal (truncation), which is
//     the BcnSharp/rgbcx lineage TexTools uses; DirectXTex rounds. So for these the committed golden is OUR
//     decoder's frozen output (channelMap "none"), and this script GATES it against texconv within <=1 per
//     channel at generation time — an independent corroboration that there is no structural/channel-order bug.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeToRgba } from "../../../../src/tex/decode";
import {
  BC4,
  BC5,
  BC7,
  DXT1,
  DXT3,
  DXT5,
  type XivTex,
} from "../../../../src/tex/types";
import { applyChannelMap, bc7BlockMode } from "../../golden-util";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEXCONV = process.env.TEXCONV ?? "texconv";

type ChannelMap = "none" | "swapRB" | "grayFromR";
interface Fmt {
  key: string;
  texconv: string;
  xiv: string;
  code: number;
  // channelMap maps a STANDARD-order (texconv) buffer into OUR decoder's convention (spec §4).
  channelMap: ChannelMap;
  bc7max?: boolean;
}
const FORMATS: Fmt[] = [
  {
    key: "dxt1",
    texconv: "BC1_UNORM",
    xiv: "DXT1",
    code: DXT1,
    channelMap: "none",
  },
  {
    key: "dxt3",
    texconv: "BC2_UNORM",
    xiv: "DXT3",
    code: DXT3,
    channelMap: "none",
  },
  {
    key: "dxt5",
    texconv: "BC3_UNORM",
    xiv: "DXT5",
    code: DXT5,
    channelMap: "none",
  },
  {
    key: "bc4",
    texconv: "BC4_UNORM",
    xiv: "BC4",
    code: BC4,
    channelMap: "grayFromR",
  },
  {
    key: "bc5",
    texconv: "BC5_UNORM",
    xiv: "BC5",
    code: BC5,
    channelMap: "swapRB",
  },
  {
    key: "bc7",
    texconv: "BC7_UNORM",
    xiv: "BC7",
    code: BC7,
    channelMap: "swapRB",
    bc7max: true,
  },
];

type Px = (x: number, y: number) => [number, number, number, number];
interface Src {
  name: string;
  w: number;
  h: number;
  px: Px;
}
const REGION: [number, number, number, number][] = [
  [220, 30, 30, 255],
  [30, 220, 30, 255],
  [30, 30, 220, 255],
  [230, 230, 30, 255],
];
const SOURCES: Src[] = [
  // Smooth opaque gradient, distinct R/G (meaningful for BC4/BC5) -> BC7 mode 6.
  {
    name: "grad",
    w: 64,
    h: 64,
    px: (x, y) => [(x * 4) & 0xff, (y * 4) & 0xff, 128, 255],
  },
  // Sharp multi-color quadrants (2-3 subsets per straddling block) -> partitioned BC7 modes.
  {
    name: "regions",
    w: 64,
    h: 64,
    px: (x, y) => REGION[(x < 32 ? 0 : 1) + (y < 32 ? 0 : 2)]!,
  },
  // Color gradient with DECORRELATED alpha -> BC7 rotation/index modes 4/5 and RGBA partition mode 7.
  {
    name: "alpha",
    w: 64,
    h: 64,
    px: (x, y) => [(x * 4) & 0xff, 64, (y * 4) & 0xff, ((x ^ y) * 4) & 0xff],
  },
  // Non-power-of-two, non-multiple-of-4 -> partial edge blocks.
  {
    name: "edge",
    w: 65,
    h: 33,
    px: (x, y) => [(x * 3) & 0xff, (y * 7) & 0xff, ((x + y) * 2) & 0xff, 255],
  },
];

function texOf(
  format: number,
  width: number,
  height: number,
  mipData: Uint8Array,
): XivTex {
  return {
    attributes: 0,
    format,
    width,
    height,
    depth: 1,
    mipCount: 1,
    mipFlag: 0,
    arraySize: 1,
    lodMips: [0, 0, 0],
    mipMapOffsets: new Array(13).fill(0),
    mipData,
  };
}

// Max per-byte absolute difference between two equal-length buffers (-1 if lengths differ).
function maxDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return -1;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > m) m = d;
  }
  return m;
}

// Writes a 32-bit uncompressed TGA, top-left origin, BGRA byte order. DirectXTex reads TGA natively.
function writeTga(path: string, w: number, h: number, px: Px): void {
  const header = Buffer.from([
    0,
    0,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    32,
    0x28,
  ]);
  const body = Buffer.alloc(w * h * 4);
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      body[o++] = b;
      body[o++] = g;
      body[o++] = r;
      body[o++] = a;
    }
  }
  writeFileSync(path, Buffer.concat([header, body]));
}

// Strips a DDS container down to raw mip bytes, handling the optional DX10 extended header.
function stripDds(path: string): Uint8Array {
  const buf = new Uint8Array(readFileSync(path));
  if (buf[0] !== 0x44 || buf[1] !== 0x44 || buf[2] !== 0x53 || buf[3] !== 0x20)
    throw new Error(`not a DDS: ${path}`);
  // DDS_PIXELFORMAT.dwFourCC is at absolute offset 84; "DX10" => 20-byte DDS_HEADER_DXT10 follows.
  const dx10 =
    buf[84] === 0x44 &&
    buf[85] === 0x58 &&
    buf[86] === 0x31 &&
    buf[87] === 0x30;
  return buf.slice(dx10 ? 148 : 128);
}

function texconv(args: string[]): void {
  execFileSync(TEXCONV, ["-nologo", "-y", ...args], { stdio: "inherit" });
}

// Authors a valid 16-byte BC7 block for `mode`. Any 128-bit value whose low bits are `mode` zeros then a
// 1 is a well-formed mode-N block (BC7 decode is defined for every bit pattern), so a deterministic fill
// exercises the mode's partition/endpoint/index math. Used only for modes the encoder never emits (0/1/2):
// texconv still decodes it, providing the golden, and agreement with our decoder cross-checks that path.
function authorBc7Block(mode: number): Uint8Array {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = (i * 37 + 11) & 0xff;
  b[0] = ((b[0]! & (0xff << (mode + 1))) | (1 << mode)) & 0xff; // mode marker: bits 0..mode-1 = 0, bit mode = 1
  return b;
}

interface Vector {
  name: string;
  format: string;
  width: number;
  height: number;
  input: string;
  expected: string;
  channelMap: ChannelMap;
}

// Corroborates OUR decode against texconv, then returns the committed golden + its channelMap:
//   BC7 -> independent texconv golden (standard order, channelMap "swapRB"), must match EXACTLY.
//   BC1-5 -> OUR frozen output (channelMap "none"), gated to <=1 per channel vs texconv (S3TC rounding).
function goldenFor(
  f: Fmt,
  compressed: Uint8Array,
  texStd: Uint8Array,
  w: number,
  h: number,
  label: string,
): { bytes: Uint8Array; channelMap: ChannelMap } {
  const ours = decodeToRgba(texOf(f.code, w, h, compressed));
  const texInOurOrder = applyChannelMap(texStd, f.channelMap);
  const tol = f.xiv === "BC7" ? 0 : 1;
  const d = maxDiff(ours, texInOurOrder);
  if (d < 0)
    throw new Error(
      `${label}: length mismatch ours=${ours.length} tex=${texInOurOrder.length}`,
    );
  if (d > tol)
    throw new Error(
      `${label}: our decode differs from texconv by ${d} (> ${tol}) — a structural/channel-order discrepancy, not rounding. Investigate.`,
    );
  if (f.xiv === "BC7") return { bytes: texStd, channelMap: "swapRB" };
  return { bytes: ours, channelMap: "none" };
}

function main(): void {
  const srcDir = join(HERE, "sources");
  const imgDir = join(HERE, "images");
  const tmp = join(HERE, ".tmp");
  for (const d of [srcDir, imgDir]) mkdirSync(d, { recursive: true });

  const manifest: Vector[] = [];

  for (const s of SOURCES) {
    const tga = join(srcDir, `${s.name}.tga`);
    writeTga(tga, s.w, s.h, s.px);
    for (const f of FORMATS) {
      const encDir = join(tmp, "enc");
      const decDir = join(tmp, "dec");
      mkdirSync(encDir, { recursive: true });
      mkdirSync(decDir, { recursive: true });

      // Encode source -> single-mip BCn .dds. `-bc x` enables the slow BC7 modes 0/2 (max quality).
      texconv([
        "-m",
        "1",
        "-f",
        f.texconv,
        ...(f.bc7max ? ["-bc", "x"] : []),
        "-o",
        encDir,
        tga,
      ]);
      const encDds = join(encDir, `${s.name}.DDS`);
      const compressed = stripDds(encDds);
      writeFileSync(join(imgDir, `${s.name}.${f.key}.bin`), compressed);

      // Decode BCn .dds -> single-mip R8G8B8A8 .dds -> strip -> texconv's standard-order RGBA.
      texconv(["-m", "1", "-f", "R8G8B8A8_UNORM", "-o", decDir, encDds]);
      const texStd = stripDds(join(decDir, `${s.name}.DDS`));
      if (texStd.length !== s.w * s.h * 4)
        throw new Error(
          `texconv ${s.name}.${f.key}: got ${texStd.length} bytes, want ${s.w * s.h * 4}`,
        );

      const g = goldenFor(
        f,
        compressed,
        texStd,
        s.w,
        s.h,
        `${s.name}.${f.key}`,
      );
      writeFileSync(join(imgDir, `${s.name}.${f.key}.rgba`), g.bytes);
      manifest.push({
        name: `${s.name}.${f.key}`,
        format: f.xiv,
        width: s.w,
        height: s.h,
        input: `images/${s.name}.${f.key}.bin`,
        expected: `images/${s.name}.${f.key}.rgba`,
        channelMap: g.channelMap,
      });
    }
  }

  // Fallback: author blocks for any BC7 mode the encoder never emitted (real encoders skip the 3-subset
  // modes 0/2 and low-precision mode 1). Reuse a texconv-produced 4x4 BC7 DDS as the header template and
  // swap in the authored payload, so no DDS header is hand-written. BC7 => exact-match gate (tol 0).
  const bc7 = FORMATS.find((f) => f.xiv === "BC7")!;
  const imgBc7Modes = new Set<number>();
  for (const s of SOURCES) {
    const bin = new Uint8Array(readFileSync(join(imgDir, `${s.name}.bc7.bin`)));
    for (let off = 0; off + 16 <= bin.length; off += 16)
      imgBc7Modes.add(bc7BlockMode(bin, off));
  }
  const missingModes = [0, 1, 2, 3, 4, 5, 6, 7].filter(
    (m) => !imgBc7Modes.has(m),
  );
  if (missingModes.length) {
    const blocksDir = join(HERE, "blocks");
    mkdirSync(blocksDir, { recursive: true });
    const tmplTga = join(tmp, "tmpl4x4.tga");
    writeTga(tmplTga, 4, 4, () => [128, 64, 200, 255]);
    const encDir = join(tmp, "enc");
    mkdirSync(encDir, { recursive: true });
    texconv(["-m", "1", "-f", "BC7_UNORM", "-o", encDir, tmplTga]);
    const tmpl = new Uint8Array(readFileSync(join(encDir, "tmpl4x4.DDS")));
    const dx10 =
      tmpl[84] === 0x44 &&
      tmpl[85] === 0x58 &&
      tmpl[86] === 0x31 &&
      tmpl[87] === 0x30;
    const headerLen = dx10 ? 148 : 128;
    for (const mode of missingModes) {
      const block = authorBc7Block(mode);
      const dds = Uint8Array.from(tmpl);
      dds.set(block, headerLen);
      const modeTmp = join(tmp, `mode${mode}.dds`);
      writeFileSync(modeTmp, dds);
      const decDir = join(tmp, "dec");
      mkdirSync(decDir, { recursive: true });
      texconv(["-m", "1", "-f", "R8G8B8A8_UNORM", "-o", decDir, modeTmp]);
      const texStd = stripDds(join(decDir, `mode${mode}.DDS`));
      if (texStd.length !== 4 * 4 * 4)
        throw new Error(
          `fallback mode ${mode}: got ${texStd.length} bytes, want 64`,
        );
      const g = goldenFor(bc7, block, texStd, 4, 4, `block.bc7-mode${mode}`);
      writeFileSync(join(blocksDir, `bc7-mode${mode}.bin`), block);
      writeFileSync(join(blocksDir, `bc7-mode${mode}.rgba`), g.bytes);
      manifest.push({
        name: `block.bc7-mode${mode}`,
        format: "BC7",
        width: 4,
        height: 4,
        input: `blocks/bc7-mode${mode}.bin`,
        expected: `blocks/bc7-mode${mode}.rgba`,
        channelMap: g.channelMap,
      });
    }
  }

  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(
    join(HERE, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // Report BC7 mode coverage across all BC7 vectors (images + fallback blocks); the test asserts all 8.
  const modes = new Set<number>();
  for (const v of manifest) {
    if (v.format !== "BC7") continue;
    const bin = new Uint8Array(readFileSync(join(HERE, v.input)));
    for (let off = 0; off + 16 <= bin.length; off += 16)
      modes.add(bc7BlockMode(bin, off));
  }
  const covered = [...modes].filter((m) => m >= 0).sort((a, b) => a - b);
  console.log("BC7 modes covered:", covered.join(", "));
  const missing = [0, 1, 2, 3, 4, 5, 6, 7].filter((m) => !modes.has(m));
  if (missing.length)
    console.warn(
      `MISSING BC7 modes: ${missing.join(", ")} — could not author fallback.`,
    );
}

main();
