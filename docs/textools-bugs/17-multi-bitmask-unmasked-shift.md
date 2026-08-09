# 17. `FromPMPGroup`'s Multi bitmask aliases option 64 onto option 0 (unmasked shift count)

**Status:** reproduced · **Where:** `WizardData.cs:817-818` (and the mirror-image getter,
`WizardData.cs:600`) — see `src/container/pmp.ts`, `readPmp`'s Multi branch

`FromPMPGroup` derives a Multi-type group's per-option `Selected` from `DefaultSettings` by testing
one bit per option index:

```csharp
var bit = 1UL << idx;                              // :817
wizOp.Selected = (pGroup.DefaultSettings & bit) != 0;
```

`DefaultSettings` is a `ulong`, so the shift is a 64-bit `shl`, and the C# language specification
requires the shift count to be **masked to the low 6 bits** for a 64-bit operand — the compiler
emits an explicit `and 63` to guarantee it. (ECMA-335 itself leaves `shl` with a count at or above
the operand width *unspecified*; the guarantee is C#'s, not the IL's.) `idx` is the plain
`0..Options.Count-1` loop counter with no bound of its own, so a group with **65 or more options**
wraps: option 64 tests `1UL << 0`, option 65 tests `1UL << 1`, and so on. Those options become
mirrors of options 0..N — their selection state is not read from any bit of their own (there is
none; the field is only 64 bits wide) but silently aliased onto an earlier option's.

Nothing about the PMP format caps a group at 64 options: `PMPGroupJson.Options` (`PMP.cs:1517`) is
an unbounded list, and `DefaultSettings` is a fixed-width `ulong` (`:1512`). So the format admits
groups the selection encoding cannot represent, and the C# neither rejects them nor truncates them
— it wraps, which is the defect. The write-side getter `WizardGroupEntry.Selection` (`WizardData.cs:596-603`)
has the identical unmasked `1UL << i`, so a round-trip folds the aliased options' state back down
onto the low bits as well.

**Us:** `readPmp` reproduces the aliasing exactly, as `1n << BigInt(idx & 63)`. JS `BigInt` is
arbitrary-precision and does **not** mask, so a bare `1n << BigInt(idx)` would evaluate to 2^64 and
`&` to zero against the 64-bit `rawSettings` — silently deselecting every option past 63 instead of
aliasing it. We chose reproduction over a fail-loud throw: AGENTS.md's "fail loud" rule covers a
path the port cannot yet reproduce faithfully, and this one it can, in one `& 63`; throwing would
also refuse a pack TexTools upgrades fine. Pinned by `test/container/pmp-selected.test.ts`
("Multi: option 64 aliases option 0"). The write side reproduces it too: `groupSelection` in the
same file (the direct port of `Selection`, replacing the earlier `computeSelection` simulation)
masks identically, `1n << BigInt(i & 63)`, so both derivations alias in step. Its `number` return is
exact only below 2^53 — a bound a 54-plus-option group can exceed with or *without* the mask — but
that is no reason the masking is unobservable: masking **lowers** the result, it does not raise it.
A 65-option Multi group with option 64 selected and option 0 not returns exactly `1` masked, versus
`Number(2n ** 64n)` unmasked; both are perfectly distinguishable, and it is the masked one that
stays inside the exactly-representable range. The mask also keeps the two sides transcribed from the
same shift rather than one aliasing and the other overflowing past 2^63; see its doc comment. Pinned
by `test/container/pmp-write.test.ts` ("Multi: option 64 aliases onto bit 0 on the WRITE side too").

**Upstream fix:** reject (or explicitly truncate, with a warning) a group whose `Options.Count`
exceeds 64, in both `FromPMPGroup` and `Selection` — the encoding genuinely cannot carry more, so
silently aliasing is the worst of the three options.
