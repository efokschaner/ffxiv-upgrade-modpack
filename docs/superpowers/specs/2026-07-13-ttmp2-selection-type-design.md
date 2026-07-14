# `SelectionType`: port the C#, not its doc-comment

Date: 2026-07-13 · Status: approved, not yet implemented

Fixes the top prioritized backlog item,
[`docs/backlog/2026-07-13-ttmp2-selection-type-spelling.md`](../../backlog/2026-07-13-ttmp2-selection-type-spelling.md)
— **whose prescribed fix was wrong**, for reasons this spec records (§3). Related:
[`2026-07-12-pmp-writer-regeneration-design.md`](2026-07-12-pmp-writer-regeneration-design.md),
which built the `/resave` oracle that surfaced this and whose lessons section needs a correction
(§5).

## 1. The defect

`src/container/ttmp2.ts` carries a matched pair of errors that mask each other on round-trip:

- **Reader** (`:101-102`): `g.SelectionType === "Multi Selection" ? "Multi" : "Single"`
- **Writer** (`:203-213`): `g.selectionType === "Multi" ? "Multi Selection" : "Single Selection"`

Real packs declare the bare `"Multi"`, which the reader does not match — so **every multi-select
group in every TTMP pack we read collapses to `Single`**, and the writer then emits a spelling
TexTools never produces. A mod author's multi-select group arrives at whoever installs our output as
single-select. This is a wrong-output defect for users, not a byte-parity nit.

It hid because the two errors are inverses: read `"Multi Selection"` → `Multi` → write
`"Multi Selection"` round-trips *our own* strings perfectly. Only an oracle that compares our
written bytes against TexTools' written bytes — `/resave` — could see it, and only once manifest
diffs were reported per JSON pointer rather than as one opaque per-document token.

## 2. What TexTools actually does

Three citations, and they are the whole specification:

| | C# | Behaviour |
|---|---|---|
| The type | `WizardData.cs:25-29` | `enum EOptionType { Single, Multi }` — two members, no other values exist |
| Read | `WizardData.cs:652` | `group.OptionType = tGroup.SelectionType == "Single" ? EOptionType.Single : EOptionType.Multi;` |
| Write | `WizardData.cs:877` (group), `:419` (option) | `SelectionType = OptionType.ToString()` — the bare enum name |

An option has no `SelectionType` of its own: `WizardOptionEntry.OptionType` delegates to its group's
(`:335-341`), so the group and option values in a written `.mpl` are always identical. Our writer
already has that shape; only the strings are wrong.

Note the read comparison is against `"Single"` — **not** against `"Multi"`. Anything that is not
exactly `"Single"` becomes `Multi`, including an absent or unrecognized value. That `else` branch is
C#'s own default and we port it verbatim.

## 3. Root cause: the port coded a comment instead of the code

`"Single Selection"` / `"Multi Selection"` are strings **no TexTools code has ever read or
written.** They occur exactly twice in the entire vendored source, both as doc-comments:

```csharp
/// This is either Single Selection or Multi Selection      // ModGroup.cs:32, ModPackJson.cs:144
public string SelectionType { get; set; }
```

That sentence is prose about *semantics*. The port read it as a statement about the JSON literal and
coded it, in both directions. Evidence that no such literal exists:

- No C# writes it, and no C# compares against it — only `== "Single"` (`WizardData.cs:652`) is ever
  evaluated against this field.
- **All 59 real corpus packs write the bare `"Single"`/`"Multi"`.** Zero legacy spellings — and the
  corpus is deliberately full of old Endwalker-era packs, which is precisely where a legacy spelling
  would show up if one existed.
- Git history cannot settle it either way: the vendored `xivModdingFramework` clone is a single
  squashed commit.

**This is therefore NOT a TexTools bug and gets no `docs/TEXTOOLS_BUGS.md` entry.** An earlier draft
of this design proposed one, on the theory that `== "Single"` silently converts a legacy
single-select group to multi-select. That theory requires legacy-spelled packs to exist, and nothing
supports that they do. Against the only inputs TexTools has ever produced, `== "Single" ? Single :
Multi` is a total, correct function; the `else` branch is a defensive default for an input that does
not occur, which by the register's own criteria ("a comparison that can never match", "an
unreachable guard") is not a defect. There is nothing to take upstream.

The backlog item's prescribed fix — "accept both spellings on read" — followed from the same false
premise and would have *introduced* a divergence: it maps `"Single Selection"` → `Single` where
`WizardData.cs:652` maps it to `Multi`.

**The transferable lesson:** a doc-comment is not the spec. `AGENTS.md` says every line of business
logic traces to a named C# symbol; this traced to a `///` line *next to* one. Cite the code that
executes.

## 4. The fix

**Reader** — a literal port of `WizardData.cs:652`:

```ts
selectionType: g.SelectionType === "Single" ? "Single" : "Multi",
```

The comment cites `:652` and states that the `else` branch is C#'s own default for an unrecognized
value — explicitly *not* an accommodation for a "legacy spelling", so the phantom cannot be
reintroduced by someone helpfully "fixing" the asymmetry later.

**Writer** — the bare enum name (`OptionType.ToString()`) at group and option level, both taken from
the group, per `:877`/`:419`/`:335-341`. That means the *same collapse the reader performs*:

```ts
SelectionType: g.selectionType === "Single" ? "Single" : "Multi",
```

**Two axes, not one — and C# keeps them separate.** Both C# readers collapse the raw type string
into the two-valued `EOptionType` **at load** — `WizardData.cs:652` (TTMP) and `:769` (PMP,
`pGroup.Type == "Single" ? Single : Multi`). C# never retains an `"Imc"` or `"Combining"`
*option-type* anywhere. Imc-ness rides a separate axis: `ImcData != null` → `GroupType`
(`:609-618`), set by `FromPMPGroup` only for a `PMPImcGroupJson` (`:784-787`).

Our `ModpackGroup.selectionType` **blends those two axes into one string** (`"Single" | "Multi" |
"Imc" | "Combining"`), because `src/container/pmp.ts:214` carries PMP's `Type` through verbatim and
the PMP writer needs it back verbatim for byte-parity. That blend is ours, not TexTools'. It is
retained (unpicking it would ripple through the PMP writer for no byte-parity gain), but it must not
leak into behaviour, so the TTMP writer reproduces C#'s two axes explicitly:

- **Option type** → the collapse above. `"Combining"` is not `"Single"`, so it writes as `"Multi"` —
  which is exactly what C# does, and why an earlier draft of this spec was wrong to propose throwing
  on it.
- **Imc-ness** → `writeTtmp2` throws when an option's group is Imc, reproducing
  `WizardGroupEntry.ToModGroup` (`WizardData.cs:868-871`), which throws
  `InvalidDataException("TTMP Does not support IMC Groups.")` at its first statement,
  before it builds the ModGroup or visits any option. The test is `g.selectionType === "Imc"`,
  the same stand-in for `GroupType == EGroupType.Imc` already used at
  `option-prefix.ts:288` and `pmp.ts:485` (both citing `WizardData.cs:1513-1516`).

Unreachable in `/upgrade` either way — only a PMP→TTMP conversion could get there, and `/upgrade`
never converts formats — but reproduced because it is TexTools' behaviour, not invented because it
seemed safe.

> **A guard is a ported behaviour like any other.** The first draft of this spec proposed throwing on
> any `selectionType` outside `{Single, Multi}`. That guard has no C# counterpart, and it would have
> thrown on `"Combining"`, which TexTools handles fine. It was the same mistake as §3 — inventing
> behaviour that felt right instead of porting the behaviour that exists — committed one section
> after diagnosing it. Fail-loud does not license a throw the C# does not have.

## 5. Scrubbing the phantom

The invented spelling has taken root in four places. Removing it is a deliverable, not a
side-effect — the belief is what caused the bug, so leaving copies of it around invites a relapse.

1. **`src/container/ttmp2.ts`** — the reader and writer above.
2. **`test/helpers/make-packs.ts:98,105,123`** — three fixtures declare `"Single Selection"`. Left
   alone, the reader fix silently turns `makeTtmp2Wizard`'s group into a **Multi** group, quietly
   shifting `harness.test.ts` and `upgrade-harness.test.ts` under tests that never meant to exercise
   that. They become `"Single"`.
3. **`docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md:307-320`** — a *durable*
   spec whose lessons section calls this "the legacy `"Multi Selection"`/`"Single Selection"`
   spelling". Now known false; corrected in place. Its actual lesson — that per-pointer harness
   reporting turned a blessed, invisible defect into a greppable one — survives, and sharpens: the
   defect the harness caught was introduced *by a comment*.
4. **`docs/backlog/2026-07-13-ttmp2-selection-type-spelling.md` and its `docs/BACKLOG.md` index
   entry** — deleted when this ships, per the backlog's own rule (grep for citations first).

Explicitly **not** touched: `docs/TEXTOOLS_BUGS.md` (§3).

## 6. Proof

### 6.1 The real corpus already proves the fix

Measured on 2026-07-13, before any change:

| baseline | blessed diffs | `SelectionType` pointers | packs |
|---|---|---|---|
| `test/corpus/.upgrade-baseline` | 6264 | **643** | 36 of 68 |
| `test/corpus/.resave-baseline` | 4980 | **643** | 36 of 63 |

Fantasia is the sharpest single case: its `.mpl` declares one group as `["Race","Multi"]`, the
ConsoleTools golden emits `"Multi"`, and we emit `"Single Selection"`.

After the fix, re-blessing must **remove those 643 pointers from each baseline** and move nothing
else. The transform never reads `selectionType`, so any *other* pointer class that shifts is a
finding to investigate, not acceptable churn. Verify by grepping both baseline dirs before and
after — do not blind-bless.

### 6.2 A synthetic `.ttmp2` grounds the `else` branch in the oracle

§2's `else → Multi` claim is currently *our reading of the C#*. Ground it in ConsoleTools instead.

New `scripts/generate-synthetics/ttmp2-builder.ts` (all five existing builders are PMP-only), plus
**two** packs. Each carries one SqPack-compressed dummy payload (`src/sqpack`'s `encodeSqPackFile`;
TTMP payloads live in the `.mpd` as compressed blobs, so the PMP builders' raw 4-byte dummy will not
do) at a gamePath `/upgrade` ignores, with a pinned zip mtime for byte-reproducibility, as
`pmp-builder.ts` does and for the same reason (the golden cache is keyed by `sha256(input pack)`).

**Pack 1 — `selection-type.ttmp2`.** A wizard pack, one page, three groups whose `SelectionType` is
*present*, so ConsoleTools is certain to load it:

| group | `SelectionType` | predicted `OptionType` |
|---|---|---|
| 1 | `"Single"` | `Single` |
| 2 | `"Multi"` | `Multi` |
| 3 | `"Single Selection"` (the string we invented) | `Multi` |

**Pack 2 — `selection-type-absent.ttmp2`.** One group with the `SelectionType` key *omitted*.
Predicted `Multi`: a missing key deserializes to `null`, and `null == "Single"` (`:652`) is an
ordinary C# string value comparison — `false`, no dereference. So it most likely loads fine.

It is a **separate pack** because its blast radius is different, not because it is likely to fail.
If ConsoleTools *does* reject it, `/resave` absorbs that (`resave-golden.ts` caches an error marker
and reports the pack UNVERIFIED rather than passing it), but the `/upgrade` harness models only
`pack | noop` — an erroring pack hard-fails it, uncached, every run. That is the open
[expected-failure-golden](../../backlog/2026-07-11-expected-failure-golden.md) item, explicitly
deferred "until one does". Isolating the risky group means a rejection costs us one quarantined pack
and a decision, instead of taking the three known-good groups' golden down with it.

**If pack 2 errors under ConsoleTools:** do not paper over it. Either land the `/upgrade`
expected-failure capability (unblocking that backlog item — a legitimate outcome, since we would have
finally produced the erroring pack it was waiting for), or hold pack 2 out of the corpus and record
the finding. Decide then; do not pre-commit here.

`corpusPacks()` (`test/helpers/corpus-roots.ts:13`) already globs `.ttmp2` from `synthetic/`, so the
pack flows into both harnesses with no wiring.

- **`/resave` is the oracle.** It always writes (`WizardData.FromModpack` → `WriteModpack`, no
  transform, no no-op branch), so ConsoleTools hands back a real TexTools-authored `.mpl` and
  `diffArchives` compares it per JSON pointer. **If the oracle contradicts the predicted column
  above, the oracle wins and the reader follows it** — that is the entire point of building it.
- **`/upgrade` no-ops** on the pack (dummy payload at an ignored path), so its golden *is* the input,
  and group 3/4's `SelectionType` will show as expected diffs against a deliberately non-TexTools
  input. Blessed once, documented here — not silently absorbed.
- Any new `.ttmp2` also inherits the write-side gaps already tracked in the backlog (`.mpl` fields we
  omit; `Name`/`Category` re-derivation), so its baselines will carry those entries too. Expected.

### 6.3 Unit tests

- Reader: the four-way mapping of §6.2's table, citing `WizardData.cs:652`.
- Writer: bare `"Single"`/`"Multi"` at group **and** option level.
- Writer collapse: a `"Combining"` group writes as `"Multi"` — the case the retracted guard would
  have wrongly thrown on, so it is pinned deliberately.
- Writer Imc throw: an `Imc` group throws, reproducing `ToModOption` (`WizardData.cs:423-426`).

## 7. Risks and sequencing

1. Reader + writer + `make-packs.ts` + unit tests. Suite goes red on the corpus checks (baselines
   still record the old strings) — expected.
2. `ttmp2-builder.ts` + `selection-type.ttmp2` (§6.2 pack 1); `npm run synthetics`.
3. Run the suite. **Inspect** the resulting diffs, then bless. Grep both baseline dirs and confirm:
   643 `SelectionType` pointers gone from each; nothing else moved except the new synthetic's own
   entries.
4. Read pack 1's `/resave` golden and confirm — or correct — §2's `else` branch.
5. `selection-type-absent.ttmp2` (§6.2 pack 2) last, on its own, so a rejection by the oracle is
   isolated to a step where nothing else is in flight.
6. Docs: correct the pmp-writer spec's lessons section; delete the backlog item and index entry.

**Risk:** blessing is a big, mostly-deletion diff across ~70 baseline files. It is only safe because
the expected shape is stated up front (step 3). Blessing first and reading after would defeat the
ratchet.
