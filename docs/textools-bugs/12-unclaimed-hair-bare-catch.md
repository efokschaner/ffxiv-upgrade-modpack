# 12. `UpdateUnclaimedHairTextures` swallows every transform exception (bare catch)

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:1498-1501` (see
`src/upgrade/unclaimed-hair.ts`, the transform `try`/`catch` after the raw-copy step)

After copying a rescued hair/tail/ear texture pair to its canonical Dx11 destinations
(`:1478-1492`), the function calls `UpdateEndwalkerHairTextures` inside a bare
`catch (Exception ex) { Trace.WriteLine(ex); continue; }` (`:1495-1502`). That catch-all masks
**any** exception the transform can throw, including a genuinely corrupt or malformed loose
texture that fails to parse. Either way the failure is logged (or, in our port, simply dropped)
and the loop moves on, leaving the untransformed **raw** copies already written in place —
silently shipping a pixel-untransformed pair with the new Dawntrail paths.

**Us:** reproduced verbatim — a bare `catch { continue; }` around the transform, so any transform
failure leaves the raw copies already written above untouched, matching the C#'s "log and move on"
outcome. As of 2026-07-22 the only thing that reaches it is a genuinely corrupt or unparseable
input: the modeled NPOT-resize gap this used to also swallow is gone, the resize being ported and
its sentinel deleted (see `docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md`).

**Upstream fix:** catch only the specific expected conditions — the two `MergePixelData` failures
(`Tex.cs:655-659`, `:717-746`) are the ones a resize can legitimately raise here — and either
log-and-skip explicitly for those or let a genuinely unexpected exception (a corrupt input) surface
instead of silently swallowing it.
