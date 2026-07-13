# `writeTtmp2` writes the LEGACY `SelectionType` spelling — a `Multi` group is silently downgraded to single-select

Filed: 2026-07-13 · Status: open · Priority: prioritized

Our READER only understands the legacy spelling, so **this makes our *output* wrong for users** —
the same class as the (now-fixed) generated-texture `Files`-key defect: a mod author's multi-select
group becomes single-select in the pack we emit, which is a functional regression for whoever
installs it, not merely a byte-parity nit.

`src/container/ttmp2.ts` reader: `g.SelectionType === "Multi Selection" ? "Multi" : "Single"`;
writer: `g.selectionType === "Multi" ? "Multi Selection" : "Single Selection"`. Modern TexTools
writes the bare enum name (`"Single"` / `"Multi"`), not the legacy `"… Selection"` string.

**Evidence:** `Fantasia.ttmp2`'s source `.mpl` declares its one group as `["Race","Multi"]`; our
reader does not match `"Multi Selection"`, so it falls through to `Single`, and our writer emits
`"SelectionType":"Single Selection"` — while the `/resave` golden emits `"Multi"`. Shows as
`#/ModGroups/N/SelectionType [mismatch]` + `#/OptionList/N/SelectionType [mismatch]` on 36 packs in
the `/resave` baselines (`test/corpus/.resave-baseline/`).

**This defect is ALSO already sitting in the `/upgrade` ratchet baselines, not just `/resave`'s**
(checked 2026-07-13: `Select-String -Pattern SelectionType -Path test/corpus/.upgrade-baseline/*.json`).
It hits the exact same 36 files as the `/resave` baselines, 643 `SelectionType`-pointer lines total
(e.g. `7f8d4701a82d….json` alone carries 25: `TTMPL.mpl#/ModPackPages/0/ModGroups/N/SelectionType`
and `…/OptionList/N/SelectionType` for every group/option in the pack, all `status: "mismatch"`).
That means the `/upgrade` harness has been **blessing** this defect all along — every affected
pack's baseline already records the mismatch as "known, ratchet-passing" rather than catching it as
a regression. It only became legible as a *named, greppable* finding once manifest diffs started
being reported **per JSON pointer** instead of a single opaque manifest-mismatch count; before that
this was invisible noise inside an aggregate diff. That is the sharpest statement of why the
per-pointer harness work mattered: it turned a silently-tolerated defect into something you can
literally `grep` for and name.

**Fix (deliberately deferred):** accept both spellings on read; write the bare enum name on write.
Note the reader fix changes `ModpackData`, so the `/upgrade` baselines will move (in the good
direction — the 643 lines above should mostly disappear) once it lands.
