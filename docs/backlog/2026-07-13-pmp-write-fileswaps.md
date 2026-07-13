# Port FileSwap handling in the PMP write path (currently: fail loud)

Filed: 2026-07-13 · Status: open

`resolveDuplicates` (`src/container/resolve-duplicates.ts`) throws when an option carries a
non-empty `fileSwaps` map, because this port cannot reproduce TexTools' FileSwap handling
faithfully with the information available to a browser-targeted library. Full picture, for whoever
picks this up:

- **The placeholder mechanism.** In TexTools, `ResolveDuplicates` (`PmpExtensions.cs:476-566`) does
  not run over "just the custom files" — it runs over `WizardStandardOptionData.Files`, which
  `UnpackPmpOption` (`PMP.cs:1104-1137`) builds by merging custom `Files` AND `FileSwaps` into one
  dictionary. On the `/upgrade` load path, `zipArchivePath` is `null` (`WizardData.cs:818`:
  `UnpackPmpOption(o, null, unzipPath, false)`), so `includeData` is `false` (`PMP.cs:1015`). For
  each FileSwap, TexTools resolves the swap's *source* against the live game index
  (`tx.Get8xDataOffset(src, true)`, `PMP.cs:1117`); if that lookup succeeds (`offset > 0`), the swap
  becomes an empty placeholder entry, `ret.Add(src, new FileStorageInformation())` (`PMP.cs:1130`) —
  keyed by the swap's *source* path, not its destination, and carrying a default-valued struct
  (`RealPath == null`, `StorageType == EFileStorageType.ReadOnly`). `WizardStandardOptionData` has
  no separate FileSwaps field (`WizardData.cs:69-80`), so that placeholder flows on as an ordinary
  `Files` entry and reaches `ResolveDuplicates` indistinguishable from a real file.
- **The idx-burning interaction with the zero-hash bug (`docs/TEXTOOLS_BUGS.md` #8).** The
  placeholder's `RealPath` is `null`, so it fails `File.Exists(f.Info.RealPath)`
  (`PmpExtensions.cs:509`) exactly like an absent PMP file does, and takes the same zero-hash
  sentinel path (`:509-514`) — colliding with every other absent/placeholder file in the option and
  burning an `idx` value that shifts the `common/N` numbering of every genuine duplicate that
  follows it in iteration order.
- **We cannot reproduce this without a game index.** Deciding whether a given FileSwap yields a
  placeholder (vs. being skipped entirely, `PMP.cs:1118-1122`, `offset <= 0`) requires querying the
  live game's index file via `tx.Get8xDataOffset` — `PMP.cs:1063-1067` opens a readonly transaction
  specifically to do this. This library has no game index and no transaction layer; porting this
  faithfully would mean either bundling/fetching real game index data (out of scope for a
  browser-targeted upgrader) or guessing, which risks silently mis-numbering `common/N` for every
  duplicate after a swap.
- **TexTools' own writer drops FileSwaps outright regardless.** `PopulatePmpStandardOption`
  (`PMP.cs:873-875`) sets `opt.FileSwaps = new()` and never adds to it — only `opt.Files` and
  `opt.Manipulations` get populated in the function body that follows. So even if we *could*
  reproduce the read-side placeholder mechanism perfectly, the pack TexTools itself writes back out
  loses the FileSwaps entirely; matching TexTools' emitted bytes does not require carrying FileSwaps
  through at all. See `docs/TEXTOOLS_BUGS.md` #10 — adjudicated as a genuine TexTools defect (silent
  data loss on write), not a quirk we need to transcribe.
- **No corpus coverage.** All 13 real corpus PMPs have `fileSwaps=0`; this is a latent gap with no
  oracle behind it today.
- **Current behaviour:** `resolveDuplicates` throws a descriptive error citing the above when an
  option's `fileSwaps` is non-empty, rather than risking a silently wrong `common/N` numbering.
  Pinned by a test in `test/container/resolve-duplicates.test.ts`.

**To actually fix this:** given TexTools' own writer drops FileSwaps unconditionally
(`docs/TEXTOOLS_BUGS.md` #10), the pragmatic port-side fix does NOT need the game index at all —
since our output only needs to match what TexTools writes, and TexTools writes nothing for
FileSwaps, we could instead *drop* fileSwaps entries before they ever reach `resolveDuplicates`
(matching the writer's end state) rather than trying to reproduce the read-side placeholder/
idx-burning mechanics. The one caveat: if TexTools' `/upgrade` needs to rewrite a pack that had
FileSwaps but doesn't ultimately touch that particular option's payload (e.g. the swap survives
untouched in a no-op-for-that-option path), the idx-burning could still perturb OTHER options'
`common/N` numbering in ways a "just drop them" port would miss — this needs verifying against a
synthetic pack with FileSwaps once one exists before treating "drop silently" as safe. Would need a
synthetic modpack builder (`scripts/generate-synthetics/`) carrying a FileSwaps entry to pin the
golden bytes either way.
