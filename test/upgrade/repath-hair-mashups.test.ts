// Tests for RepathHairMashups (ModpackUpgrader.cs:379-482), see
// src/upgrade/repath-hair-mashups.ts for provenance. Fixture shapes mirror
// test/upgrade/resolve-highlight.test.ts.
import { describe, expect, it, vi } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../../src/model/modpack";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import { repathHairMashups } from "../../src/upgrade/repath-hair-mashups";

const SAMPLE_BYTES = new Uint8Array(
  Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64"),
);
// SAMPLE_HAIR_MTRL_BASE64 parses (regardless of the path passed to parseMtrl) with a Hair-shader
// norm/mask already pointing at c0801h0115's real DT texture paths (confirmed against the bundled
// hair-materials table): .../c0801h0115_hir_norm.tex and .../c0801h0115_hir_mask.tex, both known
// to exist in the bundled hairTextureExists oracle, with the old _n/_m suffixed forms confirmed
// absent from it.
const MTRL_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";

function samplerPath(bytes: Uint8Array, id: number): string {
  const m = parseMtrl(bytes, MTRL_PATH);
  return m.textures.find((t) => t.sampler?.samplerIdRaw === id)!.texturePath;
}

function raw(bytes: Uint8Array): ModpackFile {
  return { data: bytes, storage: FileStorageType.RawUncompressed };
}

function option(
  name: string,
  files: Array<[string, ModpackFile]>,
): ModpackOption {
  return {
    name,
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files: new Map(files),
  };
}

function pack(options: ModpackOption[]): ModpackData {
  const group: ModpackGroup = {
    name: "G",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options,
  };
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [group],
  };
}

/** Build a Hair material whose norm/mask samplers use OLD suffixes derived from the DT canonical
 *  (SAMPLE_BYTES' own paths, which are the real DT c0801h0115 hair texture names). */
function oldSuffixMtrl(): {
  bytes: Uint8Array;
  dtNorm: string;
  dtMask: string;
} {
  const m = parseMtrl(SAMPLE_BYTES, MTRL_PATH);
  const norm = m.textures.find(
    (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
  )!;
  const mask = m.textures.find(
    (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
  )!;
  const dtNorm = norm.texturePath;
  const dtMask = mask.texturePath;
  norm.texturePath = dtNorm.replaceAll("_norm.tex", "_n.tex");
  norm.flags &= ~0x8000; // clear DX9 flag so dx11Path == texturePath (no "--" splicing)
  mask.texturePath = dtMask.replaceAll("_mask.tex", "_m.tex");
  mask.flags &= ~0x8000;
  return { bytes: serializeMtrl(m), dtNorm, dtMask };
}

describe("repathHairMashups", () => {
  it("retargets old-suffix norm/mask to their existing DT names", () => {
    const { bytes, dtNorm, dtMask } = oldSuffixMtrl();
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);

    repathHairMashups(data);

    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerNormal)).toBe(dtNorm);
    expect(samplerPath(out, ESamplerId.g_SamplerMask)).toBe(dtMask);
  });

  it("leaves an already-DT-form material's paths unchanged (no double-repath)", () => {
    const dtBytes = SAMPLE_BYTES; // canonical: samplers already _norm/_mask, which exist
    const before = samplerPath(dtBytes, ESamplerId.g_SamplerNormal);
    const data = pack([option("On", [[MTRL_PATH, raw(dtBytes)]])]);

    repathHairMashups(data);

    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerNormal)).toBe(before);
  });

  it("skips a non-hair/zear/tail .mtrl path (regex gate)", () => {
    const data = pack([
      option("On", [
        [
          "chara/human/c0801/obj/body/b0001/material/v0001/mt_c0801b0001_a.mtrl",
          raw(SAMPLE_BYTES),
        ],
      ]),
    ]);
    repathHairMashups(data);
    // Unchanged entirely -- not even re-serialized (no write for a non-matching path).
    const out = data.groups[0]!.options[0]!.files.get(
      "chara/human/c0801/obj/body/b0001/material/v0001/mt_c0801b0001_a.mtrl",
    )!;
    expect(out.data).toBe(SAMPLE_BYTES);
  });

  it("skips a non-Hair/Character-shaderpack .mtrl (shader gate)", () => {
    const bytes = (() => {
      const m = parseMtrl(SAMPLE_BYTES, MTRL_PATH);
      m.shaderPackRaw = "skin.shpk";
      return serializeMtrl(m);
    })();
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    repathHairMashups(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!;
    expect(out.data).toBe(bytes); // untouched -- `continue`d before the write
  });

  it("throws when the .mtrl bytes fail to decode/parse (no try/catch, unlike the highlight half)", () => {
    const data = pack([
      option("On", [[MTRL_PATH, raw(new Uint8Array([0, 0, 0, 0]))]]),
    ]);
    expect(() => repathHairMashups(data)).toThrow();
  });

  it("throws when a texture is bound to no sampler and is reached before norm/mask/diff (unguarded NRE)", () => {
    const m = parseMtrl(SAMPLE_BYTES, MTRL_PATH);
    // Insert a sampler-less texture before the norm/mask textures so findSamplerUnguarded throws.
    m.textures.unshift({ texturePath: "a.tex", flags: 0 });
    const bytes = serializeMtrl(m);
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    expect(() => repathHairMashups(data)).toThrow(/bound no sampler/);
  });

  it("skips a material missing a mask sampler (norm/mask both-required gate)", () => {
    const m = parseMtrl(SAMPLE_BYTES, MTRL_PATH);
    m.textures = m.textures.filter(
      (t) => t.sampler?.samplerIdRaw !== ESamplerId.g_SamplerMask,
    );
    const bytes = serializeMtrl(m);
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    repathHairMashups(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!;
    expect(out.data).toBe(bytes); // untouched -- `continue`d before the write
  });

  it("re-serializes and writes back even when no suffix changed (unconditional write, :466-479)", () => {
    const data = pack([option("On", [[MTRL_PATH, raw(SAMPLE_BYTES)]])]);
    repathHairMashups(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!;
    // A fresh serialize replaces the buffer identity even though no path changed.
    expect(out.data).not.toBe(SAMPLE_BYTES);
    expect(out.data).toEqual(serializeMtrl(parseMtrl(SAMPLE_BYTES, MTRL_PATH)));
  });
});

describe("repathHairMashups — oracle-controlled branches", () => {
  // Real game data can't isolate the _m->_mask-before-_mult tie-break, the _s variants, or the
  // diffuse suffix (no corpus/bundled fixture reaches those specific combinations), so these mock
  // the oracle module directly via vi.doMock + a dynamic re-import, which DOES intercept when
  // invoking vitest directly (confirmed by running this file) -- each test resets modules first so
  // the mock is scoped to that one dynamic import of repath-hair-mashups.
  function buildMashupMtrl(opts: {
    normSuffix: string;
    maskSuffix: string;
    shaderPackRaw?: string;
    withDiffuse?: { suffix: string; path: string };
  }): Uint8Array {
    const m = parseMtrl(SAMPLE_BYTES, MTRL_PATH);
    if (opts.shaderPackRaw) m.shaderPackRaw = opts.shaderPackRaw;
    const norm = m.textures.find(
      (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
    )!;
    const mask = m.textures.find(
      (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
    )!;
    norm.texturePath = norm.texturePath.replaceAll(
      "_norm.tex",
      opts.normSuffix,
    );
    norm.flags &= ~0x8000;
    mask.texturePath = mask.texturePath.replaceAll(
      "_mask.tex",
      opts.maskSuffix,
    );
    mask.flags &= ~0x8000;
    if (opts.withDiffuse) {
      m.textures.push({
        texturePath: opts.withDiffuse.path,
        flags: 0,
        sampler: {
          samplerIdRaw: ESamplerId.g_SamplerDiffuse,
          samplerSettingsRaw: 0,
        },
      });
    }
    return serializeMtrl(m);
  }

  it("prefers _m->_mask over _m->_mult when both DT targets exist (first-match-wins)", async () => {
    vi.resetModules();
    vi.doMock("../../src/upgrade/reference/hair-texture-exists", () => ({
      hairTextureExists: (p: string) =>
        p.includes("_norm.tex") ||
        p.includes("_mask.tex") ||
        p.includes("_mult.tex"),
      computeHash: () => 0,
    }));
    const { repathHairMashups: fn } = await import(
      "../../src/upgrade/repath-hair-mashups"
    );

    const bytes = buildMashupMtrl({
      normSuffix: "_norm.tex",
      maskSuffix: "_m.tex",
    });
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    fn(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerMask)).toMatch(/_mask\.tex$/);

    vi.doUnmock("../../src/upgrade/reference/hair-texture-exists");
    vi.resetModules();
  });

  it("prefers _m->_mult over _s variants when _m->_mask is absent but _m->_mult exists", async () => {
    vi.resetModules();
    vi.doMock("../../src/upgrade/reference/hair-texture-exists", () => ({
      hairTextureExists: (p: string) =>
        p.includes("_norm.tex") || p.endsWith("_mult.tex"),
      computeHash: () => 0,
    }));
    const { repathHairMashups: fn } = await import(
      "../../src/upgrade/repath-hair-mashups"
    );

    const bytes = buildMashupMtrl({
      normSuffix: "_norm.tex",
      maskSuffix: "_m.tex",
    });
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    fn(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerMask)).toMatch(/_mult\.tex$/);

    vi.doUnmock("../../src/upgrade/reference/hair-texture-exists");
    vi.resetModules();
  });

  it("falls back to _s->_mask when the mask sampler uses the _s suffix and no _m targets exist", async () => {
    vi.resetModules();
    vi.doMock("../../src/upgrade/reference/hair-texture-exists", () => ({
      hairTextureExists: (p: string) =>
        p.includes("_norm.tex") || p.endsWith("_mask.tex"),
      computeHash: () => 0,
    }));
    const { repathHairMashups: fn } = await import(
      "../../src/upgrade/repath-hair-mashups"
    );

    const bytes = buildMashupMtrl({
      normSuffix: "_norm.tex",
      maskSuffix: "_s.tex",
    });
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    fn(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerMask)).toMatch(/_mask\.tex$/);

    vi.doUnmock("../../src/upgrade/reference/hair-texture-exists");
    vi.resetModules();
  });

  it("falls back to _s->_mult as the last resort when no other mask target exists", async () => {
    vi.resetModules();
    vi.doMock("../../src/upgrade/reference/hair-texture-exists", () => ({
      hairTextureExists: (p: string) =>
        p.includes("_norm.tex") || p.endsWith("_mult.tex"),
      computeHash: () => 0,
    }));
    const { repathHairMashups: fn } = await import(
      "../../src/upgrade/repath-hair-mashups"
    );

    const bytes = buildMashupMtrl({
      normSuffix: "_norm.tex",
      maskSuffix: "_s.tex",
    });
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    fn(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerMask)).toMatch(/_mult\.tex$/);

    vi.doUnmock("../../src/upgrade/reference/hair-texture-exists");
    vi.resetModules();
  });

  it("retargets diffuse _d->_base on a Character-shader material", async () => {
    vi.resetModules();
    vi.doMock("../../src/upgrade/reference/hair-texture-exists", () => ({
      hairTextureExists: (p: string) =>
        p.includes("_norm.tex") ||
        p.includes("_mask.tex") ||
        p.endsWith("_base.tex"),
      computeHash: () => 0,
    }));
    const { repathHairMashups: fn } = await import(
      "../../src/upgrade/repath-hair-mashups"
    );

    const diffPath =
      "chara/human/c0801/obj/hair/h0115/texture/c0801h0115_hir_d.tex";
    const bytes = buildMashupMtrl({
      normSuffix: "_norm.tex",
      maskSuffix: "_mask.tex",
      shaderPackRaw: "character.shpk",
      withDiffuse: { suffix: "_d.tex", path: diffPath },
    });
    const data = pack([option("On", [[MTRL_PATH, raw(bytes)]])]);
    fn(data);
    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerDiffuse)).toMatch(
      /_base\.tex$/,
    );

    vi.doUnmock("../../src/upgrade/reference/hair-texture-exists");
    vi.resetModules();
  });
});
