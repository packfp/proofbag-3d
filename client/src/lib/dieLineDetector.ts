// Die Line Detector
// Downsamples large proofs before processing, then maps results back.

import type { BagDimensions } from '../../../shared/schema';

export interface DieLineResult {
  maskedCanvas: HTMLCanvasElement;
  dieLineBounds: { x: number; y: number; width: number; height: number };
  artworkCanvas: HTMLCanvasElement;
  foldLines: FoldLine[];
  estimatedDimensions: Partial<BagDimensions>;
}

export interface FoldLine {
  type: 'vertical' | 'horizontal';
  position: number;
  isDashed: boolean;
}

const MAX_PROCESS_SIZE = 1000; // max pixels on longest side for flood fill
const DEFAULT_TOLERANCE = 22;

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function samplePixelColor(
  canvas: HTMLCanvasElement,
  x: number,
  y: number
): { r: number; g: number; b: number } {
  const ctx = canvas.getContext('2d')!;
  const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

function colorsMatch(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number, tol: number): boolean {
  return Math.abs(r1-r2) <= tol && Math.abs(g1-g2) <= tol && Math.abs(b1-b2) <= tol;
}

/** Downscale a canvas to max `maxSize` on longest side, returns scaled canvas + scale factor */
function downscaleCanvas(src: HTMLCanvasElement, maxSize: number): { canvas: HTMLCanvasElement; scale: number } {
  const { width: sw, height: sh } = src;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  if (scale >= 1) return { canvas: src, scale: 1 };

  const dw = Math.floor(sw * scale);
  const dh = Math.floor(sh * scale);
  const dst = document.createElement('canvas');
  dst.width = dw;
  dst.height = dh;
  const ctx = dst.getContext('2d')!;
  ctx.drawImage(src, 0, 0, dw, dh);
  return { canvas: dst, scale };
}

export function detectDieLine(
  sourceCanvas: HTMLCanvasElement,
  dieLineColor: { r: number; g: number; b: number },
  tolerance: number = DEFAULT_TOLERANCE
): DieLineResult {
  // Step 1: Downsample for processing
  const { canvas: procCanvas, scale } = downscaleCanvas(sourceCanvas, MAX_PROCESS_SIZE);
  const { width, height } = procCanvas;

  const ctx = procCanvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Step 2: Mark die line pixels
  const isDieLine = new Uint8Array(width * height);
  const { r: dr, g: dg, b: db } = dieLineColor;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 100) continue;
    if (colorsMatch(r, g, b, dr, dg, db, tolerance)) isDieLine[i] = 1;
  }

  // Step 3: Flood fill exterior from edges using iterative BFS
  const isExterior = new Uint8Array(width * height);
  const queue = new Int32Array(width * height); // pre-allocated queue
  let qHead = 0, qTail = 0;

  const enqueue = (idx: number) => {
    if (idx < 0 || idx >= width * height) return;
    if (isExterior[idx] || isDieLine[idx]) return;
    isExterior[idx] = 1;
    queue[qTail++] = idx;
  };

  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height-1)*width+x); }
  for (let y = 0; y < height; y++) { enqueue(y*width); enqueue(y*width+(width-1)); }

  while (qHead < qTail) {
    const idx = queue[qHead++];
    const x = idx % width, y = Math.floor(idx / width);
    if (x > 0) enqueue(idx-1);
    if (x < width-1) enqueue(idx+1);
    if (y > 0) enqueue(idx-width);
    if (y < height-1) enqueue(idx+width);
  }

  // Step 4: Find die line bounds in process-space
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let i = 0; i < width * height; i++) {
    if (!isExterior[i] && !isDieLine[i]) {
      const x = i % width, y = Math.floor(i / width);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }

  if (minX >= maxX || minY >= maxY) {
    // Fallback: use whole canvas
    minX = 10; maxX = width - 10; minY = 10; maxY = height - 10;
  }

  // Step 5: Scale bounds back to original canvas
  const invScale = 1 / scale;
  const origBounds = {
    x: Math.round(minX * invScale),
    y: Math.round(minY * invScale),
    width: Math.round((maxX - minX) * invScale),
    height: Math.round((maxY - minY) * invScale),
  };

  // Step 6: Apply mask directly to source canvas at full resolution
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
  const srcData = srcCtx.getImageData(origBounds.x, origBounds.y, origBounds.width, origBounds.height);
  const srcPixels = srcData.data;

  // Build mask for artwork region (interior = not die line, not exterior)
  // We use the downscaled result, remapping coordinates
  const artCanvas = document.createElement('canvas');
  artCanvas.width = origBounds.width;
  artCanvas.height = origBounds.height;
  const artCtx = artCanvas.getContext('2d')!;
  const artData = artCtx.createImageData(origBounds.width, origBounds.height);
  const artPixels = artData.data;

  for (let py = 0; py < origBounds.height; py++) {
    for (let px = 0; px < origBounds.width; px++) {
      // Map to process-space
      const procX = Math.round((origBounds.x + px) * scale);
      const procY = Math.round((origBounds.y + py) * scale);
      const procIdx = Math.min(procY, height-1) * width + Math.min(procX, width-1);

      if (!isExterior[procIdx] && !isDieLine[procIdx]) {
        // Interior: copy original pixel
        const srcIdx = (py * origBounds.width + px) * 4;
        artPixels[srcIdx] = srcPixels[srcIdx];
        artPixels[srcIdx+1] = srcPixels[srcIdx+1];
        artPixels[srcIdx+2] = srcPixels[srcIdx+2];
        artPixels[srcIdx+3] = srcPixels[srcIdx+3];
      }
      // exterior: stays transparent (0,0,0,0)
    }
  }
  artCtx.putImageData(artData, 0, 0);

  // Also create a full-size masked canvas (for preview)
  const maskedCanvas = document.createElement('canvas');
  maskedCanvas.width = sourceCanvas.width;
  maskedCanvas.height = sourceCanvas.height;
  const maskedCtx = maskedCanvas.getContext('2d')!;
  maskedCtx.fillStyle = '#0d1117';
  maskedCtx.fillRect(0, 0, maskedCanvas.width, maskedCanvas.height);
  maskedCtx.drawImage(artCanvas, origBounds.x, origBounds.y);

  // Step 7: Detect fold lines in process-space bounds
  const foldLines = detectFoldLinesInBounds(
    data, width, height,
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    isDieLine, isExterior, dieLineColor, tolerance
  ).map(f => ({
    ...f,
    // Scale position back to original coordinates
    position: Math.round(f.position * invScale + (f.type === 'vertical' ? origBounds.x : origBounds.y)),
  }));

  // Adjust fold line positions relative to origBounds
  const foldLinesRelative = foldLines.map(f => ({
    ...f,
    position: f.type === 'vertical' ? f.position : f.position,
  }));

  const estimatedDimensions = estimateDimensions(origBounds, foldLines);

  return { maskedCanvas, dieLineBounds: origBounds, artworkCanvas: artCanvas, foldLines: foldLinesRelative, estimatedDimensions };
}

function detectFoldLinesInBounds(
  data: Uint8ClampedArray, width: number, height: number,
  bounds: { x: number; y: number; width: number; height: number },
  isDieLine: Uint8Array, isExterior: Uint8Array,
  dieLineColor: { r: number; g: number; b: number }, tolerance: number
): FoldLine[] {
  const { x: bx, y: by, width: bw, height: bh } = bounds;
  const foldLines: FoldLine[] = [];

  // Vertical fold lines
  const colScores = new Float32Array(bw);
  for (let col = 5; col < bw - 5; col++) {
    let match = 0, total = 0;
    for (let row = Math.floor(bh*0.1); row < Math.floor(bh*0.9); row += 3) {
      const idx = (by+row)*width + (bx+col);
      if (isExterior[idx]) continue;
      const r=data[idx*4], g=data[idx*4+1], b=data[idx*4+2], a=data[idx*4+3];
      if (a < 100) continue;
      total++;
      if (colorsMatch(r,g,b, dieLineColor.r,dieLineColor.g,dieLineColor.b, tolerance+20)) match++;
    }
    if (total > 0) colScores[col] = match/total;
  }
  for (const col of findPeaks(Array.from(colScores), 0.25, 15)) {
    foldLines.push({ type: 'vertical', position: bx + col, isDashed: true });
  }

  // Horizontal fold lines
  const rowScores = new Float32Array(bh);
  for (let row = 5; row < bh - 5; row++) {
    let match = 0, total = 0;
    for (let col = Math.floor(bw*0.1); col < Math.floor(bw*0.9); col += 3) {
      const idx = (by+row)*width + (bx+col);
      if (isExterior[idx]) continue;
      const r=data[idx*4], g=data[idx*4+1], b=data[idx*4+2], a=data[idx*4+3];
      if (a < 100) continue;
      total++;
      if (colorsMatch(r,g,b, dieLineColor.r,dieLineColor.g,dieLineColor.b, tolerance+20)) match++;
    }
    if (total > 0) rowScores[row] = match/total;
  }
  for (const row of findPeaks(Array.from(rowScores), 0.25, 10)) {
    foldLines.push({ type: 'horizontal', position: by + row, isDashed: true });
  }

  return foldLines;
}

function findPeaks(scores: number[], threshold: number, minDist: number): number[] {
  const peaks: number[] = [];
  for (let i = minDist; i < scores.length - minDist; i++) {
    if (scores[i] < threshold) continue;
    let peak = true;
    for (let j = i-minDist; j <= i+minDist; j++) {
      if (j !== i && scores[j] >= scores[i]) { peak = false; break; }
    }
    if (peak) peaks.push(i);
  }
  return peaks;
}

function estimateDimensions(
  bounds: { x: number; y: number; width: number; height: number },
  foldLines: FoldLine[]
): Partial<BagDimensions> {
  const dims: Partial<BagDimensions> = {
    totalWidth: bounds.width,
    totalHeight: bounds.height,
    proofLayout: 'front-only',
  };

  const verts = foldLines.filter(f => f.type === 'vertical').map(f => f.position - bounds.x).sort((a,b)=>a-b);
  const horizs = foldLines.filter(f => f.type === 'horizontal').map(f => f.position - bounds.y).sort((a,b)=>a-b);

  if (verts.length >= 2) {
    dims.leftGussetWidth = verts[0];
    dims.rightGussetWidth = bounds.width - verts[verts.length-1];
    dims.frontWidth = verts[verts.length-1] - verts[0];
    dims.proofLayout = 'full-wrap';
  } else if (verts.length === 1) {
    dims.frontWidth = verts[0];
    dims.proofLayout = 'front-back';
  } else {
    dims.frontWidth = bounds.width;
    dims.leftGussetWidth = 0;
    dims.rightGussetWidth = 0;
  }

  if (horizs.length >= 2) {
    dims.topSealHeight = horizs[0];
    dims.bottomSealHeight = bounds.height - horizs[horizs.length-1];
  } else {
    dims.topSealHeight = Math.round(bounds.height * 0.1);
    dims.bottomSealHeight = Math.round(bounds.height * 0.07);
  }

  dims.bagDepth = dims.leftGussetWidth
    ? ((dims.leftGussetWidth || 0) + (dims.rightGussetWidth || 0)) / 2
    : (dims.frontWidth || bounds.width) * 0.25;

  return dims;
}

/** Clamps a BagDimensions object to valid positive values */
export function clampDimensions(dims: Partial<BagDimensions>, totalW: number, totalH: number): Partial<BagDimensions> {
  const maxSeal = totalH * 0.35;
  const maxGusset = totalW * 0.4;
  return {
    ...dims,
    totalWidth: Math.max(1, dims.totalWidth || totalW),
    totalHeight: Math.max(1, dims.totalHeight || totalH),
    frontWidth: Math.max(1, Math.min(totalW, dims.frontWidth || totalW)),
    leftGussetWidth: Math.max(0, Math.min(maxGusset, dims.leftGussetWidth || 0)),
    rightGussetWidth: Math.max(0, Math.min(maxGusset, dims.rightGussetWidth || 0)),
    topSealHeight: Math.max(1, Math.min(maxSeal, dims.topSealHeight || totalH * 0.1)),
    bottomSealHeight: Math.max(1, Math.min(maxSeal, dims.bottomSealHeight || totalH * 0.07)),
    bagDepth: Math.max(1, dims.bagDepth || totalW * 0.2),
  };
}
