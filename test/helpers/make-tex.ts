// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";

/** A hand-built canonical A8R8G8B8 2x2 single-mip .tex: 80-byte canonical header + 16 pixel bytes. */
export function buildMinimalTex(): Uint8Array {
  const header = buildCanonicalTexHeader(A8R8G8B8, 2, 2, 1);
  const pixels = new Uint8Array(2 * 2 * 4).map((_, i) => (i * 11 + 3) & 0xff);
  return concatBytes([header, pixels]);
}
