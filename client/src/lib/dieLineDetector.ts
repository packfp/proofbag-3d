// Die Line Detector — Clustered peak detection
//
// For each row, leftmost/rightmost green pixels cluster at the die line border
// and at any annotation lines outside. We cluster the histogram peaks, then
// select the INNERMOST cluster as the die line border (annotations are farther out).

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

const MAX_PROCESS_SIZE = 6000; // High enough that 200 DPI proofs aren't downscaled
const DEFAULT_TOLERANCE = 22;

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/**
 * Smart area sampler with saturation preference.
 */
export function samplePixelColor(
  canvas: HTMLCanvasElement,
  x: number,
  y: number
): { r: number; g: number; b: number } {
  const ctx = canvas.getContext('2d')!;
  const cx = Math.round(x), cy = Math.round(y);
  const maxR = 60;
  const w = canvas.width, h = canvas.height;

  const sx = Math.max(0, cx - maxR);
  const sy = Math.max(0, cy - maxR);
  const sw = Math.min(maxR * 2 + 1, w - sx);
  const sh = Math.min(maxR * 2 + 1, h - sy);
  const imgData = ctx.getImageData(sx, sy, sw, sh);
  const data = imgData.data;

  const isBackground = (r: number, g: number, b: number) => {
    if (r > 230 && g > 230 && b > 230) return true;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum > 215) return true;
    return false;
  };

  const saturation = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b);
    return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
  };

  for (const minSat of [0.30, 0]) {
    for (let ring = 0; ring <= maxR; ring++) {
      const colorCounts: Record<string, { r: number; g: number; b: number; count: number }> = {};
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          const px = (cx - sx) + dx, py = (cy - sy) + dy;
          if (px < 0 || py < 0 || px >= sw || py >= sh) continue;
          const idx = (py * sw + px) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          if (isBackground(r, g, b)) continue;
          if (saturation(r, g, b) < minSat) continue;
          const qr = (r >> 3) << 3, qg = (g >> 3) << 3, qb = (b >> 3) << 3;
          const key = `${qr},${qg},${qb}`;
          if (!colorCounts[key]) colorCounts[key] = { r, g, b, count: 0 };
          colorCounts[key].count++;
        }
      }
      let best: { r: number; g: number; b: number } | null = null;
      let bestCount = 0;
      for (const c of Object.values(colorCounts)) {
        if (c.count > bestCount) { bestCount = c.count; best = { r: c.r, g: c.g, b: c.b }; }
      }
      if (best) return best;
    }
  }

  const pixel = ctx.getImageData(cx, cy, 1, 1).data;
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

function colorsMatch(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number, tol: number): boolean {
  return Math.abs(r1 - r2) <= tol && Math.abs(g1 - g2) <= tol && Math.abs(b1 - b2) <= tol;
}

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

interface PeakCluster {
  center: number;   // position of the tallest bin
  min: number;       // leftmost bin above threshold
  max: number;       // rightmost bin above threshold
  peakVal: number;   // height of the tallest bin
}

/**
 * Find contiguous clusters of bins above 15% of the max in a histogram.
 * Each cluster is one logical peak (e.g. a 3px-wide die line border).
 */
function findPeakClusters(hist: Int32Array, length: number): PeakCluster[] {
  // Smooth the histogram to merge nearby bins
  const smoothed = new Float64Array(length);
  const wr = 3;
  for (let i = 0; i < length; i++) {
    let sum = 0, cnt = 0;
    for (let d = -wr; d <= wr; d++) {
      if (i + d >= 0 && i + d < length) { sum += hist[i + d]; cnt++; }
    }
    smoothed[i] = sum / cnt;
  }

  let maxVal = 0;
  for (let i = 0; i < length; i++) if (smoothed[i] > maxVal) maxVal = smoothed[i];
  if (maxVal === 0) return [];

  const threshold = maxVal * 0.15;

  const clusters: PeakCluster[] = [];
  let inCluster = false;
  let cStart = 0, cPeak = 0, cPeakVal = 0;

  for (let i = 0; i < length; i++) {
    if (smoothed[i] >= threshold) {
      if (!inCluster) {
        inCluster = true;
        cStart = i;
        cPeak = i;
        cPeakVal = smoothed[i];
      } else if (smoothed[i] > cPeakVal) {
        cPeak = i;
        cPeakVal = smoothed[i];
      }
    } else if (inCluster) {
      clusters.push({ center: cPeak, min: cStart, max: i - 1, peakVal: cPeakVal });
      inCluster = false;
    }
  }
  if (inCluster) {
    clusters.push({ center: cPeak, min: cStart, max: length - 1, peakVal: cPeakVal });
  }

  return clusters;
}

/**
 * Clustered-peak die line rectangle detection.
 */
export function detectDieLine(
  sourceCanvas: HTMLCanvasElement,
  dieLineColor: { r: number; g: number; b: number },
  tolerance: number = DEFAULT_TOLERANCE
): DieLineResult {
  const { canvas: procCanvas, scale } = downscaleCanvas(sourceCanvas, MAX_PROCESS_SIZE);
  const { width, height } = procCanvas;

  const ctx = procCanvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Mark die line pixels
  const isDieLine = new Uint8Array(width * height);
  const { r: dr, g: dg, b: db } = dieLineColor;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 100) continue;
    if (colorsMatch(r, g, b, dr, dg, db, tolerance)) isDieLine[i] = 1;
  }

  // For each row: leftmost / rightmost green pixel
  const leftMostPerRow = new Int32Array(height).fill(-1);
  const rightMostPerRow = new Int32Array(height).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isDieLine[y * width + x]) {
        if (leftMostPerRow[y] === -1) leftMostPerRow[y] = x;
        rightMostPerRow[y] = x;
      }
    }
  }

  // For each column: topmost / bottommost green pixel
  const topMostPerCol = new Int32Array(width).fill(-1);
  const bottomMostPerCol = new Int32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (isDieLine[y * width + x]) {
        if (topMostPerCol[x] === -1) topMostPerCol[x] = y;
        bottomMostPerCol[x] = y;
      }
    }
  }

  // Build histograms
  const leftHist = new Int32Array(width);
  const rightHist = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    if (leftMostPerRow[y] >= 0) leftHist[leftMostPerRow[y]]++;
    if (rightMostPerRow[y] >= 0) rightHist[rightMostPerRow[y]]++;
  }
  const topHist = new Int32Array(height);
  const bottomHist = new Int32Array(height);
  for (let x = 0; x < width; x++) {
    if (topMostPerCol[x] >= 0) topHist[topMostPerCol[x]]++;
    if (bottomMostPerCol[x] >= 0) bottomHist[bottomMostPerCol[x]]++;
  }

  // Find peak clusters
  const leftClusters = findPeakClusters(leftHist, width);
  const rightClusters = findPeakClusters(rightHist, width);
  const topClusters = findPeakClusters(topHist, height);
  const bottomClusters = findPeakClusters(bottomHist, height);

  // Select INNERMOST cluster for each border
  // Left: rightmost cluster (closest to center from left side)
  let minX = leftClusters.length > 0 ? leftClusters[leftClusters.length - 1].center : 10;

  // Right: leftmost cluster that is well separated from minX (at least 15% of width)
  let maxX = width - 10;
  const minGapW = width * 0.15;
  for (const c of rightClusters) {
    if (c.center > minX + minGapW) { maxX = c.center; break; }
  }

  // Top: bottommost cluster (closest to center from top)
  let minY = topClusters.length > 0 ? topClusters[topClusters.length - 1].center : 10;

  // Bottom: topmost cluster well separated from minY
  let maxY = height - 10;
  const minGapH = height * 0.15;
  for (const c of bottomClusters) {
    if (c.center > minY + minGapH) { maxY = c.center; break; }
  }

  // Sanity check
  if (maxX <= minX + 10 || maxY <= minY + 10) {
    minX = 10; maxX = width - 10; minY = 10; maxY = height - 10;
  }

  // Inset past the border line
  const borderInset = 3;
  const bMinX = Math.min(minX + borderInset, maxX);
  const bMaxX = Math.max(maxX - borderInset, bMinX + 1);
  const bMinY = Math.min(minY + borderInset, maxY);
  const bMaxY = Math.max(maxY - borderInset, bMinY + 1);

  // Scale to original canvas coords
  const invScale = 1 / scale;
  const origBounds = {
    x: Math.round(bMinX * invScale),
    y: Math.round(bMinY * invScale),
    width: Math.round((bMaxX - bMinX) * invScale),
    height: Math.round((bMaxY - bMinY) * invScale),
  };

  origBounds.x = Math.max(0, origBounds.x);
  origBounds.y = Math.max(0, origBounds.y);
  origBounds.width = Math.min(sourceCanvas.width - origBounds.x, origBounds.width);
  origBounds.height = Math.min(sourceCanvas.height - origBounds.y, origBounds.height);

  // Extract artwork
  const artCanvas = document.createElement('canvas');
  artCanvas.width = origBounds.width;
  artCanvas.height = origBounds.height;
  const artCtx = artCanvas.getContext('2d')!;
  artCtx.drawImage(sourceCanvas,
    origBounds.x, origBounds.y, origBounds.width, origBounds.height,
    0, 0, origBounds.width, origBounds.height
  );

  // Masked preview
  const maskedCanvas = document.createElement('canvas');
  maskedCanvas.width = sourceCanvas.width;
  maskedCanvas.height = sourceCanvas.height;
  const maskedCtx = maskedCanvas.getContext('2d')!;
  maskedCtx.fillStyle = '#0d1117';
  maskedCtx.fillRect(0, 0, maskedCanvas.width, maskedCanvas.height);
  maskedCtx.drawImage(artCanvas, origBounds.x, origBounds.y);

  // Detect fold lines
  const colSums = new Float64Array(width);
  const rowSums = new Float64Array(height);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isDieLine[y * width + x]) { colSums[x]++; rowSums[y]++; }
    }
  }

  const foldLines = detectFoldLinesFromProjection(
    colSums, rowSums, minX, maxX, minY, maxY, invScale
  );

  const estimatedDimensions = estimateDimensions(origBounds, foldLines);

  return { maskedCanvas, dieLineBounds: origBounds, artworkCanvas: artCanvas, foldLines, estimatedDimensions };
}

function detectFoldLinesFromProjection(
  colSums: Float64Array,
  rowSums: Float64Array,
  minX: number, maxX: number,
  minY: number, maxY: number,
  invScale: number
): FoldLine[] {
  const foldLines: FoldLine[] = [];
  const rectH = maxY - minY;
  const rectW = maxX - minX;
  // Skip at least 10% from each edge to avoid false positives from border anti-aliasing
  const borderSkipV = Math.max(15, Math.round(rectW * 0.10));
  const borderSkipH = Math.max(15, Math.round(rectH * 0.10));

  const vFoldThreshold = rectH * 0.15;
  const vBorderLevel = Math.max(colSums[minX] || 0, colSums[maxX] || 0) * 0.7;

  for (let x = minX + borderSkipV; x < maxX - borderSkipV; x++) {
    if (colSums[x] < vFoldThreshold || colSums[x] > vBorderLevel) continue;
    let isPeak = true;
    for (let dx = -8; dx <= 8; dx++) {
      if (dx !== 0 && x + dx >= minX && x + dx <= maxX && colSums[x + dx] >= colSums[x]) {
        isPeak = false; break;
      }
    }
    if (isPeak) {
      foldLines.push({ type: 'vertical', position: Math.round(x * invScale), isDashed: true });
    }
  }

  const hFoldThreshold = rectW * 0.15;
  const hBorderLevel = Math.max(rowSums[minY] || 0, rowSums[maxY] || 0) * 0.7;

  for (let y = minY + borderSkipH; y < maxY - borderSkipH; y++) {
    if (rowSums[y] < hFoldThreshold || rowSums[y] > hBorderLevel) continue;
    let isPeak = true;
    for (let dy = -8; dy <= 8; dy++) {
      if (dy !== 0 && y + dy >= minY && y + dy <= maxY && rowSums[y + dy] >= rowSums[y]) {
        isPeak = false; break;
      }
    }
    if (isPeak) {
      foldLines.push({ type: 'horizontal', position: Math.round(y * invScale), isDashed: true });
    }
  }

  return foldLines;
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

  const verts = foldLines.filter(f => f.type === 'vertical').map(f => f.position - bounds.x).sort((a, b) => a - b);
  const horizs = foldLines.filter(f => f.type === 'horizontal').map(f => f.position - bounds.y).sort((a, b) => a - b);

  // Aspect-ratio heuristic: tall proof (H > 1.6 × W) is almost always front+back stacked
  const isTallProof = bounds.height > bounds.width * 1.6;

  if (isTallProof) {
    // Front+back stacked vertically — each panel is approximately half the proof height.
    // The ACTUAL bag height is one panel, not the full stacked proof.
    dims.proofLayout = 'front-back-stacked';
    dims.frontWidth = bounds.width;
    dims.leftGussetWidth = 0;
    dims.rightGussetWidth = 0;

    // Single panel height (the real bag height)
    const panelHeight = Math.round(bounds.height / 2);
    dims.totalWidth = bounds.width;
    dims.totalHeight = panelHeight;

    // For ponytail bags (stacked layout), use sensible defaults for seal heights.
    // Horizontal fold lines inside the panel are usually design elements, not seal lines.
    // Only use a fold line as a seal boundary if it's in the outermost 20% of the panel.
    const midY = bounds.height / 2;
    const frontHorizs = horizs.filter(h => h < midY * 0.85);
    const topEdgeFolds = frontHorizs.filter(h => h < panelHeight * 0.20);
    const bottomEdgeFolds = frontHorizs.filter(h => h > panelHeight * 0.80);

    if (topEdgeFolds.length > 0) {
      dims.topSealHeight = topEdgeFolds[topEdgeFolds.length - 1]; // outermost top fold
    } else {
      dims.topSealHeight = Math.round(panelHeight * 0.12);
    }
    if (bottomEdgeFolds.length > 0) {
      dims.bottomSealHeight = panelHeight - bottomEdgeFolds[0]; // outermost bottom fold
    } else {
      dims.bottomSealHeight = Math.round(panelHeight * 0.04);
    }
  } else if (verts.length >= 2) {
    dims.leftGussetWidth = verts[0];
    dims.rightGussetWidth = bounds.width - verts[verts.length - 1];
    dims.frontWidth = verts[verts.length - 1] - verts[0];
    dims.proofLayout = 'full-wrap';
  } else if (verts.length === 1) {
    dims.frontWidth = verts[0];
    dims.proofLayout = 'front-back';
  } else {
    dims.frontWidth = bounds.width;
    dims.leftGussetWidth = 0;
    dims.rightGussetWidth = 0;
  }

  // Seal heights for non-stacked layouts
  if (!isTallProof) {
    if (horizs.length >= 2) {
      dims.topSealHeight = horizs[0];
      dims.bottomSealHeight = bounds.height - horizs[horizs.length - 1];
    } else {
      dims.topSealHeight = Math.round(bounds.height * 0.1);
      dims.bottomSealHeight = Math.round(bounds.height * 0.07);
    }
  }

  dims.bagDepth = dims.leftGussetWidth
    ? ((dims.leftGussetWidth || 0) + (dims.rightGussetWidth || 0)) / 2
    : (dims.frontWidth || bounds.width) * 0.25;

  return dims;
}

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
