# `writeTtmp2` re-emits a SIMPLE pack as simple; TexTools always writes a WIZARD pack

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

Confirmed on 13 corpus packs. `Black Widow.ttmp2`: source `TTMPVersion` `"1.3s"` with a 21-entry
`SimpleModsList` and `ModPackPages: null`. Our writer emits `"2.1s"` + `SimpleModsList[21]`
(`src/container/ttmp2.ts`, `TTMPVersion: data.isSimple ? "2.1s" : "2.1w"`). ConsoleTools `/resave`
emits `"2.1w"` with `SimpleModsList: null` and `ModPackPages: [1]` — one page holding a single group
`{"GroupName":"Default Group","SelectionType":"Single","OptionList":[1 option]}`.

So TexTools' `WriteModpack` **has no simple-pack writer at all**: `WizardData` is
page/group/option-shaped, and everything it writes is a wizard pack. Shows in the baselines as
`TTMPL.mpl#/ModPackPages [added]` + `#/SimpleModsList [mismatch]` + `#/TTMPVersion [mismatch]`
(13 packs each).

Decide deliberately whether to match this (our simple round-trip is arguably nicer, but it is not
what TexTools does).
