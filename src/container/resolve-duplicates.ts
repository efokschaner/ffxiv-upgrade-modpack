// Port of PMPExtensions.ResolveDuplicates (PmpExtensions.cs:476-566): assigns every PMP payload
// file its final zip path -- `<optionPrefix><gamePath>` for a file used once, content-deduped into
// `common/{idx}/{basename}` for a file whose bytes repeat anywhere in the pack (any option, any
// group). `optionPrefix` per option comes from Task 6's `optionPrefixes` (src/container/option-prefix.ts,
// MakeOptionPrefix); this module is the second half of `WizardData.WritePmp`'s file-naming pipeline
// (WizardData.cs:1502-1546 -> FileIdentifier.IdentifierListFromDictionaries, PmpExtensions.cs:594-626).
//
// Three things ported deliberately, not by omission:
//
// 1. `useCompressed` is always false FOR INPUTS WE ACCEPT. GetHashKey's caller
//    (PmpExtensions.cs:488-499) picks compressed-vs-uncompressed hashing by majority `StorageType`
//    across the file set, defaulting to the else/compCount++ branch (:493-496) for anything that
//    isn't `UncompressedIndividual`/`UncompressedBlob` -- which includes a FileSwap placeholder's
//    `FileStorageInformation` default (`StorageType` is a struct field defaulting to
//    `EFileStorageType.ReadOnly`, TransactionDataHandler.cs:25-47), so a pack WITH FileSwaps could
//    in principle push `compCount` above `uncompCount`. It never does here because we reject any
//    option with a non-empty FileSwaps map before this point (see the throw above) -- every file we
//    actually hash is a real, always-`RawUncompressed` PMP file, so `compCount` is always 0 and the
//    uncompressed branch always wins. We don't port the majority-vote branch at all -- only the
//    branch that can ever be taken given that rejection. And since only EQUALITY CLASSES of the hash
//    matter for dedup (never the digest value itself), `sha1Hex` (src/util/sha1.ts) stands in for
//    `TransactionDataHandler.GetUncompressedFile` + `SHA1.ComputeHash` in one step: our in-memory
//    `ModpackFile.data` already IS the uncompressed bytes, so there is no separate "resolve from
//    disk" step to model.
//
// 2. The zero-hash bug is reproduced deliberately (PmpExtensions.cs:509-514; docs/TEXTOOLS_BUGS.md
//    #8). A file with no bytes (`ModpackFile.data === undefined`, our analogue of `!File.Exists(f.Info.RealPath)`)
//    is NOT hashed, but IS inserted into the dedup dictionary under a shared, default (all-zero)
//    hash key. Two or more absent files therefore collide as "duplicates" of each other and burn an
//    `idx` value in the SAME counter real duplicates use -- shifting the `common/N` numbering of
//    every genuine duplicate that follows. A "fix" here (e.g. skipping absent files entirely) would
//    silently diverge from TexTools' member names. We still exclude absent files from the RETURNED
//    map (point 3 below) -- that drop happens in a DIFFERENT C# function and does not undo the idx
//    already spent.
//
// 3. Iteration order is the contract. C# enumerates `Dictionary<Guid, FileIdentifier>` in insertion
//    order (no removals: PmpExtensions.cs:503-551 never calls `.Remove`), and insertion order is
//    option-by-option, file-by-file (`FileIdentifier.IdentifierListFromDictionaries`,
//    PmpExtensions.cs:594-611, itself fed by `WizardData.WritePmp`'s own `DataPages -> p.Groups ->
//    o.Options` walk, WizardData.cs:1506-1542). `optionPrefixes` (option-prefix.ts) already performs
//    that exact page-bucketed walk to compute each option's prefix, and a `Map`'s iteration order IS
//    its insertion order -- so `prefixes.keys()` reproduces the C#'s option visiting order without
//    us re-deriving `DataPages` a second time here (which would blend option-prefix.ts's private
//    `buildPages` into this module). Within an option, `option.files` is already in `Files`-map
//    insertion order (the reader builds it that way, src/container/pmp.ts:81). Get either order
//    wrong and the `common/N` numbers come out different from TexTools'.
//
// Absent files get no zip path in the RETURNED map at all -- that is a different guard,
// `PopulatePmpStandardOption`'s `!File.Exists` skip (PMP.cs:883-888), which drops the file's
// `Files` key and payload member without touching `idx` (already spent, in a different function, by
// the time this guard runs). We fold that drop into this module's return value directly, since our
// return type IS exactly "the paths PopulatePmpStandardOption would actually use".

import type { ModpackData, ModpackFile, ModpackOption } from "../model/modpack";
import { sha1Hex } from "../util/sha1";

// C#'s default `TTMPWriter.SHA1HashKey` (TTMPWriter.cs:235-247) is a struct whose ulong/uint fields
// default to zero -- the 20 all-zero bytes a real SHA-1 digest can, for all practical purposes,
// never produce. Only equality-class membership matters here (see the header comment above), so a
// literal all-zero 40-hex-char string reproduces the sentinel without needing the real struct.
const ZERO_HASH = "0".repeat(40);

/** `Path.GetFileName` for our always-forward-slash zip/game paths (PmpExtensions.cs:542). */
function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * Assigns every PMP payload file its final zip path. See the module header for the port's shape
 * and the three behaviours (useCompressed, the zero-hash bug, iteration order) it deliberately
 * reproduces from `ResolveDuplicates` (`PmpExtensions.cs:476-566`).
 *
 * `prefixes` must come from `optionPrefixes(data)` for this SAME `data` -- its Map iteration order
 * is what drives the `common/N` numbering (see point 3 above). We do not call `optionPrefixes`
 * ourselves (the caller, `writePmp`, needs the prefixes separately for the manifest JSON too), but
 * we do cross-check `prefixes`' keys are reachable from `data.groups` and fail loud rather than
 * silently dedupe an unrelated file set if a caller passes a mismatched pair.
 */
export function resolveDuplicates(
  data: ModpackData,
  prefixes: Map<ModpackOption, string>,
): Map<ModpackFile, string> {
  const knownOptions = new Set(data.groups.flatMap((g) => g.options));
  for (const option of prefixes.keys()) {
    if (!knownOptions.has(option)) {
      throw new Error(
        "resolveDuplicates: prefixes contains an option absent from data.groups -- prefixes must " +
          "come from optionPrefixes(data) for this same data",
      );
    }
  }

  // FileSwaps cannot be reproduced faithfully. In TexTools, ResolveDuplicates runs over
  // WizardStandardOptionData.Files, which UnpackPmpOption (PMP.cs:1104-1137) populates by merging
  // custom Files AND FileSwaps into one dictionary. On the /upgrade load path (WizardData.cs:818:
  // `UnpackPmpOption(o, null, unzipPath, false)`) `zipArchivePath` is null, so `includeData` is false
  // (PMP.cs:1015) and each FileSwap whose source resolves in the live game index becomes an empty
  // placeholder, `ret.Add(src, new FileStorageInformation())` (PMP.cs:1130) -- deciding this requires
  // `tx.Get8xDataOffset` against the GAME INDEX (PMP.cs:1063-1067, :1117-1122), which this
  // browser-targeted library does not have and cannot open. `WizardStandardOptionData` has no
  // separate FileSwaps field (WizardData.cs:69-80), so that placeholder flows on as an ordinary
  // Files entry and reaches ResolveDuplicates, where it fails `File.Exists(null)` and burns an idx
  // on the zero-hash path (PmpExtensions.cs:509-514; docs/TEXTOOLS_BUGS.md #8), shifting every later
  // common/N number. We cannot reproduce that without a game index, so fail loud rather than
  // silently diverge -- see BACKLOG.md.
  //
  // Checked over EVERY option in `data.groups`, NOT just `prefixes.keys()` -- i.e. independent of
  // whatever `buildPages` (option-prefix.ts) pruned. An option can be absent from `prefixes` (its
  // group didn't survive pruning) while still carrying a non-empty FileSwaps map; iterating only
  // `prefixes.keys()` would silently skip the guard for exactly that option instead of throwing --
  // the inverse of "fail loud, never silently diverge" (AGENTS.md). `prefixes` itself is still used
  // above for the knownOptions cross-check (a caller-mismatch guard, unrelated to pruning).
  for (const g of data.groups) {
    for (const option of g.options) {
      if (Object.keys(option.fileSwaps).length > 0) {
        throw new Error(
          "resolveDuplicates: option has a non-empty FileSwaps map, which this port cannot reproduce " +
            "faithfully -- deciding whether a swap yields an empty placeholder entry (PMP.cs:1104-1137) " +
            "requires querying the live game index (tx.Get8xDataOffset, PMP.cs:1117-1122), which this " +
            "browser-targeted library does not have. See BACKLOG.md for the full analysis.",
        );
      }
    }
  }

  interface Entry {
    file: ModpackFile;
    pmpPath: string;
    hash: string;
  }
  // PmpExtensions.cs:503-524 (parallel hash computation) collapsed into one synchronous pass: our
  // hashing is pure and in-memory, so there is no async I/O to overlap and the eventual dedup loop
  // below needs every hash available up front regardless.
  const entries: Entry[] = [];
  for (const [option, prefix] of prefixes) {
    for (const file of option.files) {
      entries.push({
        file,
        pmpPath: prefix + file.gamePath,
        hash: file.data === undefined ? ZERO_HASH : sha1Hex(file.data),
      });
    }
  }

  // PmpExtensions.cs:528-551 -- first occurrence of a hash claims its own pmpPath; every later
  // occurrence promotes that path to common/{idx}/{basename} (once -- :540 skips a path that
  // already starts with "common/", so a third+ occurrence does not burn another idx).
  const seenFiles = new Map<string, string>();
  let idx = 1;
  for (const e of entries) {
    const existing = seenFiles.get(e.hash);
    if (existing === undefined) {
      seenFiles.set(e.hash, e.pmpPath);
    } else if (!existing.startsWith("common/")) {
      seenFiles.set(e.hash, `common/${idx}/${basename(existing)}`);
      idx++;
    }
  }

  // PmpExtensions.cs:556-565 -- re-loop to read back each file's FINAL path (a hash's seenFiles
  // entry may have been promoted to common/ by an occurrence later than the file's own). Absent
  // files are dropped here (PMP.cs:883-888's job in the C#, folded in -- see the module header).
  const result = new Map<ModpackFile, string>();
  for (const e of entries) {
    if (e.file.data === undefined) continue;
    // Invariant: every entry's hash was inserted into seenFiles by the loop above (each entry sets
    // seenFiles.set(e.hash, ...) on its own first occurrence, if not already present). Absent here
    // would mean the two loops iterated `entries` inconsistently -- an internal bug, not a bad input.
    const finalPath = seenFiles.get(e.hash);
    if (finalPath === undefined) {
      throw new Error(
        `resolveDuplicates: internal invariant violated -- no seenFiles entry for hash of ` +
          `${e.pmpPath}; the dedup pass (PmpExtensions.cs:528-551) must populate every hash before ` +
          `this re-loop (PmpExtensions.cs:556-565) reads it back`,
      );
    }
    result.set(e.file, finalPath);
  }
  return result;
}
