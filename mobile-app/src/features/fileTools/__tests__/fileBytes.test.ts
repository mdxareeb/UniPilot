import { bytesToBase64, utf8ToBytes } from "../fileBytes";

describe("fileBytes", () => {
  test("encodes UTF-8 without TextEncoder", () => {
    expect(Array.from(utf8ToBytes("aé漢😀"))).toEqual([
      0x61, 0xc3, 0xa9, 0xe6, 0xbc, 0xa2, 0xf0, 0x9f, 0x98, 0x80,
    ]);
    expect(Array.from(utf8ToBytes("plain"))).toEqual([
      0x70, 0x6c, 0x61, 0x69, 0x6e,
    ]);
  });

  test("base64-encodes those bytes exactly", () => {
    expect(bytesToBase64(utf8ToBytes("hello"))).toBe("aGVsbG8=");
    expect(bytesToBase64(utf8ToBytes("aé漢😀"))).toBe("YcOp5ryi8J+YgA==");
  });
});
