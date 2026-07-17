/** Decode a base64 string to bytes. Uses the platform `atob` (global in Node >=16 and browsers),
 *  so it works in the Vite browser bundle and in tests without a Node-only Buffer dependency. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
