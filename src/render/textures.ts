import * as THREE from 'three/webgpu';
import { TABLE_SPEC } from '../shared/tableSpec.ts';

export interface StainedGlassTextureSet {
  readonly albedo: THREE.CanvasTexture;
  readonly roughness: THREE.CanvasTexture;
  readonly emissive: THREE.CanvasTexture;
  readonly normal: THREE.CanvasTexture;
  dispose(): void;
}

interface CanvasSurface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

const DECK_WIDTH = 1024;
const DECK_HEIGHT = 2048;
const GLASS_SIZE = 512;

function createCanvasSurface(width: number, height: number): CanvasSurface {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context for procedural texture generation.');
  }
  return { canvas, ctx };
}

function makeCanvasTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  wrapping: THREE.Wrapping,
  anisotropy = 4,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = colorSpace;
  tex.wrapS = wrapping;
  tex.wrapT = wrapping;
  tex.anisotropy = anisotropy;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function wrapIndex(index: number, max: number): number {
  const m = index % max;
  return m < 0 ? m + max : m;
}

function clampIndex(index: number, max: number): number {
  if (index < 0) return 0;
  if (index >= max) return max - 1;
  return index;
}

function sobelNormalCanvas(
  heightField: Float32Array,
  width: number,
  height: number,
  strength: number,
  tileWrap: boolean,
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvasSurface(width, height);
  const imageData = ctx.createImageData(width, height);
  const out = imageData.data;

  const sample = (x: number, y: number): number => {
    const sx = tileWrap ? wrapIndex(x, width) : clampIndex(x, width);
    const sy = tileWrap ? wrapIndex(y, height) : clampIndex(y, height);
    return heightField[sy * width + sx];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = tr + 2 * r + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * width + x) * 4;
      out[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function hexToCss(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hash2D(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Generates the 1024x2048 space-cadet cathedral stained-glass playfield deck PBR textures.
 * Maps world playfield coordinates (x in [-0.2575, +0.2575], z in [-0.535, +0.535])
 * directly onto Canvas 2D pixels so inserts, lanes, and rose medallions align with TableSpec.
 */
export function createPlayfieldDeckTextures(): StainedGlassTextureSet {
  const albedoSurf = createCanvasSurface(DECK_WIDTH, DECK_HEIGHT);
  const roughSurf = createCanvasSurface(DECK_WIDTH, DECK_HEIGHT);
  const emissiveSurf = createCanvasSurface(DECK_WIDTH, DECK_HEIGHT);
  const reliefSurf = createCanvasSurface(DECK_WIDTH, DECK_HEIGHT);

  const aCtx = albedoSurf.ctx;
  const rCtx = roughSurf.ctx;
  const eCtx = emissiveSurf.ctx;
  const hCtx = reliefSurf.ctx;

  const pxX = (xMeters: number): number =>
    ((xMeters - TABLE_SPEC.playfield.xMin) / TABLE_SPEC.cabinet.innerWidth) * DECK_WIDTH;
  const pxY = (zMeters: number): number =>
    ((zMeters - TABLE_SPEC.playfield.zMin) / TABLE_SPEC.cabinet.innerLength) * DECK_HEIGHT;
  const scaleX = DECK_WIDTH / TABLE_SPEC.cabinet.innerWidth;
  const scaleY = DECK_HEIGHT / TABLE_SPEC.cabinet.innerLength;

  // 1. Base deep obsidian cathedral stone / dark lacquered slate
  const bgGrad = aCtx.createLinearGradient(0, 0, 0, DECK_HEIGHT);
  bgGrad.addColorStop(0, '#04060f');
  bgGrad.addColorStop(0.45, '#070b1a');
  bgGrad.addColorStop(0.75, '#050915');
  bgGrad.addColorStop(1, '#03050c');
  aCtx.fillStyle = bgGrad;
  aCtx.fillRect(0, 0, DECK_WIDTH, DECK_HEIGHT);

  // Base clearcoat roughness (~0.24 = 61)
  rCtx.fillStyle = 'rgb(62, 62, 62)';
  rCtx.fillRect(0, 0, DECK_WIDTH, DECK_HEIGHT);

  // Emissive starts completely dark so opaque surfaces never bloom
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, DECK_WIDTH, DECK_HEIGHT);

  // Relief neutral base
  hCtx.fillStyle = 'rgb(128, 128, 128)';
  hCtx.fillRect(0, 0, DECK_WIDTH, DECK_HEIGHT);

  // 2. Subtle cosmic starfield + cathedral tile grid across main active field
  const mainCx = pxX(TABLE_SPEC.playfield.mainCenterX);
  const roseCy = pxY(-0.04);

  const nebula = aCtx.createRadialGradient(mainCx, roseCy, 24, mainCx, roseCy, 560);
  nebula.addColorStop(0, 'rgba(90, 56, 170, 0.36)');
  nebula.addColorStop(0.45, 'rgba(28, 92, 168, 0.22)');
  nebula.addColorStop(1, 'rgba(10, 15, 36, 0)');
  aCtx.fillStyle = nebula;
  aCtx.fillRect(0, 0, DECK_WIDTH, DECK_HEIGHT);

  // Subtle gothic floor flagstones
  aCtx.strokeStyle = 'rgba(148, 163, 214, 0.10)';
  aCtx.lineWidth = 2;
  hCtx.strokeStyle = 'rgb(108, 108, 108)';
  hCtx.lineWidth = 3;
  for (let gx = -0.24; gx <= 0.21; gx += 0.06) {
    const x = pxX(gx);
    aCtx.beginPath();
    aCtx.moveTo(x, 0);
    aCtx.lineTo(x, DECK_HEIGHT);
    aCtx.stroke();
    hCtx.beginPath();
    hCtx.moveTo(x, 0);
    hCtx.lineTo(x, DECK_HEIGHT);
    hCtx.stroke();
  }
  for (let gz = -0.50; gz <= 0.50; gz += 0.08) {
    const y = pxY(gz);
    aCtx.beginPath();
    aCtx.moveTo(0, y);
    aCtx.lineTo(pxX(TABLE_SPEC.plungerLane.dividerX), y);
    aCtx.stroke();
    hCtx.beginPath();
    hCtx.moveTo(0, y);
    hCtx.lineTo(pxX(TABLE_SPEC.plungerLane.dividerX), y);
    hCtx.stroke();
  }

  // Cosmic stars & constellation dots
  for (let i = 0; i < 160; i++) {
    const sx = hash2D(i * 1.17, 3.71) * pxX(TABLE_SPEC.playfield.mainActiveXMax - 0.01);
    const sy = hash2D(i * 5.23, 9.13) * DECK_HEIGHT;
    const rad = 1 + hash2D(i, 17.3) * 2.2;
    const alpha = 0.25 + hash2D(i, 29.1) * 0.55;
    aCtx.fillStyle = `rgba(218, 232, 255, ${alpha.toFixed(2)})`;
    aCtx.beginPath();
    aCtx.arc(sx, sy, rad, 0, Math.PI * 2);
    aCtx.fill();
  }

  // 3. Gothic cathedral nave pointed arch framing the upper playfield
  aCtx.save();
  aCtx.strokeStyle = '#c89b4b';
  aCtx.lineWidth = 7;
  rCtx.strokeStyle = 'rgb(112, 112, 112)';
  rCtx.lineWidth = 7;
  hCtx.strokeStyle = 'rgb(190, 190, 190)';
  hCtx.lineWidth = 7;

  const drawArchFrame = (ctx: CanvasRenderingContext2D): void => {
    ctx.beginPath();
    ctx.moveTo(pxX(-0.242), pxY(0.32));
    ctx.lineTo(pxX(-0.242), pxY(-0.26));
    ctx.quadraticCurveTo(pxX(-0.22), pxY(-0.50), mainCx, pxY(-0.515));
    ctx.quadraticCurveTo(pxX(0.18), pxY(-0.50), pxX(0.198), pxY(-0.26));
    ctx.lineTo(pxX(0.198), pxY(0.32));
    ctx.stroke();
  };
  drawArchFrame(aCtx);
  drawArchFrame(rCtx);
  drawArchFrame(hCtx);
  aCtx.restore();

  // 4. Right plunger lane track & brass ruler ticks
  const dividerPx = pxX(TABLE_SPEC.plungerLane.dividerX);
  const plungerCenterPx = pxX(TABLE_SPEC.plungerLane.centerX);
  aCtx.fillStyle = '#080b16';
  aCtx.fillRect(dividerPx, 0, DECK_WIDTH - dividerPx, DECK_HEIGHT);
  rCtx.fillStyle = 'rgb(96, 96, 96)';
  rCtx.fillRect(dividerPx, 0, DECK_WIDTH - dividerPx, DECK_HEIGHT);

  aCtx.strokeStyle = '#d4a34f';
  aCtx.lineWidth = 4;
  for (let z = -0.22; z <= 0.48; z += 0.05) {
    const ty = pxY(z);
    aCtx.beginPath();
    aCtx.moveTo(plungerCenterPx - 14, ty);
    aCtx.lineTo(plungerCenterPx + 14, ty);
    aCtx.stroke();
  }
  // Launch chevron in shooter lane
  const drawChevron = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
    fill: string,
    stroke?: string,
  ): void => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h * 0.6);
    ctx.lineTo(cx + w * 0.5, cy + h * 0.4);
    ctx.lineTo(cx, cy + h * 0.1);
    ctx.lineTo(cx - w * 0.5, cy + h * 0.4);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  };

  for (let i = 0; i < 3; i++) {
    const cy = pxY(0.24 - i * 0.08);
    drawChevron(aCtx, plungerCenterPx, cy, 34, 34, '#f59e0b', '#1b1d28');
    drawChevron(eCtx, plungerCenterPx, cy, 30, 30, '#ffb020');
    drawChevron(rCtx, plungerCenterPx, cy, 34, 34, 'rgb(34, 34, 34)');
  }

  // 5. Central Rose Window Stained-Glass Medallion & Astrolabe Halo at (-0.022, -0.04)
  const roseRx = 0.098 * scaleX;
  const roseRy = 0.098 * scaleY;
  const petalPalette = ['#38bdf8', '#a855f7', '#f59e0b', '#ec4899', '#10b981', '#f43f5e'];

  aCtx.save();
  aCtx.translate(mainCx, roseCy);
  aCtx.scale(1, roseRy / roseRx);

  rCtx.save();
  rCtx.translate(mainCx, roseCy);
  rCtx.scale(1, roseRy / roseRx);

  eCtx.save();
  eCtx.translate(mainCx, roseCy);
  eCtx.scale(1, roseRy / roseRx);

  hCtx.save();
  hCtx.translate(mainCx, roseCy);
  hCtx.scale(1, roseRy / roseRx);

  // Outer brass astrolabe halo
  aCtx.beginPath();
  aCtx.arc(0, 0, roseRx * 1.28, 0, Math.PI * 2);
  aCtx.strokeStyle = '#d4a656';
  aCtx.lineWidth = 6;
  aCtx.stroke();

  hCtx.beginPath();
  hCtx.arc(0, 0, roseRx * 1.28, 0, Math.PI * 2);
  hCtx.strokeStyle = 'rgb(220, 220, 220)';
  hCtx.lineWidth = 7;
  hCtx.stroke();

  // 12 stained-glass rose petals
  const petalCount = 12;
  for (let p = 0; p < petalCount; p++) {
    const a0 = (p / petalCount) * Math.PI * 2;
    const a1 = ((p + 1) / petalCount) * Math.PI * 2;
    const mid = (a0 + a1) * 0.5;
    const col = petalPalette[p % petalPalette.length];

    const drawPetal = (ctx: CanvasRenderingContext2D, fill: string, stroke?: string): void => {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * roseRx * 0.34, Math.sin(a0) * roseRx * 0.34);
      ctx.lineTo(Math.cos(a0) * roseRx * 1.08, Math.sin(a0) * roseRx * 1.08);
      ctx.quadraticCurveTo(
        Math.cos(mid) * roseRx * 1.22,
        Math.sin(mid) * roseRx * 1.22,
        Math.cos(a1) * roseRx * 1.08,
        Math.sin(a1) * roseRx * 1.08,
      );
      ctx.lineTo(Math.cos(a1) * roseRx * 0.34, Math.sin(a1) * roseRx * 0.34);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    };

    drawPetal(aCtx, col, '#151822');
    drawPetal(eCtx, col, '#000000');
    drawPetal(rCtx, 'rgb(30, 30, 30)', 'rgb(142, 142, 142)');
    drawPetal(hCtx, 'rgb(104, 104, 104)', 'rgb(230, 230, 230)');
  }

  // Inner cathedral star core
  aCtx.beginPath();
  aCtx.arc(0, 0, roseRx * 0.34, 0, Math.PI * 2);
  aCtx.fillStyle = '#fde68a';
  aCtx.fill();
  aCtx.strokeStyle = '#151822';
  aCtx.lineWidth = 5;
  aCtx.stroke();

  eCtx.beginPath();
  eCtx.arc(0, 0, roseRx * 0.3, 0, Math.PI * 2);
  eCtx.fillStyle = '#fbbf24';
  eCtx.fill();

  aCtx.restore();
  rCtx.restore();
  eCtx.restore();
  hCtx.restore();

  // 6. Pop Bumper Halo Rings matching TABLE_SPEC.bumpers
  for (const bumper of TABLE_SPEC.bumpers) {
    const bx = pxX(bumper.positionLocal.x);
    const by = pxY(bumper.positionLocal.z);
    const brx = bumper.radius * 1.65 * scaleX;
    const bry = bumper.radius * 1.65 * scaleY;
    const color = hexToCss(bumper.colorHex);

    for (const [ctx, stroke, lw] of [
      [aCtx, color, 8],
      [eCtx, color, 7],
      [rCtx, 'rgb(34, 34, 34)', 8],
      [hCtx, 'rgb(210, 210, 210)', 8],
    ] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(bx, by, brx, bry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 7. Upper Rollover Lane Glow Inserts (aligned to z = -0.395 between divider Xs)
  const rolloverCenters = [-0.092, -0.022, 0.048];
  const rolloverColors = ['#ef4444', '#38bdf8', '#f59e0b'];
  for (let i = 0; i < rolloverCenters.length; i++) {
    const rx = pxX(rolloverCenters[i]);
    const ry = pxY(-0.395);
    const col = rolloverColors[i];

    aCtx.beginPath();
    aCtx.ellipse(rx, ry, 18, 32, 0, 0, Math.PI * 2);
    aCtx.fillStyle = col;
    aCtx.fill();
    aCtx.strokeStyle = '#151822';
    aCtx.lineWidth = 4;
    aCtx.stroke();

    eCtx.beginPath();
    eCtx.ellipse(rx, ry, 15, 28, 0, 0, Math.PI * 2);
    eCtx.fillStyle = col;
    eCtx.fill();

    rCtx.beginPath();
    rCtx.ellipse(rx, ry, 18, 32, 0, 0, Math.PI * 2);
    rCtx.fillStyle = 'rgb(28, 28, 28)';
    rCtx.fill();
  }

  // 8. Ramp Entry & Multiball Lock Sanctuary Chevrons
  const rampX = pxX(TABLE_SPEC.stainedGlassRamp.entryLocal.x);
  for (let i = 0; i < 2; i++) {
    const ry = pxY(-0.20 + i * 0.065);
    drawChevron(aCtx, rampX, ry, 42, 42, '#c084fc', '#151822');
    drawChevron(eCtx, rampX, ry, 36, 36, '#d8b4fe');
    drawChevron(rCtx, rampX, ry, 42, 42, 'rgb(30, 30, 30)');
  }

  const lockX = pxX(TABLE_SPEC.multiballLock.sensorLocal.x);
  for (let i = 0; i < 2; i++) {
    const ly = pxY(-0.19 + i * 0.065);
    drawChevron(aCtx, lockX, ly, 42, 42, '#10b981', '#151822');
    drawChevron(eCtx, lockX, ly, 36, 36, '#34d399');
    drawChevron(rCtx, lockX, ly, 42, 42, 'rgb(30, 30, 30)');
  }

  // 9. Drop Target Lane Bar Indicators (x = -0.228)
  for (const target of TABLE_SPEC.dropTargets.targets) {
    const tx = pxX(target.positionLocal.x + 0.025);
    const ty = pxY(target.positionLocal.z);
    aCtx.fillStyle = '#f43f5e';
    aCtx.fillRect(tx - 10, ty - 24, 20, 48);
    aCtx.strokeStyle = '#14161e';
    aCtx.lineWidth = 4;
    aCtx.strokeRect(tx - 10, ty - 24, 20, 48);

    eCtx.fillStyle = '#fb7185';
    eCtx.fillRect(tx - 8, ty - 21, 16, 42);
    rCtx.fillStyle = 'rgb(30, 30, 30)';
    rCtx.fillRect(tx - 10, ty - 24, 20, 48);
  }

  // 10. Lower Multiplier Diamond Inserts & Space-Cadet Cathedral Emblem above flippers
  const multColors = ['#38bdf8', '#a855f7', '#f59e0b', '#ec4899'];
  const multLabels = ['2X', '4X', '6X', '8X'];
  for (let i = 0; i < 4; i++) {
    const mx = pxX(TABLE_SPEC.playfield.mainCenterX + (i - 1.5) * 0.056);
    const my = pxY(0.18);
    const col = multColors[i];

    const drawDiamond = (ctx: CanvasRenderingContext2D, r: number, fill: string, stroke?: string): void => {
      ctx.beginPath();
      ctx.moveTo(mx, my - r);
      ctx.lineTo(mx + r * 0.72, my);
      ctx.lineTo(mx, my + r);
      ctx.lineTo(mx - r * 0.72, my);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    };

    drawDiamond(aCtx, 28, col, '#151822');
    drawDiamond(eCtx, 23, col);
    drawDiamond(rCtx, 28, 'rgb(28, 28, 28)');
    drawDiamond(hCtx, 28, 'rgb(165, 165, 165)', 'rgb(215, 215, 215)');

    aCtx.fillStyle = '#090d1c';
    aCtx.font = 'bold 18px system-ui, sans-serif';
    aCtx.textAlign = 'center';
    aCtx.textBaseline = 'middle';
    aCtx.fillText(multLabels[i], mx, my);
  }

  // Cathedral Space-Cadet Crest between apron lanes
  aCtx.fillStyle = 'rgba(229, 193, 108, 0.9)';
  aCtx.font = 'bold 26px Georgia, serif';
  aCtx.textAlign = 'center';
  aCtx.fillText('SPACE CATHEDRAL', mainCx, pxY(0.275));

  aCtx.fillStyle = 'rgba(148, 197, 255, 0.8)';
  aCtx.font = '600 15px system-ui, sans-serif';
  aCtx.fillText('SANCTUARY MULTIBALL', mainCx, pxY(0.302));

  // Glowing Ball Save shield medallion between flippers (z = 0.405)
  const saveCx = mainCx;
  const saveCy = pxY(0.405);
  aCtx.beginPath();
  aCtx.arc(saveCx, saveCy, 24, 0, Math.PI * 2);
  aCtx.fillStyle = '#065f46';
  aCtx.fill();
  aCtx.strokeStyle = '#34d399';
  aCtx.lineWidth = 4;
  aCtx.stroke();

  eCtx.beginPath();
  eCtx.arc(saveCx, saveCy, 20, 0, Math.PI * 2);
  eCtx.fillStyle = '#10b981';
  eCtx.fill();

  // Build Sobel normal map from relief channel
  const reliefData = hCtx.getImageData(0, 0, DECK_WIDTH, DECK_HEIGHT).data;
  const heightField = new Float32Array(DECK_WIDTH * DECK_HEIGHT);
  for (let i = 0; i < heightField.length; i++) {
    heightField[i] = reliefData[i * 4] / 255;
  }
  const normalCanvas = sobelNormalCanvas(heightField, DECK_WIDTH, DECK_HEIGHT, 2.2, false);

  const albedo = makeCanvasTexture(albedoSurf.canvas, THREE.SRGBColorSpace, THREE.ClampToEdgeWrapping);
  const roughness = makeCanvasTexture(roughSurf.canvas, THREE.NoColorSpace, THREE.ClampToEdgeWrapping);
  const emissive = makeCanvasTexture(emissiveSurf.canvas, THREE.SRGBColorSpace, THREE.ClampToEdgeWrapping);
  const normal = makeCanvasTexture(normalCanvas, THREE.NoColorSpace, THREE.ClampToEdgeWrapping);

  return {
    albedo,
    roughness,
    emissive,
    normal,
    dispose(): void {
      albedo.dispose();
      roughness.dispose();
      emissive.dispose();
      normal.dispose();
    },
  };
}

/**
 * Generates a 512x512 seamless vibrant cathedral stained-glass mosaic PBR texture set
 * with dark metallic lead cames, hand-blown glass ripples, emissive glow mask, and Sobel normal map.
 */
export function createStainedGlassTextureSet(): StainedGlassTextureSet {
  const albedoSurf = createCanvasSurface(GLASS_SIZE, GLASS_SIZE);
  const roughSurf = createCanvasSurface(GLASS_SIZE, GLASS_SIZE);
  const emissiveSurf = createCanvasSurface(GLASS_SIZE, GLASS_SIZE);

  const aImg = albedoSurf.ctx.createImageData(GLASS_SIZE, GLASS_SIZE);
  const rImg = roughSurf.ctx.createImageData(GLASS_SIZE, GLASS_SIZE);
  const eImg = emissiveSurf.ctx.createImageData(GLASS_SIZE, GLASS_SIZE);
  const heightField = new Float32Array(GLASS_SIZE * GLASS_SIZE);

  const aData = aImg.data;
  const rData = rImg.data;
  const eData = eImg.data;

  // Vibrant jewel-toned stained glass palette (RGB)
  const palette: readonly [number, number, number][] = [
    [34, 152, 255],  // Sapphire cobalt
    [194, 72, 245],  // Cathedral amethyst
    [248, 174, 34],  // Amber gold
    [24, 206, 168],  // Sanctuary emerald
    [242, 68, 128],  // Ruby rose
    [56, 218, 248],  // Celestial cyan
  ];

  // Periodic Voronoi seed grid (8x8 wrapping cell lattice for crisp stained-glass mosaic)
  const cells = 8;
  const jitterX = new Float32Array(cells * cells);
  const jitterY = new Float32Array(cells * cells);
  const cellColor = new Uint8Array(cells * cells);

  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const idx = cy * cells + cx;
      jitterX[idx] = 0.2 + hash2D(cx + 1.3, cy + 4.7) * 0.6;
      jitterY[idx] = 0.2 + hash2D(cx + 9.1, cy + 2.5) * 0.6;
      cellColor[idx] = (cx * 3 + cy * 5 + Math.floor(hash2D(cx, cy) * 3)) % palette.length;
    }
  }

  for (let y = 0; y < GLASS_SIZE; y++) {
    const v = (y / GLASS_SIZE) * cells;
    const baseCellY = Math.floor(v);

    for (let x = 0; x < GLASS_SIZE; x++) {
      const u = (x / GLASS_SIZE) * cells;
      const baseCellX = Math.floor(u);

      let d1 = 1e9;
      let d2 = 1e9;
      let nearestIdx = 0;

      for (let oy = -1; oy <= 1; oy++) {
        const cy = wrapIndex(baseCellY + oy, cells);
        for (let ox = -1; ox <= 1; ox++) {
          const cx = wrapIndex(baseCellX + ox, cells);
          const idx = cy * cells + cx;
          const px = baseCellX + ox + jitterX[idx];
          const py = baseCellY + oy + jitterY[idx];
          const dx = u - px;
          const dy = v - py;
          const dist = Math.hypot(dx, dy);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
            nearestIdx = idx;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }

      // Distance to Voronoi cell border gives exact lead-came seams
      const borderDist = d2 - d1;
      const cameWidth = 0.085;
      const isCame = borderDist < cameWidth;

      // Hand-blown glass ripple inside each shard
      const ripple =
        Math.sin((x / GLASS_SIZE) * Math.PI * 16 + d1 * 5.0) *
        Math.cos((y / GLASS_SIZE) * Math.PI * 16 - d1 * 4.0) *
        0.5 +
        0.5;

      const idx4 = (y * GLASS_SIZE + x) * 4;

      if (isCame) {
        const cameProfile = Math.cos((borderDist / cameWidth) * Math.PI * 0.5);
        aData[idx4] = 20;
        aData[idx4 + 1] = 22;
        aData[idx4 + 2] = 30;
        aData[idx4 + 3] = 255;

        rData[idx4] = 148;
        rData[idx4 + 1] = 148;
        rData[idx4 + 2] = 148;
        rData[idx4 + 3] = 255;

        eData[idx4] = 0;
        eData[idx4 + 1] = 0;
        eData[idx4 + 2] = 0;
        eData[idx4 + 3] = 255;

        heightField[y * GLASS_SIZE + x] = 0.58 + cameProfile * 0.42;
      } else {
        const [pr, pg, pb] = palette[cellColor[nearestIdx]];
        // Slight luminous jewel variation toward pane centers and edges
        const edgeGlow = Math.max(0, 1 - (borderDist - cameWidth) * 3.0);
        const shade = 0.78 + ripple * 0.22 + edgeGlow * 0.16;

        aData[idx4] = Math.min(255, Math.round(pr * shade));
        aData[idx4 + 1] = Math.min(255, Math.round(pg * shade));
        aData[idx4 + 2] = Math.min(255, Math.round(pb * shade));
        aData[idx4 + 3] = 255;

        const roughByte = Math.round(28 + ripple * 20);
        rData[idx4] = roughByte;
        rData[idx4 + 1] = roughByte;
        rData[idx4 + 2] = roughByte;
        rData[idx4 + 3] = 255;

        const emitScale = 0.45 + ripple * 0.18;
        eData[idx4] = Math.min(255, Math.round(pr * emitScale));
        eData[idx4 + 1] = Math.min(255, Math.round(pg * emitScale));
        eData[idx4 + 2] = Math.min(255, Math.round(pb * emitScale));
        eData[idx4 + 3] = 255;

        heightField[y * GLASS_SIZE + x] = 0.25 + ripple * 0.14;
      }
    }
  }

  albedoSurf.ctx.putImageData(aImg, 0, 0);
  roughSurf.ctx.putImageData(rImg, 0, 0);
  emissiveSurf.ctx.putImageData(eImg, 0, 0);

  const normalCanvas = sobelNormalCanvas(heightField, GLASS_SIZE, GLASS_SIZE, 2.4, true);

  const albedo = makeCanvasTexture(albedoSurf.canvas, THREE.SRGBColorSpace, THREE.RepeatWrapping);
  const roughness = makeCanvasTexture(roughSurf.canvas, THREE.NoColorSpace, THREE.RepeatWrapping);
  const emissive = makeCanvasTexture(emissiveSurf.canvas, THREE.SRGBColorSpace, THREE.RepeatWrapping);
  const normal = makeCanvasTexture(normalCanvas, THREE.NoColorSpace, THREE.RepeatWrapping);

  return {
    albedo,
    roughness,
    emissive,
    normal,
    dispose(): void {
      albedo.dispose();
      roughness.dispose();
      emissive.dispose();
      normal.dispose();
    },
  };
}
