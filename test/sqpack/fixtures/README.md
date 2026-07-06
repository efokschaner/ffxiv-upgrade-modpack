# Type-4 (texture) SQPack golden

Validates our Type-4 texture **decoder** against Square Enix's real Type-4 **compressor** output.

- `type4-sample.tex` — a synthetic uncompressed `A8R8G8B8` 64×64 multi-mip `.tex` built from our own
  procedural pixels (`regen.ts`). This is the **expected** decode output.
- `type4-sample.bin` — the same tex run through ConsoleTools `/wrap … /sqpack`, i.e. an authentic
  SE-compressed **Type-4 entry**. This is the **decoder input**.

`sqpack-type4-oracle.test.ts` decodes `type4-sample.bin` and asserts it equals `type4-sample.tex`
byte-for-byte — with **no game install and no ConsoleTools at test time**.

## Why a committed golden (not the corpus, not a live tool)

The corpus `/unwrap` oracle deliberately **does not decompress Type 4**
(`test/helpers/corpus-sqpack.ts`), so the corpus only self-round-trips Type-4 entries against *our
own* encoder — it never checks our decoder against genuine SE-compressed bytes. No independent tool
reproduces SE's exact Type-4 output either, so the one authentic sample is captured once and frozen
here. The input pixels are ours, so the compressed bytes are a mechanical transform of our own data
(committable, like the `test/tex/fixtures/bcn` decode goldens).

## Regenerating

Requires FFXIV TexTools' `ConsoleTools.exe` (override the path with the `CONSOLE_TOOLS` env var):

    npx tsx test/sqpack/fixtures/regen.ts

`regen.ts` gates the output at generation time (must be a Type-4 entry that our decoder round-trips
exactly) before writing the two files. SE's Type-4 compression is deterministic, so a clean regen
reproduces byte-identical goldens; a change means a TexTools/library change worth understanding.
