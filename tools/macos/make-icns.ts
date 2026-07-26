#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [iconsetDirectory, outputPath] = process.argv.slice(2);
if (!iconsetDirectory || !outputPath) {
  throw new Error("usage: make-icns.ts ICONSET_DIRECTORY OUTPUT.icns");
}

const variants = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
] as const;

const chunks = variants.map(([type, file]) => {
  const png = readFileSync(join(iconsetDirectory, file));
  const chunk = Buffer.allocUnsafe(8 + png.length);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32BE(chunk.length, 4);
  png.copy(chunk, 8);
  return chunk;
});
const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const header = Buffer.allocUnsafe(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(totalLength, 4);
writeFileSync(outputPath, Buffer.concat([header, ...chunks], totalLength), {
  mode: 0o644,
});
