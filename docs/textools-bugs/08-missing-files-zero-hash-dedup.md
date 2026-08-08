# 8. Missing files all share the zero hash, perturbing dedup paths

**Status:** reproduced · **Where:** `PmpExtensions.cs:509-514` + `:537-551` (see
`src/container/resolve-duplicates.ts`)

`ResolveDuplicates` guards a file whose `RealPath` doesn't exist by assigning it a **default
(all-zero) `SHA1HashKey`** instead of hashing it. Two or more absent files therefore collide as
"duplicates": on the second (and any later) absent file, the dedup loop sees the zero hash already in
`seenFiles`, relocates the *first* absent file's path into `common/{idx}/…`, and increments the shared
`idx` counter (`:537-543`) — all of this happens in `ResolveDuplicates`, entirely before
`PopulatePmpStandardOption`'s write-time `!File.Exists` guard (`PMP.cs:976-981`) ever runs.

That write-time guard drops the absent files' own `Files` entries and payload bytes, but it does
**not** undo the `idx` increment their collision already consumed — `idx` is a local counter in a
different function, already spent by the time the drop happens. So with two absent files, the very
next **genuine** duplicate (two really-identical present files) is relocated into `common/2/…` instead
of `common/1/…` — an observable member-name difference between our output and TexTools' that survives
the write-time drop. We do reproduce it, now that `ResolveDuplicates` is ported (see the "Us:"
paragraph below).

**Us:** `resolveDuplicates` inserts the same all-zero sentinel hash for a byte-less
`ModpackFile` (`data === undefined`) and lets it dedupe against every other absent file, burning
`idx` values exactly as the C# does; a later genuine duplicate's `common/N` numbering shifts to
match. Pinned by `test/container/resolve-duplicates.test.ts` case 6. Absent files are still excluded
from the function's returned map — that is `PopulatePmpStandardOption`'s separate `!File.Exists`
guard (`PMP.cs:976-981`), which does not undo the `idx` this bug already spent.

**Upstream fix:** exclude missing files from the dedup set instead of hashing them to a shared
sentinel.
