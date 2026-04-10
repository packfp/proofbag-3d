// 3D Bag Viewer — Pure Three.js with React ref-based scene management.
// Studio-quality rendering with PBR materials, environment reflections, and soft shadows.

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

/**
 * Generate a soft studio HDRI-like environment map procedurally.
 * Creates multiple softbox panels for realistic packaging reflections.
 */
function createStudioEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  // Gradient dome — warm highlights, cool shadows
  const gradientGeo = new THREE.SphereGeometry(100, 64, 64);
  const gradientMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0.92, 0.94, 1.0) },
      midColor: { value: new THREE.Color(0.50, 0.52, 0.58) },
      bottomColor: { value: new THREE.Color(0.15, 0.17, 0.22) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos);
        float h = dir.y;
        vec3 col;
        if (h > 0.0) {
          col = mix(midColor, topColor, smoothstep(0.0, 0.8, h));
        } else {
          col = mix(midColor, bottomColor, smoothstep(0.0, -0.5, h));
        }
        
        // Main softbox — large overhead panel
        float mainPanel = smoothstep(0.25, 0.6, h) * smoothstep(0.85, 0.6, h);
        mainPanel *= smoothstep(0.5, 0.0, abs(dir.x));
        col += vec3(0.55) * mainPanel;
        
        // Fill softbox from the left
        float fillPanel = smoothstep(-0.05, 0.25, h) * smoothstep(0.55, 0.25, h);
        float fillX = dir.x;
        fillPanel *= smoothstep(-0.7, -0.2, fillX) * smoothstep(0.1, -0.2, fillX);
        col += vec3(0.2) * fillPanel;
        
        // Strip light from behind-right (rim definition)
        float rimStrip = smoothstep(0.0, 0.3, h) * smoothstep(0.6, 0.3, h);
        rimStrip *= smoothstep(0.3, 0.7, dir.x) * smoothstep(1.0, 0.7, dir.x);
        float rimZ = dir.z;
        rimStrip *= smoothstep(0.0, -0.3, rimZ);
        col += vec3(0.25) * rimStrip;

        // Floor bounce — subtle warm reflection
        float bounce = smoothstep(-0.1, -0.4, h) * smoothstep(-0.7, -0.4, h);
        col += vec3(0.12, 0.10, 0.08) * bounce;
        
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(gradientGeo, gradientMat));

  const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
  pmremGenerator.dispose();
  gradientGeo.dispose();
  gradientMat.dispose();

  return envMap;
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
  const envMapRef = useRef<THREE.Texture | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const width = mount.clientWidth || 900;
    const height = mount.clientHeight || 600;

    // ─── Scene ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e1319');
    sceneRef.current = scene;

    // ─── Camera ───────────────────────────────────────────────────────
    // Product photography angle: slightly above, looking slightly down
    const camera = new THREE.PerspectiveCamera(28, width / height, 0.01, 200);
    camera.position.set(0, 2.5, 8);
    camera.lookAt(0, 1.0, 0);
    cameraRef.current = camera;

    // ─── Renderer ─────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── Environment Map ──────────────────────────────────────────────
    const envMap = createStudioEnvMap(renderer);
    envMapRef.current = envMap;
    scene.environment = envMap;

    // ─── Controls ─────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.5;
    controls.maxDistance = 50;
    controls.enablePan = true;
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.target.set(0, 1.0, 0);
    controlsRef.current = controls;

    // ─── Lights (3-point studio setup) ────────────────────────────────
    // Low ambient — let env map handle fill
    scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    // Key light — warm, from upper-right-front
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.5);
    keyLight.position.set(5, 10, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 40;
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -2;
    keyLight.shadow.bias = -0.001;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 6; // soft shadow
    scene.add(keyLight);

    // Fill light — cool, from left
    const fillLight = new THREE.DirectionalLight(0xd8e4ff, 0.6);
    fillLight.position.set(-6, 5, -2);
    scene.add(fillLight);

    // Rim/back light — edge definition from behind
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.2);
    rimLight.position.set(-2, 4, -8);
    scene.add(rimLight);

    // Subtle ground bounce
    const bounceLight = new THREE.PointLight(0xe0dcd4, 0.2, 20);
    bounceLight.position.set(0, -0.5, 3);
    scene.add(bounceLight);

    // ─── Ground Plane ─────────────────────────────────────────────────
    // Dark, slightly reflective studio floor at Y=0
    const groundGeo = new THREE.PlaneGeometry(30, 30);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x101820,
      roughness: 0.75,
      metalness: 0.05,
      envMap: envMap,
      envMapIntensity: 0.15,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);
    groundRef.current = ground;

    // Subtle grid
    const grid = new THREE.GridHelper(16, 32, 0x1a2630, 0x131c26);
    grid.position.y = 0.001;
    scene.add(grid);
    gridRef.current = grid;

    // ─── Bag Group ────────────────────────────────────────────────────
    const bagGroup = new THREE.Group();
    scene.add(bagGroup);
    bagGroupRef.current = bagGroup;

    // ─── Animation Loop ───────────────────────────────────────────────
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ─── Resize ───────────────────────────────────────────────────────
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
      // Placeholder wireframe bag
      const geo = new THREE.BoxGeometry(0.8, 1.4, 0.15);
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, wireframe: true });
      const placeholder = new THREE.Mesh(geo, mat);
      placeholder.position.y = 0.7; // sit on ground
      group.add(placeholder);
      return;
    }

    // Update texture from artwork canvas
    if (artworkCanvas) {
      if (textureRef.current) textureRef.current.dispose();
      const tex = new THREE.CanvasTexture(artworkCanvas);
      tex.flipY = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipMapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      textureRef.current = tex;
    }

    buildBag(group, dimensions, fillState, closureType, textureRef.current, envMapRef.current, showDangerZones, showFoldLines);

    // Fit camera to the bag
    const s = MM_TO_SCENE;
    const bagH = dimensions.totalHeight * s;
    const bagW = dimensions.frontWidth * s;
    const camera = cameraRef.current!;
    const fovRad = (camera.fov * Math.PI) / 180;
    const neededDist = (bagH * 0.5) / Math.tan(fovRad / 2) * 1.6;
    const dist = Math.max(neededDist, Math.max(bagH, bagW) * 3.5);

    if (cameraRef.current && controlsRef.current) {
      const lookY = bagH * 0.45; // look at ~45% of bag height
      cameraRef.current.position.set(dist * 0.15, lookY + dist * 0.15, dist);
      controlsRef.current.target.set(0, lookY, 0);
      cameraRef.current.lookAt(0, lookY, 0);
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
  envMap: THREE.Texture | null,
  showDangerZones: boolean,
  showFoldLines: boolean
) {
  const s = MM_TO_SCENE;
  const meshData = createBagMeshData({ dimensions: d, fillState });
  const { frontGeometry, backGeometry, leftGussetGeometry, rightGussetGeometry,
    neckGeometry, tieGeometry } = meshData;

  // ─── PBR Plastic Film Material ──────────────────────────────────────
  // MeshPhysicalMaterial with clearcoat simulates glossy poly packaging film
  const artMat = new THREE.MeshPhysicalMaterial({
    map: texture ?? null,
    color: texture ? 0xffffff : 0xd8e2ec,
    side: THREE.FrontSide,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.08,
    ior: 1.45,          // polyethylene film IOR
    envMap: envMap,
    envMapIntensity: 0.7,
    reflectivity: 0.5,
  });

  // Back panel — same material but can have different texture region
  const backMat = new THREE.MeshPhysicalMaterial({
    map: texture ?? null,
    color: texture ? 0xffffff : 0xd0dae8,
    side: THREE.FrontSide,
    roughness: 0.25,
    metalness: 0.0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
    ior: 1.45,
    envMap: envMap,
    envMapIntensity: 0.6,
    reflectivity: 0.45,
  });

  // Side/gusset material — translucent plastic
  const sideMat = new THREE.MeshPhysicalMaterial({
    color: 0xd0d8e4,
    side: THREE.DoubleSide,
    roughness: 0.25,
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: 0.6,
    envMap: envMap,
    envMapIntensity: 0.5,
  });

  // Neck material — gathered translucent plastic (nearly clear, with glossy wrinkles)
  const neckMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf0f8,
    side: THREE.DoubleSide,
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15,
    transparent: true,
    opacity: 0.28,
    envMap: envMap,
    envMapIntensity: 0.5,
  });

  // Tie material
  const tieColor = closureType === 'ponytail-tape' ? 0xd4a840 :
                   closureType === 'ponytail-twist' ? 0x707a88 :
                   closureType === 'heat-seal' ? 0x889098 : 0x00c2cb;
  const tieMat = new THREE.MeshPhysicalMaterial({
    color: tieColor,
    roughness: 0.35,
    metalness: closureType === 'ponytail-twist' ? 0.5 : 0.05,
    clearcoat: 0.7,
    clearcoatRoughness: 0.08,
    envMap: envMap,
    envMapIntensity: 0.9,
  });

  // ─── Position bag sitting on ground (Y=0) ──────────────────────────
  // Geometry is created centered at Y=0. The body spans from -bodyH/2 to +bodyH/2.
  // We need to shift everything up so the bottom of the bag sits at Y=0.
  const bodyH = d.totalHeight - d.topSealHeight;
  const totalH = d.totalHeight;
  const halfTotal = totalH / 2;

  // The front/back panels are centered vertically in geometry at their center.
  // In geometry space, the bag bottom is at -bodyH/2 relative to the panel center.
  // Panel center is placed at frontCenterY.
  // We want the absolute bottom = -halfTotal*s to map to Y=0.
  // So we shift the whole group up by halfTotal*s.
  const groupOffsetY = halfTotal * s;

  // frontCenterY is the Y position of the front panel center in geometry space
  // (before applying groupOffsetY)
  const frontCenterY = (-halfTotal + bodyH / 2) * s;

  // Front panel
  const frontMesh = new THREE.Mesh(frontGeometry, artMat);
  frontMesh.scale.setScalar(s);
  frontMesh.position.y = frontCenterY + groupOffsetY;
  frontMesh.castShadow = true;
  frontMesh.receiveShadow = true;
  group.add(frontMesh);

  // Back panel
  const backMesh = new THREE.Mesh(backGeometry, backMat);
  backMesh.scale.setScalar(s);
  backMesh.position.y = frontCenterY + groupOffsetY;
  backMesh.castShadow = true;
  backMesh.receiveShadow = true;
  group.add(backMesh);

  // Gussets
  if (leftGussetGeometry) {
    const lm = new THREE.Mesh(leftGussetGeometry, sideMat);
    lm.scale.setScalar(s);
    lm.position.y = frontCenterY + groupOffsetY;
    lm.castShadow = true;
    group.add(lm);
  }
  if (rightGussetGeometry) {
    const rm = new THREE.Mesh(rightGussetGeometry, sideMat.clone());
    rm.scale.setScalar(s);
    rm.position.y = frontCenterY + groupOffsetY;
    rm.castShadow = true;
    group.add(rm);
  }

  // Neck (starts at top of body panels)
  const neckBottomY = (bodyH - halfTotal) * s + groupOffsetY;
  const neckMesh = new THREE.Mesh(neckGeometry, neckMat);
  neckMesh.scale.setScalar(s);
  neckMesh.position.y = neckBottomY;
  neckMesh.castShadow = true;
  group.add(neckMesh);

  // Tie — positioned at ~60% up the neck (where it cinches)
  const tieY = neckBottomY + d.topSealHeight * 0.6 * s;
  const tieMesh = new THREE.Mesh(tieGeometry, tieMat);
  tieMesh.scale.setScalar(s);
  tieMesh.rotation.x = Math.PI / 2; // lay flat as a horizontal band
  tieMesh.position.y = tieY;
  tieMesh.castShadow = true;
  group.add(tieMesh);

  // Bottom seal — thin strip connecting front/back at the bottom
  // Instead of a floating plate, create a small rounded edge at the base
  const bsFill = Math.max(d.bagDepth * fillState, 1);
  const bsH = Math.max(d.bottomSealHeight * 0.15, 2); // thin strip
  const bsGeo = new THREE.BoxGeometry(d.frontWidth * s, bsH * s, bsFill * s);
  const bsMat = new THREE.MeshPhysicalMaterial({
    color: 0xb0b8c4,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.15,
    transparent: true,
    opacity: 0.6,
    envMap: envMap,
    envMapIntensity: 0.3,
  });
  const bsMesh = new THREE.Mesh(bsGeo, bsMat);
  bsMesh.position.y = bsH * 0.5 * s; // sits right at ground level
  bsMesh.castShadow = true;
  group.add(bsMesh);

  // ── Danger Zones ────────────────────────────────────────────────
  if (showDangerZones) {
    const zFront = (d.bagDepth * fillState / 2 + 1) * s;

    // Top closure zone (blue)
    const tzGeo = new THREE.PlaneGeometry(d.frontWidth * s, d.topSealHeight * s);
    const tzMat = new THREE.MeshBasicMaterial({ color: 0x0099dd, transparent: true, opacity: 0.22, depthTest: false, side: THREE.DoubleSide });
    const tzMesh = new THREE.Mesh(tzGeo, tzMat);
    const tzY = (totalH - d.topSealHeight / 2) * s;
    tzMesh.position.set(0, tzY, zFront);
    tzMesh.renderOrder = 1;
    group.add(tzMesh);

    // Bottom seal zone (red)
    const bzGeo = new THREE.PlaneGeometry(d.frontWidth * s, d.bottomSealHeight * s);
    const bzMat = new THREE.MeshBasicMaterial({ color: 0xee3333, transparent: true, opacity: 0.22, depthTest: false, side: THREE.DoubleSide });
    const bzMesh = new THREE.Mesh(bzGeo, bzMat);
    const bzY = d.bottomSealHeight / 2 * s;
    bzMesh.position.set(0, bzY, zFront);
    bzMesh.renderOrder = 1;
    group.add(bzMesh);
  }

  // ── Fold Lines ───────────────────────────────────────────────────
  if (showFoldLines && d.leftGussetWidth > 0) {
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffcc00 });
    const zFront = (d.bagDepth * fillState / 2 + 1.5) * s;
    const yBot = 0;
    const yTop = totalH * s;

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
