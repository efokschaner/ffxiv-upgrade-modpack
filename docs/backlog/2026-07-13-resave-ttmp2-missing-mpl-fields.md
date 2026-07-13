# `writeTtmp2` omits `.mpl` fields TexTools always writes

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

All on 36 packs, all `[added]` (i.e. present in the golden, absent from ours):

- `#/ModPackPages/N/ModGroups/N/OptionList/N/IsChecked` — TexTools writes the option's checked state
  (`true` for the first option of a Single group, `false` otherwise, per the `Fantasia` /
  `Tight&Firm` goldens).
- `#/ModPackPages/N/ModGroups/N/OptionList/N/ModsJsons/N/ModPackEntry` — TexTools writes
  `"ModPackEntry": null` on **every** mod json (1443 instances).
- `#/SimpleModsList` — TexTools writes the key as an explicit `null` on a wizard pack; we omit it.
- Option `Description`: TexTools writes `null` where we write `""` (25 packs,
  `#/OptionList/N/Description [mismatch]`).
