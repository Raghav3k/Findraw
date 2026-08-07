import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { AUTO_DRAW_OBSCURITY_LEVELS, type AutoDrawAsset } from "./autoDrawAssets";
import { assetUrl } from "../assetUrls";

type AutoDrawCanvasProps = {
  asset: AutoDrawAsset;
  active: boolean;
  paused?: boolean;
  resetToken?: number;
  stageIndex: number;
  stageProgress: number;
};

type Cloud = {
  bobAmplitude: number;
  bobRate: number;
  frameOffset: number;
  frameRate: number;
  phase: number;
  rotationAmplitude: number;
  rotationRate: number;
  scale: number;
  variant: number;
  wobbleAmplitude: number;
  wobbleRate: number;
  xSeed: number;
  ySeed: number;
};

type DrawingTransform = { drawX: number; drawY: number; scale: number };
type ScanPoint = { x: number; y: number };

const CLOUD_SPRITE_URL = assetUrl("/auto-draw/particles/cloud-cover.png");
const FALLBACK_PAPER = "#fff2cf";
const FRAME_SEQUENCE = [0, 1, 2, 1];
const STAGE_OBSCURITY = [...AUTO_DRAW_OBSCURITY_LEVELS.map((value) => value / 100), 0];
const SCAN_DIAMETERS = STAGE_OBSCURITY.map((_, index) => (
  index === STAGE_OBSCURITY.length - 1 ? 1.75 : 0.19
));
const FIRST_STAGE_OBSCURITY = AUTO_DRAW_OBSCURITY_LEVELS[0] / 100;
const LAST_GUESS_OBSCURITY = AUTO_DRAW_OBSCURITY_LEVELS[AUTO_DRAW_OBSCURITY_LEVELS.length - 1] / 100;
const STAGE_CLARITY = STAGE_OBSCURITY.map((obscurity, index) => (
  index === STAGE_OBSCURITY.length - 1
    ? 1
    : (FIRST_STAGE_OBSCURITY - obscurity) / (FIRST_STAGE_OBSCURITY - LAST_GUESS_OBSCURITY)
));
const CLOUD_COUNT = 104;
const CLOUD_DRIFT_SPEED = 11;

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const smoothstep = (value: number) => {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
};
const mix = (start: number, end: number, amount: number) => start + (end - start) * amount;

const stringSeed = (value: string) => {
  let seed = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
};

const randomGenerator = (initialSeed: number) => {
  let seed = initialSeed || 1;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const createClouds = (assetId: string): Cloud[] => {
  const random = randomGenerator(stringSeed(`${assetId}:cloud-cover`));
  const clouds: Cloud[] = [];
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < CLOUD_COUNT; index += 1) {
    let bestPoint = { x: random(), y: random() };
    let bestDistance = -1;
    for (let sample = 0; sample < 24; sample += 1) {
      const candidate = { x: random(), y: random() };
      const nearestDistance = points.reduce((nearest, point) => {
        const rawX = Math.abs(candidate.x - point.x);
        const rawY = Math.abs(candidate.y - point.y);
        const dx = Math.min(rawX, 1 - rawX);
        const dy = Math.min(rawY, 1 - rawY);
        return Math.min(nearest, dx * dx + dy * dy);
      }, Number.POSITIVE_INFINITY);
      if (nearestDistance > bestDistance) {
        bestDistance = nearestDistance;
        bestPoint = candidate;
      }
    }
    points.push(bestPoint);
    clouds.push({
      bobAmplitude: mix(2.5, 6, random()),
      bobRate: mix(0.3, 0.7, random()),
      frameOffset: random() * FRAME_SEQUENCE.length,
      frameRate: mix(0.6, 1.4, random()),
      phase: random() * Math.PI * 2,
      rotationAmplitude: mix(0.01, 0.04, random()),
      rotationRate: mix(0.2, 0.65, random()),
      scale: mix(0.92, 1.48, Math.sqrt(random())),
      variant: Math.floor(random() * 3),
      wobbleAmplitude: mix(2.5, 7, random()),
      wobbleRate: mix(0.25, 0.68, random()),
      xSeed: bestPoint.x,
      ySeed: bestPoint.y,
    });
  }
  return clouds;
};

const drawingTransform = (
  displayWidth: number,
  displayHeight: number,
  image: HTMLImageElement,
  asset: AutoDrawAsset,
): DrawingTransform => {
  const bounds = asset.subjectBounds;
  const imageWidth = image.naturalWidth || 500;
  const imageHeight = image.naturalHeight || 500;
  const subjectWidth = imageWidth * bounds.width;
  const subjectHeight = imageHeight * bounds.height;
  const subjectAspectRatio = subjectWidth / Math.max(1, subjectHeight);

  // Contextual scaling target based on asset aspect ratio shape
  let targetWidthRatio = 0.76;
  let targetHeightRatio = 0.78;

  if (subjectAspectRatio > 1.35) {
    // Wide horizontal asset (e.g. weapons, guns, maps, horizontal banners)
    targetWidthRatio = 0.82;
    targetHeightRatio = 0.62;
  } else if (subjectAspectRatio < 0.72) {
    // Tall vertical asset (e.g. full-body character renders, operators, agents)
    targetWidthRatio = 0.64;
    targetHeightRatio = 0.85;
  } else {
    // Square or balanced asset (e.g. card icons, abilities, items)
    targetWidthRatio = 0.72;
    targetHeightRatio = 0.74;
  }

  const scaleByWidth = (displayWidth * targetWidthRatio) / subjectWidth;
  const scaleByHeight = (displayHeight * targetHeightRatio) / subjectHeight;
  const scale = Math.min(scaleByWidth, scaleByHeight);

  const centerX = imageWidth * (bounds.x + bounds.width / 2);
  const centerY = imageHeight * (bounds.y + bounds.height / 2);
  return {
    drawX: displayWidth * 0.5 - centerX * scale,
    drawY: displayHeight * 0.51 - centerY * scale,
    scale,
  };
};

export function AutoDrawCanvas({
  asset,
  active,
  paused = false,
  resetToken = 0,
  stageIndex,
  stageProgress,
}: AutoDrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTimestampRef = useRef(0);
  const motionTimeRef = useRef(0);
  const beamOpacityRef = useRef(0);
  const pointerInsideRef = useRef(false);
  const scanPointRef = useRef<ScanPoint | null>(null);
  const stageStateRef = useRef({ paused, stageIndex, stageProgress });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [cloudSprite, setCloudSprite] = useState<HTMLImageElement | null>(null);
  const clouds = useMemo(() => createClouds(asset.id), [asset.id]);

  stageStateRef.current = { paused, stageIndex, stageProgress };

  useEffect(() => {
    const nextImage = new Image();
    nextImage.decoding = "async";
    nextImage.src = asset.imageUrl;
    nextImage.onload = () => setImage(nextImage);
    return () => {
      nextImage.onload = null;
      setImage((current) => current === nextImage ? null : current);
    };
  }, [asset.imageUrl]);

  useEffect(() => {
    const sprite = new Image();
    sprite.decoding = "async";
    sprite.src = CLOUD_SPRITE_URL;
    sprite.onload = () => setCloudSprite(sprite);
    return () => {
      sprite.onload = null;
      setCloudSprite((current) => current === sprite ? null : current);
    };
  }, []);

  useEffect(() => {
    lastTimestampRef.current = 0;
    motionTimeRef.current = 0;
    beamOpacityRef.current = 0;
    pointerInsideRef.current = false;
    scanPointRef.current = null;
  }, [asset.id, resetToken]);

  useEffect(() => {
    const trackPointer = (event: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      const inside = event.clientX >= bounds.left
        && event.clientX <= bounds.right
        && event.clientY >= bounds.top
        && event.clientY <= bounds.bottom;
      pointerInsideRef.current = inside;
      if (inside) {
        scanPointRef.current = {
          x: clamp(event.clientX - bounds.left, 0, bounds.width),
          y: clamp(event.clientY - bounds.top, 0, bounds.height),
        };
      }
    };
    const closeLight = () => { pointerInsideRef.current = false; };
    window.addEventListener("pointermove", trackPointer);
    window.addEventListener("blur", closeLight);
    return () => {
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("blur", closeLight);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const cloudLayer = document.createElement("canvas");
    const cloudContext = cloudLayer.getContext("2d");
    if (!cloudContext) return;
    const blurLayer = document.createElement("canvas");
    const blurContext = blurLayer.getContext("2d");
    if (!blurContext) return;
    let animationFrame = 0;

    const render = (timestamp: number) => {
      const previousTimestamp = lastTimestampRef.current || timestamp;
      const delta = Math.min(64, timestamp - previousTimestamp);
      lastTimestampRef.current = timestamp;
if (!stageStateRef.current.paused) motionTimeRef.current += delta;
      const beamTarget = pointerInsideRef.current ? 1 : 0;
      const fadeDuration = beamTarget > beamOpacityRef.current ? 110 : 190;
      const fadeAmount = 1 - Math.exp(-delta / fadeDuration);
      beamOpacityRef.current = mix(beamOpacityRef.current, beamTarget, fadeAmount);

      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const displayWidth = Math.max(1, bounds.width);
      const displayHeight = Math.max(1, bounds.height);
      const pixelWidth = Math.max(1, Math.round(displayWidth * ratio));
      const pixelHeight = Math.max(1, Math.round(displayHeight * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
if (cloudLayer.width !== pixelWidth || cloudLayer.height !== pixelHeight) {
        cloudLayer.width = pixelWidth;
        cloudLayer.height = pixelHeight;
      }
      if (blurLayer.width !== pixelWidth || blurLayer.height !== pixelHeight) {
        blurLayer.width = pixelWidth;
        blurLayer.height = pixelHeight;
      }

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      const paper = getComputedStyle(canvas).getPropertyValue("--auto-canvas-paper").trim() || FALLBACK_PAPER;
      context.fillStyle = paper;
      context.fillRect(0, 0, pixelWidth, pixelHeight);

      if (!active || !image?.complete || !image.naturalWidth) {
        animationFrame = requestAnimationFrame(render);
        return;
      }

      const state = stageStateRef.current;
      const safeStage = Math.max(0, Math.min(SCAN_DIAMETERS.length - 1, state.stageIndex));
      const transition = smoothstep(state.stageProgress / 0.22);
      const previousStage = Math.max(0, safeStage - 1);
      const stageClarity = mix(
        STAGE_CLARITY[previousStage],
        STAGE_CLARITY[safeStage],
        safeStage === 0 ? 1 : transition,
      );
      const minimumDimension = Math.min(displayWidth, displayHeight);
      const scanDiameter = minimumDimension * mix(
        SCAN_DIAMETERS[previousStage],
        SCAN_DIAMETERS[safeStage],
        safeStage === 0 ? 1 : transition,
      );
      const scanPoint = scanPointRef.current ?? { x: displayWidth * 0.5, y: displayHeight * 0.54 };
      const transform = drawingTransform(displayWidth, displayHeight, image, asset);
      const radius = scanDiameter / 2;
      const isFullSketch = safeStage === SCAN_DIAMETERS.length - 1;
      const lightPresence = isFullSketch ? 0 : beamOpacityRef.current;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.save();
      context.globalAlpha = 1;
      context.drawImage(
        image,
        transform.drawX,
        transform.drawY,
        image.naturalWidth * transform.scale,
        image.naturalHeight * transform.scale,
      );
      context.restore();

      cloudContext.setTransform(1, 0, 0, 1, 0, 0);
      cloudContext.clearRect(0, 0, pixelWidth, pixelHeight);
      cloudContext.setTransform(ratio, 0, 0, ratio, 0, 0);

      if (!isFullSketch) {
        cloudContext.save();
        const veil = cloudContext.createLinearGradient(0, 0, displayWidth, displayHeight);
        veil.addColorStop(0, "#d9e5e4");
        veil.addColorStop(0.48, "#f3ead2");
        veil.addColorStop(1, "#cbdcde");
        cloudContext.fillStyle = veil;
        cloudContext.fillRect(0, 0, displayWidth, displayHeight);
        cloudContext.restore();
      }

      if (!isFullSketch && cloudSprite?.complete && cloudSprite.naturalWidth) {
        const time = motionTimeRef.current / 1000;
        const sourceWidth = cloudSprite.naturalWidth / 3;
        const sourceHeight = cloudSprite.naturalHeight / 3;
        const cloudSize = minimumDimension * 0.29;
        const cloudTravelWidth = displayWidth + cloudSize * 1.8;

        for (const cloud of clouds) {
          const size = cloudSize * cloud.scale;
          const baseX = (cloud.xSeed * cloudTravelWidth + time * CLOUD_DRIFT_SPEED) % cloudTravelWidth - cloudSize * 0.9;
          const x = baseX + Math.sin(time * cloud.wobbleRate + cloud.phase) * cloud.wobbleAmplitude;
          const y = cloud.ySeed * displayHeight + Math.cos(time * cloud.bobRate + cloud.phase) * cloud.bobAmplitude;
          const frameIndex = FRAME_SEQUENCE[
            Math.floor(time * cloud.frameRate + cloud.frameOffset) % FRAME_SEQUENCE.length
          ];
          cloudContext.save();
          cloudContext.translate(x, y);
          cloudContext.rotate(
            Math.sin(time * cloud.rotationRate + cloud.phase) * cloud.rotationAmplitude,
          );
          cloudContext.drawImage(
            cloudSprite,
            frameIndex * sourceWidth,
            cloud.variant * sourceHeight,
            sourceWidth,
            sourceHeight,
            -size / 2,
            -size / 2,
            size,
            size,
          );
          cloudContext.restore();
        }
      }

      context.drawImage(cloudLayer, 0, 0, pixelWidth, pixelHeight, 0, 0, displayWidth, displayHeight);

      if (!isFullSketch && lightPresence > 0.001) {
        const blurProgress = smoothstep(Math.pow(stageClarity, 0.65));
        blurContext.setTransform(1, 0, 0, 1, 0, 0);
        blurContext.clearRect(0, 0, pixelWidth, pixelHeight);
        blurContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        blurContext.save();
        blurContext.globalAlpha = lightPresence;
        blurContext.filter = `blur(${mix(34, 0, blurProgress)}px)`;
        blurContext.drawImage(
          image,
          transform.drawX,
          transform.drawY,
          image.naturalWidth * transform.scale,
          image.naturalHeight * transform.scale,
        );
        blurContext.filter = "none";
        blurContext.globalCompositeOperation = "destination-in";
        const blurMask = blurContext.createRadialGradient(
          scanPoint.x,
          scanPoint.y,
          0,
          scanPoint.x,
          scanPoint.y,
          radius * 1.02,
        );
        blurMask.addColorStop(0, "rgba(0,0,0,1)");
        blurMask.addColorStop(0.9, "rgba(0,0,0,1)");
        blurMask.addColorStop(1, "rgba(0,0,0,0)");
        blurContext.fillStyle = blurMask;
        blurContext.fillRect(
          scanPoint.x - radius * 1.03,
          scanPoint.y - radius * 1.03,
          radius * 2.06,
          radius * 2.06,
        );
        blurContext.restore();

        context.save();
        context.globalAlpha = lightPresence;
        context.fillStyle = paper;
        context.beginPath();
        context.arc(scanPoint.x, scanPoint.y, radius, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        context.drawImage(blurLayer, 0, 0, pixelWidth, pixelHeight, 0, 0, displayWidth, displayHeight);
        context.globalAlpha = lightPresence;
        context.strokeStyle = "rgba(67, 91, 98, 0.5)";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(scanPoint.x, scanPoint.y, radius * 1.02, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, [active, asset, cloudSprite, clouds, image]);

  const updateScanPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    pointerInsideRef.current = true;
    const bounds = event.currentTarget.getBoundingClientRect();
    scanPointRef.current = {
      x: clamp(event.clientX - bounds.left, 0, bounds.width),
      y: clamp(event.clientY - bounds.top, 0, bounds.height),
    };
  };

const handlePointerEnter = (event: PointerEvent<HTMLCanvasElement>) => {
    pointerInsideRef.current = true;
    updateScanPoint(event);
  };

  const handlePointerLeave = () => {
    pointerInsideRef.current = false;
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    updateScanPoint(event);
  };

  return (
    <canvas
      aria-label="Cloud-covered sketch. Move the scan light to inspect the vague silhouette."
      className={`auto-draw-canvas ${active && stageIndex < asset.stages.length - 1 ? "scan-enabled" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={updateScanPoint}
      ref={canvasRef}
    />
  );
}

