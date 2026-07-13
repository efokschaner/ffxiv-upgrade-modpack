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
the group, per `:877`/`:419`/`:335-341`.

**Writer guard** — throw on a `selectionType` outside `{Single, Multi}`. `Imc`/`Combining` are PMP
group types (`src/container/pmp.ts:214` carries `g.Type` through verbatim) and can only reach
`writeTtmp2` via a PMP→TTMP conversion, which `/upgrade` never performs. C# does not silently coerce
such an option either — `WizardOptionEntry.ToModOption` throws `NotImplementedException` on it
(`WizardData.cs:423-426`). Mapping `Imc → "Single"` would be exactly the silent divergence
`AGENTS.md` forbids; failing loud is the house rule, and it is consistent with `writeTtmp2`'s
existing `extraFiles` and absent-file guards.

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

New `scripts/generate-synthetics/ttmp2-builder.ts` (all five existing builders are PMP-only), plus a
builder emitting `test/corpus/synthetic/selection-type.ttmp2`: a wizard pack, one page, four groups
declaring —

| group | `SelectionType` | predicted `OptionType` |
|---|---|---|
| 1 | `"Single"` | `Single` |
| 2 | `"Multi"` | `Multi` |
| 3 | `"Single Selection"` (the string we invented) | `Multi` |
| 4 | absent | `Multi` |

— over one SqPack-compressed dummy payload (`src/sqpack`'s `encodeSqPackFile`; TTMP payloads live in
the `.mpd` as compressed blobs, so the PMP builders' raw 4-byte dummy will not do) at a gamePath
`/upgrade` ignores. Pinned zip mtime for byte-reproducibility, as `pmp-builder.ts` does and for the
same reason (the golden cache is keyed by `sha256(input pack)`).

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
- Writer guard: an `Imc` group throws.

## 7. Risks and sequencing

1. Reader + writer + `make-packs.ts` + unit tests. Suite goes red on the corpus checks (baselines
   still record the old strings) — expected.
2. `ttmp2-builder.ts` + the synthetic pack; `npm run synthetics`.
3. Run the suite. **Inspect** the resulting diffs, then bless. Grep both baseline dirs and confirm:
   643 `SelectionType` pointers gone from each; nothing else moved except the new synthetic's own
   entries.
4. Read the synthetic's `/resave` golden and confirm — or correct — §2's `else` branch.
5. Docs: correct the pmp-writer spec's lessons section; delete the backlog item and index entry.

**Risk:** ConsoleTools may *error* on group 4's absent `SelectionType` rather than defaulting. The
`/resave` harness already models an erroring oracle (`resave-golden.ts`'s error marker, surfaced as
UNVERIFIED rather than a silent pass), so this fails legibly rather than lying. If it happens, drop
group 4 and record what we learned.

**Risk:** blessing is a big, mostly-deletion diff across ~70 baseline files. It is only safe because
the expected shape is stated up front (step 3). Blessing first and reading after would defeat the
ratchet.
