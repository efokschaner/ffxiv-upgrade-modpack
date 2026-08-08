# Reconsider line numbers in TexTools citations

Filed: 2026-08-08 · Status: open · Surfaced by the citation-drift sweep during the v3.1.1.4 re-pin.

AGENTS.md prescribes `file · symbol · lines` for every ported behaviour. **The `lines` component is
the only part that rots**, and this item is to decide whether it earns the tax.

## Motivation

Measured 2026-08-08: **~1,374 line-number citations across 173 files** in `src/` and `test/`. Every
re-pin has to re-point all of them, and the count only grows.

Three properties make that tax worse than it looks:

- **The failure mode is silent.** A stale line number points confidently at unrelated code rather
  than at nothing. Live example from this re-pin: three sites cite `Tex.cs:138` for a guard
  `1993bf6` deleted, and at the new pin `Tex.cs:138` is a real line with unrelated content. A missing
  or renamed *symbol*, by contrast, fails loud when you grep for it — and a renamed symbol is a
  signal we actively want, because it means the thing we ported changed identity.
- **Line numbers cannot be checked mechanically.** A file, a symbol, or a quoted code fragment can
  all be verified by a script; a line number can only be verified by a human reading both sides.
- **Re-pointing them is genuinely dangerous.** The v3.1.1.4 sweep needed two fix rounds and produced
  a wrong-but-confident rewrite in *each* automated pass — a bare reference attributed to the wrong
  C# file, landing on a real line with plausible content. One even came from a hand-verified list.
  Deleting a token cannot produce a wrong token; computing a new one demonstrably can.

Against that: the sweep found nothing of value. The one real discovery of that task — that `1993bf6`
deletes all four `ToBytes` guards, not just the `LoDMips` one — came from reading `git show`, not
from any citation.

## Sketch of the change (decide the details when picked up)

1. Drop bare line numbers; keep `file · symbol`, which is what actually carries provenance.
2. Where sub-symbol precision genuinely matters — a large symbol (`Mdl.cs` methods run to hundreds of
   lines), or a citation pointing at something that is not a named symbol at all (a field
   initializer, a block-commented region, one hunk of a loop) — **quote a short code fragment
   instead**: `PMP.cs · LoadPMP · "meta.FileVersion > 3 && enforceCompatibility"`. Content-anchored
   rather than position-anchored, self-verifying by grep, and loud when the fragment disappears. Same
   principle the golden cache already uses by keying on `sha256(input pack)` rather than a path.
3. Add a checker asserting every cited file exists, every cited symbol exists in it, and every quoted
   fragment matches. This is the part that makes the surviving citations trustworthy, and it is only
   cheap once the line numbers are gone.

Note this **changes a rule AGENTS.md states**, so the decision needs recording there, not only here.

Not ranked as a correctness item — nothing is wrong today that this fixes. It is a recurring tax with
a bad failure mode, and it is cheap to retire.

Reference: the v3.1.1.4 re-pin's citation sweep (`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md`
§10.1) records the six distinct citation spellings the sweep had to handle, which is itself evidence
the format has drifted beyond what AGENTS.md describes.
