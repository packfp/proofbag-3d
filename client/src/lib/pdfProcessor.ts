// PDF Processor — renders PDF proof to a high-res canvas using pdf.js

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Use Vite ?url import so the worker is bundled as a static asset
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderResult {
  canvas: HTMLCanvasElement;
  scale: number;           // actual render scale used
  widthPx: number;
  heightPx: number;
  pageWidthMm: number;
  pageHeightMm: number;
  pixelsPerMm: number;
}

/**
 * Renders the first page of a PDF file to a canvas at high DPI.
 * Returns both the canvas and metadata needed for dimension extraction.
 */
export async function renderPdfToCanvas(
  file: File,
  targetDpi: number = 200
): Promise<RenderResult> {
  const arrayBuffer = await file.arrayBuffer();
  const typedArray = new Uint8Array(arrayBuffer);

  const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
  const page = await pdf.getPage(1);

  // PDF user units are in points (1 point = 1/72 inch)
  // We want to render at targetDpi, so scale = targetDpi / 72
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetDpi / 72;

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * scale);
  canvas.height = Math.floor(viewport.height * scale);

  const ctx = canvas.getContext('2d')!;

  await page.render({
    canvasContext: ctx,
    viewport: page.getViewport({ scale }),
  }).promise;

  // Convert points to mm: 1 point = 0.352778 mm
  const pageWidthMm = viewport.width * 0.352778;
  const pageHeightMm = viewport.height * 0.352778;
  const pixelsPerMm = canvas.width / pageWidthMm;

  return {
    canvas,
    scale,
    widthPx: canvas.width,
    heightPx: canvas.height,
    pageWidthMm,
    pageHeightMm,
    pixelsPerMm,
  };
}

/**
 * Renders an image file (PNG/JPG) to a canvas element.
 */
export function renderImageToCanvas(file: File): Promise<RenderResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      // Assume 96 DPI for images without metadata
      const pixelsPerMm = 96 / 25.4;
      const pageWidthMm = img.naturalWidth / pixelsPerMm;
      const pageHeightMm = img.naturalHeight / pixelsPerMm;

      resolve({
        canvas,
        scale: 1,
        widthPx: img.naturalWidth,
        heightPx: img.naturalHeight,
        pageWidthMm,
        pageHeightMm,
        pixelsPerMm,
      });
    };
    img.onerror = reject;
    img.src = url;
  });
}
