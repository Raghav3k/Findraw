import type { FillOperation } from "./drawingTypes";

const hexToRgba = (color: string, opacity: number): [number, number, number, number] => {
  const value = color.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    Math.round(255 * opacity / 100),
  ];
};

export const drawLayerFloodFill = (
  fillContext: CanvasRenderingContext2D,
  inkContext: CanvasRenderingContext2D,
  operation: FillOperation,
) => {
  const canvas = fillContext.canvas;
  const transform = fillContext.getTransform();
  const width = canvas.width;
  const height = canvas.height;
  let startX = Math.max(0, Math.min(width - 1, Math.floor(operation.x * transform.a + transform.e)));
  let startY = Math.max(0, Math.min(height - 1, Math.floor(operation.y * transform.d + transform.f)));
  const inkImage = inkContext.getImageData(0, 0, width, height);
  const fillImage = fillContext.getImageData(0, 0, width, height);
  const inkPixels = inkImage.data;
  const fillPixels = fillImage.data;
  const pixelCount = width * height;
  const barrierThreshold = 12;
  const isOpen = (offset: number) => inkPixels[offset * 4 + 3] <= barrierThreshold;

  let startOffset = startY * width + startX;
  if (!isOpen(startOffset)) {
    const searchRadius = Math.max(2, Math.round(transform.a * 4));
    let found = false;
    for (let radius = 1; radius <= searchRadius && !found; radius += 1) {
      for (let dy = -radius; dy <= radius && !found; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const x = startX + dx;
          const y = startY + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const offset = y * width + x;
          if (isOpen(offset)) {
            startX = x;
            startY = y;
            startOffset = offset;
            found = true;
            break;
          }
        }
      }
    }
    if (!found) return;
  }

  const region = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 1;
  queue[0] = startOffset;
  visited[startOffset] = 1;

  while (queueStart < queueEnd) {
    const offset = queue[queueStart++];
    if (!isOpen(offset)) continue;
    region[offset] = 1;
    const x = offset % width;
    const y = Math.floor(offset / width);
    const visit = (nextOffset: number) => {
      if (!visited[nextOffset]) {
        visited[nextOffset] = 1;
        queue[queueEnd++] = nextOffset;
      }
    };
    if (x > 0) visit(offset - 1);
    if (x < width - 1) visit(offset + 1);
    if (y > 0) visit(offset - width);
    if (y < height - 1) visit(offset + width);
  }

  const paintMask = new Uint8Array(region);
  const fringeRadius = Math.max(1, Math.round(transform.a * 1.5));
  for (let offset = 0; offset < pixelCount; offset += 1) {
    if (!region[offset]) continue;
    const x = offset % width;
    const y = Math.floor(offset / width);
    for (let dy = -fringeRadius; dy <= fringeRadius; dy += 1) {
      for (let dx = -fringeRadius; dx <= fringeRadius; dx += 1) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        paintMask[nextY * width + nextX] = 1;
      }
    }
  }

  const replacement = hexToRgba(operation.color, operation.opacity);
  for (let offset = 0; offset < pixelCount; offset += 1) {
    if (!paintMask[offset]) continue;
    const index = offset * 4;
    fillPixels[index] = replacement[0];
    fillPixels[index + 1] = replacement[1];
    fillPixels[index + 2] = replacement[2];
    fillPixels[index + 3] = replacement[3];
  }
  fillContext.putImageData(fillImage, 0, 0);
};
