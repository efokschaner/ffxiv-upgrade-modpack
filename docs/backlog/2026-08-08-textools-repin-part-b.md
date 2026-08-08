# TexTools re-pin Part B — port the one upstream commit that still owes a port

Filed: 2026-08-08 · Status: open · Follows directly from the v3.1.1.4 re-pin (Part A), which landed
the new oracle and a verdict for all 11 upstream commits in the range.

Part A's exit condition was deliberately **not** a zero baseline — it was "every commit carries a
verdict and the suite is green against the new oracle"
(`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §14). Part B is the other half:
actually porting what those verdicts assign.

## Scope — smaller than the name suggests

Of the 11 ledger rows in §10, only **row 1 (`1993bf6`, "Be less strict about texture mip data, and fix
non-ascending lodmips")** still owes work:

- rows 6, 8, 9, 10, 11 — `ported`, shipped during the PMP v4 detour;
- row 2 — `ported`, shipped in Part A (the Combining refusal moved to the write seam);
- rows 3, 4, 5, 7 — `no port impact`, each with a recorded rationale.

So this is one commit, three hunks, all in `Tex.cs`. The register entry `docs/TEXTOOLS_BUGS.md` #19
carries the full analysis under **"What Part B owes"**; that is the authoritative statement of the
work and should be read first.

## What to do

1. **Delete `assertTexHeaderWritable` and its Branch-B call site** (`src/upgrade/validate-tex.ts`).
   Upstream's `TexHeader.ToBytes` lost its entire validation block — all four checks, not just the
   `LoDMips` ordering guard #19 is named for — and is now a pure serializer.
2. **Change `buildCanonicalTexHeader`'s LoD2** to `mipCount > 2 ? 2 : mipCount - 1`.
3. **Add the ascending-order clamp** to `fixUpBrokenMipOffsets`: a running `maxLodMip` raising any
   entry that falls below its predecessor, setting `modified`.
4. **Replace the tests that currently assert the throw** — the cases in
   `test/upgrade/validate-tex.test.ts` and `test/tex/tex-header.test.ts` pin behaviour this change
   removes, so they invert rather than disappear.
5. **Update `docs/TEXTOOLS_BUGS.md` #19's status line** to say our port now reproduces the fixed
   behaviour, naming the commit. Keep the entry — it still documents why the old bytes looked as they
   did.
6. **Retire the three `*pre-fix*` markers** at `test/upgrade/validate-tex.test.ts`, `src/tex/header.ts`
   and `src/upgrade/validate-tex.ts`. They exist precisely because those sites cite a guard that no
   longer exists upstream; once ported, they become wrong rather than merely cautionary.

Registered bugs **#20** (unaffected — `EndwalkerUpgrade.cs` is untouched across the whole range) and
**#21** (not fixed upstream) were audited in Part A and need nothing here.

## This one moves bytes — plan the re-bless

Unlike most of Part A, hunk 2 reaches real output through `encodeUncompressedTex`, so **corpus bytes
will move**. That is the point: Part A recorded the opening total (166 packs / 5809 diffs, `roundtrip`
0) precisely so this reduction is measurable against it. Re-bless deliberately, record the new total in
§10's table, and attribute what moved — a diff that shrinks for a reason you cannot name is not a win.

Guard the `roundtrip` ratchet across any bless, per the spec's §7.2 rule: it records our codec
contradicting itself with no oracle involved, so it must not move. It is currently at zero, which is
the goal state.

## The deferral is category-1, not category-4

Noted by the PR #45 reviewer, 2026-08-08, and worth stating plainly because the framing above
undersells it. While `assertTexHeaderWritable` remains live, a `MipCount == 2` `.tex` with a broken
mip-offset table is **dropped at our load seam** — the load-fix `catch` swallows the throw — where the
v3.1.1.4 oracle repairs it and keeps it. On `docs/BACKLOG.md`'s own severity ladder that is **class 1,
silent wrong output** (the user ships a mod missing a texture and never learns), not the class-4
cosmetic byte divergence "this one moves bytes" suggests.

Nothing is hidden today: **no corpus pack reaches it** (checked), and the case is pinned by
`test/upgrade/validate-tex.test.ts`'s Branch-B fixture. But "no corpus pack reaches it" is the
weakest kind of safety, and `docs/BACKLOG.md`'s deployment note applies directly — a public page
accepts arbitrary uploads, so corpus silence stops being evidence of rarity.

## Why it is ranked first

It is the only piece of work in the repo where **we know exactly what to do and have already proved
it needs doing** — the analysis is complete, the C# is read and cited, the register entry is written,
and the reference measurement is in place. Everything above it in an ideal ordering is either an
unmet evidence bar (the #23 in-game check) or an open question needing investigation first. This is
the one item that is purely execution, and leaving it undone means the port knowingly diverges from
its own oracle in a way the ratchet is quietly absorbing.
