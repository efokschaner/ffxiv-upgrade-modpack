# Backlog

Follow-up work deferred out of the change that surfaced it. See `AGENTS.md` → Conventions
("Deferred work lives in `BACKLOG.md`") for when to add here. Each item cites the audit
finding and/or C# source it traces to, so it can be picked up cold.

## Prioritized

`/upgrade`-pipeline work still to port — the rounds our pipeline currently stubs, roughly
highest-priority first. Reference: `src/upgrade/upgrade.ts`, `reference/.../Mods/EndwalkerUpgrade.cs`.

- **Texture round (round 2 — `UpgradeRemainingTextures`).** `textureRound`
  (`src/upgrade/upgrade.ts:140`) is a no-op stub. It should consume the `UpgradeInfo[]`
  targets the material round produces (normal + colorset → index maps) and emit the
  upgraded textures. This is the source of the **705 baselined `.tex` diffs** — porting it
  closes that ratchet. Blocks the U4 decision below.
- **Partials round (round 3).** `partials` (`src/upgrade/upgrade.ts:145`) is a no-op stub
  for `UpdateUnclaimedHairTextures` / `UpdateEyeMask` / `UpdateSkinPaths`.
- **`fixUpSkinReferences` (audit 6-1).** `src/mdl/model/model-modifiers.ts:489` is a
  deferred no-op; C# rewrites serialized skin-material strings
  (`ModelModifiers.cs:2309/2347`). Port the race-tree skin-material remap. Latent on the
  current corpus, so no live corruption today.

## Unprioritized

- **U4 — fail loud on pending texture upgrades (audit Theme A).** When we decide the WIP
  texture round should refuse rather than silently shrink packs, make `textureRound` throw
  while unimplemented when `upgradeTargets.length > 0`. **Deferred deliberately:** throwing
  today converts the 705 documented/ratcheted `.tex` diffs into hard crashes and blocks
  every texture-bearing mod. The ratchet already documents the gap loudly, so it is not a
  silent divergence. Revisit once the texture round (Prioritized) lands or the ratchet is reworked.
- **M1/M2 — empty-sampler placeholder serialization (audit Theme D).** Reproduce, byte-for-byte,
  C#'s quirk where `XivMtrlToUncompressedMtrl` lowercases texture paths (`Mtrl.cs:560`) before its
  UPPERCASE `StartsWith(EmptySamplerPrefix)` exclusion checks, so placeholders are written as
  ordinary textures. `src/mtrl/serialize.ts` currently throws on any empty-sampler placeholder.
  Reproduction also requires matching C#'s placeholder path (`_empty_sampler_` + lowercased
  ESamplerId *name*, whereas `parse.ts` uses the numeric raw id). Needs an authored synthetic
  modpack with an orphan sampler to pin the golden bytes before implementing. Latent (0 unstable on
  the current corpus).
- **F6 — "real data in padding" throw (audit Theme A).** `src/sqpack/blocks.ts` `readBlock`
  omits C#'s `readBlockPadding` throw (`Dat.cs:2400-2405`) because that throw is gated on
  whole-`.dat` context (`lastInFile && i != blockCount - 1`) our single-file block reader does
  not carry. Documented as a code comment rather than ported, since a partial reproduction would
  risk over-throwing on legitimately-tolerated padding. Revisit if we ever thread archive-level
  read context (which file/block is last) into the block loop. Malformed-input-only + latent.
