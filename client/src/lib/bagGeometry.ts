// Parametric 3D Bag Geometry
// Generates Three.js BufferGeometry for a side-gusseted ponytail poly bag
// with accurate UV mapping from the proof artwork.

import * as THREE from 'three';
import type { BagDimensions, ProofLayout } from '../../../shared/schema';

export interface BagGeometryParams {
  dimensions: BagDimensions;
  fillState: number;  // 0 = flat/empty, 1 = fully filled
}

export interface BagMeshData {
  frontGeometry: THREE.BufferGeometry;
  backGeometry: THREE.BufferGeometry;
  leftGussetGeometry: THREE.BufferGeometry | null;
  rightGussetGeometry: THREE.BufferGeometry | null;
  neckGeometry: THREE.BufferGeometry;
  tieGeometry: THREE.BufferGeometry;
  bottomGeometry: THREE.BufferGeometry;
  // UV regions for each face (normalized 0-1 within the proof texture)
  uvRegions: {
    front: UVRegion;
    back: UVRegion;
    leftGusset: UVRegion | null;
    rightGusset: UVRegion | null;
  };
}

export interface UVRegion {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

const SEGMENTS = 20; // subdivisions for smooth inflation

/**
 * Creates the bag geometry components based on dimensions and fill state.
 * All geometry is in "bag space" units (1 unit = 1mm for scale consistency).
 * Scale down in the scene to fit viewport.
 */
export function createBagMeshData(params: BagGeometryParams): BagMeshData {
  const { dimensions: d, fillState } = params;

  // The normalized bag body dimensions used for geometry
  const w = d.frontWidth;       // front panel width (mm)
  const h = d.totalHeight;      // total height (mm)
  const gL = d.leftGussetWidth; // left gusset (mm)
  const gR = d.rightGussetWidth;// right gusset (mm)
  const depth = d.bagDepth * fillState; // depth increases with fill
  const topSeal = d.topSealHeight;
  const bottomSeal = d.bottomSealHeight;

  // Body height (below neck)
  const bodyHeight = h - topSeal;

  // How much the front/back panels bow outward with fill
  const bowAmount = depth * 0.35;

  // ─── UV regions ───────────────────────────────────────────────────
  const uvRegions = computeUVRegions(d);

  // ─── Front Panel ─────────────────────────────────────────────────
  const frontGeometry = createBowedPanel(
    w, bodyHeight, SEGMENTS,
    bowAmount,          // bow outward in +Z
    depth / 2,          // center Z offset
    uvRegions.front
  );

  // ─── Back Panel ──────────────────────────────────────────────────
  const backGeometry = createBowedPanel(
    w, bodyHeight, SEGMENTS,
    bowAmount,          // bow outward in -Z (will be flipped)
    -(depth / 2),       // center Z offset
    uvRegions.back
  );
  // Flip normals for back panel
  flipNormals(backGeometry);

  // ─── Left Gusset ─────────────────────────────────────────────────
  let leftGussetGeometry: THREE.BufferGeometry | null = null;
  if (gL > 0 && fillState > 0.01) {
    leftGussetGeometry = createGussetPanel(
      depth, bodyHeight, SEGMENTS,
      -(w / 2),         // X position (left side)
      'left',
      uvRegions.leftGusset!
    );
  }

  // ─── Right Gusset ────────────────────────────────────────────────
  let rightGussetGeometry: THREE.BufferGeometry | null = null;
  if (gR > 0 && fillState > 0.01) {
    rightGussetGeometry = createGussetPanel(
      depth, bodyHeight, SEGMENTS,
      w / 2,            // X position (right side)
      'right',
      uvRegions.rightGusset!
    );
  }

  // ─── Neck / Ponytail Region ───────────────────────────────────────
  const neckGeometry = createNeckGeometry(w, depth, topSeal, fillState);

  // ─── Tie Band ────────────────────────────────────────────────────
  const tieGeometry = createTieGeometry(w, depth, bodyHeight + topSeal * 0.7, fillState);

  // ─── Bottom Seal ─────────────────────────────────────────────────
  const bottomGeometry = createBottomGeometry(w, depth, fillState);

  return {
    frontGeometry,
    backGeometry,
    leftGussetGeometry,
    rightGussetGeometry,
    neckGeometry,
    tieGeometry,
    bottomGeometry,
    uvRegions,
  };
}

/**
 * Computes UV regions for each bag face based on proof layout.
 */
function computeUVRegions(d: BagDimensions): {
  front: UVRegion;
  back: UVRegion;
  leftGusset: UVRegion | null;
  rightGusset: UVRegion | null;
} {
  const totalW = d.totalWidth;
  const totalH = d.totalHeight;

  if (d.proofLayout === 'full-wrap') {
    // Layout: [back][leftGusset][front][rightGusset]  (one common layout)
    // Or:     [leftGusset][front][rightGusset][back]
    const gL = d.leftGussetWidth;
    const gR = d.rightGussetWidth;
    const fw = d.frontWidth;
    const bw = totalW - gL - gR - fw;

    return {
      leftGusset: { uMin: 0, uMax: gL / totalW, vMin: 0, vMax: 1 },
      front: { uMin: gL / totalW, uMax: (gL + fw) / totalW, vMin: 0, vMax: 1 },
      rightGusset: { uMin: (gL + fw) / totalW, uMax: (gL + fw + gR) / totalW, vMin: 0, vMax: 1 },
      back: { uMin: (gL + fw + gR) / totalW, uMax: 1, vMin: 0, vMax: 1 },
    };
  } else if (d.proofLayout === 'front-back') {
    // Layout: [front (left half)][back (right half)] — side by side
    return {
      front: { uMin: 0, uMax: 0.5, vMin: 0, vMax: 1 },
      back: { uMin: 0.5, uMax: 1, vMin: 0, vMax: 1 },
      leftGusset: null,
      rightGusset: null,
    };
  } else if (d.proofLayout === 'front-back-stacked') {
    // Layout: [front (top half)] / [back (bottom half)] — stacked vertically
    return {
      front: { uMin: 0, uMax: 1, vMin: 0, vMax: 0.5 },
      back: { uMin: 0, uMax: 1, vMin: 0.5, vMax: 1 },
      leftGusset: null,
      rightGusset: null,
    };
  } else {
    // front-only: entire texture is the front face
    return {
      front: { uMin: 0, uMax: 1, vMin: 0, vMax: 1 },
      back: { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }, // mirror same artwork
      leftGusset: null,
      rightGusset: null,
    };
  }
}

/**
 * Creates a bowed (slightly inflated) panel geometry.
 * The panel faces +Z and bows outward by bowAmount at center.
 */
function createBowedPanel(
  width: number,
  height: number,
  segments: number,
  bowAmount: number,
  zOffset: number,
  uvRegion: UVRegion
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segments, segments);
  const positions = geo.attributes.position as THREE.BufferAttribute;
  const uvs = geo.attributes.uv as THREE.BufferAttribute;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);

    // Bow effect: sine-based displacement in Z, max at center
    const nx = (x / (width / 2));  // normalized -1 to 1
    const ny = (y / (height / 2)); // normalized -1 to 1
    const bowZ = bowAmount * (1 - nx * nx) * (1 - ny * ny * 0.5);

    positions.setZ(i, zOffset + bowZ);

    // Remap UVs to the correct proof region
    const u = uvs.getX(i);
    const v = uvs.getY(i);
    const remappedU = uvRegion.uMin + u * (uvRegion.uMax - uvRegion.uMin);
    // V: proof top = bag top. Three.js UVs have V=0 at bottom, V=1 at top.
    // Proof images have Y=0 at top. Flip V.
    const remappedV = (1 - v) * (uvRegion.vMax - uvRegion.vMin) + uvRegion.vMin;
    uvs.setXY(i, remappedU, 1 - remappedV);
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a gusset side panel (vertical, perpendicular to front/back panels).
 */
function createGussetPanel(
  depth: number,
  height: number,
  segments: number,
  xPosition: number,
  side: 'left' | 'right',
  uvRegion: UVRegion
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(depth, height, segments, Math.floor(segments / 2));
  const positions = geo.attributes.position as THREE.BufferAttribute;
  const uvs = geo.attributes.uv as THREE.BufferAttribute;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);

    // The gusset lies in the XZ plane (perpendicular to front panel)
    // Rotate 90° so it connects front and back
    const newX = xPosition;
    const newZ = x; // original X becomes Z
    positions.setXYZ(i, newX, y, newZ);

    // Remap UVs to the gusset UV region
    // For gusset: U goes from 0 at front edge to 1 at back edge
    let u = uvs.getX(i);
    if (side === 'right') u = 1 - u; // flip for right side
    const v = uvs.getY(i);
    const remappedU = uvRegion.uMin + u * (uvRegion.uMax - uvRegion.uMin);
    const remappedV = (1 - v) * (uvRegion.vMax - uvRegion.vMin) + uvRegion.vMin;
    uvs.setXY(i, remappedU, 1 - remappedV);
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geo.computeVertexNormals();

  // Flip normals so they face outward (correct side to face the viewer)
  if (side === 'left') {
    flipNormals(geo);
  }

  return geo;
}

/**
 * Creates the neck/ponytail region — tapers from bag width to a narrow neck.
 */
function createNeckGeometry(
  bagWidth: number,
  depth: number,
  neckHeight: number,
  fillState: number
): THREE.BufferGeometry {
  const neckRadius = (bagWidth * 0.08 + depth * 0.05) * Math.max(0.1, fillState);
  const baseWidth = bagWidth;
  const baseDepth = depth * fillState;

  // Create a simple tapered prism for the neck
  const points: THREE.Vector2[] = [];
  const neckTop = neckRadius * 1.2;

  // Profile for lathe won't work for a rectangular bag...
  // Instead, use a custom geometry that tapers from rectangle to circle
  const geo = new THREE.CylinderGeometry(
    neckRadius,
    Math.max(baseWidth * 0.35, neckRadius),
    neckHeight,
    12,
    1,
    true
  );

  // Position at top of bag body
  const positions = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, positions.getY(i) + neckHeight / 2);
  }
  positions.needsUpdate = true;

  // Neck UVs don't map to the artwork — they'll use a transparent/bag material
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a small cylinder geometry for the twist-tie / neck tape.
 */
function createTieGeometry(
  bagWidth: number,
  depth: number,
  yPosition: number,
  fillState: number
): THREE.BufferGeometry {
  const tieRadius = bagWidth * 0.04 * Math.max(0.3, fillState) + 1;
  const geo = new THREE.TorusGeometry(
    Math.max(bagWidth * 0.08, 3),
    tieRadius,
    8,
    20
  );

  // Position the tie at neck height
  const positions = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, positions.getY(i) + yPosition);
  }
  positions.needsUpdate = true;
  return geo;
}

/**
 * Creates a flat bottom geometry for the bag.
 */
function createBottomGeometry(
  width: number,
  depth: number,
  fillState: number
): THREE.BufferGeometry {
  const actualDepth = depth * fillState;
  const geo = new THREE.PlaneGeometry(width, Math.max(actualDepth, 1), 10, 5);
  const positions = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getY(i); // PlaneGeometry Y becomes Z
    positions.setXYZ(i, x, 0, z);
  }
  positions.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Flips the normals of a geometry (reverses face winding).
 */
function flipNormals(geo: THREE.BufferGeometry): void {
  const index = geo.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const c = index.getX(i + 2);
      index.setX(i, c);
      index.setX(i + 2, a);
    }
    index.needsUpdate = true;
  }
  const normals = geo.attributes.normal as THREE.BufferAttribute;
  if (normals) {
    for (let i = 0; i < normals.count; i++) {
      normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
    }
    normals.needsUpdate = true;
  }
}

/**
 * Scale factor: convert from mm to Three.js scene units.
 * We use 1 unit = 1mm, then apply a global scale of 0.01 in the scene.
 */
export const MM_TO_SCENE = 0.01;
