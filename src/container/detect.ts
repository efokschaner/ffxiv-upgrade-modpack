import { ModpackFormat } from "../model/modpack";

export function detectFormat(name: string): ModpackFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pmp") || lower.endsWith(".json"))
    return ModpackFormat.Pmp;
  if (lower.endsWith(".ttmp2")) return ModpackFormat.Ttmp2;
  if (lower.endsWith(".ttmp")) return ModpackFormat.TtmpLegacy;
  return null;
}
