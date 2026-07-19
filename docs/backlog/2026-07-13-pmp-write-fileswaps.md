# FileSwap preservation — remaining work

Filed: 2026-07-13 · Status: **partly shipped**, superseded by
`docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`

The original item ("`resolveDuplicates` throws on a non-empty `fileSwaps` map; we cannot reproduce
TexTools' placeholder mechanism without the live game index") is **resolved**. Its central premise
was wrong: the index was only ever needed to decide a single `idx` increment, and since we now
preserve swaps rather than modelling placeholders, nothing about the game index is required. See the
spec §4 for the full reasoning and the measurement that closed the bundled-index option.

**Shipped (2026-07-18):** the throw is gone; swaps are carried through to the written pack;
`torn bassment glow.pmp` is in `test/corpus/real/` and its `/resave` diff empirically confirms
ConsoleTools destroys all 6 swaps while we keep them (`docs/TEXTOOLS_BUGS.md` #10 observed, not
inferred).

**Remaining:**

1. **The `common/N` divergence is still unexercised.** TexTools' zero-hash class burns one `idx`
   once it reaches **two members** — and ≥2 valid swaps alone clear that, no absent file needed
   (the original item and early spec drafts both got this threshold wrong).
   `torn bassment glow.pmp` has 6 swaps but no duplicate content, so there is no `common/N` member
   for the burned `idx` to shift and the divergence never materialises. Reaching it needs a
   **synthetic pack with ≥2 swaps AND duplicate content**. Spec §5.2.
2. **The cause-gated semantic-comparison mode** that divergence needs (compare payload by
   `gamePath` through the redirect table rather than by zip member name, gated on the input pack
   carrying ≥1 FileSwap). Spec §5.2. Penumbra's `SubMod.AddContainerTo` (`SubMod.cs:23-32`) is the
   authority on what "same effective result" means.
3. **The §5.1 manifest carve-out** confirming our populated `FileSwaps` against the golden's `{}`,
   replacing the current ratchet-baseline suppression.
4. **The in-game verification gate** (spec §7) — manual, required by AGENTS.md's first principle
   before this counts as a justified divergence.

**Frequency correction.** The original item claimed real PMPs "commonly carry file swaps". Measured
2026-07-18 across the operator's whole user directory: **1 of 826 PMPs** (~0.12%). Still worth
fixing — it was a hard crash on a real pack — but the "common input" framing that put it at #1 does
not survive measurement.
