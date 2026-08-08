# 4. Empty-sampler exclusion checks can never match (case mismatch)

**Status:** **gap** — we fail loud instead · **Where:** `Mtrl.cs:560` vs `:577` / `:593` / `:627` / `:719`

`XivMtrlToUncompressedMtrl` lowercases every texture path (`:560`) *before* comparing it against the
`_EMPTY_SAMPLER_` prefix constant (`Mtrl.cs:70`), which is **uppercase**. The comparison can never
succeed, so every exclusion check that was meant to drop empty-sampler placeholders is dead code and
C# **writes the placeholders into the output material**.

**Us:** `src/mtrl/serialize.ts` throws rather than emitting placeholders — a deliberate parity hole,
because pinning the exact bytes TexTools emits here needs a synthetic modpack that exercises it. See
`docs/backlog/2026-07-08-mtrl-empty-sampler-placeholders.md`.

**Upstream fix:** compare case-insensitively (or lowercase the constant). Note this would *change*
TexTools' output bytes, so it is a behavioural fix, not a cosmetic one.
