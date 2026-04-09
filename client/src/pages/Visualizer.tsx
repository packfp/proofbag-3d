// Main Visualizer Page — Split layout: proof panel (left) + 3D viewer (right)

import { useState, useCallback, useRef } from 'react';
import { Download, Layers, Eye, EyeOff, RotateCcw, Info } from 'lucide-react';
import type { BagDimensions, ClosureType, BagType } from '../../../shared/schema';
import ProofPanel, { type ProofStep } from '../components/ProofPanel';
import BagViewer from '../components/BagViewer';

// ─── Logo ─────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <svg
      aria-label="ProofBag 3D"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-7 h-7"
    >
      {/* Bag silhouette */}
      <rect x="6" y="10" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      {/* Neck */}
      <path d="M12 10 C12 7 14 5.5 16 5.5 C18 5.5 20 7 20 10" stroke="currentColor" strokeWidth="1.8" fill="none" />
      {/* Tie band */}
      <rect x="10" y="4" width="12" height="3" rx="1.5" fill="currentColor" opacity="0.8" />
      {/* 3D lines */}
      <line x1="6" y1="10" x2="3" y2="14" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <line x1="26" y1="10" x2="29" y2="14" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <line x1="3" y1="14" x2="3" y2="30" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
    </svg>
  );
}

// ─── Closure Selector ─────────────────────────────────────────────────────────

const CLOSURE_OPTIONS: { value: ClosureType; label: string }[] = [
  { value: 'ponytail-tape', label: 'Neck Tape' },
  { value: 'ponytail-twist', label: 'Twist Tie' },
  { value: 'heat-seal', label: 'Heat Seal' },
  { value: 'quick-lock', label: 'Quick Lock' },
  { value: 'zip-lock', label: 'Zip Lock' },
];

// ─── Export Controls ──────────────────────────────────────────────────────────

function ExportPanel({ onExport, isReady }: { onExport: () => void; isReady: boolean }) {
  return (
    <button
      className="tool-btn"
      onClick={onExport}
      disabled={!isReady}
      title="Export hero image (2560px, white background)"
      data-testid="btn-export"
    >
      <Download size={13} />
      Export Hero Image
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Visualizer() {
  const [step, setStep] = useState<ProofStep>('upload');
  const [artworkCanvas, setArtworkCanvas] = useState<HTMLCanvasElement | null>(null);
  const [dimensions, setDimensions] = useState<BagDimensions | null>(null);
  const [pixelsPerMm, setPixelsPerMm] = useState(7.87);
  const [fillState, setFillState] = useState(0.8);
  const [closureType, setClosureType] = useState<ClosureType>('ponytail-tape');
  const [showDangerZones, setShowDangerZones] = useState(true);
  const [showFoldLines, setShowFoldLines] = useState(true);

  const exportFnRef = useRef<(() => string) | null>(null);

  const handleProofReady = useCallback((canvas: HTMLCanvasElement, dims: BagDimensions, ppm: number) => {
    setArtworkCanvas(canvas);
    setDimensions(dims);
    setPixelsPerMm(ppm);
  }, []);

  const handleDimensionsChange = useCallback((dims: BagDimensions) => {
    setDimensions(dims);
  }, []);

  const handleExport = useCallback(() => {
    if (!exportFnRef.current) return;

    // Trigger a high-res render on a separate canvas
    const dataUrl = exportFnRef.current();
    if (!dataUrl) return;

    // Create 2560px export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 2560;
    exportCanvas.height = 2560;
    const ctx = exportCanvas.getContext('2d')!;

    // White background (Amazon requirement)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 2560, 2560);

    const img = new Image();
    img.onload = () => {
      // Center and scale to fill ~85% of frame (Amazon standard)
      const scale = Math.min(2560 * 0.85 / img.width, 2560 * 0.85 / img.height);
      const x = (2560 - img.width * scale) / 2;
      const y = (2560 - img.height * scale) / 2;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

      const link = document.createElement('a');
      link.download = `bag-hero-${Date.now()}.png`;
      link.href = exportCanvas.toDataURL('image/png');
      link.click();
    };
    img.src = dataUrl;
  }, []);

  const isViewingReady = step === 'ready';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Top Bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 text-primary">
          <Logo />
          <div>
            <span className="text-sm font-semibold text-foreground">ProofBag</span>
            <span className="text-xs text-muted-foreground ml-1.5">3D Pre-Press Visualizer</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Controls — only show when viewing */}
        {isViewingReady && (
          <>
            {/* Closure selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Closure:</span>
              {CLOSURE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`tool-btn py-1 px-2.5 text-xs ${closureType === opt.value ? 'active' : ''}`}
                  onClick={() => setClosureType(opt.value)}
                  data-testid={`closure-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-border" />

            {/* Overlay toggles */}
            <button
              className={`tool-btn ${showDangerZones ? 'active' : ''}`}
              onClick={() => setShowDangerZones(z => !z)}
              title="Toggle seal/closure danger zone overlays"
              data-testid="btn-danger-zones"
            >
              <Layers size={13} />
              Seal Zones
            </button>

            <button
              className={`tool-btn ${showFoldLines ? 'active' : ''}`}
              onClick={() => setShowFoldLines(f => !f)}
              title="Toggle fold line indicators"
              data-testid="btn-fold-lines"
            >
              {showFoldLines ? <Eye size={13} /> : <EyeOff size={13} />}
              Fold Lines
            </button>

            <div className="w-px h-5 bg-border" />

            <ExportPanel onExport={handleExport} isReady={isViewingReady} />
          </>
        )}
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Proof upload, die line, dimensions */}
        <aside className="w-80 flex-shrink-0 border-r border-border p-4 overflow-y-auto">
          <ProofPanel
            step={step}
            onStepChange={setStep}
            onProofReady={handleProofReady}
            onDimensionsChange={handleDimensionsChange}
            dimensions={dimensions}
            pixelsPerMm={pixelsPerMm}
          />
        </aside>

        {/* Right Panel — 3D Viewer */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {/* 3D Canvas */}
          <div className="flex-1 min-h-0">
            <BagViewer
              artworkCanvas={isViewingReady ? artworkCanvas : null}
              dimensions={isViewingReady ? dimensions : null}
              fillState={fillState}
              closureType={closureType}
              showDangerZones={showDangerZones}
              showFoldLines={showFoldLines}
              onExportReady={fn => { exportFnRef.current = fn; }}
            />
          </div>

          {/* Empty state overlay */}
          {step !== 'ready' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-center opacity-30">
                <div className="text-5xl text-primary mb-3 flex justify-center">
                  <Logo />
                </div>
                <p className="text-sm text-muted-foreground">
                  {step === 'upload' && 'Upload a proof to begin'}
                  {step === 'pick-die-line' && 'Pick the die line color'}
                  {step === 'confirm-dimensions' && 'Confirm dimensions to view 3D'}
                </p>
              </div>
            </div>
          )}

          {/* Fill State Slider — bottom of 3D view */}
          {isViewingReady && (
            <div className="flex items-center gap-3 px-5 py-3 border-t border-border bg-card/40 backdrop-blur flex-shrink-0">
              <span className="text-xs text-muted-foreground w-16">Empty</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={fillState}
                onChange={e => setFillState(parseFloat(e.target.value))}
                className="flex-1"
                title="Fill state — drag to simulate bag being filled"
                data-testid="slider-fill"
              />
              <span className="text-xs text-muted-foreground w-12 text-right">Filled</span>
              <span className="text-xs text-primary font-medium w-10 text-right">
                {Math.round(fillState * 100)}%
              </span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
