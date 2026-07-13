# PMP writer: `WizardHelpers.WriteImage` re-encode is unported — `Image` fields and image zip members are carried through verbatim, not regenerated

Filed: 2026-07-13 · Status: open — **deliberately not ported** (no image encoder in this repo)

`WizardHelpers.WriteImage` is called for every option (`WizardData.cs:545`), every group (`:953`),
and meta (`:1497`): it returns `""` when the referenced source file does not exist, else re-encodes
the image to a 16-bit PNG under a NEW name at `images/<newName>.png` and returns THAT path.
`optionToJson` / the group-assembly loop / the meta-assembly block (`src/container/pmp.ts`) all pass
the SOURCE `Image` value (and, by extension, the source image zip member under its original name)
straight through instead.

**Deliberately not ported**: this repo has no image encoder, and porting a real one just to
reproduce a PNG re-encode is out of proportion to what it buys — several real corpus packs DO carry
option/group images (the golden's `Image` value AND the image member name/bytes both diverge for any
option/group that has one; meta images are extinct in the corpus so that particular emit site is
empirically unexercised today). Each of the three emit sites (`src/container/pmp.ts`) carries an
accurate comment noting the divergence and citing the C#.

If this is ever picked up, it needs:

1. a PNG encoder capable of 16-bit output matching ImageSharp's, and
2. the naming scheme `WriteImage` uses for the new `images/<newName>.png` path (distinct per call
   site — option/group callers pass their own `imgName` / `IOUtil.MakePathSafe(Name)`,
   `WizardData.cs:930-940/953`; meta uses a fixed `"_MetaImage"`, `:1497`).
