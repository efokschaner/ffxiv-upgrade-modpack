import { unzipSync, type Zippable, zipSync } from "fflate";
import { BinaryReader } from "../util/binary";

const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const UTF8_FLAG_BIT = 0x0800; // general-purpose bit 11 ("language encoding flag / EFS")

/**
 * Locate the End Of Central Directory record by scanning backward from EOF — it may be followed by
 * up to 65535 bytes of zip file comment, so a plain "last 22 bytes" read is not enough. Verifies the
 * trailing comment-length field actually reaches EOF before accepting a candidate, so a signature
 * that happens to occur inside the comment bytes themselves is not mistaken for the real record.
 */
function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minPos = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      const commentLen = bytes[i + 20]! | (bytes[i + 21]! << 8);
      if (i + 22 + commentLen === bytes.length) return i;
    }
  }
  throw new Error("zip: End Of Central Directory record not found");
}

/**
 * Read-only pre-check over the zip's Central Directory, run BEFORE handing `bytes` to fflate.
 *
 * TexTools unzips with Ionic.Zip (IOUtil.UnzipFiles, IOUtil.cs:625/654/669: `new
 * Ionic.Zip.ZipFile(zipLocation)`, no explicit encoding configured). For an entry whose UTF-8
 * general-purpose-flag bit (bit 11) is UNSET, Ionic falls back to decoding the raw name bytes as
 * IBM437 (CP437). fflate's `unzipSync` (used below) decodes that same unset-flag case as latin1 —
 * the "not UTF-8" convention most non-.NET unzippers use. IBM437 and latin1 agree only for bytes
 * < 0x80 (plain ASCII); above that they map to different characters, so any such name is one we
 * would resolve to a DIFFERENT string than TexTools does — a silent divergence, not a shared one.
 * Downstream, that means readPmp resolves the option's `Files` value against the wrong archive
 * member (or none), marks the file absent, and the writer drops it — a real file the pack ships
 * with is never referenced by the rewritten manifest.
 *
 * We do not implement IBM437 (see docs/backlog/2026-07-12-cp437-zip-entry-names.md), so — per
 * AGENTS.md ("fail loud, never silently diverge") — we throw rather than guess. Returns the
 * offending entries' raw name bytes (hex), for the thrown error's message; empty when nothing is
 * affected.
 */
function findNonUtf8HighByteEntryNames(bytes: Uint8Array): string[] {
  const eocd = findEndOfCentralDirectory(bytes);
  const r = new BinaryReader(bytes);
  r.seek(eocd + 10);
  const totalEntries = r.readUint16();
  r.seek(eocd + 16);
  const centralDirOffset = r.readUint32();

  const bad: string[] = [];
  let pos = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    r.seek(pos);
    const signature = r.readUint32();
    if (signature !== CENTRAL_DIR_SIGNATURE) {
      throw new Error("zip: central directory file header signature mismatch");
    }
    r.seek(pos + 8); // general purpose bit flag
    const flags = r.readUint16();
    r.seek(pos + 28); // file name length, extra field length, file comment length
    const nameLen = r.readUint16();
    const extraLen = r.readUint16();
    const commentLen = r.readUint16();
    r.seek(pos + 46); // fixed header size; file name immediately follows
    const nameBytes = r.readBytes(nameLen);
    const utf8Flag = (flags & UTF8_FLAG_BIT) !== 0;
    if (!utf8Flag && nameBytes.some((b) => b >= 0x80)) {
      bad.push(
        [...nameBytes].map((b) => b.toString(16).padStart(2, "0")).join(""),
      );
    }
    pos = pos + 46 + nameLen + extraLen + commentLen;
  }
  return bad;
}

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const badNames = findNonUtf8HighByteEntryNames(bytes);
  if (badNames.length > 0) {
    throw new Error(
      "zip: entry name(s) lack the UTF-8 flag and contain a byte >= 0x80 — cannot resolve the " +
        "same name TexTools' Ionic.Zip/IBM437 fallback would (IOUtil.cs:625/654/669; see " +
        "src/zip/zip.ts). Raw name bytes (hex): " +
        badNames.join(", "),
    );
  }
  const out = new Map<string, Uint8Array>();
  const files = unzipSync(bytes);
  for (const [name, data] of Object.entries(files)) {
    // Skip directory entries (fflate yields zero-length entries for them).
    if (name.endsWith("/")) continue;
    out.set(name.replace(/\\/g, "/"), data);
  }
  return out;
}

export function writeZip(
  entries: Map<string, Uint8Array>,
  opts: { store?: boolean } = {},
): Uint8Array {
  const store = opts.store ?? true;
  const zippable: Zippable = {};
  for (const [name, data] of entries) {
    zippable[name.replace(/\\/g, "/")] = [data, { level: store ? 0 : 6 }];
  }
  return zipSync(zippable);
}
