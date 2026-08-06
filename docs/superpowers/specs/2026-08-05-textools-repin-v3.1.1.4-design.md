# Re-pinning the TexTools oracle from v3.1.0.2 to v3.1.1.4

Filed: 2026-08-05 · Status: **design approved, not yet implemented**

Moves the porting baseline — the installed ConsoleTools *and* `reference/` — from TexTools
`v3.1.0.2` to `v3.1.1.4`, replaces the Program Files installer with a versioned portable install,
and defines a repeatable procedure for reviewing every upstream commit in the range for port impact.

Links back to the foundation design,
`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`.

## 1. Why now

### 1.1 The forcing function: FFXIV patch 7.5 broke the pinned oracle

`test/helpers/corpus-resave.ts:64` is the only `ctx.skip` in the suite, so `1 skipped` in a run is
always the same pack: `Milktruck Bust Scaling Tweaks v1.0.0.ttmp2` (12 `.rgsp` files, nothing else).
ConsoleTools `/resave` cannot round-trip it — the oracle itself throws, so there is no golden to diff
our writer against and the harness marks the writer UNVERIFIED for that pack.

The cause is a hardcoded offset in the pinned build. `CharaMakeParameter.cs:25` declares
`MetadataStart = 0x2a800` as the point in the game's `human.cmp` where racial-scaling records begin,
and `:61` throws `"CMP Format Changed - Unable to read all CMP data."` when the trailing region is
not a whole multiple of `RacialScalingParameter.TotalByteSize` (56). Measured against this machine's
installed game (read in-process via `scripts/lib/game-index.ts`):

| | |
|---|---|
| `chara/xls/charamake/human.cmp` length | 186,752 (`0x2D980`) |
| hardcoded `MetadataStart` | 174,080 (`0x2A800`) |
| trailing bytes | 12,672 |
| `12,672 / 56` | 226 records **+ 16 left over** → `:61` throws |
| real RSP block start | 182,272 (`0x2C800`) = `length - 8*10*56` |
| colour region growth | **+8,192 bytes = 2,048 RGBA pixels** |

A patch grew `human.cmp`'s colour-pixel region and the constant never moved. Under the stale anchor
TexTools parses 8 KB of colour pixels as scaling floats — exactly 2,048 of the 3,168 floats it reads
come back `NaN`/`-3.3e38`, and those 2,048 are precisely the added bytes. Re-anchoring from the end
of the file yields exactly 80 records whose 1,120 floats are all plausible scale values (0.4–2.0,
no zero rows), which confirms the diagnosis.

Two observations worth recording:

- `CharaMakeParameter.cs:43`'s guard is dead code — the `i += 4` loop always lands exactly on
  `MetadataStart`, or throws `IndexOutOfRangeException` first. Only `:61` can fire.
- **The throw was luck.** `:61` is a pure length check. Had the patch added a multiple of 56 bytes,
  the pinned build would have parsed colour pixels as scaling parameters and written a corrupted
  `human.cmp` — `GetScalingParameter` indexes 0…79, entirely inside the colour region under the
  stale anchor.

### 1.2 Upstream fixed it, after our pin

Three commits on 2026-05-07, all after our pin (`e20179a0`):

- `d731d744` — "Fix CMP RSP offset for patch 7.5"
- `c961d9e1` — "Replace dead rem check with a size precondition" (they spotted the dead guard too)
- `4929174` — "Restore comment, and bump to 3.1.1.2 pending release."

The fix anchors from the back, with a comment naming the cause:

```csharp
// SE adds new color blocks between patches, so calculate the RSP offset from the back instead of hardcoding it
var rspDataSize = 8 * 10 * RacialScalingParameter.TotalByteSize;
if (data.Length <= rspDataSize) throw new Exception("CMP Format Changed …");
var metadataStart = data.Length - rspDataSize;
```

`CharaMakeParameter.cs` is not a file our port cites — this is oracle-environment breakage only.
Nothing in our code reads `human.cmp`; `.rgsp` is opaque payload to us.

### 1.3 Deciding factor

The CMP breakage is the trigger, not the whole reason. Drift accumulates whether or not we act, and
each deferred re-pin makes the next one larger. Operator call, 2026-08-05: **get to the latest
release now**, rather than an intermediate re-pin to a point that only carries the CMP fix.

## 2. Target and its provenance

**Target: TexTools `v3.1.1.4`**, published 2026-08-03, `prerelease: false`.

| | v3.1.0.2 (current) | v3.1.1.4 (target) |
|---|---|---|
| FFXIV_TexTools_UI | `b83feb57b59a8f061ee458e9e8b416a99225110b` | `b96139d3c2bbe8d8fa7ace94c9a9f00d1b500c40` |
| xivModdingFramework | `e20179a014ab86269e8f4da3762be1003bc611ab` | `8e2a2603f963ceb38062798c128b7f4efd966e11` |
| ConsoleTools ProductVersion | `1.0.0+b83feb57…` | `1.0.0+b96139d3…` |
| `xivModdingFramework.dll` ProductVersion | — | `3.1.1.4+8e2a2603…` |

Verified by extracting the release binaries and reading their version metadata: the shipped
`xivModdingFramework.dll` self-reports `8e2a2603`, which is the submodule sha carrying the CMP fix.
Read-source and oracle therefore stay in lockstep, which is the invariant README's provenance section
exists to protect.

**Distribution.** The 3.1.1.x line is **zip-only** — no `Install_TexTools.exe` since v3.1.0.2
(Dec 2025). The release is named "v3.1.1.3 BETA" and its asset is `FFXIV_TexTools_v3.1.1.4b.zip`,
despite `prerelease: false`. Accepted: it is the only route to the fix, and the zip is a full build
output containing `ConsoleTools.exe` and `lib/xivModdingFramework.dll`, so **no building from source
is required**.

**`v3.1.1.4` is currently also the tip** of both `refs/heads/develop` and `refs/heads/beta`;
`refs/heads/master` (`bbc7069c`, 2026-05-25) is *behind* it and is not a release. Pinning to the
**tag** is the conservative form of "latest": reproducible, matched to a published binary, and immune
to later branch movement.

**Unaffected:** `SixLabors.ImageSharp` stays pinned at `2.1.11` in `xivModdingFramework.csproj`
across both commits, so `src/tex/imagesharp/`'s port baseline does not move.

## 3. Scope of the upstream diff

Range `e20179a0..8e2a2603`. Our pin is a clean ancestor of the target — no divergent lineage.

| Scope | Count |
|---|---|
| All commits | 35 (26 non-merge) |
| Changed `.cs` files | 24 |
| **Changed files our port cites** | **10** |
| **Commits touching them** | **11** (+330 / −71) |

Two findings materially shrink the work:

- **`EndwalkerUpgrade.cs` is untouched** across the entire range — the most-cited source in `src/`,
  the whole Dawntrail transform core.
- **`ConsoleTools/Program.cs` is untouched.** The UI repo's 17 commits are WPF Views/ViewModels plus
  the submodule bump; the oracle CLI's own code did not move.

The dominant theme is **Penumbra v4 / PMP v4**: six of the eleven commits, and the bulk of the churn
(`PMP.cs` alone is +187/−22 net, touched by six of the eleven).

> Counts here come from full-history scratch clones. Both `reference/` clones are **shallow**
> (`rev-parse --is-shallow-repository` = true, `rev-list --count HEAD` = 1), so `git log`/`rev-list`
> run inside `reference/` after a tag fetch produce meaningless numbers.

## 4. Decisions

Recorded with the operator call that settled each.

1. **Versioned, portable, env-resolved oracle install** (§5). Operator call, 2026-08-05.
2. **The Program Files install is uninstalled by the operator, manually**, once the harness resolves
   through the env var and a green run proves it. Operator call, 2026-08-05.
3. **Bless first, then port commit by commit**, watching the recorded divergence total fall
   (§7). Driving unexplained divergences to zero is a *separate* project and is explicitly not this
   spec's exit condition. Operator call, 2026-08-05.
4. **The ratchet baseline is the right home for the post-re-pin drift.** AGENTS.md's "a divergence
   recorded only in a gitignored ratchet baseline is *not* documented" governs **intended, permanent
   divergences** that need a `DIVERGENCE_RULES` confirmation. What we bless here is transient port
   drift we intend to eliminate — which is what the glossary means by "pre-existing gaps don't
   block". The corpus is too large for git, so its baselines are local-only by necessity; that is an
   accepted property of how this project develops on this machine, not a gap to close here.
   Operator call, 2026-08-05.
5. **A `deferred` verdict requires explicit operator sign-off.** No backlog item is filed and no
   scope is dropped on the implementer's judgement — the case is surfaced and the work stops on that
   thread until the operator rules. Operator call, 2026-08-05.

## 5. Oracle install layout

```
C:\dev\textools-oracle\
  v3.1.0.2\   ConsoleTools.exe  ConsoleTools.exe.config  console_config.json  lib\  …
  v3.1.1.4\   ConsoleTools.exe  ConsoleTools.exe.config  console_config.json  lib\  …
```

`DEFAULT_ORACLE_PATH` is `C:\dev\textools-oracle\v3.1.1.4\ConsoleTools.exe` — a user-writable
location outside Program Files, so no step of an install or re-pin needs elevation.

ConsoleTools is **fully portable** — everything it needs sits next to the exe:

- `console_config.json` → `XivPath` (the game's sqpack dir), read from
  `Assembly.GetEntryAssembly().Location`'s directory (`ConsoleConfig.cs:49-50`)
- `ConsoleTools.exe.config` → the `TextWriterTraceListener` block the `/upgrade` oracle depends on
- `lib/xivModdingFramework.dll`, found via `<probing privatePath="lib" />`

Nothing tied the oracle to Program Files except the hardcoded constant at `test/helpers/oracle.ts:21`.
That becomes:

```ts
const CONSOLE_TOOLS = process.env.FFXIV_CONSOLETOOLS ?? DEFAULT_ORACLE_PATH;
```

`oracleAvailable()` already fails loud on a missing exe, so a wrong env var is a clear red rather
than a silent skip.

**`scripts/setup-oracle.ts <tag>`** performs an install: download the release zip, verify it against
a **sha256 pinned in the repo**, extract to the versioned dir, write `console_config.json` with the
operator's `XivPath`, and patch `ConsoleTools.exe.config` with the trace-listener block. Pinning the
hash is better supply-chain hygiene than the manual download it replaces, consistent with the
project's minimum-age / pinned-dependency policy.

Pinned hash for the target:

```
FFXIV_TexTools_v3.1.1.4b.zip
sha256  6add67cb87c8b123ade5f9b4172571d24adcaca3072475af3c7ee5f1907e86a2
size    35,120,324 bytes
```

**The trace-listener patch is load-bearing.** The released `ConsoleTools.exe.config` has no
`<system.diagnostics>` section; the installed one carries a hand-added block, added once, elevated:

```xml
<system.diagnostics>
  <trace autoflush="true">
    <listeners>
      <add name="ffxivUpgradeFileListener" type="System.Diagnostics.TextWriterTraceListener"
           initializeData="C:\Users\<user>\.ffxiv-consoletools-trace.log" />
    </listeners>
  </trace>
</system.diagnostics>
```

The path must be written **literally expanded** — .NET does not expand `%USERPROFILE%` in
`initializeData`, and `traceListenerConfigured` (`oracle.ts:302`) substring-matches the absolute
`UPGRADE_TRACE_LOG` value, which `oracle.ts:29` builds from `homedir()`. Having the setup script
compute and write it removes a step that is easy to get subtly wrong by hand.

Without it every `/upgrade` run dies at `assertUpgradeTraceListenerConfigured` (`oracle.ts:316`),
because `HandleUpgrade` reports failures via `Trace.WriteLine`, not Console (`Program.cs:185`) — see
`docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md` Part B. That function's
error text currently instructs the reader to edit an elevated Program Files path and must be updated
for the new location.

Keeping `v3.1.0.2` extracted alongside costs one directory and preserves the ability to re-run the
old oracle on a single pack when a diff is hard to attribute.

## 6. Re-pinning `reference/`

Both clones are shallow, so this is fetch-then-checkout:

```
git -C reference/FFXIV_TexTools_UI fetch --depth=1 origin tag v3.1.1.4
git -C reference/FFXIV_TexTools_UI checkout v3.1.1.4
git -C reference/FFXIV_TexTools_UI submodule update --init --depth=1
```

Landing at UI `b96139d3` / XMF `8e2a2603`, matching what the shipped binaries self-report.

README updates: the provenance table (both commit rows and the baseline sentence), and the
"Incremental upgrade" paragraph — which currently describes an installer-based flow and omits the
shallow-clone fetch. The ImageSharp row is unchanged and should be noted as verified-unchanged.

## 7. Execution order and the ratchet

### 7.0 Ordering prerequisite

`scripts/baseline-report.ts` (§11.3) must land **before** the opening bless — it is what records the
opening total and snapshots the roundtrip ratchet. Building it first also means it is exercised
against the pre-re-pin baselines, where the expected numbers are already known.

### 7.1 Cache invalidation

All three oracle caches are keyed on `sha256(input pack)` and carry no TexTools version, so any
survivor silently serves v3.1.0.2 output forever. Delete:

```
test/corpus/.upgrade-cache/     test/corpus/.resave-cache/     test/corpus/.oracle-cache/
```

`.oracle-cache` holds `/unwrap` output and is the easy one to forget. Note that
`.upgrade-cache`/`.resave-cache` also hold `<key>.noop` and `<key>.error` markers — including
Milktruck's `.error` — which are outcomes, not payloads, and are equally stale.

### 7.2 Opening bless

Cold `npm test`, then bless all three baselines:

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Expected at this point:

- A large jump in recorded diffs across `.upgrade-baseline/` and `.resave-baseline/`.
- **The Milktruck `/resave` skip disappears.** With CMP fixed the oracle can round-trip the pack, so
  it produces a real golden — and, most likely, real diffs. The suite's skip count goes to zero and
  `docs/backlog/2026-07-11-expected-failure-golden.md` gains a closing note. The related open item
  `docs/backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md` loses its only real-world
  instance; whether to close or keep it as latent machinery is a **deferral decision** and therefore
  needs operator sign-off per §4.5.
- `.roundtrip-baseline/` should be **unaffected** — it records `decode(encode(x)) != x`, our codec
  contradicting itself, with no TexTools output involved. A movement there is a signal that
  something else changed and must be investigated, not blessed.

**Guard the roundtrip ratchet across the bless.** `UPDATE_UPGRADE_BASELINE=1` re-blesses all three
baselines (AGENTS.md: "same key, same bless env var"), so a `roundtrip` regression would be silently
absorbed by the very step meant to record oracle drift — and the baselines are gitignored, so `git`
cannot show it. Before blessing, snapshot `.roundtrip-baseline/` (copy the directory, or record its
totals via `npm run baseline:report`); after blessing, diff it and confirm it is byte-identical. Any
movement is investigated before proceeding, never blessed away.

That blessed total is the number the rest of the project drives down.

### 7.3 Then port, commit by commit

Chronological order — the six Penumbra-v4 commits build on each other
(`d09cd2b` → `f20b659` → `33ae15c` → `cdd64b6` → `7bc8a76`), so upstream's own order keeps each diff
readable.

Per commit:

1. `git show <sha> -- <cited paths>` against the re-pinned `reference/`; the new code is now the spec.
2. Locate each hunk against our citation index (`file · symbol · lines` in `src/`): does it land in a
   symbol we port?
3. Assign a verdict (§8).
4. Re-run, record the new total from `npm run baseline:report`, re-bless downward.

**Citation drift.** Line numbers shift in all 10 changed cited files, including for hunks ruled "no
port impact" — an earlier insertion moves every later citation in the same file. Every citation into
those 10 files must be re-validated regardless of verdict. If this proves painful by hand, propose a
verifier rather than absorbing the risk silently.

## 8. Verdict taxonomy

| Verdict | Meaning | Obligation |
|---|---|---|
| `no port impact` | Hunk lands in a symbol we do not port (item catalogs, GUI flows, install-time paths) | Record **why**, so the next re-pin does not re-derive it |
| `ported` | Hunk changes ported behaviour | Port it, refresh citations, add the test that would have caught the divergence |
| `bug register` | Upstream fixed (or introduced) a defect we deliberately reproduce | §9 |
| `deferred` | Real, but out of scope | **Operator sign-off required first** (§4.5); then a `docs/BACKLOG.md` entry |

## 9. When upstream fixes a bug we deliberately reproduce

We reproduce TexTools' defects on purpose and register them in `docs/TEXTOOLS_BUGS.md` (22 entries).
When upstream fixes one, our faithful reproduction **becomes a divergence from the new oracle**.

The rule:

- The reproduction changes to match the fixed behaviour, with a test.
- The register entry is **kept, not deleted**, and gains a status line: *"Fixed upstream in `<sha>`
  (v3.1.1.4); our port reproduces the fixed behaviour as of `<our commit>`."* The entry still
  documents why the old bytes looked as they did, which the golden cache and this spec both reference.
- The inverse also applies: a commit that *introduces* a defect we must now reproduce earns a new
  register entry.

**Known instance — bug #19**, via `1993bf6`. That commit deletes the exact guard the entry is about:

```diff
-  if (this.LoDMips[1] < this.LoDMips[0] || this.LoDMips[2] < this.LoDMips[1])
-      throw new InvalidOperationException("LoDMips is not in non-descending order.");
```

and fixes the line that *produced* the offending canonical header — `LoD 2 Mip` now writes
`newMipCount > 2 ? 2 : (newMipCount - 1)` instead of `… : 0`, so a `MipCount == 2` header emits
`[0,1,1]` rather than the `[0,1,0]` that tripped the guard. It also adds ascending-order
normalization to the mip-fixup loop.

**To audit** under the same commit: **#20** and **#21** (same `Tex.cs` mip machinery). **To audit**
against the PMP/WizardData commits: **#10** (FileSwaps destruction on write), **#7** (page-index
off-by-one), **#22** (`ClearNulls` over a list it is mutating).

## 10. Commit ledger

Verdicts are filled in during execution. `cited files` lists only files our port cites; every commit
below also touches unported files.

| # | commit | date | subject | cited files touched | verdict |
|---|--------|------|---------|---------------------|---------|
| 1 | `1993bf6` | 2025-11-02 | Be less strict about texture mip data, and fix non-ascending lodmips | `Tex.cs` +9/−10 | _pending_ — expect `bug register` (#19; audit #20, #21) |
| 2 | `76535f4` | 2026-05-24 | Add PMP Combining group import support | `PMP.cs` +93/−3, `WizardData.cs` +19/−1 | _pending_ |
| 3 | `9c09415` | 2026-05-24 | Add Facewear item list support | `XivCache.cs` +10/−1, `Mtrl.cs` +7/−1, `Mdl.cs` +1/−0, `Imc.cs` +12/−1 | _pending_ |
| 4 | `bbc7069` | 2026-05-25 | Fix material auto assign for pre `_bibo` EW mods | `Mdl.cs` +5/−1, `TTMP.cs` +14/−12 | _pending_ |
| 5 | `8cc1f40` | 2026-05-27 | Fix double-execution of ModelModifiers in some model import paths | `Mdl.cs` +1/−5 | _pending_ |
| 6 | `d09cd2b` | 2026-07-19 | Don't crash on v4 import | `PMP.cs` +25/−5 | _pending_ |
| 7 | `371f74b` | 2026-07-20 | Fix Racial Deforms and Replace GPL violating `DxtUtil.cs` | `ModelModifiers.cs` +28/−8 | _pending_ — also review `NOTICE` |
| 8 | `f20b659` | 2026-07-24 | Adjust read/write for Penumbra v4 | `PMP.cs` +26/−11, `WizardData.cs` +0/−1 | _pending_ |
| 9 | `33ae15c` | 2026-07-27 | Upgrade double-click handler/modpack upgrader to full-copy or refuse penumbra v4 modpacks depending on context | `PMP.cs` +38/−2, `ModpackUpgrader.cs` +34/−6, `WizardData.cs` +2/−2 | _pending_ |
| 10 | `cdd64b6` | 2026-08-03 | Minor PMPv4 fixes | `PMP.cs` +4/−4 | _pending_ |
| 11 | `7bc8a76` | 2026-08-03 | Add LastWrite field for PMP v4 | `PMP.cs` +4/−0, `WizardData.cs` +1/−0 | _pending_ |

Baseline totals, recorded via `npm run baseline:report`:

| Point | upgrade | resave | roundtrip | total |
|---|---|---|---|---|
| after opening bless (§7.2) | _pending_ | _pending_ | _pending_ | _pending_ |

One row is appended per ported commit as the total falls.

Prior context for #2: README already records that the earlier `master`-tracking era carried the
additive PMP "Combining" group feature opaquely via `raw`, so that commit may land as
`no port impact` — to be confirmed against the actual hunks, not assumed.

## 11. Deliverables

1. `scripts/setup-oracle.ts` + committed release hashes
2. `test/helpers/oracle.ts` env resolution + corrected `assertUpgradeTraceListenerConfigured` text
3. `scripts/baseline-report.ts` + `npm run baseline:report`, printing per-pack and total diff counts
   across the three baseline dirs
4. README provenance table + rewritten incremental-upgrade procedure (incl. the shallow-clone fetch)
5. This spec, carrying the commit ledger (§10) kept current through execution
6. Ported changes + tests, one commit per upstream commit where it divides cleanly
7. `docs/TEXTOOLS_BUGS.md` status updates per §9
8. Closing note on `docs/backlog/2026-07-11-expected-failure-golden.md`

## 12. Testing

The gate is unchanged: `npm run check` → `npm run typecheck` → `npm test`, all green before any task
is considered complete. Each `ported` verdict additionally owes the test that would have caught its
divergence — preferring a real or synthetic golden over a synthetic unit test, per AGENTS.md.

`npm run baseline:report` is reporting-only and is deliberately **not** part of the gate; its job is
to make the ratchet-down measurable, not to fail builds.

## 13. Risks, accepted

- **Beta channel.** v3.1.1.4 is `prerelease: false` but named "v3.1.1.3 BETA" with a `b`-suffixed
  asset, and has ~681 downloads against v3.1.0.2's ~66,642. It is the only route to the fix.
- **Penumbra v4 dominates.** `PMP.cs` +187/−22 net across six commits, and `33ae15c` makes the upgrader
  *refuse* v4 packs in some contexts — behaviour to reproduce, not route around. This is the most
  likely source of substantial port work and of a stubborn baseline residue.
- **Citation drift** across the 10 changed files (§7.3).
- **Single-machine reproducibility.** Corpus, caches and baselines are local-only; a fresh clone
  cannot reproduce this work. Pre-existing and accepted (§4.4).
- **The baseline may not reach zero within this project.** Its exit condition is that all 11 commits
  carry a verdict and the suite is green against the new oracle — not a zero baseline.

## 14. Exit criteria

1. Harness runs against v3.1.1.4 via `FFXIV_CONSOLETOOLS`; Program Files install removed by the
   operator.
2. `reference/` at UI `b96139d3` / XMF `8e2a2603`; README provenance updated.
3. All three caches rebuilt from the new oracle; baselines blessed and the opening total recorded.
4. All 11 commits carry a verdict in §10, with `deferred` verdicts signed off by the operator.
5. `docs/TEXTOOLS_BUGS.md` reconciled for every fixed-upstream entry found.
6. `npm run check` / `npm run typecheck` / `npm test` green; suite skip count zero.
