# 10. `PopulatePmpStandardOption` silently destroys a pack's FileSwaps on write

**Status:** diverged · **Where:** `PMP.cs:966-968` (see
`src/container/resolve-duplicates.ts`, `src/container/pmp.ts`)

> Status corrected 2026-08-07 (was `worked around`). The legend's `worked around` is for a symptom
> the harness *hides* while our output still matches the golden — entry #9's `.noop` marker is the
> real example. Here our output genuinely **differs** from the golden (our `FileSwaps` populated
> where the golden's is always `{}`), and the harness carve-out **confirms** that specific difference
> rather than hiding it, which is precisely the `diverged` definition. The body below already called
> it "the first divergence justified under `AGENTS.md`'s user-benefit principle"; only the tag was
> out of step.

`PopulatePmpStandardOption` initializes `opt.FileSwaps = new()` (`:967`) alongside `opt.Files` and
`opt.Manipulations`, but unlike those two, nothing ever adds to it afterward — the function's body
(`:969-1021`) only populates `opt.Files` (from `files`) and `opt.Manipulations` (from the metadata/
rgsp conversion and `otherManipulations`). This is the **only** writer of `PmpStandardOptionJson`
(`WizardData.WritePmp` → `PopulatePmpStandardOption` is the sole call site that builds an option's
JSON for the zip), so any option that came in with file swaps — a Penumbra mod that swaps one game
file for another instead of shipping a custom replacement — has that data unconditionally discarded
by TexTools' own writer. A round-trip through TexTools (`/resave`, or `/upgrade` when it needs to
rewrite the pack at all) silently drops a mod author's file swaps from the emitted pack, with no
warning and no error. That is a data-loss defect, not a transcribed SE oddity: nothing about game
data or a legacy format forces it, it's a writer that starts populating a field and then never
finishes the job for one of its three members.

**Us:** `resolveDuplicates` does **not** reproduce this bug, and does **not** fail loud on it either
— we deliberately preserve every FileSwap the source pack carries (`src/container/pmp.ts:437-445`,
`base.FileSwaps = o.fileSwaps`) rather than modelling TexTools' *read-side* placeholder mechanism
(`UnpackPmpOption`, `PMP.cs:1202-1235`, which needs a live game index we don't bundle) or reproducing
the write-side drop. This is the first divergence justified under AGENTS.md's user-benefit principle
rather than plain TexTools byte-parity: a FileSwap is a live redirection in Penumbra's runtime model
(`SubMod.AddContainerTo`, Penumbra repo `Mods/SubMods/SubMod.cs:23-32` — a separate repo from this
project's `reference/`), so reproducing the write-time drop would hand
the user a modpack quietly missing functionality. The resulting divergence (our `FileSwaps` populated
where the golden's is always `{}`) is confirmed against the oracle by a scoped carve-out in the golden
harness (`dropConfirmedAbsentKeys`, `test/helpers/upgrade-archive-diff.ts`), not by a ratchet
baseline — see `docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md` for the full
analysis, including why no bundled game index is needed and the `common/N` dedup-numbering side
effect (entry 8, above) this creates.

**The harm is observed, not theorised.** In-game verification 2026-07-19 (AGENTS.md's first
principle, requirement 3) against `torn bassment glow.pmp`: both packs load in Penumbra, and **a
material loads successfully from our output that FAILS to load from TexTools' output** — the swaps
that resolved its textures having been destroyed on write.

The mechanism, recorded so the observation is reproducible rather than testimony. The packed
material `chara/equipment/e0246/material/v0001/mt_c0101e0246_top_a.mtrl` references three textures,
**all three supplied by FileSwaps** (`..._top_n_afadde89.tex`, `..._top_m_0b26c9b8.tex`,
`..._top_id_f6bf57ea.tex`, swapped from the corresponding `e6120` textures). Those hash-suffixed
destination paths are TexTools' own item-swap feature minting unique names so the swapped item
cannot collide with real `e0246` gear — and checked against the 040000 index they are **absent from
the game**, while all three swap sources exist. So they are backed by nothing unless the swap
supplies them; there is no base-game fallback, because a suffixed name is not a base-game name.
Dropping the swaps leaves the material pointing at three addresses that resolve to nothing — a hard
load failure, not a degraded appearance. **TexTools' writer thus destroys exactly the data its own
item-swap feature depends on.** Verified against `/resave` rather than
`/upgrade`, because ConsoleTools no-ops on every swap-carrying pack available; `/resave` is the same
write path minus the transform (`Program.cs:191-221`) and this function sits in it, so the
destruction shown there is the destruction any writing `/upgrade` performs.

**Upstream fix:** either serialize `files`' original FileSwaps back into `opt.FileSwaps` in
`PopulatePmpStandardOption` (matching `opt.Files`/`opt.Manipulations`'s treatment), or — if dropping
them is intentional (e.g. because a swap's target may no longer resolve against the current game
version) — log or surface that loss to the user instead of doing it silently.
