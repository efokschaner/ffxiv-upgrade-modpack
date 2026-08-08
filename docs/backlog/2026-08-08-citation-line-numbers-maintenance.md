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

## Known-stale intra-repo citations, deliberately left for this item

The re-pin's sweep was scoped to citations into the **ten changed C# files**. Citations pointing at
*our own* TypeScript were never in scope, and the re-pin moved plenty of our lines. The following
were verified stale at the close of that branch (2026-08-08) and **deliberately not fixed**, because
renumbering them now would be thrown away by the change this item proposes:

- **12 `src/container/pmp.ts:N` and 4 `src/container/ttmp2.ts:N` citations across 9 files** —
  `docs/TEXTOOLS_BUGS.md:155,267`, `docs/BACKLOG.md:307`, four items under `docs/backlog/`, four
  older specs, plus `test/container/pmp-write.test.ts:186` and
  `test/helpers/upgrade-archive-diff.ts:218`.
- Each was confirmed **already stale before** the re-pin's final fix wave, so that wave neither
  caused nor worsened them.
- `docs/superpowers/specs/2026-07-20-ttmp2-mpl-manifest-fidelity-design.md:160` is a further instance
  found separately, and a good illustration of the failure mode: it cites `pmp.ts:321-325` for
  `reformatPmpVersion`, while the same spec records five lines later that the function was lifted out
  to `src/util/dotnet-version.ts` entirely.

**Two of these need rewording, not renumbering** — they are substantively out of date, not merely
mis-pointed: `docs/BACKLOG.md:307` and `docs/backlog/2026-07-18-empty-vs-omitted-fileswaps-key.md`
both describe `base.FileSwaps = o.fileSwaps` as unconditional, but it is now `ShouldSerialize`-gated
(`src/container/pmp.ts:698`). Anyone picking this item up should treat a stale citation as a prompt to
re-read the claim around it, not just the number.

`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §5's `test/helpers/oracle.ts:21`
is a third category again — a deliberate historical description of the pre-re-pin state, correct as
written. Distinguishing those from genuine rot is part of the work here.
