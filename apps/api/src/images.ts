/**
 * Just enough image parsing to check an upload is the image it says it is,
 * and to read its size. No decoding, no native code.
 */

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** The real type of an image from its first bytes, or null. */
export function sniffImage(buf: Buffer): keyof typeof IMAGE_TYPES | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("latin1") === "GIF87a" || buf.subarray(0, 6).toString("latin1") === "GIF89a")) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Width and height in pixels, when the header says. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    const type = sniffImage(buf);
    if (type === "image/png" && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === "image/gif" && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === "image/webp" && buf.length >= 30) {
      const chunk = buf.subarray(12, 16).toString("latin1");
      if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1]!;
        // Start-of-frame markers carry the size (not DHT 0xC4, JPG 0xC8 or DAC 0xCC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {
    /* truncated header */
  }
  return null;
}
