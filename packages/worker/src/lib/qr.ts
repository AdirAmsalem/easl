import { encode } from "uqr";

export function generateQrSvg(url: string, size = 256, margin = 2): string {
  const { data, size: modules } = encode(url, { ecc: "M" });
  const total = modules + margin * 2;
  const scale = size / total;

  let rects = "";
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (data[y][x]) {
        rects += `<rect x="${(x + margin) * scale}" y="${(y + margin) * scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#fff"/>
<g fill="#000">${rects}</g>
</svg>`;
}
