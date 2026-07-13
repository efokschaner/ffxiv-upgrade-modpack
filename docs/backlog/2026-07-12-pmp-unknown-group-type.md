# PMP group with an unrecognized `Type` yields an empty group instead of failing loud

Filed: 2026-07-12 · Status: open · **Inverts the port's fail-loud rule** — we quietly drop content

`parsePmpGroup` (`src/container/manifest-types.ts`) defaults `Options` to `[]`, so a group whose
`Type` is neither `Single`, `Multi` nor `Imc` (or is absent entirely) reads as a group with **no
options** — its files silently vanish from the model, and `/upgrade` would emit a pack missing them.

C# cannot produce that outcome: `PMPGroupJson.Options` is a virtual property that **throws** on the
base class — `NotImplementedException($"Unimplemented PMP group type: {Type}")` (`PMP.cs:1407`) —
and only the three known subtypes override it with a real `OptionData = new()` (`:1413` / `:1421` /
`:1434`, selected by `JsonSubtypes` off `Type`, `:1383-1386`). So TexTools fails loudly where we
quietly drop content — a best-effort wrong output that the golden diff could miss, since an empty
group also writes back empty.

Pre-existing — the `?? []` predates the raw/parsed split and was carried through it unchanged, so
this is not a regression.

**To fix:** throw from `parsePmpGroup` when `Type` is not a known subtype, mirroring the C# message.

**First check** what `JsonSubtypes` actually does with an unrecognized discriminator — it may throw
at *deserialization* rather than reaching the base property, which would change the failure point
(and whether `LoadPMP` can even load such a pack) — and scan the corpus for an unknown/absent `Type`
before flipping it, or the ratchet will light up. Presumed latent (a pack that hit this would likely
already show as missing files against its golden), but that scan has **not** been run — do it as
step one rather than trusting this note.
