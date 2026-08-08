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

The oracle lives **inside `reference/`**, beside the vendored source it is the compiled form of:

```
reference/
  FFXIV_TexTools_UI/          vendored third-party SOURCE (read-only, see below)
    lib/xivModdingFramework/
  oracle/
    v3.1.0.2/   ConsoleTools.exe  ConsoleTools.exe.config  console_config.json  lib/  …
    v3.1.1.4/   ConsoleTools.exe  ConsoleTools.exe.config  console_config.json  lib/  …
```

`DEFAULT_ORACLE_PATH` is therefore **repo-relative**: `reference/oracle/v3.1.1.4/ConsoleTools.exe`.
No machine-specific absolute path is baked into the harness, and `FFXIV_CONSOLETOOLS` becomes a
genuine override rather than a necessity. The location is user-writable, so no step of an install or
re-pin needs elevation.

Co-locating is the point: `reference/` holds the pinned upstream *source*, and the oracle is the
pinned upstream *build of that same source*. Keeping them in one tree makes the invariant this spec
exists to protect — read-source and oracle in lockstep — physically visible, and makes the whole
pinned baseline a single directory to inspect or replace.

Verified safe on every tooling axis: `.gitignore:5` ignores `/reference/` wholesale (so the binaries
can never be committed), Biome skips it via `useIgnoreFile: true` (`biome.jsonc:3-7`), `tsconfig.json`
includes only `src`/`test`/`scripts`, and the custom runner globs `test/`.

**One clarification is owed to AGENTS.md.** Its "`reference/` is off-limits to edits" rule is about
the vendored C# we port from. Adding a tool-managed subtree needs the distinction spelled out, or the
rule blurs:

- `reference/FFXIV_TexTools_UI/` — vendored third-party **source**. Read freely; never edit, lint or
  format.
- `reference/oracle/` — third-party **binaries**, written *only* by `scripts/setup-oracle.ts`. Never
  hand-edited either; the script is the one writer.

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
a **sha256 pinned in the repo**, extract to `reference/oracle/<tag>/`, write `console_config.json`
with the operator's `XivPath`, and patch `ConsoleTools.exe.config` with the trace-listener block. Pinning the
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

**Only the pinned latest is installed.** The layout above is versioned so a future re-pin can stage a
new build beside the old one, but nothing reads a non-pinned version *after* a switch: the harness
resolves exactly one path, and §7.1 rebuilds every cache from the new oracle. Keeping v3.1.0.2
extracted would only serve the golden-vs-golden attribution the operator declined (§4.3), so it is
not installed. Should a divergence during porting prove inexplicable, the v3.1.0.2 release is still
published and can be re-provisioned on demand. Operator call, 2026-08-06.

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

**Confirmed, 2026-08-07.** The Milktruck skip disappeared exactly as predicted above: the suite's
skip count went to zero, and `Milktruck Bust Scaling Tweaks v1.0.0.ttmp2` now produces a real
`/resave` golden (3 diffs, all manifest-level — `TTMPL.mpl#/ModPackPages`, `#/SimpleModsList`,
`#/TTMPVersion`) in place of the `ctx.skip`. See the closing note on
`docs/backlog/2026-07-11-expected-failure-golden.md` for the full detail.

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

**Inverse instance — bug #23**, the register's first entry going the *other* direction: a defect
the v4 work *introduces* rather than fixes, and one we deliberately do **not** reproduce.
`PMP.cs · LoadPMP · 191-208` builds its "extra files" set from the on-disk `groups` list, but the
v4 pull-back at `:217-225` never assigns that local variable — it assigns `pmp.Groups` instead — so
the referenced-file scan at `:234` sees nothing for a v4 pack's inline groups, misclassifies every
such payload member as "extra," and `WizardData.WritePmp`'s `saveExtraFiles` path (the one live
caller: `/resave`, `ConsoleTools/Program.cs:211`) writes each one twice. Registered as
`docs/TEXTOOLS_BUGS.md` **#23**, status `diverged`: our reader (`src/container/pmp.ts`'s
`readPmp`) feeds the referenced-file scan from the groups it actually loaded, so it emits each
payload member once. Confirmed — not merely tolerated — by
`test/helpers/pmp-v4-extrafile-divergence.ts`'s `makeV4ExtraFileDuplicateConfirmation`, exercised
by the purpose-built `test/corpus/synthetic/pmp-v4-extrafiles.pmp`
(`scripts/generate-synthetics/build-synthetic-pmp-v4.ts`). Upstream report:
`docs/upstream/2026-08-06-textools-pmp-v4-extrafile-duplication.md`, written to stand on its own
for a TexTools maintainer with no knowledge of this repo.

**OPEN — AGENTS.md evidence bar 3 for the #23 divergence.** In-game verification has NOT been
performed. Operator action: install our `/resave` output and ConsoleTools' `/resave` output of
`test/corpus/synthetic/pmp-v4-extrafiles.pmp` in Penumbra, confirm both load, confirm identical
in-game result, confirm ours is roughly half the size. Record the outcome in
`test/helpers/pmp-v4-extrafile-divergence.ts` and `docs/TEXTOOLS_BUGS.md` #23. Until then the
divergence ships on the operator's 2026-08-06 ruling, not on satisfied evidence.

## 10. Commit ledger

Verdicts are filled in during execution. `cited files` lists only files our port cites; every commit
below also touches unported files.

| # | commit | date | subject | cited files touched | verdict |
|---|--------|------|---------|---------------------|---------|
| 1 | `1993bf6` | 2025-11-02 | Be less strict about texture mip data, and fix non-ascending lodmips | `Tex.cs` +9/−10 | **`bug register` + `ported`** — three hunks, all in `Tex.cs`, all landing in symbols we port. (a) `TexHeader.ToBytes` loses its **entire** validation block (`Tex.cs:138-145` *at the old pin*, +0/−9). §9's summary named only the `LoDMips` ordering guard; `git show` shows the commit also deletes `LoDMips[2] >= MipCount`, `MipFlag > 15` and `MipCount > 13` — `ToBytes` is now a pure serializer. We port all four verbatim as `assertTexHeaderWritable` (`src/tex/header.ts:158`), called at `src/upgrade/validate-tex.ts:49` where a throw **drops the file at the load seam**; Part B deletes the function and that call. (b) `CreateTexFileHeader`'s LoD2 line becomes `newMipCount > 2 ? 2 : (newMipCount - 1)` (`Tex.cs:1126`); ours still writes `: 0` (`src/tex/header.ts:79`) and reaches real output via `encodeUncompressedTex` (`src/tex/encode.ts:105`), so every regenerated exactly-2-mip texture moves bytes. (c) `FixUpBrokenMipOffsets` gains an ascending-order clamp in its LoDMips loop (`Tex.cs:203-219`, running `maxLodMip`, sets `modified`); ours has only the `>= mipCount` clamp (`src/tex/header.ts:135`). Bug register reconciled: **#19 fixed upstream** by (a)+(b) — status line added, and note the landed (b) is behaviourally identical to the fix #19 already proposed for every reachable `newMipCount >= 1`; **#20 audited, UNAFFECTED** — it lives in `EndwalkerUpgrade.cs`, untouched across the entire range; **#21 audited, NOT fixed** — `TexHeader` is still a `struct` (`:71`), still taken by value (`:159`), and both `header.MipCount` writes are still to the local copy (`:173`, `:200`). |
| 2 | `76535f4` | 2026-05-24 | Add PMP Combining group import support | `PMP.cs` +93/−3, `WizardData.cs` +19/−1 | _pending_ — deliberately **out of scope** for the PMP v4 plan (`docs/superpowers/plans/2026-08-06-pmp-v4-port.md`, "Explicitly out of scope"). Verified: zero cached goldens under `test/corpus/.upgrade-cache`/`.resave-cache`/`.oracle-cache` carry a `Combining` group anywhere in their bytes. Our reader still fails loud on one — `KNOWN_PMP_GROUP_TYPES` (`src/container/manifest-types.ts:308-315`) excludes `"Combining"` by name, so `parsePmpGroup` throws `Unimplemented PMP group type: Combining`, the same message TexTools itself threw *before* this commit and no longer throws after it — a real, tracked gap, not silently wrong output. **VERIFIED against `git show 76535f4`, 2026-08-07** — the rationale above holds, with three additions the prose did not have. (i) The mechanism is exact: the commit adds `[JsonSubtypes.KnownSubType(typeof(PMPCombiningGroupJson), "Combining")]` (`PMP.cs:1494`) plus the `PMPCombiningGroupJson` / `PmpCombiningOptionJson` / `PmpCombiningContainerJson` types (`:1555-1603`), so the base `PMPGroupJson.Options` virtual whose `NotImplementedException` we mirror (`:1517`) is no longer reached for `"Combining"`. (ii) **A Combining pack still fails to `/upgrade` or `/resave` at the new pin — just later and with a different message.** `WizardData.ToPmpGroup` gains `throw new InvalidDataException("Editing or exporting PMP Combining groups is not supported.")` (`WizardData.cs:897-900`), and `ToPmpGroup` is called only from `WizardData.WritePmp` (`:1581`, `:1613`; `WritePmp` starts `:1479`) — the symbol our `writePmp` ports. So the net observable outcome (refuse) is unchanged; what moves is the failure *stage* (load → write) and the *message*, which matters because `assertMatchedUpgradeFailure` substring-matches our thrown text against the oracle's trace. The remaining `PMP.cs` hunks are outside our path: the `allPmpFiles` `Containers` scan is in `LoadPMP` (`:236-251`), the import branch is in `ImportPMP`, and the `Groups.Any(x => x.Type == "Combining") → return null` early-out is in `UnpackPMP` (`:1059`, the simple-modpack path). `HasCombiningGroups` (`WizardData.cs:1103`) has no consumer in either repo. (iii) Re-verified after the cache rebuild: **0 of 1443 files** under `.upgrade-cache` (122), `.resave-cache` (115), `.oracle-cache` (1091), `corpus/real` (85) and `corpus/synthetic` (30) contain the string `Combining` (caveat: `.pmp`/`.ttmp2` members are deflated, so the stronger evidence is that our reader *throws* on one and the suite is green). **ESCALATED, awaiting operator sign-off (§4.5).** The verdict this implies is `deferred` — real (our message and failure stage now diverge from the oracle), but explicitly out of scope for the PMP v4 plan — and §4.5 forbids recording `deferred` without the operator. Left `_pending_` deliberately. |
| 3 | `9c09415` | 2026-05-24 | Add Facewear item list support | `XivCache.cs` +10/−1, `Mtrl.cs` +7/−1, `Mdl.cs` +1/−0, `Imc.cs` +12/−1 | **`no port impact`** — every hunk adds a Facewear special case to `IItem`/`IItemModel`-driven **item-catalog** machinery, and the port has no item catalog at all: it transforms modpacks by `gamePath`, never by item. Symbol by symbol: `XivCache.MakeGear` (`XivCache.cs:1367-1409`) builds an `XivGear` from a cache-DB row (adds Facewear to the Accessories re-categorisation and unpacks a `>0xFFFF` packed model id); `Mtrl.GetMaterialSetId(IItem)` (`Mtrl.cs:1364-1372`) and `Imc.GetMaterialSetId(IItemModel)` / `Imc.UsesImc(IItemModel)` (`Imc.cs:101-106`, `:63-68`) gain Facewear early-returns — **note the overload**: what we port is `UsesImc(XivDependencyRootInfo)` (`Imc.cs:80-91`, offline, in `scripts/lib/imc-entries.ts`), which is untouched; `Mdl.SlotAbbreviationDictionary` gains `{Facewear, "met"}` (`Mdl.cs:5337`) — our only `Mdl.cs` citation in that region is `VertexTypeDictionary`/`VertexUsageDictionary` (`:5361-5392`, `src/mdl/geometry/format.ts`), a different table. `Imc.GetEntries` and the IMC (de)serializers we *do* port are unchanged in content; only their line numbers move (+11), corrected below. |
| 4 | `bbc7069` | 2026-05-25 | Fix material auto assign for pre `_bibo` EW mods | `Mdl.cs` +5/−1, `TTMP.cs` +14/−12 | **`no port impact`** — both files' hunks land in **install-time** paths, none of which we port. `Mdl.cs`: `.ToList()` snapshots the modlist in `CheckAllModsSkinAssignments` (`Mdl.cs:4364-4384`) so `CheckSkinAssignment`'s `Dat.WriteModFile` cannot invalidate the enumerator — a live-collection-mutation fix in a modlist maintenance loop. `TTMP.cs`: the same reorder applied twice, hoisting `EndwalkerUpgrade.UpdateEndwalkerFiles` **above** the `AutoAssignSkinMaterials` block, in `ImportModPackAsync` (`TTMP.cs:832-835` vs `:839`) and `ImportFiles` (`:1136-1138` vs `:1141`). Decisive check: `AutoAssignSkinMaterials` appears **only** in `TTMP.cs` and `PenumbraAttachHandler.cs` — `ModpackUpgrader` has no auto-assign step, so there is no ordering for our `/upgrade` port to reproduce; and the `UpdateEndwalkerFiles` overload being reordered is the `IEnumerable<string> paths` one (`EndwalkerUpgrade.cs:83`), while `ModpackUpgrader.cs:105` calls the *other* overload (`EndwalkerUpgrade.cs:151`, `Dictionary<string, FileStorageInformation>`) that our round 1 reproduces. Our `TTMP.cs` citations sit in `GetModpackList`/`DoesModpackNeedFix`/`MakeFileStorageInformationDictionary`, all outside both hunks. |
| 5 | `8cc1f40` | 2026-05-27 | Fix double-execution of ModelModifiers in some model import paths | `Mdl.cs` +1/−5 | **`no port impact`** — one hunk, entirely inside `Mdl.FileToUncompressedMdl` (`Mdl.cs:1922-2013`): the local `applyOptions` flag is dropped and `LoadExternalModel(externalPath, options, applyOptions)` becomes `LoadExternalModel(externalPath, options, false)`, so a caller-supplied `ModelImportOptions` no longer has its `ModelModifiers` applied twice (once in the loader, once downstream). `FileToUncompressedMdl` / `LoadExternalModel` are the **external model import** path (FBX/DB → `.mdl`); we port neither, and neither appears anywhere in `src/` — the `/upgrade` transform only ever reads `.mdl` bytes already inside a modpack. The hunk sits at `Mdl.cs:1922-2013`; our `Mdl.cs` citations below it (`:349-995` read, `:1000-1027` parse, `:1362-1373`) are unmoved, and every citation above it shifts −4, corrected below. |
| 6 | `d09cd2b` | 2026-07-19 | Don't crash on v4 import | `PMP.cs` +25/−5 | `ported` — `default_mod.json` becomes optional, gated on `File.Exists(defModPath)` (`PMP.cs:182`); ported at `src/container/pmp.ts:405`. |
| 7 | `371f74b` | 2026-07-20 | Fix Racial Deforms and Replace GPL violating `DxtUtil.cs` | `ModelModifiers.cs` +28/−8 | **`no port impact`** (both halves). *Racial deform*: the six changed lines route `Normal`/`Binormal`/`Tangent`/`FlowDirection` through a new `MatrixTransformDirection` (`ModelModifiers.cs:1515-1529`, linear 3×3 only) instead of `MatrixTransform`, in the base-mesh and shape-data vertex loops of **`ApplyRacialDeform`** (`:1206-…`, changed lines `:1381-1386` and `:1428-1433`). We do not port `ApplyRacialDeform`: its only callers are `INTERNAL_RaceConvertRecursive` (`:1144`) reached from `ModelModifierOptions.Apply` (`:155`, the external-model-import options path) and `RootCloner.cs:310` (the convert-item flow) — neither is on the `/upgrade` path, and our `ModelModifiers.cs` citations are all in the merge/weld/tangent family (`:376-860`, `:1871-2419`), none inside `1206-1450`. *`DxtUtil.cs`*: irrelevant to us for the reason recorded in `docs/superpowers/specs/2026-07-03-tex-codec-design.md` §3 — we deliberately never ported it, taking BC1/3/4 from MIT `richgel999/bc7enc_rdo` instead. Upstream's replacement is a from-spec rewrite that its own message states is **byte-identical to the previous implementation** (fuzzed side-by-side; "the RGB565 expansion keeps the original rounding formula"), so the ±1 divergence in `docs/backlog/2026-07-16-bcn-decoder-rounding-divergence.md` is unchanged in size or shape. **`NOTICE` needs no change**: it never mentioned FNA/`DxtUtil`/Ms-PL — precisely because we did not port it — and our BCn attribution covers our own `bc7enc_rdo` lineage. Worth carrying forward: the *licensing* obstacle in that backlog item is now gone — `DxtUtil.cs` at this pin carries xivModdingFramework's own GPL-3.0 header, not FNA's Ms-PL, so option 3 ("match `DxtUtil`'s rounding") could now be a direct port rather than a clean-room reimplementation. |
| 8 | `f20b659` | 2026-07-24 | Adjust read/write for Penumbra v4 | `PMP.cs` +26/−11, `WizardData.cs` +0/−1 | `ported` — the v4 pull-back (`PMP.cs:217-225`, `pmp.Groups = meta.Groups` when `meta.Groups`/`meta.DefaultData` is populated) and the write-side push-forward (`:928-939`, `pmp.Meta.Groups = pmp.Groups` / `pmp.Meta.DefaultData = pmp.DefaultMod`); ported at `src/container/pmp.ts:247` (read) and `:1053` (write). NOTE: the `ShouldSerialize` gates at `:1679-1681` are present but still block-commented immediately after this commit (verified via `git show f20b659:.../PMP.cs`) — they go live only in `cdd64b6` (row 10 below), not here; do not attribute that flip to this commit. |
| 9 | `33ae15c` | 2026-07-27 | Upgrade double-click handler/modpack upgrader to full-copy or refuse penumbra v4 modpacks depending on context | `PMP.cs` +38/−2, `ModpackUpgrader.cs` +34/−6, `WizardData.cs` +2/−2 | `ported` — `readPmp`'s `enforceCompatibility` throw (`PMP.cs:176-179`, `meta.FileVersion > 3 && enforceCompatibility`) and the `/upgrade` entry-point refusal (`ModpackUpgrader.cs:218-241`: throws `"Cannot convert v4+ Penumbra modpack to ttmp/pmp."` for a `.ttmp2`/`.pmp` destination, raw-copies otherwise); ported at `src/container/pmp.ts:208` and `src/upgrade/upgrade.ts:405,419` (message is byte-identical to the C# one). |
| 10 | `cdd64b6` | 2026-08-03 | Minor PMPv4 fixes | `PMP.cs` +4/−4 | `ported` — folded into row 8's verdict, three hunks verified against `git show cdd64b6`: (a) null-guards the pull-back, `pmp.Groups = meta.Groups ?? new List<PMPGroupJson>()` at `:220` (a v4 pack with `DefaultData` set but `Groups` absent no longer NREs) — our port's `readPmp` already defaults to `[]`, so this needed no code change, only citation coverage; (b) adds `Identifier = Guid.NewGuid()` field initializers to both `PMPJson` (`:1476`) and `PMPGroupJson` (`:1509`) — see the non-determinism confirmation, `test/helpers/pmp-v4-nondeterminism.ts`; (c) **uncomments** `ShouldSerializeFiles`/`ShouldSerializeFileSwaps`/`ShouldSerializeManipulations` (`:1679-1681`), making them live for the first time — ported at `src/container/pmp.ts:644,868` ("LIVE at this pin — they were block-commented at the old one"). |
| 11 | `7bc8a76` | 2026-08-03 | Add LastWrite field for PMP v4 | `PMP.cs` +4/−0, `WizardData.cs` +1/−0 | `ported` — `LastWrite` field initializer (`PMP.cs:1477`, `.NET` `"O"` format) and the write-time re-stamp (`:941`, `pmp.Meta.LastWrite = DateTime.Now.ToString("O", InvariantCulture)`); ported at `src/util/dotnet-datetime.ts` and `src/container/pmp.ts:1049`. |

### 10.1 Citation drift sweep (2026-08-07)

§7.3's citation-drift obligation is discharged for `src/`, `test/` and `docs/TEXTOOLS_BUGS.md`,
mechanically rather than by eye — 1,202 citations into the ten changed files is well past what
hand-checking could claim honestly. The scope of the claim is stated precisely at the end of this
section; read it before relying on this.

**Citations come in five spellings, and a sweep that handles only the first is worse than useless
— it leaves a third of them stale while looking complete.** The first pass here did exactly that,
and it is the trap most likely to recur:

| form | example | note |
|---|---|---|
| named | `Mdl.cs:2464`, `Mdl.cs:2513-2535` | the obvious one |
| bare continuation | `:2464` for a file named earlier | context routinely spans a **whole module** — a header names the file, the body cites bare |
| dot | `WizardData.cs · ClearNulls · 1234-1266`, and bare `(· 621-627)` | AGENTS.md's own prescribed `file · symbol · lines` |
| wrapped | `ModelModifiers.cs:` ending a line, digits starting the next | invisible to any single-line regex |
| file-qualified symbol | `WizardData.FromPmp:1118-1159` | no `.cs`, but the file base name is there |
| **bare symbol** | `FromPmp:1159`, `WriteWizardPack:1348-1357` | **no file reference at all** — resolvable only by knowing which C# file owns the symbol |

The last row is the one to watch: a *scanner* cannot resolve it without a symbol table, and every
automated pass here missed it (18 sites). Those were fixed **by hand**.

**Method.** One scanner over the whole file text: any `<Name>.cs` occurrence sets the current-file
context (file-scoped, last-wins); any following line-number token in any of the above spellings is a
citation against that context. The OLD→NEW line map comes from `git diff -U0 e20179a0..8e2a2603` per
file — git's own answer, not a guess. Every correction is then **proved** by requiring
`OLD[n] === NEW[n + shift]` textually, and the proof **explicitly rejects three ways it can pass
vacuously**, each of which produced a real misattribution here before it was tightened:

1. **out of range** — `:2009` under a 540-line `ModpackUpgrader.cs` indexes `undefined` on *both*
   sides, and `undefined === undefined` "proves" a citation that actually belongs to
   `EndwalkerUpgrade.cs`;
2. **blank line** — matches any other blank line at any shift;
3. **punctuation-only line** (`{`, `}`, `);`) — same, slightly weaker.

A range must therefore have at least one substantive endpoint. Lines authored by the PMP-v4 port
already cite the new pin and are skipped via `git blame` against `main..HEAD`.

**Result.** 226 + 416 = **642 proven corrections** across `src/`, `test/` and the bug register, plus
**24 hand-resolved**, each individually proved against the C# before editing. Of the hand cases,
three could not be proved textually because the upstream commit edited that very line, and were
resolved by symbol identity instead: `PMP.cs:124 → :159` (`LoadPMP` gained `enforceCompatibility`),
`ModpackUpgrader.cs:58 → :63` (`FromModpack(path)` → `FromModpack(path, true)`), and
`Tex.cs:1127 → :1126` (the LoD2 line `1993bf6` changed). The `Tex.cs:138-145` citations are
deliberately **not** repointed — they name the guard block `1993bf6` deleted, and the register now
marks them *pre-fix*.

**Completeness.** An audit (`.superpowers/…/audit.mjs`) resolves all 1,202 citations into the ten
changed files and re-derives each one's old-pin counterpart: 1,176 verified stable, 26 flagged and
individually explained (19 are the audit's own context misattributions — provably so, being out of
range for the file it guessed; 7 are correct new-pin citations pointing *into* a changed region,
`PMP.cs:170-173` and `:1679-1681`).

**That audit is necessary but NOT sufficient, and the reason is the important part.** It re-uses the
same last-wins context heuristic as the mapper, so where the mapper guessed the wrong C# file the
audit agrees with it and reports clean. It is not an independent check; it is the same check run
twice. Three citations were rewritten to *confidently wrong* values before this was understood —
worse than staleness, because they read as freshly verified. All three were the same cause: a bare
ref attributed to the wrong file, where the hardened vacuity proof still passed because the wrong
file's line happened to be in range and substantive.

The check that **is** independent — it shares no logic with the mapper and never needs to know which
C# file a ref belongs to — is `.superpowers/…/detect-divergent.mjs`:

> Pair each removed line with its added counterpart using git's own hunk alignment, extract every
> `<old> → <new>` line-number rewrite, and flag any old number rewritten to **two or more different
> new values**. One old line cannot legitimately land on two new lines, so divergence means two
> citations of it were attributed to different files.

Measured, not assumed — over the 1,123 number rewrites of the two automated passes:

| variant | flags | caught | noise |
|---|---|---|---|
| per repo file | 1 | breakage 1 (`WizardData.cs:1334 → :1432` vs `:1353`, one file contradicting itself) | none |
| repo-wide | 24 | breakages 1 and 3 (`:1230 → :1232` vs `:1249`) | ~22 legitimate — the same line number in *different* C# files properly maps to different values |

**Breakage 2 is not catchable by this method at all**, and that is worth stating plainly: `:326` was
never a C# citation — it was an intra-file self-reference to this module's own `clearNulls` call,
which the scanner swept into a C# shift. There is no second citation of it to disagree with. It is
now rewritten as prose carrying no bare `:N` token, so no future scanner can mistake it again.

Run the per-file variant as the zero-noise gate after any sweep; the repo-wide one as a triage list.

Caveats, recorded so the next re-pin does not trip on them:

- The mapper is **not idempotent** — it rewrites OLD-pin numbers to NEW-pin ones, so re-running it
  over an already-corrected tree silently double-shifts. Run once per re-pin, per tree. Round 2 hit
  this in a subtler form: round 1 had *hand-written* new-pin bare refs into register entries 19–21,
  which `git blame` cannot distinguish from its own automated edits, so every token on a round-1
  line in `TEXTOOLS_BUGS.md` had to be re-reviewed by hand.
- A **last-wins file context can misattribute** a bare ref when two `.cs` files are named in one
  comment, and the hardened proof is *not* a sufficient backstop: it only catches the cases where the
  wrong file's line is out of range or blank. Three misattributions survived it here. The
  divergent-rewrite detector above is the check that catches them; run it, and hand-verify anything a
  sweep touches in a file that names more than one C# source.
- **Prefer a citation that names its file.** Every failure in this section traces to a citation that
  did not: bare `:N`, bare `FromPmp:1159`, or an intra-file `:326` indistinguishable from a C# ref.
  When adding a citation, spell the file at least once per comment block — it costs nine characters
  and makes the reference machine-resolvable instead of a guess.
- Some citations live inside **runtime message strings**, not comments, so correcting one is
  observable. Three moved (`src/container/option-prefix.ts`'s `MakeGroupPrefix` non-termination
  throw, and two in `src/mdl/model/model-modifiers.ts`, `ModelModifiers.cs:2021/:2026 → :2041/:2046`).
  One test asserted on the first and was updated with it. The suite is the reliable detector — a
  hand-written `grep` missed it, because the assertion spells the citation as an escaped regex
  (`WizardData\.cs:…`).
- **Not swept:** everything under `docs/` except `TEXTOOLS_BUGS.md` — including the other specs and
  the backlog — plus `AGENTS.md` and `README.md`. Those carry citations into the ten changed files
  and are known-stale. The tooling handles them unchanged; it was scoped out, not attempted.

Baseline totals, recorded via `npm run baseline:report`:

| Point | upgrade | resave | roundtrip | total |
|---|---|---|---|---|
| after opening bless (§7.2) *(identical to the row below by construction — see the prose immediately following this table; not a copy-paste error)* | 3352 | 2457 | 0 | 5809 |
| after PMP v4 (rows 6, 8, 9, 10, 11 above) | 3352 | 2457 | 0 | 5809 |

One row is appended per ported commit as the total falls. The PMP-v4 row above is a **re-keying**
of the same pre-existing diffs, not a reduction: two corpus packs (`Westlaketea's Constellation
Crown (Dawntrail Edition).pmp`, `torn bassment glow.pmp`) had their divergences addressed under
`group_NNN.json#/Options/…` / `default_mod.json#…` JSON pointers before this row and under
`meta.json#/Groups/…/Options/…` / `meta.json#default|…` pointers after it, because the v4 writer
(row 8) now emits a single `meta.json` in place of those documents.

The pack-by-pack proof, recorded here rather than cited out to a transient report. Exactly **three**
baseline files changed under the bless — one `upgrade`, two `resave` — matching the three pre-bless
failing test files 1:1; every other file in both directories stayed byte-identical to a pre-bless
snapshot, and `.roundtrip-baseline` neither gained nor lost a file:

| pack (input sha256) | baseline | entries before → after | keys that moved |
|---|---|---|---|
| `Westlaketea's Constellation Crown (Dawntrail Edition).pmp` (`bd7130dc…f12166`) | `upgrade` | 89 → 89 | 2, `group_001_options.json#/Options/{0,1}/Files/…met_d_n.tex` → `meta.json#/Groups/0/Options/{0,1}/Files/…met_d_n.tex` |
| same pack | `resave` | 94 → 94 | 3, `group_001_options.json#/Options/{0,0,1}/Files/…met_d_{m,n,n}.tex` → `meta.json#/Groups/0/Options/…` |
| `torn bassment glow.pmp` (`a552bbd3…50878f`) | `resave` | 4 → 4 | 2, `default_mod.json#0\|chara/equipment/e0246/texture/v01_c0201e0246_top_{n_a678270a,s_5e70012b}.tex` → `meta.json#default\|…` (same `detail`: `5592496 vs 5592496` and `1398184 vs 1398180` bytes) |

Only the manifest **filename** prefix and the pointer path moved; `index`, `status` and `detail` are
unchanged on every entry, and every entry not listed above is byte-identical before and after. The
shape of the move follows directly from the writer flip: v3 put a group's `Options` array at the top
level of its own `group_NNN_<name>.json` and made `default_mod.json` *be* the default option (hence
the `#0|` key), while v4 holds the same data at `meta.json`'s `Groups[i].Options[j]` and
`DefaultData` (hence `#default|`).

The `upgrade`/`resave`/`total` counts are therefore identical before and after this row — 76/90/166
packs, 3352/2457/5809 diffs, `npm run baseline:report` printing the same table both times — and
`roundtrip` (which records our own codec self-consistency, with no oracle involved) stayed at zero
throughout, verified byte-identical against a pre-bless snapshot.

Prior context for #2: README already records that the earlier `master`-tracking era carried the
additive PMP "Combining" group feature opaquely via `raw`, so that commit may land as
`no port impact` — to be confirmed against the actual hunks, not assumed.

## 11. Deliverables

1. `scripts/setup-oracle.ts` + committed release hashes
2. `test/helpers/oracle.ts` repo-relative default + env override, and corrected
   `assertUpgradeTraceListenerConfigured` text
3. AGENTS.md clarification distinguishing `reference/`'s vendored source from `reference/oracle/`'s
   tool-managed binaries (§5)
4. `scripts/baseline-report.ts` + `npm run baseline:report`, printing per-pack and total diff counts
   across the three baseline dirs
5. README provenance table + rewritten incremental-upgrade procedure (incl. the shallow-clone fetch
   and the new oracle location)
6. This spec, carrying the commit ledger (§10) kept current through execution
7. Ported changes + tests, one commit per upstream commit where it divides cleanly
8. `docs/TEXTOOLS_BUGS.md` status updates per §9
9. Closing note on `docs/backlog/2026-07-11-expected-failure-golden.md`

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
- **`git clean -xdf` now also destroys the oracle.** Putting the install under `reference/` (§5) means
  a stray clean removes the binaries along with the vendored source, the corpus, and the caches. The
  blast radius was already severe — corpus and caches are the expensive losses and both predate this
  change — and `scripts/setup-oracle.ts` makes oracle recovery a one-liner, so this is accepted
  rather than mitigated.
- **The baseline may not reach zero within this project.** Its exit condition is that all 11 commits
  carry a verdict and the suite is green against the new oracle — not a zero baseline.

## 14. Exit criteria

1. Harness runs against v3.1.1.4 at the repo-relative default (`reference/oracle/v3.1.1.4/`), with
   `FFXIV_CONSOLETOOLS` working as an override; Program Files install removed by the operator.
2. `reference/` at UI `b96139d3` / XMF `8e2a2603`; README provenance updated.
3. All three caches rebuilt from the new oracle; baselines blessed and the opening total recorded.
4. All 11 commits carry a verdict in §10, with `deferred` verdicts signed off by the operator.
5. `docs/TEXTOOLS_BUGS.md` reconciled for every fixed-upstream entry found.
6. `npm run check` / `npm run typecheck` / `npm test` green; suite skip count zero.
