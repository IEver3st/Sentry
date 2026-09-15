import sharp from "sharp";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const originals = [
  "93978923-4ea5-486c-95ee-b6a7487f7d08-a3c6aa36-eb98-41b1-81e4-1dd8f94e2a30.png",
  "93978923-4ea5-486c-95ee-b6a7487f7d08-ac24849d-7757-408c-a27c-4c8582413545.png",
];
await mkdir("assets/originals", { recursive: true });
await mkdir("public", { recursive: true });
for (const [index, file] of originals.entries()) {
  const source = join(
    process.env.USERPROFILE!,
    ".t3/userdata/attachments",
    file,
  );
  const dest = `assets/originals/${index === 0 ? "icon" : "ribbon"}.png`;
  await copyFile(source, dest);
  const { data, info } = await sharp(dest)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    top = info.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3] > 16) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  // Crop transparent canvas only. Original color and alpha, including intentional shading, remain intact.
  const name = index === 0 ? "sentry-icon" : "sentry-ribbon";
  const crop = sharp(dest).extract({
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  });
  await crop
    .clone()
    .resize(512, 512, { fit: "contain", background: "#00000000" })
    .png()
    .toFile(`public/${name}.png`);
  await copyFile(`public/${name}.png`, `assets/${name}.png`);
  console.log(name, { hasAlpha: true, bounds: { left, top, right, bottom } });
  if (index === 0) {
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = await Promise.all(
      sizes.map((s) =>
        crop
          .clone()
          .resize(s, s, { fit: "contain", background: "#00000000" })
          .png()
          .toBuffer(),
      ),
    );
    const head = Buffer.alloc(6 + sizes.length * 16);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(sizes.length, 4);
    let offset = head.length;
    pngs.forEach((png, i) => {
      const p = 6 + i * 16;
      head[p] = sizes[i] === 256 ? 0 : sizes[i];
      head[p + 1] = head[p];
      head.writeUInt16LE(1, p + 4);
      head.writeUInt16LE(32, p + 6);
      head.writeUInt32LE(png.length, p + 8);
      head.writeUInt32LE(offset, p + 12);
      offset += png.length;
    });
    await writeFile("assets/sentry.ico", Buffer.concat([head, ...pngs]));
  }
}
