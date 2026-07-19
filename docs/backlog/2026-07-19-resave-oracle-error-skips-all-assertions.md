# `/resave` asserts nothing when its oracle errors — the oracle-free checks could still run

Filed: 2026-07-19 · Status: open

`registerResaveCheck` (`test/helpers/corpus-resave.ts:52-66`) returns early when the cached result is
`{ kind: "error" }`, before comparing anything. It is **loud** about it — `console.error("[resave]
UNVERIFIED: …")` naming the pack and quoting the oracle's stack, then `ctx.skip(message)` so the unit
reports skipped-with-a-note rather than green. That much is right and should stay.

What it gives up is that the skip happens *before* any assertion at all, including the ones that need
no oracle.

**Why the skip (not a matched-failure assertion) is correct here.** The `/upgrade` harness asserts a
*matched* failure — oracle throws AND our port throws the same error is a PASS, a mismatch is a loud
FAIL (`assertMatchedUpgradeFailure`, `test/helpers/corpus-upgrade.ts:27`, used at `:90`). That is
right for `/upgrade`, where an oracle error is transform logic we are meant to reproduce. It is
**wrong for this case**: the only `/resave` oracle error in the corpus is
`Milktruck Bust Scaling Tweaks v1.0.0.ttmp2`, where TexTools converts each `.rgsp` into an RSP
manipulation on write and reads **the installed game's `human.cmp`**, which this TexTools build does
not recognise (`CMP Format Changed - Unable to read all CMP data`, full stack in
`docs/backlog/2026-07-11-expected-failure-golden.md`). That is environmental — a property of the
machine and game version, not of the pack. Asserting we must crash too would reproduce a failure with
no modpack-semantic meaning, and would invert the moment TexTools ships a fix or the game changes.
**Do not "fix" this item by making it a matched-failure assertion.**

**What could run instead.** Everything that does not need a golden:

- the write → re-read → compare-against-the-in-memory-model round-trip (the same seam
  `registerUpgradeCheck` gets for free by re-reading `oursArchive`), and
- `pmpSelfConsistency` (no dangling `Files` key, no orphan member) for a PMP.

That turns "UNVERIFIED" into "verified as far as is possible without an oracle" for these packs.
Milktruck is a `.ttmp2`, so only the round-trip half applies to the one pack that exists today — the
self-consistency half would matter for a future PMP that trips a write-side oracle error.

**Why it is worth doing.** This pack is the one place in the corpus where a pack is *both* a
`/upgrade` no-op and a `/resave` oracle error, so nothing in either harness compares its written
output to anything. Surfaced by the PR review for
`docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md`, which removed the
`/upgrade` no-op branch's (unsound) member-name comparison and so left this pack's writer covered by
neither harness. The concrete scenario: a `writeTtmp2` regression that drops `ModPackPages` or mangles
option names on that pack ships green.

Deliberately **not** closed by coupling the two harnesses — the `/upgrade` no-op branch will not read
`/resave`'s error markers (operator call, 2026-07-19: the two checks stay independent, and the case is
rare). Fixing it inside `/resave`, where the error is already known, needs no crosstalk at all.

**Scope note.** `ctx.skip` after running the oracle-free assertions still reports the unit as skipped,
which is the honest status — the *oracle* comparison genuinely did not happen. Decide whether the
assertions run before the skip, or whether such a pack should report as passing on the reduced check
set with the loud `UNVERIFIED` line retained. The first is less of a change and keeps the skip count
meaningful (`corpus-resave.ts:64` is currently the **only** skip site in the whole suite, so
`1 skipped` in a run is exactly this pack).
