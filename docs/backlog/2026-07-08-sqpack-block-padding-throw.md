# F6 — "real data in padding" throw (audit Theme A)

Filed: 2026-07-08 · Status: open (documented gap; malformed-input-only + latent)

`src/sqpack/blocks.ts` `readBlock` omits C#'s `readBlockPadding` throw (`Dat.cs:2400-2405`) because
that throw is gated on whole-`.dat` context (`lastInFile && i != blockCount - 1`) our single-file
block reader does not carry.

Documented as a code comment rather than ported, since a partial reproduction would risk
over-throwing on legitimately-tolerated padding.

Revisit if we ever thread archive-level read context (which file/block is last) into the block loop.
