# 16. `GetFullImcInfo`'s NonSet default subset reads `Vfx` from the material-set byte

**Status:** **not reached** — the buggy symbol is not on our path · **Where:** `Imc.cs:395` (vs
`:412` and the `Set` branch's `:425`/`:442`)

`Imc.GetFullImcInfo`'s `ImcType.NonSet` branch reads the default subset's six bytes into named
locals and then builds the entry with **`Vfx = variant`** (`Imc.cs:390-397`):

```csharp
byte variant = br.ReadByte();
byte unknown = br.ReadByte();
ushort mask   = br.ReadUInt16();
byte vfx      = br.ReadByte();   // :387 — read, then discarded
byte anim     = br.ReadByte();

imcData.DefaultSubset.Add(new XivImc
{
    MaterialSet = variant,
    Decal = unknown,
    Mask = mask,
    Vfx = variant,               // :395 — should be `vfx`
    Animation = anim
});
```

The `vfx` local is read off the stream and then never used, so the default entry's `Vfx` is silently
a copy of its material-set byte. Every *other* entry the function builds reads its own `vfx` byte:
the NonSet variant-subset loop immediately below (`:404`, assigned at `:412`) and both the default
and variant subsets of the `Set` branch (`:425-433` and `:442-450`, each reading `Vfx =
br.ReadByte()` inline). The asymmetry is confined to one field of
one entry in one branch — a plain transcription defect, not a format rule: nothing about the NonSet
layout makes the default subset's fifth byte mean something different from the same byte in the very
next entry. The surrounding comment ("This type uses the first short for both Variant and VFX",
`:383`) explains the `variant`/`unknown` pair, not this assignment.

**Us:** we do not reproduce it, because we never execute this function. The `.meta` IMC base seed
runs through an entirely different reader: `ItemMetadata.CreateFromRaw` (`ItemMetadata.cs:238-241`)
→ `XivDependencyRoot.GetImcEntryPaths` (`XivDependencyRoot.cs:1133-1202`) → `Imc.GetEntries`
(`Imc.cs:200-249`), which computes a byte offset per entry and reads six **raw** bytes there
(`:237-244`) without constructing an `XivImc` field-by-field at all. Our port
(`scripts/lib/imc-entries.ts`, extraction tooling) mirrors that path and records the raw six bytes,
so the correct `vfx` byte lands in the table. This entry is registered as an upstream defect
**observed while porting**, not one we knowingly reproduce — the `not reached` status.

**Also recorded here so it is not re-litigated:** the sibling *near*-bug in `Imc.GetEntries` is not a
bug. Its EOF guard, `if (offset > imcByteData.Length - entrySize) continue;` (`Imc.cs:228`), looks
like it should silently drop the last entry of a high-numbered slot, because `GetImcEntryPaths` adds
a non-zero `subOffset` inside an **inclusive** `i <= subsetCount` loop
(`XivDependencyRoot.cs:1188-1199`). It never fires on a well-formed `.imc` of either type, and the
margin is exactly zero. For `ImcType.Set`, `length == 4 + 30*(1 + subsetCount)`; the largest offset
is `4 + 30*subsetCount + 4*6`, and the guard's bound is `length - 6 == 28 + 30*subsetCount` — equal,
and the comparison is `>`, not `>=`. For `ImcType.NonSet` the largest offset is `4 + 6*subsetCount`
against the same bound `4 + 6*subsetCount`. So every slot yields exactly `subsetCount + 1` entries.
The guard is real and worth porting — it fires only on a truncated or malformed file, where dropping
it would turn TexTools' short list into an out-of-bounds read — but it is not a defect. Both halves
are pinned by `test/scripts/imc-entries.test.ts` (exact-length boundary: nothing dropped; truncated:
dropped), and the arithmetic is confirmed against real ConsoleTools output by the
`imc-weapon` / `imc-demihuman` synthetic packs.

**Upstream fix:** `Vfx = vfx` at `Imc.cs:395`. Note this *changes* the values `GetFullImcInfo`
returns for any NonSet item whose default entry has a non-zero vfx byte differing from its material
set, so it is a behavioural fix for that function's own consumers, not a cosmetic one.
