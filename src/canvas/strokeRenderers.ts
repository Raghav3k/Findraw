import { LaserPointer } from "@excalidraw/laser-pointer";
import { getStroke } from "perfect-freehand";
import type { BrushOperation, EraserOperation, ShapeOperation } from "./drawingTypes";

export const getSvgPathFromStroke = (points: number[][]) => {
  if (points.length < 4) return "";
  const average = (a: number, b: number) => (a + b) / 2;
  const first = points[0];
  const second = points[1];
  const third = points[2];
  let path = `M${first[0].toFixed(2)},${first[1].toFixed(2)} Q${second[0].toFixed(2)},${second[1].toFixed(2)} ${average(second[0], third[0]).toFixed(2)},${average(second[1], third[1]).toFixed(2)} T`;
  for (let index = 2; index < points.length - 1; index += 1) {
    path += `${average(points[index][0], points[index + 1][0]).toFixed(2)},${average(points[index][1], points[index + 1][1]).toFixed(2)} `;
  }
  return `${path}Z`;
};

export const createNativeEraserTrail = () => new LaserPointer({
  streamline: 0.2,
  size: 5,
  keepHead: true,
  sizeMapping: (details) => {
    const decayTime = 200;
    const decayLength = 10;
    const easeOut = (value: number) => 1 - Math.pow(1 - value, 4);
    const time = Math.max(0, 1 - (performance.now() - details.pressure) / decayTime);
    const length = (decayLength - Math.min(decayLength, details.totalLength - details.currentIndex)) / decayLength;
    return Math.min(easeOut(length), easeOut(time));
  },
});

const traceBrushPath = (context: CanvasRenderingContext2D, points: BrushOperation["points"]) => {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }
  const last = points.at(-1)!;
  context.lineTo(last[0], last[1]);
};

export const drawBrushStroke = (context: CanvasRenderingContext2D, operation: BrushOperation) => {
  if (!operation.points.length) return;
  const style = operation.style ?? "marker";

  if (style === "pencil") {
    const alpha = operation.opacity / 100;
    const graphiteNoise = (seed: number) => {
      const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
      return value - Math.floor(value);
    };

    context.save();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = operation.color;
    context.strokeStyle = operation.color;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (operation.points.length === 1) {
      const point = operation.points[0];
      for (let grain = 0; grain < 14; grain += 1) {
        const angle = graphiteNoise(grain + 1) * Math.PI * 2;
        const distance = graphiteNoise(grain + 31) * operation.strokeWidth * 0.65;
        const length = 0.25 + graphiteNoise(grain + 67) * 0.9;
        context.globalAlpha = alpha * (0.62 + graphiteNoise(grain + 91) * 0.36);
        context.lineWidth = 0.2 + graphiteNoise(grain + 117) * 0.35;
        context.beginPath();
        context.moveTo(point[0] + Math.cos(angle) * distance, point[1] + Math.sin(angle) * distance);
        context.lineTo(point[0] + Math.cos(angle) * distance + length, point[1] + Math.sin(angle) * distance);
        context.stroke();
      }
      context.restore();
      return;
    }

    const fiberOffsets = [-0.46, -0.18, 0.08, 0.31, 0.52];
    fiberOffsets.forEach((fiberOffset, fiberIndex) => {
      const fiberPoints = operation.points.map((point, index, points) => {
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        const deltaX = next[0] - previous[0];
        const deltaY = next[1] - previous[1];
        const length = Math.hypot(deltaX, deltaY) || 1;
        const pressure = 0.45 + point[2] * 0.7;
        const wobble = (graphiteNoise(index * 7 + fiberIndex * 43) - 0.5) * operation.strokeWidth * 0.3;
        const offset = operation.strokeWidth * fiberOffset * pressure + wobble;
        return [point[0] - (deltaY / length) * offset, point[1] + (deltaX / length) * offset, point[2]] as BrushOperation["points"][number];
      });
      context.globalAlpha = alpha * (0.38 + graphiteNoise(fiberIndex + 201) * 0.22);
      context.lineWidth = Math.max(0.28, operation.strokeWidth * (0.11 + graphiteNoise(fiberIndex + 241) * 0.09));
      traceBrushPath(context, fiberPoints);
      context.stroke();
    });

    const grainBands = [
      { alpha: 0.55, width: 0.3, salt: 311 },
      { alpha: 0.75, width: 0.42, salt: 617 },
      { alpha: 0.92, width: 0.52, salt: 919 },
    ];
    grainBands.forEach((band) => {
      context.globalAlpha = alpha * band.alpha;
      context.lineWidth = band.width;
      context.beginPath();
      for (let index = 1; index < operation.points.length; index += 1) {
        const start = operation.points[index - 1];
        const end = operation.points[index];
        const deltaX = end[0] - start[0];
        const deltaY = end[1] - start[1];
        const segmentLength = Math.hypot(deltaX, deltaY);
        if (segmentLength < 0.01) continue;
        const tangentX = deltaX / segmentLength;
        const tangentY = deltaY / segmentLength;
        const normalX = -tangentY;
        const normalY = tangentX;
        const steps = Math.max(1, Math.ceil(segmentLength / 1.35));

        for (let step = 0; step < steps; step += 1) {
          const seed = band.salt + index * 131 + step * 17;
          if (graphiteNoise(seed + 3) < 0.05) continue;
          const progress = (step + graphiteNoise(seed + 7)) / steps;
          const pressure = start[2] + (end[2] - start[2]) * progress;
          const halfWidth = Math.max(0.65, operation.strokeWidth * (0.48 + pressure * 0.58));
          const across = (graphiteNoise(seed + 11) * 2 - 1) * halfWidth;
          const along = (graphiteNoise(seed + 19) - 0.5) * 1.2;
          const markLength = 0.25 + graphiteNoise(seed + 29) * 1.35;
          const x = start[0] + deltaX * progress + normalX * across + tangentX * along;
          const y = start[1] + deltaY * progress + normalY * across + tangentY * along;
          context.moveTo(x, y);
          context.lineTo(x + tangentX * markLength, y + tangentY * markLength);
        }
      }
      context.stroke();
    });

    context.restore();
    return;
  }
  if (style === "dotted") {
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = operation.opacity / 100;
    context.strokeStyle = operation.color;
    context.fillStyle = operation.color;
    context.lineWidth = Math.max(1, operation.strokeWidth * 1.35);
    context.lineCap = "round";
    context.lineJoin = "round";
    if (operation.points.length === 1) {
      context.beginPath();
      context.arc(operation.points[0][0], operation.points[0][1], context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.setLineDash([0.01, Math.max(4, operation.strokeWidth * 3)]);
      traceBrushPath(context, operation.points);
      context.stroke();
    }
    context.restore();
    return;
  }
  const outline = getStroke(operation.points, {
    size: operation.strokeWidth * 1.5,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (value) => Math.sin(value * Math.PI / 2),
    simulatePressure: false,
    last: operation.complete,
  });
  if (!outline.length) return;

  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = operation.opacity / 100;
  context.fillStyle = operation.color;
  context.beginPath();
  context.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    context.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }
  context.closePath();
  context.fill();
  context.restore();
};
export const drawEraserStroke = (context: CanvasRenderingContext2D, operation: EraserOperation) => {
  if (!operation.points.length) return;
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.globalAlpha = 1;
  context.strokeStyle = "rgba(0, 0, 0, 1)";
  context.fillStyle = "rgba(0, 0, 0, 1)";
  context.lineWidth = operation.size;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (operation.points.length === 1) {
    context.beginPath();
    context.arc(operation.points[0][0], operation.points[0][1], operation.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(operation.points[0][0], operation.points[0][1]);
    for (let index = 1; index < operation.points.length - 1; index += 1) {
      const current = operation.points[index];
      const next = operation.points[index + 1];
      context.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
    }
    const last = operation.points[operation.points.length - 1];
    context.lineTo(last[0], last[1]);
    context.stroke();
  }
  context.restore();
};
export const drawShapeStroke = (context: CanvasRenderingContext2D, operation: ShapeOperation) => {
  const [startX, startY] = operation.start;
  const [endX, endY] = operation.end;
  const width = endX - startX;
  const height = endY - startY;

  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = operation.opacity / 100;
  context.strokeStyle = operation.color;
  context.fillStyle = operation.color;
  context.lineWidth = operation.strokeWidth * 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (operation.shape === "dotted-line") context.setLineDash([0.01, Math.max(5, context.lineWidth * 2.2)]);
  context.beginPath();

  if (operation.shape === "rectangle") {
    context.rect(startX, startY, width, height);
  } else if (operation.shape === "ellipse") {
    context.ellipse(startX + width / 2, startY + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
  } else {
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
  }
  context.stroke();

  if (operation.shape === "arrow") {
    const arrowLength = Math.hypot(width, height);
    if (arrowLength > 0) {
      const angle = Math.atan2(height, width);
      const headLength = Math.min(24, Math.max(9, operation.strokeWidth * 4), arrowLength * 0.32);
      const headAngle = Math.PI / 7;
      const leftX = endX - headLength * Math.cos(angle - headAngle);
      const leftY = endY - headLength * Math.sin(angle - headAngle);
      const rightX = endX - headLength * Math.cos(angle + headAngle);
      const rightY = endY - headLength * Math.sin(angle + headAngle);

      context.beginPath();
      context.moveTo(leftX, leftY);
      context.lineTo(endX, endY);
      context.lineTo(rightX, rightY);
      context.stroke();
    }
  }
  context.restore();
};

