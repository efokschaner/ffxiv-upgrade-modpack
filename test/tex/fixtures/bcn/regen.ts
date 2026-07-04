// Dev-time regenerator for the BCn golden decode fixtures. NOT part of the test gate.
// Requires DirectXTex `texconv` on PATH (or set env TEXCONV=C:\path\to\texconv.exe). See README.md.
//
//   npx tsx test/tex/fixtures/bcn/regen.ts
//
// Per (source image, format): source .tga -> texconv encode -> BCn .dds -> strip container ->
// images/<name>.<fmt>.bin ; then texconv decode that .dds to R8G8B8A8 .dds -> strip -> images/<name>.<fmt>.rgba.
// Goldens are texconv's STANDARD-order RGBA, unmodified; the test applies our channel convention (spec §4).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bc7BlockMode } from "../../golden-util";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEXCONV = process.env.TEXCONV ?? "texconv";

type ChannelMap = "none" | "swapRB" | "grayFromR";
interface Fmt {
  key: string;
  texconv: string;
  xiv: string;
  channelMap: ChannelMap;
  bc7max?: boolean;
}
const FORMATS: Fmt[] = [
  { key: "dxt1", texconv: "BC1_UNORM", xiv: "DXT1", channelMap: "none" },
  { key: "dxt3", texconv: "BC2_UNORM", xiv: "DXT3", channelMap: "none" },
  { key: "dxt5", texconv: "BC3_UNORM", xiv: "DXT5", channelMap: "none" },
  { key: "bc4", texconv: "BC4_UNORM", xiv: "BC4", channelMap: "grayFromR" },
  { key: "bc5", texconv: "BC5_UNORM", xiv: "BC5", channelMap: "swapRB" },
  {
    key: "bc7",
    texconv: "BC7_UNORM",
    xiv: "BC7",
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
  // Sharp multi-color quadrants (2-3 subsets per straddling block) -> partitioned BC7 modes 0/1/2/3.
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

function main(): void {
  const srcDir = join(HERE, "sources");
  const imgDir = join(HERE, "images");
  const tmp = join(HERE, ".tmp");
  for (const d of [srcDir, imgDir]) mkdirSync(d, { recursive: true });

  const manifest: {
    name: string;
    format: string;
    width: number;
    height: number;
    input: string;
    expected: string;
    channelMap: ChannelMap;
  }[] = [];

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
      writeFileSync(join(imgDir, `${s.name}.${f.key}.bin`), stripDds(encDds));

      // Decode BCn .dds -> single-mip R8G8B8A8 .dds -> strip -> golden RGBA (standard order).
      texconv(["-m", "1", "-f", "R8G8B8A8_UNORM", "-o", decDir, encDds]);
      const golden = stripDds(join(decDir, `${s.name}.DDS`));
      if (golden.length !== s.w * s.h * 4)
        throw new Error(
          `golden ${s.name}.${f.key}: got ${golden.length} bytes, want ${s.w * s.h * 4}`,
        );
      writeFileSync(join(imgDir, `${s.name}.${f.key}.rgba`), golden);

      manifest.push({
        name: `${s.name}.${f.key}`,
        format: f.xiv,
        width: s.w,
        height: s.h,
        input: `images/${s.name}.${f.key}.bin`,
        expected: `images/${s.name}.${f.key}.rgba`,
        channelMap: f.channelMap,
      });
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(
    join(HERE, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // Report BC7 mode coverage so any gap is visible (the test asserts all 8 modes are present).
  const modes = new Set<number>();
  for (const s of SOURCES) {
    const bin = new Uint8Array(readFileSync(join(imgDir, `${s.name}.bc7.bin`)));
    for (let off = 0; off + 16 <= bin.length; off += 16)
      modes.add(bc7BlockMode(bin, off));
  }
  const covered = [...modes].filter((m) => m >= 0).sort((a, b) => a - b);
  console.log("BC7 modes covered:", covered.join(", "));
  const missing = [0, 1, 2, 3, 4, 5, 6, 7].filter((m) => !modes.has(m));
  if (missing.length)
    console.warn(
      `MISSING BC7 modes: ${missing.join(", ")} — hand-author a fallback block per README "Filling mode gaps".`,
    );
}

main();
