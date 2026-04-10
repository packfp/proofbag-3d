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

const SEGMENTS = 32; // higher for smoother curves

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
  const bowAmount = depth * 0.4;

  // ─── UV regions ───────────────────────────────────────────────────
  const uvRegions = computeUVRegions(d);

  // ─── Front Panel ─────────────────────────────────────────────────
  const frontGeometry = createBowedPanel(
    w, bodyHeight, SEGMENTS,
    bowAmount,          // bow outward in +Z
    depth / 2,          // center Z offset
    uvRegions.front,
    fillState
  );

  // ─── Back Panel ──────────────────────────────────────────────────
  const backGeometry = createBowedPanel(
    w, bodyHeight, SEGMENTS,
    bowAmount,          // bow outward in -Z (will be flipped)
    -(depth / 2),       // center Z offset
    uvRegions.back,
    fillState
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
  // Tie sits around the gathered neck. bandRadius should roughly match the neckRadius.
  const neckR = Math.max(w * 0.06, 4) * Math.max(0.15, fillState) + 2;
  const tieGeometry = createTieGeometry(w, neckR, fillState);

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
 * Creates a bowed (inflated) panel geometry with organic curvature.
 * The panel faces +Z and bows outward by bowAmount at center.
 * Includes subtle edge taper and fill-dependent shape.
 */
function createBowedPanel(
  width: number,
  height: number,
  segments: number,
  bowAmount: number,
  zOffset: number,
  uvRegion: UVRegion,
  fillState: number
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segments, segments);
  const positions = geo.attributes.position as THREE.BufferAttribute;
  const uvs = geo.attributes.uv as THREE.BufferAttribute;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);

    // Normalized coordinates
    const nx = (x / (width / 2));   // -1 to 1
    const ny = (y / (height / 2));  // -1 to 1

    // Organic bow: elliptical cross-section that tapers at edges
    // Horizontal profile: smooth cosine curve (more rounded than parabolic)
    const hProfile = Math.cos(nx * Math.PI * 0.5);
    // Vertical profile: full in the middle, tapers at top (neck) and bottom (seal)
    const vTaper = smoothstep(ny, -1.0, -0.85) * smoothstep(ny, 1.0, 0.9);
    // Bottom region tapers more gradually for the seal area
    const bottomBulge = ny < -0.5 ? 1.0 - ((-0.5 - ny) / 0.5) * 0.3 : 1.0;

    const bowZ = bowAmount * hProfile * vTaper * bottomBulge;

    // Slight inward pinch at the side edges for realistic plastic fold
    const edgePinch = (1.0 - Math.abs(nx)) < 0.06 ? -bowAmount * 0.08 * fillState : 0;

    positions.setZ(i, zOffset + bowZ + edgePinch);

    // Remap UVs to the correct proof region
    const u = uvs.getX(i);
    const v = uvs.getY(i);
    const remappedU = uvRegion.uMin + u * (uvRegion.uMax - uvRegion.uMin);
    // V: proof top = bag top. Three.js UVs have V=0 at bottom, V=1 at top.
    const remappedV = (1 - v) * (uvRegion.vMax - uvRegion.vMin) + uvRegion.vMin;
    uvs.setXY(i, remappedU, 1 - remappedV);
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Smooth step function for organic transitions */
function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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

    const newX = xPosition;
    const newZ = x; // original X becomes Z
    positions.setXYZ(i, newX, y, newZ);

    let u = uvs.getX(i);
    if (side === 'right') u = 1 - u;
    const v = uvs.getY(i);
    const remappedU = uvRegion.uMin + u * (uvRegion.uMax - uvRegion.uMin);
    const remappedV = (1 - v) * (uvRegion.vMax - uvRegion.vMin) + uvRegion.vMin;
    uvs.setXY(i, remappedU, 1 - remappedV);
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geo.computeVertexNormals();

  if (side === 'left') {
    flipNormals(geo);
  }

  return geo;
}

/**
 * Creates a realistic gathered ponytail neck region.
 * The neck tapers from the rectangular bag body to a narrow oval/circular gather,
 * with subtle folds/wrinkles at the transition.
 */
function createNeckGeometry(
  bagWidth: number,
  depth: number,
  neckHeight: number,
  fillState: number
): THREE.BufferGeometry {
  const bodyHalfW = bagWidth / 2;
  const bodyHalfD = (depth * fillState) / 2;
  // The gathered neck radius — narrow where the tie cinches
  const neckRadius = Math.max(bagWidth * 0.06, 4) * Math.max(0.15, fillState) + 2;

  const rows = 16;  // vertical slices
  const cols = 24;  // around the circumference

  const vertices: number[] = [];
  const normals: number[] = [];
  const uvData: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= rows; row++) {
    const t = row / rows; // 0 = bottom (bag body), 1 = top (gathered tip)

    // Taper profile: starts rectangular, transitions to oval/circle
    // Use a smooth blend with most of the tapering in the lower 40%
    const blendT = smoothstep(t, 0.0, 0.45);
    // At t=0: full rectangular cross-section
    // At t=1: circular/oval cross-section at neckRadius

    for (let col = 0; col <= cols; col++) {
      const angle = (col / cols) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Rectangular cross-section (superellipse with n → ∞)
      // Approximate with a rounded rectangle using a superellipse
      const rectN = 3.0; // roundedness of rectangle corners (higher = sharper)
      const rectPower = 2.0 / rectN;
      const absCos = Math.pow(Math.abs(cosA), rectPower);
      const absSin = Math.pow(Math.abs(sinA), rectPower);
      const rectR = 1.0 / Math.pow(absCos + absSin, 1.0 / rectPower);

      // Rectangular extents at the base
      const baseRx = bodyHalfW * rectR * Math.abs(cosA) / Math.max(Math.abs(cosA), 0.001) || bodyHalfW;
      const baseRz = bodyHalfD * rectR * Math.abs(sinA) / Math.max(Math.abs(sinA), 0.001) || bodyHalfD;

      // Simpler approach: interpolate between rectangle and circle
      // Rectangle point
      const rectX = bodyHalfW * Math.sign(cosA) * Math.min(1, Math.abs(cosA) * 2.5);
      const rectZ = Math.max(bodyHalfD, 1.5) * Math.sign(sinA) * Math.min(1, Math.abs(sinA) * 2.5);
      // Actually use cos/sin for smooth blending:
      const rectXSmooth = bodyHalfW * cosA / Math.max(Math.abs(cosA), Math.abs(sinA));
      const rectZSmooth = Math.max(bodyHalfD, 1.5) * sinA / Math.max(Math.abs(cosA), Math.abs(sinA));

      // Circle point (gathered)
      const circX = neckRadius * cosA;
      const circZ = neckRadius * sinA;

      // Blend between rectangle and circle
      const x = rectXSmooth * (1 - blendT) + circX * blendT;
      const z = rectZSmooth * (1 - blendT) + circZ * blendT;

      // Subtle wrinkle/fold pattern in the transition zone
      const wrinkleFreq = 8;
      const wrinklePhase = angle * wrinkleFreq;
      const wrinkleAmount = Math.sin(wrinklePhase) * 0.06 * bagWidth * blendT * (1 - blendT) * 4;
      const wrinkledX = x + wrinkleAmount * cosA * 0.3;
      const wrinkledZ = z + wrinkleAmount * sinA * 0.3;

      // Height
      const y = t * neckHeight;

      vertices.push(wrinkledX, y, wrinkledZ);
      // Approximate normal
      normals.push(cosA, 0, sinA);
      uvData.push(col / cols, t);
    }
  }

  // Build triangle indices
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = row * (cols + 1) + col;
      const b = a + 1;
      const c = a + (cols + 1);
      const dd = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, dd);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvData, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

/**
 * Creates a torus ring for the twist-tie / neck tape.
 * Geometry centered at origin — positioning done by the caller.
 */
function createTieGeometry(
  bagWidth: number,
  neckRadius: number,
  fillState: number
): THREE.BufferGeometry {
  const tubeRadius = Math.max(bagWidth * 0.015, 1.5) * Math.max(0.3, fillState) + 0.8;
  const bandRadius = Math.max(neckRadius * 1.15, 5); // slightly larger than neck

  const geo = new THREE.TorusGeometry(
    bandRadius,
    tubeRadius,
    12,
    32
  );
  // No position offset — kept at origin, positioned via mesh.position
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
