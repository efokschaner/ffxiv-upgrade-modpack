import type { MtrlTexture } from "./types";

/**
 * Dx11Path (XivMtrl.cs:667-680). The DX9 flag (0x8000) means the stored TexturePath lacks the
 * literal "--" hide-from-DX11 marker; Dx11Path is the path AS the DX11 client sees it, with that
 * marker spliced onto the filename. Our parser (src/mtrl/parse.ts) never manufactures or strips
 * "--", so this getter mirrors the C# one exactly, operating on the texture (path + flags).
 */
export function dx11Path(tex: MtrlTexture): string {
  if ((tex.flags & 0x8000) === 0) return tex.texturePath;
  const slash = tex.texturePath.lastIndexOf("/");
  const dir = slash >= 0 ? tex.texturePath.slice(0, slash) : "";
  const file = slash >= 0 ? tex.texturePath.slice(slash + 1) : tex.texturePath;
  return `${dir}/--${file}`;
}
