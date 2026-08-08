# 11. `ReadSqPackType3` over-allocates the model buffer by one header, appending 68 stray zero bytes

**Status:** reproduced · **Where:** `Dat.cs:801` (and `:699`) vs `Mdl.cs:2255` (see
`src/sqpack/type3.ts`, `decodeType3`)

`ReadSqPackType3` sizes its output buffer as `new byte[baseHeaderLength + decompressedSize]`
(`Dat.cs:801`, `baseHeaderLength = 68` at `:699`). But `decompressedSize` — the entry-header field at
offset 8 — is **already** the model's true decompressed size *including* the 68-byte runtime header.
The encoder proves it: `CompressMdlFile` writes `uncompressedSize = _MdlHeaderSize + vertexInfoBlock +
modelDataBlock + vertexDataSizes + indexDataSizes` (`Mdl.cs:2255`, `_MdlHeaderSize = 68`), i.e. exactly
`68 + content`, which is correct. The decoder then adds `baseHeaderLength` (68) a **second** time,
over-allocating by one header and leaving 68 trailing zero bytes that no offset or size in the header
points at. This is a defect in TexTools' own decoder, not transcribed SE/format weirdness — the encoder
and decoder simply disagree about whether `decompressedSize` counts the header.

The fault is confined to the decoded (unwrapped) representation and is **not externally visible**: the
padding is never stored in a compressed entry — `CompressMdlFile` slices its inputs by the header's
offsets/sizes, never reads past `content`, and recomputes `decompressedSize` back to `68 + content` —
so it is dropped on any re-compress and never appears in an emitted `.dat` or modpack. Its only
observable trace is that `ReadSqPackType3` returns 68 bytes more than the file's own declared size, and
that — because the zeros are regenerated on every decode — `decode(encode(x))` is non-idempotent for a
model that entered un-padded (a PMP stores each `.mdl` at its true `68 + content` size and gains the 68
zeros on first decode).

**Us:** `decodeType3` reproduces the over-allocation verbatim, because ConsoleTools `/unwrap` emits the
same 68 zeros and our decompressed-content byte-parity bar requires matching it. The corpus
self-round-trip check tolerates the resulting +68 growth on un-padded (PMP) models, asserting it is
*exactly* a run of 68 trailing zeros and nothing else (`test/helpers/corpus-sqpack.ts`,
`isTrailingZeroGrowth`). Our own `/upgrade` output is unaffected — nothing we write carries the padding.

**Upstream fix:** allocate `new byte[decompressedSize]` — the field already includes the header, so the
extra `baseHeaderLength` term is the whole bug. Purely a buffer-sizing correction: it removes the stray
zeros without altering any real model bytes.
