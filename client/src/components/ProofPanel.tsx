// ProofPanel — Left panel handling PDF upload, die line picking, and dimension editing.

import { useRef, useState, useCallback, useEffect } from 'react';
import { Upload, Crosshair, CheckCircle, RotateCcw, AlertCircle, Ruler, Eye, EyeOff } from 'lucide-react';
import type { BagDimensions, ProofLayout } from '../../../shared/schema';
import { renderPdfToCanvas, renderImageToCanvas } from '../lib/pdfProcessor';
import { samplePixelColor, detectDieLine, clampDimensions } from '../lib/dieLineDetector';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ProofStep = 'upload' | 'pick-die-line' | 'confirm-dimensions' | 'ready';

interface ProofPanelProps {
  step: ProofStep;
  onStepChange: (step: ProofStep) => void;
  onProofReady: (artworkCanvas: HTMLCanvasElement, dimensions: BagDimensions, pixelsPerMm: number) => void;
  onDimensionsChange: (dimensions: BagDimensions) => void;
  dimensions: BagDimensions | null;
  pixelsPerMm: number;
}

// ─── Dimension Field ─────────────────────────────────────────────────────────

const MM_PER_INCH = 25.4;

/** Display a dimension field in the user's chosen unit (in or mm). 
 *  Internal storage is always mm. */
function DimField({ label, valueMm, onChangeMm, unit }: {
  label: string;
  valueMm: number;
  onChangeMm: (mm: number) => void;
  unit: 'in' | 'mm';
}) {
  const display = unit === 'in'
    ? Math.round((valueMm / MM_PER_INCH) * 1000) / 1000
    : Math.round(valueMm * 10) / 10;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value) || 0;
    onChangeMm(unit === 'in' ? raw * MM_PER_INCH : raw);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground w-36 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-1 flex-1">
        <input
          type="number"
          value={display}
          onChange={handleChange}
          className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          step={unit === 'in' ? '0.125' : '0.5'}
          min="0"
          data-testid={`dim-${label.toLowerCase().replace(/\s+/g, '-')}`}
        />
        <span className="text-xs text-muted-foreground">{unit === 'in' ? '"' : 'mm'}</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProofPanel({
  step,
  onStepChange,
  onProofReady,
  onDimensionsChange,
  dimensions,
  pixelsPerMm,
}: ProofPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [proofCanvas, setProofCanvas] = useState<HTMLCanvasElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedColor, setPickedColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [previewMode, setPreviewMode] = useState<'original' | 'masked'>('original');
  const [maskedCanvas, setMaskedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [localDims, setLocalDims] = useState<BagDimensions | null>(null);
  const [displayUnit, setDisplayUnit] = useState<'in' | 'mm'>('in');

  // Sync local dims with parent dims
  useEffect(() => {
    if (dimensions && !localDims) setLocalDims(dimensions);
  }, [dimensions]);

  // ─── File Upload ────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      let result;
      if (file.type === 'application/pdf') {
        result = await renderPdfToCanvas(file, 200);
      } else if (file.type.startsWith('image/')) {
        result = await renderImageToCanvas(file);
      } else {
        throw new Error('Please upload a PDF or image file (PNG, JPG).');
      }

      setProofCanvas(result.canvas);
      onStepChange('pick-die-line');
    } catch (err: any) {
      setError(err.message || 'Failed to load proof file.');
    } finally {
      setIsLoading(false);
    }
  }, [onStepChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ─── Draw proof on canvas ────────────────────────────────────────────
  useEffect(() => {
    if (!proofCanvas || !canvasRef.current) return;

    const container = canvasRef.current.parentElement!;
    const maxW = container.clientWidth - 16;
    const scale = Math.min(1, maxW / proofCanvas.width);
    const displayW = Math.floor(proofCanvas.width * scale);
    const displayH = Math.floor(proofCanvas.height * scale);

    canvasRef.current.width = displayW;
    canvasRef.current.height = displayH;

    const ctx = canvasRef.current.getContext('2d')!;
    if (previewMode === 'masked' && maskedCanvas) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, displayW, displayH);
      ctx.drawImage(maskedCanvas, 0, 0, displayW, displayH);
    } else {
      ctx.drawImage(proofCanvas, 0, 0, displayW, displayH);
    }
  }, [proofCanvas, maskedCanvas, previewMode]);

  // ─── Die line color picking ──────────────────────────────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPickerActive || !canvasRef.current || !proofCanvas) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = proofCanvas.width / canvasRef.current.width;
    const scaleY = proofCanvas.height / canvasRef.current.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const color = samplePixelColor(proofCanvas, x, y);
    setPickedColor(color);
    setIsPickerActive(false);

    // Run die line detection
    setIsLoading(true);
    setTimeout(() => {
      try {
        const result = detectDieLine(proofCanvas, color, 25);
        setMaskedCanvas(result.maskedCanvas);
        setPreviewMode('masked');

        // Convert pixel dimensions to mm
        const ppm = pixelsPerMm || 7.87; // fallback 200dpi
        const toMm = (px: number) => Math.round((px / ppm) * 10) / 10;

        const estimated = result.estimatedDimensions;
        const dims: BagDimensions = {
          totalWidth: toMm(result.dieLineBounds.width),
          totalHeight: toMm(result.dieLineBounds.height),
          frontWidth: toMm(estimated.frontWidth || result.dieLineBounds.width),
          leftGussetWidth: toMm(estimated.leftGussetWidth || 0),
          rightGussetWidth: toMm(estimated.rightGussetWidth || 0),
          topSealHeight: toMm(estimated.topSealHeight || result.dieLineBounds.height * 0.12),
          bottomSealHeight: toMm(estimated.bottomSealHeight || result.dieLineBounds.height * 0.08),
          bagDepth: toMm(estimated.bagDepth || result.dieLineBounds.width * 0.25),
          proofLayout: estimated.proofLayout || 'front-only',
        };

        const clampedDims = clampDimensions(dims, dims.totalWidth, dims.totalHeight) as BagDimensions;
        setLocalDims(clampedDims);
        onStepChange('confirm-dimensions');
        onProofReady(result.artworkCanvas, clampedDims, ppm);
      } catch (err: any) {
        setError(`Die line detection failed: ${err.message}. Try clicking directly on the die line.`);
      } finally {
        setIsLoading(false);
      }
    }, 50);
  }, [isPickerActive, proofCanvas, pixelsPerMm, onProofReady, onStepChange]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPickerActive || !canvasRef.current || !proofCanvas) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = proofCanvas.width / canvasRef.current.width;
    const scaleY = proofCanvas.height / canvasRef.current.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const hoveredColor = samplePixelColor(proofCanvas, x, y);
    setPickedColor(hoveredColor); // live preview of picked color
  }, [isPickerActive, proofCanvas]);

  const updateDim = useCallback((key: keyof BagDimensions, value: number | string) => {
    if (!localDims) return;
    const updated = { ...localDims, [key]: value };
    setLocalDims(updated);
    onDimensionsChange(updated);
  }, [localDims, onDimensionsChange]);

  const confirmDimensions = useCallback(() => {
    if (!localDims) return;
    onDimensionsChange(localDims);
    onStepChange('ready');
  }, [localDims, onDimensionsChange, onStepChange]);

  const resetProof = useCallback(() => {
    setProofCanvas(null);
    setMaskedCanvas(null);
    setPickedColor(null);
    setLocalDims(null);
    setPreviewMode('original');
    setError(null);
    onStepChange('upload');
  }, [onStepChange]);

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">

      {/* Step Indicator */}
      <div className="flex items-center gap-2 px-1">
        {(['upload', 'pick-die-line', 'confirm-dimensions', 'ready'] as ProofStep[]).map((s, i) => {
          const labels = ['Upload', 'Die Line', 'Dims', 'Ready'];
          const isDone = ['upload', 'pick-die-line', 'confirm-dimensions', 'ready'].indexOf(step) > i;
          const isActive = step === s;
          return (
            <div key={s} className="flex items-center gap-1 flex-1 min-w-0">
              <div className={`step-dot ${isActive ? 'active' : isDone ? 'done' : ''}`} />
              <span className={`text-xs ${isActive ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                {labels[i]}
              </span>
              {i < 3 && <div className="flex-1 h-px bg-border" />}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-950/50 border border-red-800 rounded p-3 text-xs text-red-300">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Upload Zone */}
      {step === 'upload' && (
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors relative"
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          data-testid="upload-zone"
        >
          {/* 
            File input uses label wrapping for maximum mobile compatibility.
            display:none breaks iOS Safari; sr-only keeps it accessible.
          */}
          <input
            ref={fileInputRef}
            id="proof-file-input"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf"
            className="sr-only"
            onChange={handleFileInput}
            data-testid="file-input"
          />
          {isLoading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Rendering proof...</p>
            </div>
          ) : (
            <label htmlFor="proof-file-input" className="flex flex-col items-center gap-3 cursor-pointer">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                <Upload size={22} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Drop your proof here</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, PNG, or JPG — die line must be visible</p>
              </div>
              <span className="tool-btn text-primary border-primary/40">Browse files</span>
            </label>
          )}
        </div>
      )}

      {/* Proof Preview + Die Line Picker */}
      {step !== 'upload' && proofCanvas && (
        <div className="flex flex-col gap-3">
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {step === 'pick-die-line' && (
              <button
                className={`tool-btn ${isPickerActive ? 'active' : ''}`}
                onClick={() => setIsPickerActive(!isPickerActive)}
                data-testid="btn-eyedropper"
              >
                <Crosshair size={13} />
                {isPickerActive ? 'Click die line…' : 'Pick Die Line'}
              </button>
            )}

            {maskedCanvas && (
              <button
                className="tool-btn"
                onClick={() => setPreviewMode(p => p === 'original' ? 'masked' : 'original')}
                data-testid="btn-preview-toggle"
              >
                {previewMode === 'masked' ? <Eye size={13} /> : <EyeOff size={13} />}
                {previewMode === 'masked' ? 'Show Original' : 'Show Masked'}
              </button>
            )}

            <button className="tool-btn ml-auto" onClick={resetProof} data-testid="btn-reset">
              <RotateCcw size={13} />
              Reset
            </button>
          </div>

          {/* Picked color swatch */}
          {pickedColor && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div
                className="w-4 h-4 rounded border border-border"
                style={{ background: `rgb(${pickedColor.r},${pickedColor.g},${pickedColor.b})` }}
              />
              <span>
                {isPickerActive ? 'Hover to preview · Click to set die line' : `Die line: RGB(${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b})`}
              </span>
            </div>
          )}

          {/* Canvas preview */}
          <div className="proof-canvas-container rounded overflow-hidden border border-border">
            {isLoading && (
              <div className="absolute inset-0 bg-card/80 flex items-center justify-center z-10 rounded">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <canvas
              ref={canvasRef}
              className={`w-full h-auto ${isPickerActive ? 'cursor-eyedropper' : 'cursor-default'}`}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              data-testid="proof-canvas"
            />
          </div>

          {step === 'pick-die-line' && !isPickerActive && !maskedCanvas && (
            <p className="text-xs text-muted-foreground text-center">
              Click "Pick Die Line" then click on the die line border in the proof above.
            </p>
          )}
        </div>
      )}

      {/* Dimension Editor */}
      {(step === 'confirm-dimensions' || step === 'ready') && localDims && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Ruler size={14} className="text-primary" />
            <h3 className="text-sm font-medium text-foreground">Detected Dimensions</h3>
            <span className="text-xs text-muted-foreground">(adjust if needed)</span>
            <button
              className="ml-auto tool-btn text-xs px-2 py-0.5"
              onClick={() => setDisplayUnit(u => u === 'in' ? 'mm' : 'in')}
              data-testid="btn-unit-toggle"
            >
              {displayUnit === 'in' ? 'in → mm' : 'mm → in'}
            </button>
          </div>

          <div className="bg-card border border-border rounded p-3 flex flex-col gap-2.5">
            {/* Proof layout selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-36">Proof Layout</label>
              <select
                value={localDims.proofLayout}
                onChange={e => updateDim('proofLayout', e.target.value)}
                className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                data-testid="select-proof-layout"
              >
                <option value="front-only">Front face only</option>
                <option value="front-back">Front + Back (side by side)</option>
                <option value="front-back-stacked">Front + Back (stacked)</option>
                <option value="full-wrap">Full wrap (all panels)</option>
              </select>
            </div>

            <div className="h-px bg-border" />

            <DimField label="Total Width" valueMm={localDims.totalWidth} onChangeMm={v => updateDim('totalWidth', v)} unit={displayUnit} />
            <DimField label="Total Height" valueMm={localDims.totalHeight} onChangeMm={v => updateDim('totalHeight', v)} unit={displayUnit} />
            <DimField label="Front Panel Width" valueMm={localDims.frontWidth} onChangeMm={v => updateDim('frontWidth', v)} unit={displayUnit} />
            <DimField label="Left Gusset" valueMm={localDims.leftGussetWidth} onChangeMm={v => updateDim('leftGussetWidth', v)} unit={displayUnit} />
            <DimField label="Right Gusset" valueMm={localDims.rightGussetWidth} onChangeMm={v => updateDim('rightGussetWidth', v)} unit={displayUnit} />

            <div className="h-px bg-border" />

            <DimField label="Top Seal / Closure" valueMm={localDims.topSealHeight} onChangeMm={v => updateDim('topSealHeight', v)} unit={displayUnit} />
            <DimField label="Bottom Seal" valueMm={localDims.bottomSealHeight} onChangeMm={v => updateDim('bottomSealHeight', v)} unit={displayUnit} />
            <DimField label="Bag Depth (filled)" valueMm={localDims.bagDepth} onChangeMm={v => updateDim('bagDepth', v)} unit={displayUnit} />
          </div>

          {step === 'confirm-dimensions' && (
            <button
              className="tool-btn active w-full justify-center"
              onClick={confirmDimensions}
              data-testid="btn-confirm-dims"
            >
              <CheckCircle size={14} />
              Confirm &amp; View 3D
            </button>
          )}

          {step === 'ready' && (
            <p className="text-xs text-muted-foreground text-center">
              Changes apply to the 3D view in real time.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
