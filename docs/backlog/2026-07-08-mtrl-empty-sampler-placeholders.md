# M1/M2 — empty-sampler placeholder serialization (audit Theme D)

Filed: 2026-07-08 · Status: open (latent — 0 unstable on the current corpus)

Reproduce, byte-for-byte, C#'s quirk where `XivMtrlToUncompressedMtrl` lowercases texture paths
(`Mtrl.cs:560`) before its UPPERCASE `StartsWith(EmptySamplerPrefix)` exclusion checks, so
placeholders are written as ordinary textures. `src/mtrl/serialize.ts` currently throws on any
empty-sampler placeholder.

Reproduction also requires matching C#'s placeholder path (`_empty_sampler_` + lowercased
`ESamplerId` *name*, whereas `src/mtrl/parse.ts` uses the numeric raw id).

Needs an authored synthetic modpack with an orphan sampler to pin the golden bytes before
implementing.
