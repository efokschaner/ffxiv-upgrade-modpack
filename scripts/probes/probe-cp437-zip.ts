// Probe (not wired into the suite; needs a local ConsoleTools install, and is slow): when a PMP
// payload zip entry's UTF-8 general-purpose flag (bit 11) is UNSET and its raw name bytes are the
// CP437 (IBM437) encoding of a non-ASCII character, does ConsoleTools actually resolve it against a
// `Files` value spelled in correct UTF-8?
//
// This is the empirical check behind src/zip/zip.ts's findNonUtf8HighByteEntryNames throw: we read
// (never edit) Ionic.Zip's documented behaviour as "falls back to IBM437 when the UTF-8 flag is
// unset" (IOUtil.cs:625/654/669), which disagrees with fflate's latin1 fallback for any byte >= 0x80
// — a silent divergence we refuse to guess at. See BACKLOG.md's "Port IBM437 (CP437) zip entry-name
// decoding" item.
//
// We pick 'ü' (U+00FC): CP437 encodes it as the single byte 0x81; UTF-8 encodes it as 0xC3 0xBC. So a
// zip entry named "xüx" using RAW BYTES [0x78, 0x81, 0x78] (CP437), with the UTF-8 flag cleared, is a
// name fflate would decode as latin1 (which ALSO gives 0x81 -> U+0081, a control char, not 'ü' --
// latin1 and CP437 disagree above 0x7F, which is exactly the point) while Ionic is documented to
// decode as CP437 -> "xüx". The pack's default_mod.json Files value is spelled "xüx" in real UTF-8 (as
// all JSON text is), matching the CP437 *decode*, not the raw bytes.
//
// fflate's zipSync always sets the UTF-8 flag for any non-ASCII name (`u: s != fn.length` in its
// source), which is exactly the case we must NOT produce -- so this hand-assembles the zip byte-for-
// byte: local file headers + central directory + EOCD, method 0 (stored), flag bit 11 cleared on every
// entry (harmless for the two ASCII manifest entries; load-bearing for the payload entry).
//
// Ships with its control folded in (2026-07-12; previously a separate probe-cp437-zip-control.ts).
// The control is what caught a false negative during the original investigation: a `Files`/game-path
// key that doesn't start with a recognized `XivDataFile` folder prefix trips `PMP.cs:752-770`'s
// `CanImport` guard regardless of zip-name resolution, so BOTH the CP437 case and a plain-ASCII
// control dropped the file, which would have produced a wrong "CP437 not resolved" conclusion. A
// probe whose negative result can't be trusted without its control should ship with the control
// built in: run both, print both, and only report a CP437 verdict when the control passes.
//
// Then runs ConsoleTools /resave (pure load -> write, Program.cs:191-221, same rationale as the old
// probe-resave-absent.ts) on each pack and inspects whether the output's Files map still names the
// member, i.e. whether TexTools resolved the entry name to the UTF-8 Files value.
//
// Run: npx tsx scripts/probes/probe-cp437-zip.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";

const CONSOLE_TOOLS =
  "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";

// ---- minimal hand-rolled zip writer (stored, no compression) ----

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface RawEntry {
  name: Buffer; // raw name bytes, exactly as they'll appear on disk in the zip
  data: Buffer;
  flags: number; // general-purpose bit flag
}

function buildZip(entries: RawEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const crc = crc32(e.data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(e.flags),
      u16(0), // method: stored
      u16(0), // mod time
      u16(0x21), // mod date (arbitrary valid DOS date)
      u32(crc),
      u32(e.data.length), // compressed size == uncompressed (stored)
      u32(e.data.length),
      u16(e.name.length),
      u16(0), // extra length
      e.name,
      e.data,
    ]);
    localParts.push(local);

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(e.flags),
      u16(0), // method
      u16(0), // mod time
      u16(0x21), // mod date
      u32(crc),
      u32(e.data.length),
      u32(e.data.length),
      u16(e.name.length),
      u16(0), // extra length
      u16(0), // comment length
      u16(0), // disk number start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset), // relative offset of local header
      e.name,
    ]);
    centralParts.push(central);

    offset += local.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // disk w/ start of central dir
    u16(entries.length), // entries on this disk
    u16(entries.length), // total entries
    u32(centralBuf.length),
    u32(localBuf.length), // offset of start of central directory
    u16(0), // comment length
  ]);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

// ---- build + run one probe pack, return whether the payload's Files key survived /resave ----

function runProbe(opts: {
  label: string;
  packName: string;
  payloadName: Buffer;
  filesValue: string;
}): boolean {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const meta = {
    FileVersion: 3,
    Name: opts.packName,
    Author: "synthetic",
    Description: "",
    Version: "1.0.0",
    Website: "",
    ModTags: [] as string[],
  };

  // Must start with a recognized XivDataFile folder key (PMP.cs:752-770 CanImport / XivDataFile.cs:35-45)
  // or PopulatePmpStandardOption/UnpackPmpOption silently drops the entry regardless of zip-name
  // resolution -- this is exactly the false negative the control catches.
  const GAME_PATH = "chara/test.file";

  const defaultMod = {
    Name: "",
    Description: "",
    Files: { [GAME_PATH]: opts.filesValue } as Record<string, string>,
    FileSwaps: {} as Record<string, string>,
    Manipulations: [] as unknown[],
  };

  const metaBytes = Buffer.from(enc.encode(JSON.stringify(meta, null, 2)));
  const defaultModBytes = Buffer.from(
    enc.encode(JSON.stringify(defaultMod, null, 2)),
  );
  const payloadBytes = Buffer.from([0, 1, 2, 3]);

  const zipBytes = buildZip([
    { name: Buffer.from("meta.json", "ascii"), data: metaBytes, flags: 0 },
    {
      name: Buffer.from("default_mod.json", "ascii"),
      data: defaultModBytes,
      flags: 0,
    },
    { name: opts.payloadName, data: payloadBytes, flags: 0 }, // flags: 0 -> UTF-8 bit (0x0800) unset
  ]);

  const workDir = mkdtempSync(join(tmpdir(), "cp437-"));
  const src = join(workDir, "in.pmp");
  const dest = join(workDir, "out.pmp");
  writeFileSync(src, zipBytes);

  console.log(`--- ${opts.label} ---`);
  console.log("input Files map:", defaultMod.Files);
  console.log(
    "input payload zip entry name bytes (hex):",
    [...opts.payloadName].map((b) => b.toString(16).padStart(2, "0")).join(" "),
  );

  execFileSync(CONSOLE_TOOLS, ["/resave", src, dest], { stdio: "inherit" });

  const outBytes = readFileSync(dest);
  const outEntries = unzipSync(new Uint8Array(outBytes));
  const outMemberNames = Object.keys(outEntries).filter(
    (n) => !n.endsWith("/"),
  );

  const defaultModOut = outEntries["default_mod.json"];
  if (!defaultModOut) throw new Error("output pack has no default_mod.json");
  const outJson = JSON.parse(dec.decode(defaultModOut)) as {
    Files?: Record<string, string>;
  };

  console.log("output Files map:", outJson.Files ?? {});
  console.log("output zip member names:", outMemberNames);

  const resolved =
    outJson.Files !== undefined &&
    Object.keys(outJson.Files).includes(GAME_PATH);

  console.log(
    resolved
      ? `${opts.label}: RESOLVED (Files key survived).`
      : `${opts.label}: NOT resolved (Files key dropped).`,
  );
  console.log("");
  return resolved;
}

// Control: plain ASCII entry name "xyx". If ConsoleTools does not resolve even this, the hand-rolled
// zip format (or the CanImport-eligible game path) is broken, and the CP437 result below means nothing.
const controlResolved = runProbe({
  label: "CONTROL (plain ASCII 'xyx')",
  packName: "cp437-control",
  payloadName: Buffer.from("xyx", "ascii"),
  filesValue: "xyx",
});

// CP437 case: raw bytes 'x' 0x81 'x' -- CP437 decodes 0x81 as 'ü'; latin1 (fflate's fallback) decodes
// it as a control character instead. Files value is the correct UTF-8 spelling "xüx", exactly as
// Penumbra would write it.
const cp437Resolved = runProbe({
  label: "CP437 ('x' 0x81 'x')",
  packName: "cp437-probe",
  payloadName: Buffer.from([0x78, 0x81, 0x78]),
  filesValue: "xüx",
});

if (!controlResolved) {
  console.log(
    "VERDICT: INCONCLUSIVE -- the control itself was not resolved, so the CP437 result above cannot " +
      "be trusted (the hand-rolled zip format or the game path is broken, not zip-name decoding).",
  );
  process.exit(1);
}

console.log(
  cp437Resolved
    ? "VERDICT: ConsoleTools RESOLVED the CP437-named member (Files key survived) -- confirms Ionic.Zip falls back to CP437, not latin1, for an unflagged high-byte name."
    : "VERDICT: ConsoleTools did NOT resolve the CP437-named member (Files key dropped).",
);
