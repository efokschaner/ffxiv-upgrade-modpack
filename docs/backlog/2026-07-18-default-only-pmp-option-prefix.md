# A `default_mod.json`-only PMP gets a `default/` member prefix; the golden has none

Filed: 2026-07-18 · Status: open

Surfaced by adding `torn bassment glow.pmp` to `test/corpus/real/` (the FileSwaps work,
`docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`). Unrelated to FileSwaps —
this pack is simply the first corpus PMP with **no groups at all**, only a `default_mod.json`.

**Symptom.** Every payload member is laid out one folder deeper than the golden's:

    ours:   default/chara/equipment/e0246/model/c0201e0246_top.mdl
    golden: chara/equipment/e0246/model/c0201e0246_top.mdl

In the `/upgrade` diff this reads as 12 `added` + 12 `removed` structure diffs, plus a `mismatch` on
every `default_mod.json` `Files` value (they name the member paths, so they differ too). It is a
pure container-layout difference — same files, same content, different member names.

**Suspected cause, NOT yet confirmed.** `MakePagePrefix` (`WizardData.cs:1362-1400`) has a branch
returning `""` for a lone group on a lone page (`:1375-1378`, cited in
`src/container/option-prefix.ts`'s header). A default-only pack is exactly that shape: the reader
synthesizes a single "Default" group (`readPmp`, the analogue of `FromPmp`'s `fakeGroup`,
`WizardData.cs:1121-1129`) and there is nothing else. We appear to take a different branch and emit
`default/`.

**Before treating this as a bug, read `WizardData.cs:1362-1458` directly** and confirm which branch
TexTools takes for a one-group/one-page pack — including how the synthesized Default group
participates. It is equally possible our prefix is right for a *group* named "Default" and the
divergence is upstream (e.g. the pack should not synthesize a group at all when there are no real
ones). Do not "fix" `option-prefix.ts` from this item's summary alone; that module ports two
TexTools bugs deliberately (`docs/TEXTOOLS_BUGS.md` #1, #6) and is easy to break.

**Blast radius.** Member names are the dedup/naming namespace, so this affects every default-only
PMP. No other corpus pack has the shape, which is why it went unnoticed.

**It also MASKS content comparison for the whole pack.** Because every member name differs, the
golden diff pairs nothing: all 12 payload members report as `added`/`removed` and their bytes are
never compared. So `torn bassment glow.pmp`'s blessed baseline is unusually weak — it is not
evidence that our payload content matches the golden, only that the names don't. There is a known
candidate hiding behind it (`docs/backlog/2026-07-18-mdl-self-roundtrip-byte21.md`, bogus unused-LoD
offsets in emitted `.mdl`s). **Fix this item before trusting that pack's baseline, and re-bless
afterwards** — the diff that appears once names line up is the real signal.
