# `/upgrade` refuses every v4 Penumbra pack — and v4 is what current Penumbra and TexTools write

Filed: 2026-08-09 · Status: open · **Product-reach item, not a correctness bug**

`upgradeModpack` (`src/upgrade/upgrade.ts:445-451`) throws

> Cannot convert v4+ Penumbra modpack to ttmp/pmp.

for any PMP source whose `meta.json` carries `FileVersion > 3`. That is a **faithful** port of
`ModpackUpgrader.cs · UpgradeModpack · 218-241`, which refuses a v4 input bound for a `.pmp`/`.ttmp2`
destination (`:232`) and raw-copies it for a folder destination (`:237` — an arm this port has no
destination type for). Nothing here is wrong. The concern is reach.

## Why it matters more than the corpus suggests

The local corpus makes v4 look exotic: 37 of 38 `.pmp` packs are `FileVersion 3` (scanned 2026-08-09).
That is an artifact of **when the corpus was collected**, not of what exists:

- **TexTools itself writes v4.** `PMP._WriteFileVersion = 4` (`PMP.cs:47`), forced on every write at
  `WizardData.cs:1515`. Our own writer matches it (`src/container/pmp.ts:1176`). So every pack TexTools
  or this port emits is v4 — including, note, **our own `/upgrade` output**, which we would then refuse
  to re-upgrade.
- **Real Penumbra exports sampled 2026-08-09 are v4.** Both packs sourced from the official dev Discord
  (`hs-Yet Another Leisurewear …`, `Parent Settings.pmp`) are `FileVersion 4` with inline `Groups`.

So the share of real-world packs the site can process is not fixed — it shrinks as v4 spreads, and the
site's *own output* is already on the wrong side of the gate.

## A `.pmp` destination does NOT dodge the throw — checked 2026-08-09

Worth stating explicitly, because it is the natural first guess and it is wrong: the guard covers
**both** archive destinations.

```csharp
if (pmp.pmp.Meta.FileVersion > 3) {
    if (newPath.EndsWith(".ttmp2") || newPath.EndsWith(".pmp"))   // :228 — BOTH
        // Theoretically we could re-zip the data into a PMP here, but for the moment this isn't supported.
        throw new NotImplementedException("Cannot convert v4+ Penumbra modpack to ttmp/pmp.");
    await PMP.CopyPmpFiles(path, newPath);                        // :237
    return false;
}
```

`ModpackUpgrader.cs · UpgradeModpack · 226-239`, read directly. ConsoleTools passes its `dest`
argument through verbatim (`Program.cs · HandleUpgrade · 173-179`), so `/upgrade in.pmp out.pmp`
throws exactly as `/upgrade in.pmp out.ttmp2` does. **The only non-throwing arm is a destination
ending in neither suffix — a folder** — and it does not upgrade anything: `CopyPmpFiles` raw-copies
the input and returns `false`. Note upstream's own comment at `:230` — the refusal is explicitly
"for the moment", not a statement of impossibility, for `.pmp` at least (`:231` marks `.ttmp2` as
never supportable).

## What "supporting it" actually requires — much less than the name suggests

The instinct that there may not be much work here is **right**, and for a sharper reason than the
destination suffix. Trace the three stages:

1. **Read — already works.** The v4 pull-back (`PMP.cs:217-225`) is ported at
   `src/container/pmp.ts:275-280`. `hs-Yet Another Leisurewear …` loads through this port today.
2. **Transform — nothing v4-specific exists.** The upgrade rounds operate on an option's `.mtrl` /
   `.mdl` / `.tex` / `.meta` payloads, not on container shape. Eleven real v3 `.pmp` packs already run
   the whole pipeline; the only `sourceFormat` reads in the transform are `needsMdlFix`
   (`src/upgrade/model.ts:31-32`) and `texfix.ts:40-41`, both **load-fix** gates that classify
   `Pmp`/`PmpFolder` identically and have nothing to do with manifest version.
3. **Write — we already emit v4.** `writePmp`'s `meta` literal (`src/container/pmp.ts:1175-1200`) sets
   `FileVersion: 4` and writes inline `Groups`/`DefaultData`. Confirmed empirically: our `/resave` of
   the Leisurewear pack produced a v4 `meta.json` carrying all 13 redirects inline.

So the pipeline **already round-trips v4 end to end**. The gate at `src/upgrade/upgrade.ts:445-451` is
the only thing standing in front of it, and it exists because we port TexTools' gate — not because any
stage underneath it is missing.

What genuinely remains is therefore **fidelity, not capability**:

- **Close [`2026-08-09-penumbra-schema-keys-dropped.md`](2026-08-09-penumbra-schema-keys-dropped.md)
  first.** This is the real content of upstream's caution: TexTools' model cannot represent
  `Condition`/`ParentSetting`/`Combining`, so its round-trip is lossy, and refusing is how it avoids
  shipping that loss silently. Ours has the same hole. Lifting the gate without closing it converts an
  honest refusal (rubric class 2) into silent structural data loss (rubric class 1) — strictly worse by
  this backlog's own ordering. **That item is a hard precondition: it must land before this one ships.**
- **Decide the divergence deliberately.** Lifting the gate is a deviation *from* TexTools, so it needs
  AGENTS.md's three bars — and the second bar is hard here, because the golden harness has no oracle
  for output ConsoleTools refuses to produce. Answer that (a `/resave` round-trip against Penumbra's own
  reader? a semantic self-consistency check?) before writing code.
- **`Combining` groups** ([`2026-08-09-pmp-combining-group-support.md`](2026-08-09-pmp-combining-group-support.md))
  — a mainstream Penumbra feature both writers refuse today, TexTools included.

Scope estimate to revise on pickup: the port work may be close to **zero**, with the entire cost in the
fidelity item, the divergence decision, and the oracle question.

## How it scores against the rubric

Rubric class 3 (doesn't exist yet) shading into class 2 (honest refusal): a user with a v4 pack gets a
clear error, not a broken mod, so nobody is harmed silently. It also cannot affect a single real user
until the site exists — the same conditional the site's own entry carries. What makes it matter anyway
is that it bounds how useful the site is on the day it launches, and the bound tightens over time
without anyone touching the code.
