# Port IBM437 (CP437) zip entry-name decoding, matching `Ionic.Zip`

Filed: 2026-07-12 · Status: open (fail-loud guard in place; no corpus pack trips it)

`src/zip/zip.ts`'s `readZip` currently THROWS when a zip entry's UTF-8 general-purpose flag (bit 11)
is unset and its raw name contains a byte >= 0x80, rather than silently decoding it: fflate's
`unzipSync` falls back to latin1 for that case, but TexTools unzips via `Ionic.Zip`
(`IOUtil.UnzipFiles`, `IOUtil.cs:625/654/669`), whose non-UTF-8 fallback is IBM437 — a different
mapping above 0x7F, so we would otherwise silently resolve a different member name than TexTools
does. Porting a real IBM437 decode table (256-entry byte→codepoint) would let these packs load,
instead of failing loud.

**No pack in the corpus currently trips the throw** (real corpus mods use ASCII or UTF-8-flagged
names), so this is deferred until one does, or until we want to widen coverage proactively. See
`src/zip/zip.ts`'s `findNonUtf8HighByteEntryNames` doc comment for the full reasoning, and the
CRITICAL review finding that added the throw (PR for `feat/pmp-absent-file-tolerance`, 2026-07-12).

## Empirically confirmed (2026-07-12), not just read from Ionic's docs

Probe: `scripts/probes/probe-cp437-zip.ts` hand-assembles a PMP zip byte-for-byte (local file
headers + central directory + EOCD, method 0/stored) with a payload entry named `[0x78, 0x81, 0x78]`
(`'x'`, CP437 `0x81`, `'x'` — CP437 decodes this to `"xüx"`; the same bytes under latin1, fflate's
fallback, decode to a control char instead of `'ü'`) and the UTF-8 general-purpose flag bit CLEARED,
alongside a `default_mod.json` whose `Files` map spells the game path's target as real UTF-8 `"xüx"`
(`{"chara/test.file": "xüx"}`). Ran ConsoleTools `/resave` (pure load → write, `Program.cs:191-221`)
on it and inspected the output:

- **Output `Files` map:** `{"chara/test.file": "default\\chara\\test.file"}` — the key **survived**
  (a dropped/absent file would have removed it, per `PMP.cs:883-888`, the same signal
  `probe-resave-absent.ts` uses).
- **Output zip members:** `default_mod.json`, `meta.json`, `default/chara/test.file` — a payload
  member exists at the renamed path (`/resave` renames every payload entry), and its bytes are the
  original `[0, 1, 2, 3]` payload verbatim (checked directly), not empty or zeroed.
- **VERDICT: ConsoleTools RESOLVED the CP437-named member.** Ionic decoded the raw `0x81` byte as
  CP437 `'u with diaeresis'`, matched it against the `Files` value, and round-tripped the real
  payload.

A control run (folded into the same script, same hand-rolled zip format, plain-ASCII entry name
`"xyx"` instead of the CP437 byte) was necessary and used to validate the harness itself: the FIRST
attempt used a `Files`/game-path key (`"some/random/path.file"`) that doesn't start with a
recognized `XivDataFile` folder key, so `PMP.cs:752-770` (`CanImport`) silently dropped the file in
BOTH the CP437 and the ASCII-control run — a false negative unrelated to zip name decoding.
Switching the game path to `"chara/test.file"` (a real `XivDataFile` prefix) made the ASCII control
resolve correctly, and only then did the CP437 run above give the real answer.

**This confirms the premise behind the fail-loud throw is correct**: Ionic really does fall back to
CP437 (not latin1, not UTF-8, not a load error) for an unflagged high-byte name, so `readZip`'s
divergence from that behaviour is real, and porting an IBM437 decode table remains the right fix
once a pack needs it.
