// 3D Bag Viewer — Pure Three.js with React ref-based scene management.

import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BagDimensions, ClosureType } from '../../../shared/schema';
import { createBagMeshData, MM_TO_SCENE } from '../lib/bagGeometry';

interface BagViewerProps {
  artworkCanvas: HTMLCanvasElement | null;
  dimensions: BagDimensions | null;
  fillState: number;
  closureType: ClosureType;
  showDangerZones: boolean;
  showFoldLines: boolean;
  onExportReady?: (exportFn: () => string) => void;
}

export default function BagViewer({
  artworkCanvas, dimensions, fillState, closureType,
  showDangerZones, showFoldLines, onExportReady,
}: BagViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const bagGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const width = mount.clientWidth || 900;
    const height = mount.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d1117');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 200);
    camera.position.set(2, 0, 5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.5;
    controls.maxDistance = 50;
    controls.enablePan = true;
    controls.maxPolarAngle = Math.PI * 0.85;
    controlsRef.current = controls;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.3);
    dir1.position.set(5, 8, 7);
    dir1.castShadow = true;
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dir2.position.set(-4, 4, -5);
    scene.add(dir2);
    const pt = new THREE.PointLight(0x00c2cb, 0.5, 20);
    pt.position.set(0, -3, 4);
    scene.add(pt);

    // Grid
    const grid = new THREE.GridHelper(12, 24, 0x18232f, 0x111a24);
    grid.position.y = -1.2;
    scene.add(grid);

    // Bag group
    const bagGroup = new THREE.Group();
    scene.add(bagGroup);
    bagGroupRef.current = bagGroup;

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    if (onExportReady) {
      onExportReady(() => {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      });
    }

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const group = bagGroupRef.current;
    if (!group) return;

    // Clear existing meshes
    group.clear();

    if (!dimensions) {
      const geo = new THREE.BoxGeometry(0.8, 1.4, 0.15);
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, wireframe: true });
      group.add(new THREE.Mesh(geo, mat));
      return;
    }

    // Update texture from artwork canvas
    if (artworkCanvas) {
      if (textureRef.current) textureRef.current.dispose();
      const tex = new THREE.CanvasTexture(artworkCanvas);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      textureRef.current = tex;
    }

    buildBag(group, dimensions, fillState, closureType, textureRef.current, showDangerZones, showFoldLines);

    // Fit camera to bag — pull back far enough to see full bag with headroom
    const h = dimensions.totalHeight * MM_TO_SCENE;
    const w = dimensions.frontWidth * MM_TO_SCENE;
    const maxDim = Math.max(h, w);
    // Use FOV to compute exact distance needed for bag to fill ~70% of height
    const camera = cameraRef.current!;
    const fovRad = (camera.fov * Math.PI) / 180;
    const neededDist = (h * 0.5) / Math.tan(fovRad / 2) * 1.55;
    const dist = Math.max(neededDist, maxDim * 3.5);
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(dist * 0.18, maxDim * 0.08, dist);
      cameraRef.current.lookAt(0, 0, 0);
      controlsRef.current.update();
    }
  }, [dimensions, fillState, closureType, artworkCanvas, showDangerZones, showFoldLines]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />;
}

// ─── Bag Builder ──────────────────────────────────────────────────────────────

function buildBag(
  group: THREE.Group,
  d: BagDimensions,
  fillState: number,
  closureType: ClosureType,
  texture: THREE.CanvasTexture | null,
  showDangerZones: boolean,
  showFoldLines: boolean
) {
  const s = MM_TO_SCENE;
  const { frontGeometry, backGeometry, leftGussetGeometry, rightGussetGeometry,
    neckGeometry, tieGeometry } = createBagMeshData({ dimensions: d, fillState });

  const artMat = new THREE.MeshStandardMaterial({
    map: texture ?? null,
    color: texture ? 0xffffff : 0xd0dce8,
    side: THREE.FrontSide,
    roughness: 0.18,
    metalness: 0.04,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0xb0bec8,
    side: THREE.DoubleSide,
    roughness: 0.35,
    transparent: true,
    opacity: 0.72,
  });
  const neckMat = new THREE.MeshStandardMaterial({
    color: 0xc8d8e4,
    side: THREE.DoubleSide,
    roughness: 0.5,
    transparent: true,
    opacity: 0.55,
  });
  const tieMat = new THREE.MeshStandardMaterial({
    color: closureType === 'ponytail-tape' ? 0xc8a840 :
           closureType === 'ponytail-twist' ? 0x445566 :
           closureType === 'heat-seal' ? 0x607080 : 0x00c2cb,
    roughness: 0.55,
    metalness: 0.12,
  });

  // All geometry is in mm units; scale in the mesh
  // Position everything so bag is centered at y=0 in world space
  // Body goes from 0 to bodyHeight in local mm, then centered
  const bodyH = d.totalHeight - d.topSealHeight;
  const halfTotal = d.totalHeight / 2;

  // Front panel: PlaneGeometry centered at origin, spans bodyH height
  // We want it to span from -halfTotal to -halfTotal + bodyH in world Y
  // So mesh center in local mm: -halfTotal + bodyH/2
  const frontCenterY = (-halfTotal + bodyH / 2) * s;

  const frontMesh = new THREE.Mesh(frontGeometry, artMat);
  frontMesh.scale.setScalar(s);
  frontMesh.position.y = frontCenterY;
  frontMesh.castShadow = true;
  frontMesh.receiveShadow = true;
  group.add(frontMesh);

  const backMesh = new THREE.Mesh(backGeometry, artMat.clone());
  backMesh.scale.setScalar(s);
  backMesh.position.y = frontCenterY;
  group.add(backMesh);

  if (leftGussetGeometry) {
    const lm = new THREE.Mesh(leftGussetGeometry, sideMat);
    lm.scale.setScalar(s); lm.position.y = frontCenterY; group.add(lm);
  }
  if (rightGussetGeometry) {
    const rm = new THREE.Mesh(rightGussetGeometry, sideMat.clone());
    rm.scale.setScalar(s); rm.position.y = frontCenterY; group.add(rm);
  }

  // Neck: starts at top of body, goes to top of bag
  // Top of body in world Y = -halfTotal*s + bodyH*s = (bodyH - halfTotal)*s
  const neckBottomY = (bodyH - halfTotal) * s;
  const neckMesh = new THREE.Mesh(neckGeometry, neckMat);
  neckMesh.scale.setScalar(s);
  neckMesh.position.y = neckBottomY;
  group.add(neckMesh);

  // Tie: somewhere in the neck region
  const tieY = neckBottomY + d.topSealHeight * 0.55 * s;
  const tieMesh = new THREE.Mesh(tieGeometry, tieMat);
  tieMesh.scale.setScalar(s);
  tieMesh.rotation.x = Math.PI / 2;
  tieMesh.position.y = tieY;
  group.add(tieMesh);

  // Bottom seal plate
  const bsDepth = Math.max(d.bagDepth * fillState, 1);
  const bsGeo = new THREE.PlaneGeometry(d.frontWidth * s, bsDepth * s);
  const bsMat = new THREE.MeshStandardMaterial({ color: 0x909aaa, roughness: 0.4, transparent: true, opacity: 0.5 });
  const bsMesh = new THREE.Mesh(bsGeo, bsMat);
  bsMesh.rotation.x = -Math.PI / 2;
  bsMesh.position.y = -halfTotal * s;
  group.add(bsMesh);

  // ── Danger Zones ────────────────────────────────────────────────
  if (showDangerZones) {
    const zFront = (d.bagDepth * fillState / 2 + 1) * s;

    // Top closure zone (blue)
    const tzGeo = new THREE.PlaneGeometry(d.frontWidth * s, d.topSealHeight * s);
    const tzMat = new THREE.MeshBasicMaterial({ color: 0x0099dd, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide });
    const tzMesh = new THREE.Mesh(tzGeo, tzMat);
    tzMesh.position.set(0, (halfTotal - d.topSealHeight / 2) * s, zFront);
    tzMesh.renderOrder = 1;
    group.add(tzMesh);

    // Bottom seal zone (red)
    const bzGeo = new THREE.PlaneGeometry(d.frontWidth * s, d.bottomSealHeight * s);
    const bzMat = new THREE.MeshBasicMaterial({ color: 0xee3333, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide });
    const bzMesh = new THREE.Mesh(bzGeo, bzMat);
    bzMesh.position.set(0, (-halfTotal + d.bottomSealHeight / 2) * s, zFront);
    bzMesh.renderOrder = 1;
    group.add(bzMesh);
  }

  // ── Fold Lines ───────────────────────────────────────────────────
  if (showFoldLines && d.leftGussetWidth > 0) {
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffcc00 });
    const zFront = (d.bagDepth * fillState / 2 + 1.5) * s;
    const yBot = -halfTotal * s;
    const yTop = (halfTotal) * s;

    const makeVL = (x: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, yBot, zFront),
        new THREE.Vector3(x, yTop, zFront),
      ]);
      return new THREE.Line(geo, lineMat);
    };

    group.add(makeVL(-d.frontWidth / 2 * s));
    group.add(makeVL(d.frontWidth / 2 * s));
  }
}
