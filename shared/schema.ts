// Types for the Bag Proof 3D Visualizer
// No database needed — all processing is client-side

export interface BagDimensions {
  // All values in millimeters
  totalWidth: number;       // total width of the proof die line
  totalHeight: number;      // total height of the proof die line
  frontWidth: number;       // width of the printable front panel
  leftGussetWidth: number;  // width of left gusset (0 if no gusset)
  rightGussetWidth: number; // width of right gusset (0 if no gusset)
  topSealHeight: number;    // height of top seal / closure zone
  bottomSealHeight: number; // height of bottom seal zone
  bagDepth: number;         // physical depth of filled bag (= gusset * 2)
  proofLayout: ProofLayout;
}

export type ProofLayout = 
  | 'front-only'     // proof shows just the front face
  | 'front-back'     // proof shows front (left half) + back (right half)
  | 'full-wrap';     // proof shows all panels: back | gusset | front | gusset (or similar)

export type ClosureType = 
  | 'ponytail-tape'   // neck tape tie / neck tie
  | 'ponytail-twist'  // twist tie
  | 'heat-seal'       // heat sealed top
  | 'quick-lock'      // press-to-close recloseable
  | 'zip-lock';       // zipper

export type BagType =
  | 'ponytail-poly'   // side-gusseted poly bag with gathered neck
  | 'pillow-pack'     // 3-side heat sealed, pillow shape
  | 'stand-up-pouch'  // doypack / stand-up with bottom gusset
  | 'flat-bottom';    // box/block bottom pouch

export interface ProofData {
  originalCanvas: HTMLCanvasElement;
  maskedCanvas: HTMLCanvasElement;      // die-line masked artwork only
  dieLineColor: { r: number; g: number; b: number };
  dieLineBounds: { x: number; y: number; width: number; height: number };
  pixelsPerMm: number;                  // scale factor from PDF
  dimensions: BagDimensions;
}

export interface VisualizerState {
  step: 'upload' | 'pick-die-line' | 'confirm-dimensions' | 'viewing';
  proofData: ProofData | null;
  bagType: BagType;
  closureType: ClosureType;
  fillState: number;  // 0 = empty/flat, 1 = fully filled
  dimensions: BagDimensions | null;
  showDangerZones: boolean;
  showFoldLines: boolean;
}
