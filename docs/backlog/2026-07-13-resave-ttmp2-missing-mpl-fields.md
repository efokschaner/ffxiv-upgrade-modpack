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

**2026-07-19 (Task 4, the weapon IMC growth synthetic):** now exercised by a **synthetic** pack too,
not only by real corpus packs — `test/corpus/synthetic/imc-weapon.ttmp2`
(`scripts/generate-synthetics/build-synthetic-imc-weapon.ts`) reports `IsChecked [added]`,
`ModsJsons/{0,1}/ModPackEntry [added]` and `SimpleModsList [added]`, blessed into its ratchet
baseline. It is the first synthetic `.ttmp2` to earn a real (non-noop) `/upgrade` golden — the older
synthetic ttmp2s use a gamePath `/upgrade` ignores, so they no-op and the harness never runs the
manifest diff on them. Practical upshot: this item is now reproducible from a **committed builder**
on a fresh clone (`npm run synthetics`), with no third-party mod required, so whoever closes it can
iterate against a 2-file pack instead of a real corpus mod. Closing this should empty that pack's
baseline along with the real ones.
