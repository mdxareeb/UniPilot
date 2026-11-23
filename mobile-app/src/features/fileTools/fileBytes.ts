const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Hermes has no `Buffer` and some builds lack `btoa`; the encoder is small,
 * dependency-free and exact for any byte length. Chunking avoids giant
 * intermediate strings.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triplet = (first << 16) | (second << 8) | third;

    output += BASE64[(triplet >> 18) & 0x3f];
    output += BASE64[(triplet >> 12) & 0x3f];
    output += index + 1 < bytes.length ? BASE64[(triplet >> 6) & 0x3f] : "=";
    output += index + 2 < bytes.length ? BASE64[triplet & 0x3f] : "=";
  }
  return output;
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
