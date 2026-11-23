import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass, texture, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TABLE_SPEC } from '../shared/tableSpec.ts';
import type { PinballEventBus } from '../shared/events.ts';
import type {
  BumperId,
  GameStateSnapshot,
  RendererBackendKind,
  RendererCapabilities,
} from '../shared/types.ts';
import {
  createPlayfieldDeckTextures,
  createStainedGlassTextureSet,
  type StainedGlassTextureSet,
} from './textures.ts';

export interface PinballRendererOptions {
  readonly forceWebGL?: boolean;
  readonly glbUrl?: string;
}

export interface PhysicsVisualSync {
  readonly snapshot: GameStateSnapshot;
  readonly flipperAngles: { readonly left: number; readonly right: number };
  readonly dropTargetDown: readonly [boolean, boolean, boolean];
  readonly plungerPullM: number;
}

type CameraMode = 'player' | 'overview';

interface CameraPose {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
}

interface TableNodeRefs {
  readonly root: THREE.Object3D;
  readonly flipperLeft: THREE.Object3D | null;
  readonly flipperRight: THREE.Object3D | null;
  readonly plungerRod: THREE.Object3D | null;
  readonly plungerRestZ: number;
  readonly dropTargets: readonly [
    THREE.Object3D | null,
    THREE.Object3D | null,
    THREE.Object3D | null,
  ];
  readonly dropTargetRestY: readonly [number, number, number];
  readonly bumperLights: Readonly<Record<BumperId, THREE.PointLight>>;
  readonly bumperCapMaterials: Partial<Record<BumperId, THREE.MeshPhysicalNodeMaterial>>;
  readonly slingshotLights: {
    readonly left: THREE.PointLight;
    readonly right: THREE.PointLight;
  };
  readonly slingshotMaterials: {
    left: THREE.MeshStandardNodeMaterial | null;
    right: THREE.MeshStandardNodeMaterial | null;
  };
  readonly roseFlashLight: THREE.PointLight;
  readonly ballTrackLight: THREE.PointLight;
  readonly roseMaterial: THREE.MeshPhysicalNodeMaterial | null;
  readonly playfieldMaterial: THREE.MeshStandardNodeMaterial | null;
}

const DEFAULT_GLB_URL = '/assets/pinball_table.glb';
const DROP_TARGET_TRAVEL_M = TABLE_SPEC.dropTargets.size.height + 0.004;
const TRAIL_SEGMENTS_PER_BALL = 6;

const PLAYER_POSE: CameraPose = {
  position: new THREE.Vector3(-0.01, 0.96, 1.04),
  target: new THREE.Vector3(-0.015, 0.18, -0.05),
};

const OVERVIEW_POSE: CameraPose = {
  position: new THREE.Vector3(0.24, 1.44, 0.72),
  target: new THREE.Vector3(-0.015, 0.17, -0.04),
};

interface AdaptiveCameraSpec {
  readonly fov: number;
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
}

/**
 * Computes responsive camera FOV, distance, and elevation so the full 0.555 m cabinet width
 * (including plunger lane and both flippers) fits cleanly across desktop, portrait phones, and landscape phones.
 */
function computeAdaptiveCameraPose(
  width: number,
  height: number,
  mode: CameraMode,
): AdaptiveCameraSpec {
  const aspect = Math.max(width / Math.max(height, 1), 0.32);

  if (aspect >= 1.15) {
    if (height < 520) {
      // Compact mobile landscape: widen vertical FOV and pull back slightly so top & bottom fit cleanly
      const fov = mode === 'overview' ? 44 : 42;
      const position =
        mode === 'overview'
          ? new THREE.Vector3(0.18, 1.56, 0.84)
          : new THREE.Vector3(-0.01, 1.16, 1.24);
      const target = new THREE.Vector3(-0.015, 0.17, -0.03);
      return { fov, position, target };
    }

    const base = mode === 'overview' ? OVERVIEW_POSE : PLAYER_POSE;
    return {
      fov: 38,
      position: base.position.clone(),
      target: base.target.clone(),
    };
  }

  // Portrait / narrow tablet & mobile viewports (e.g., 390x844, 412x915, 9:16)
  const fov = THREE.MathUtils.clamp(39 + (1.05 - aspect) * 12, 39, 46);
  const vFovRad = THREE.MathUtils.degToRad(fov);
  const tanHalfH = Math.tan(vFovRad * 0.5) * aspect;
  // Require 0.62 m total width (0.555 m cabinet + comfortable margins) at the front flipper/lockdown plane
  const requiredFrontDist = 0.31 / Math.max(tanHalfH, 0.12);
  const elevDeg = mode === 'overview' ? 66 : 56;
  const elevRad = THREE.MathUtils.degToRad(elevDeg);

  // Front edge sits ~0.55 m forward of target, so center distance adds ~0.34 m beyond front requirement
  const centerDist = Math.max(1.42, requiredFrontDist + 0.32);
  const target = new THREE.Vector3(-0.005, 0.15, -0.02);
  const position = new THREE.Vector3(
    target.x + (mode === 'overview' ? 0.08 : 0),
    target.y + Math.sin(elevRad) * centerDist,
    target.z + Math.cos(elevRad) * centerDist,
  );

  return { fov, position, target };
}

function createCathedralEnvironmentMap(renderer: THREE.WebGPURenderer): THREE.CubeRenderTarget | null {
  const envScene = new THREE.Scene();
  const roomGeo = new THREE.BoxGeometry(10, 8, 10);
  const roomMat = new THREE.MeshBasicNodeMaterial({
    color: 0x03040a,
    side: THREE.BackSide,
  });
  envScene.add(new THREE.Mesh(roomGeo, roomMat));

  const panelConfigs: ReadonlyArray<{
    pos: [number, number, number];
    size: [number, number, number];
    color: number;
  }> = [
    { pos: [0, 3.6, -1.5], size: [2.4, 0.1, 3.6], color: 0x7dd3fc },
    { pos: [-3.4, 2.4, 0.2], size: [0.12, 2.2, 3.8], color: 0xf59e0b },
    { pos: [3.4, 2.4, 0.2], size: [0.12, 2.2, 3.8], color: 0xe879f9 },
    { pos: [0, 2.4, 4.2], size: [3.4, 1.2, 0.12], color: 0xffe4b5 },
    { pos: [0, 3.9, 1.5], size: [1.8, 0.1, 1.8], color: 0xffffff },
  ];

  const panelGeos: THREE.BufferGeometry[] = [roomGeo];
  const panelMats: THREE.Material[] = [roomMat];

  for (const cfg of panelConfigs) {
    const geo = new THREE.BoxGeometry(...cfg.size);
    const mat = new THREE.MeshBasicNodeMaterial({ color: cfg.color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...cfg.pos);
    envScene.add(mesh);
    panelGeos.push(geo);
    panelMats.push(mat);
  }

  let pmrem: THREE.PMREMGenerator | null = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    return pmrem.fromScene(envScene, 0.04, 0.1, 30, { size: 256 });
  } catch {
    return null;
  } finally {
    pmrem?.dispose();
    for (const g of panelGeos) g.dispose();
    for (const m of panelMats) m.dispose();
  }
}

function buildStainedGlassMaterial(
  textures: StainedGlassTextureSet,
  tintHex: number,
  hasUv: boolean,
): THREE.MeshPhysicalNodeMaterial {
  const mat = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    map: textures.albedo,
    roughnessMap: textures.roughness,
    normalMap: textures.normal,
    emissive: new THREE.Color(tintHex),
    emissiveMap: textures.emissive,
    emissiveIntensity: 0.9,
    metalness: 0.0,
    roughness: 0.22,
    transmission: 0.72,
    ior: 1.48,
    thickness: 0.015,
    attenuationColor: new THREE.Color(tintHex),
    attenuationDistance: 0.085,
    side: THREE.DoubleSide,
  });

  if (hasUv) {
    mat.castShadowNode = vec4(texture(textures.albedo).rgb, 0.78);
  } else {
    const c = new THREE.Color(tintHex);
    mat.castShadowNode = vec4(c.r, c.g, c.b, 0.78);
  }

  return mat;
}

function convertToOpaqueStandardNodeMaterial(
  source: THREE.Material | null,
  fallbackColor = 0x262d47,
  fallbackMetalness = 0.25,
  fallbackRoughness = 0.45,
): THREE.MeshStandardNodeMaterial {
  if (source instanceof THREE.MeshStandardNodeMaterial) {
    return source;
  }

  const std = source as Partial<THREE.MeshStandardMaterial> | null;
  return new THREE.MeshStandardNodeMaterial({
    color: std?.color ? std.color.clone() : new THREE.Color(fallbackColor),
    map: std?.map ?? null,
    normalMap: std?.normalMap ?? null,
    roughnessMap: std?.roughnessMap ?? null,
    metalnessMap: std?.metalnessMap ?? null,
    emissive: std?.emissive ? std.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: std?.emissiveMap ?? null,
    emissiveIntensity: std?.emissiveIntensity ?? 1.0,
    metalness: std?.metalness ?? fallbackMetalness,
    roughness: std?.roughness ?? fallbackRoughness,
  });
}

function matchBumperCapId(name: string): BumperId | null {
  if (name === 'Bumper_Top_Cap') return 'bumper-top';
  if (name === 'Bumper_Left_Cap') return 'bumper-left';
  if (name === 'Bumper_Right_Cap') return 'bumper-right';
  if (/^Bumper_.*_Cap$/i.test(name)) {
    const lower = name.toLowerCase();
    if (lower.includes('left')) return 'bumper-left';
    if (lower.includes('right')) return 'bumper-right';
    return 'bumper-top';
  }
  return null;
}

function buildProceduralFallbackTable(): THREE.Group {
  const root = new THREE.Group();
  root.name = TABLE_SPEC.anchorNodes.root;
  root.position.set(0, TABLE_SPEC.cabinet.rootLiftY, 0);
  root.rotation.x = TABLE_SPEC.tiltRad;

  const {
    innerWidth,
    innerLength,
    playfieldThickness,
    sideWallThickness,
    endWallThickness,
    outerWidth,
    outerLength,
    wallBottomY,
    wallHeight,
    floorThickness,
  } = TABLE_SPEC.cabinet;

  const cabinetMat = new THREE.MeshStandardNodeMaterial({
    color: 0x161b2e,
    roughness: 0.48,
    metalness: 0.2,
  });
  const trimMat = new THREE.MeshStandardNodeMaterial({
    color: 0xb9c6e4,
    roughness: 0.22,
    metalness: 0.9,
  });
  const brassMat = new THREE.MeshStandardNodeMaterial({
    color: 0xd6a652,
    roughness: 0.26,
    metalness: 0.88,
  });

  const wallCenterY = wallBottomY + wallHeight * 0.5;
  const addBox = (
    name: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };

  // Cabinet enclosure + metallic trim
  addBox(
    'Cabinet_Wall_Left',
    sideWallThickness,
    wallHeight,
    outerLength,
    -(innerWidth + sideWallThickness) * 0.5,
    wallCenterY,
    0,
    cabinetMat,
  );
  addBox(
    'Cabinet_Wall_Right',
    sideWallThickness,
    wallHeight,
    outerLength,
    (innerWidth + sideWallThickness) * 0.5,
    wallCenterY,
    0,
    cabinetMat,
  );
  addBox(
    'Cabinet_Wall_Front',
    innerWidth,
    wallHeight,
    endWallThickness,
    0,
    wallCenterY,
    (innerLength + endWallThickness) * 0.5,
    cabinetMat,
  );
  addBox(
    'Cabinet_Wall_Rear',
    innerWidth,
    wallHeight,
    endWallThickness,
    0,
    wallCenterY,
    -(innerLength + endWallThickness) * 0.5,
    cabinetMat,
  );
  addBox(
    'Cabinet_Floor',
    outerWidth,
    floorThickness,
    outerLength,
    0,
    wallBottomY - floorThickness * 0.5,
    0,
    cabinetMat,
  );

  // Side rails & lockdown bar
  addBox(
    'Cabinet_Rail_Left',
    sideWallThickness * 1.15,
    0.012,
    outerLength,
    -(innerWidth + sideWallThickness) * 0.5,
    TABLE_SPEC.cabinet.wallTopY + 0.006,
    0,
    trimMat,
  );
  addBox(
    'Cabinet_Rail_Right',
    sideWallThickness * 1.15,
    0.012,
    outerLength,
    (innerWidth + sideWallThickness) * 0.5,
    TABLE_SPEC.cabinet.wallTopY + 0.006,
    0,
    trimMat,
  );
  addBox(
    'Cabinet_Lockdown_Bar',
    outerWidth + 0.008,
    0.022,
    0.044,
    0,
    TABLE_SPEC.cabinet.wallTopY + 0.004,
    (innerLength + endWallThickness) * 0.5,
    trimMat,
  );

  // Backbox arch + stained-glass backglass panel
  addBox(
    'Cabinet_Backbox_Arch',
    outerWidth,
    0.34,
    0.04,
    0,
    0.26,
    -(innerLength * 0.5 + endWallThickness + 0.02),
    cabinetMat,
  );
  addBox(
    'Backglass_StainedGlass',
    innerWidth * 0.88,
    0.26,
    0.008,
    0,
    0.27,
    -(innerLength * 0.5 + endWallThickness - 0.003),
    brassMat,
  );

  // Playfield Deck: solid base + exact UV [0,1] top deck surface named Playfield_Deck
  addBox(
    'Playfield_Base',
    innerWidth,
    playfieldThickness,
    innerLength,
    0,
    -playfieldThickness * 0.5 - 0.0005,
    0,
    cabinetMat,
  );
  const deckGeo = new THREE.PlaneGeometry(innerWidth, innerLength);
  deckGeo.rotateX(-Math.PI * 0.5);
  const deckUv = deckGeo.attributes.uv;
  if (deckUv) {
    for (let i = 0; i < deckUv.count; i++) {
      deckUv.setY(i, 1 - deckUv.getY(i));
    }
    deckUv.needsUpdate = true;
  }
  const deckMesh = new THREE.Mesh(deckGeo, cabinetMat);
  deckMesh.name = TABLE_SPEC.anchorNodes.playfieldDeck;
  deckMesh.position.set(0, 0, 0);
  root.add(deckMesh);

  // Flush Rose Window Insert
  const roseGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.002, 48);
  const roseMesh = new THREE.Mesh(roseGeo, brassMat);
  roseMesh.name = TABLE_SPEC.anchorNodes.roseWindowInsert;
  roseMesh.position.set(TABLE_SPEC.playfield.mainCenterX, 0.001, -0.04);
  root.add(roseMesh);

  // Plunger lane divider + housing + rod
  addBox(
    TABLE_SPEC.anchorNodes.plungerDivider,
    TABLE_SPEC.plungerLane.dividerThickness,
    TABLE_SPEC.plungerLane.dividerHeight,
    TABLE_SPEC.plungerLane.dividerLength,
    TABLE_SPEC.plungerLane.dividerCenterLocal.x,
    TABLE_SPEC.plungerLane.dividerCenterLocal.y,
    TABLE_SPEC.plungerLane.dividerCenterLocal.z,
    brassMat,
  );

  const rodGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.09, 16);
  rodGeo.rotateX(Math.PI * 0.5);
  const plungerRod = new THREE.Mesh(rodGeo, trimMat);
  plungerRod.name = 'Plunger_Rod';
  plungerRod.position.set(TABLE_SPEC.plungerLane.centerX, 0.0135, 0.515);
  root.add(plungerRod);

  // Curved Upper Orbit Arch
  const archPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 28; i++) {
    const theta = Math.PI + (i / 28) * Math.PI;
    const x = Math.cos(theta) * (innerWidth * 0.5 - 0.006);
    const z = -0.265 + Math.sin(theta) * 0.258;
    archPts.push(new THREE.Vector3(x, 0.02, z));
  }
  const archCurve = new THREE.CatmullRomCurve3(archPts);
  const archMesh = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 32, 0.008, 8, false), brassMat);
  archMesh.name = 'Upper_Orbit_Arch';
  root.add(archMesh);

  // 4 Upper Rollover Lane Dividers
  const rolloverXs = [-0.127, -0.057, 0.013, 0.083];
  rolloverXs.forEach((rx, idx) => {
    addBox(`Rollover_Divider_${idx + 1}`, 0.006, 0.026, 0.09, rx, 0.013, -0.41, brassMat);
  });

  // 3 Pop Bumpers with skirt + named Cap child
  const bumperCapNames: Record<BumperId, [string, string]> = {
    'bumper-top': ['Bumper_Top', 'Bumper_Top_Cap'],
    'bumper-left': ['Bumper_Left', 'Bumper_Left_Cap'],
    'bumper-right': ['Bumper_Right', 'Bumper_Right_Cap'],
  };
  for (const bumper of TABLE_SPEC.bumpers) {
    const [baseName, capName] = bumperCapNames[bumper.id];
    const group = new THREE.Group();
    group.name = baseName;
    group.position.set(bumper.positionLocal.x, 0, bumper.positionLocal.z);

    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(bumper.radius * 0.9, bumper.radius * 1.04, 0.014, 24),
      trimMat,
    );
    skirt.position.y = 0.007;
    group.add(skirt);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(bumper.radius * 0.92, bumper.radius * 0.65, 0.026, 28),
      brassMat,
    );
    cap.name = capName;
    cap.position.y = 0.027;
    group.add(cap);
    root.add(group);
  }

  // Slingshots
  const buildSlingshot = (name: string, verts: readonly [{ x: number; z: number }, { x: number; z: number }, { x: number; z: number }]): void => {
    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x, -verts[0].z);
    shape.lineTo(verts[1].x, -verts[1].z);
    shape.lineTo(verts[2].x, -verts[2].z);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: false });
    geo.rotateX(-Math.PI * 0.5);
    const mesh = new THREE.Mesh(geo, brassMat);
    mesh.name = name;
    mesh.position.y = 0;
    root.add(mesh);
  };
  buildSlingshot('Slingshot_Left', TABLE_SPEC.slingshots.left.verticesLocal);
  buildSlingshot('Slingshot_Right', TABLE_SPEC.slingshots.right.verticesLocal);

  // 3 Drop Targets
  TABLE_SPEC.dropTargets.targets.forEach((dtSpec, i) => {
    const dtMat = new THREE.MeshStandardNodeMaterial({
      color: 0xf43f5e,
      emissive: 0x9f1239,
      emissiveIntensity: 0.7,
      roughness: 0.3,
      metalness: 0.2,
    });
    addBox(
      `DropTarget_${i + 1}`,
      TABLE_SPEC.dropTargets.size.width,
      TABLE_SPEC.dropTargets.size.height,
      TABLE_SPEC.dropTargets.size.depth,
      dtSpec.positionLocal.x,
      TABLE_SPEC.dropTargets.size.height * 0.5,
      dtSpec.positionLocal.z,
      dtMat,
    );
  });

  // Elevated Stained-Glass Ramp
  const entry = TABLE_SPEC.stainedGlassRamp.entryLocal;
  const exit = TABLE_SPEC.stainedGlassRamp.exitLocal;
  const peakY = TABLE_SPEC.stainedGlassRamp.peakElevationY;
  const rampCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(entry.x, 0.005, entry.z),
    new THREE.Vector3(-0.205, peakY * 0.72, -0.18),
    new THREE.Vector3(-0.228, peakY, -0.02),
    new THREE.Vector3(-0.225, peakY * 0.65, 0.11),
    new THREE.Vector3(exit.x, 0.008, exit.z),
  ]);
  const rampGeo = new THREE.TubeGeometry(rampCurve, 44, 0.021, 10, false);
  rampGeo.scale(1, 0.35, 1);
  const rampMesh = new THREE.Mesh(rampGeo, brassMat);
  rampMesh.name = TABLE_SPEC.anchorNodes.stainedGlassRamp;
  root.add(rampMesh);

  // Multiball Lock Sanctuary Scoop
  const lockMesh = new THREE.Mesh(
    new THREE.TorusGeometry(TABLE_SPEC.multiballLock.sensorRadius, 0.006, 10, 24, Math.PI),
    brassMat,
  );
  lockMesh.name = 'Multiball_Lock_Pocket';
  lockMesh.position.set(
    TABLE_SPEC.multiballLock.sensorLocal.x,
    0.012,
    TABLE_SPEC.multiballLock.sensorLocal.z,
  );
  root.add(lockMesh);

  // Flipper Pivots & Blades
  const buildFlipper = (
    pivotName: string,
    bladeName: string,
    spec: typeof TABLE_SPEC.flippers.left | typeof TABLE_SPEC.flippers.right,
  ): void => {
    const pivot = new THREE.Group();
    pivot.name = pivotName;
    pivot.position.set(spec.pivotLocal.x, spec.pivotLocal.y, spec.pivotLocal.z);
    pivot.rotation.y = spec.restAngleRad;

    const bladeGeo = new THREE.BoxGeometry(
      TABLE_SPEC.flippers.length,
      TABLE_SPEC.flippers.height,
      TABLE_SPEC.flippers.thickness,
    );
    bladeGeo.translate(spec.extendSignX * TABLE_SPEC.flippers.length * 0.5, TABLE_SPEC.flippers.height * 0.5, 0);
    const bladeMat = new THREE.MeshStandardNodeMaterial({
      color: 0xeef2ff,
      roughness: 0.25,
      metalness: 0.55,
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.name = bladeName;
    pivot.add(blade);
    root.add(pivot);
  };

  buildFlipper(TABLE_SPEC.anchorNodes.flipperPivotLeft, 'Flipper_Blade_Left', TABLE_SPEC.flippers.left);
  buildFlipper(TABLE_SPEC.anchorNodes.flipperPivotRight, 'Flipper_Blade_Right', TABLE_SPEC.flippers.right);

  return root;
}

export class PinballRenderer {
  private readonly container: HTMLElement;
  private readonly bus: PinballEventBus;
  private readonly renderer: THREE.WebGPURenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly timer: THREE.Timer;
  private readonly playfieldTextures: StainedGlassTextureSet;
  private readonly glassTextures: StainedGlassTextureSet;
  private readonly tableRefs: TableNodeRefs;
  private readonly envTarget: THREE.CubeRenderTarget | null;
  private readonly ballGeometry: THREE.SphereGeometry;
  private readonly ballMaterial: THREE.MeshPhysicalNodeMaterial;
  private readonly ballPool: THREE.Mesh[] = [];
  private readonly trailGeometry: THREE.SphereGeometry;
  private readonly trailMeshes: THREE.Mesh[][] = [];
  private readonly trailMaterials: THREE.MeshBasicNodeMaterial[] = [];
  private readonly ballTrailHistory = new Map<number, THREE.Vector3[]>();
  private readonly ballPrevPositions = new Map<number, THREE.Vector3>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly windowResizeHandler: () => void;

  private renderPipeline: THREE.RenderPipeline | null;
  private scenePass: ReturnType<typeof pass> | null;
  private selectiveBloomEnabled: boolean;
  private readonly backend: RendererBackendKind;
  private readonly forcedWebGL: boolean;
  private readonly webgpuAvailable: boolean;

  private cameraMode: CameraMode = 'player';
  private readonly currentCamPos = new THREE.Vector3().copy(PLAYER_POSE.position);
  private readonly currentCamTarget = new THREE.Vector3().copy(PLAYER_POSE.target);
  private targetCamPos = new THREE.Vector3().copy(PLAYER_POSE.position);
  private targetCamTarget = new THREE.Vector3().copy(PLAYER_POSE.target);
  private targetCamFov = 38;
  private readonly nudgeOffset = new THREE.Vector3();
  private readonly nudgeVel = new THREE.Vector3();
  private readonly ballLightTargetPos = new THREE.Vector3(0, 0.036, 0.2);

  private readonly bumperFlash: Record<BumperId, number> = {
    'bumper-top': 0,
    'bumper-left': 0,
    'bumper-right': 0,
  };
  private slingshotLeftFlash = 0;
  private slingshotRightFlash = 0;
  private roseFlash = 0;
  private multiballActive = false;
  private readonly dropTargetYOffsets: [number, number, number] = [0, 0, 0];
  private disposed = false;

  private constructor(params: {
    container: HTMLElement;
    bus: PinballEventBus;
    renderer: THREE.WebGPURenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    timer: THREE.Timer;
    playfieldTextures: StainedGlassTextureSet;
    glassTextures: StainedGlassTextureSet;
    tableRefs: TableNodeRefs;
    envTarget: THREE.CubeRenderTarget | null;
    renderPipeline: THREE.RenderPipeline | null;
    scenePass: ReturnType<typeof pass> | null;
    selectiveBloomEnabled: boolean;
    backend: RendererBackendKind;
    forcedWebGL: boolean;
    webgpuAvailable: boolean;
  }) {
    this.container = params.container;
    this.bus = params.bus;
    this.renderer = params.renderer;
    this.scene = params.scene;
    this.camera = params.camera;
    this.timer = params.timer;
    this.playfieldTextures = params.playfieldTextures;
    this.glassTextures = params.glassTextures;
    this.tableRefs = params.tableRefs;
    this.envTarget = params.envTarget;
    this.renderPipeline = params.renderPipeline;
    this.scenePass = params.scenePass;
    this.selectiveBloomEnabled = params.selectiveBloomEnabled;
    this.backend = params.backend;
    this.forcedWebGL = params.forcedWebGL;
    this.webgpuAvailable = params.webgpuAvailable;

    this.ballGeometry = new THREE.SphereGeometry(TABLE_SPEC.ball.radius, 28, 20);
    this.ballMaterial = new THREE.MeshPhysicalNodeMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 2.35,
    });

    this.trailGeometry = new THREE.SphereGeometry(TABLE_SPEC.ball.radius, 12, 10);
    for (let s = 0; s < TRAIL_SEGMENTS_PER_BALL; s++) {
      const t = (s + 1) / TRAIL_SEGMENTS_PER_BALL;
      const mat = new THREE.MeshBasicNodeMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: (1 - t * 0.85) * 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.trailMaterials.push(mat);
    }

    // Pre-allocate pooled pinball meshes directly under Pinball_Table_Root
    for (let i = 0; i < 6; i++) {
      this.allocatePoolBall();
    }

    this.bindBusEvents();

    this.windowResizeHandler = () => this.handleResize();
    window.addEventListener('resize', this.windowResizeHandler);
    window.addEventListener('orientationchange', this.windowResizeHandler);
    window.visualViewport?.addEventListener('resize', this.windowResizeHandler);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }

    const initialPose = computeAdaptiveCameraPose(
      Math.max(params.container.clientWidth || window.innerWidth, 1),
      Math.max(params.container.clientHeight || window.innerHeight, 1),
      this.cameraMode,
    );
    this.targetCamFov = initialPose.fov;
    this.targetCamPos.copy(initialPose.position);
    this.targetCamTarget.copy(initialPose.target);
    this.currentCamPos.copy(initialPose.position);
    this.currentCamTarget.copy(initialPose.target);
    this.camera.fov = initialPose.fov;
    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentCamTarget);
    this.camera.updateProjectionMatrix();
  }

  static async create(
    container: HTMLElement,
    bus: PinballEventBus,
    options?: PinballRendererOptions,
  ): Promise<PinballRenderer> {
    const forcedWebGL = Boolean(options?.forceWebGL);
    const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

    const renderer = new THREE.WebGPURenderer({
      antialias: true,
      forceWebGL: forcedWebGL,
    });
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.transmitted = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    await renderer.init();

    const width = Math.max(container.clientWidth || window.innerWidth, 1);
    const height = Math.max(container.clientHeight || window.innerHeight, 1);
    renderer.setSize(width, height, false);

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const backendObj = renderer.backend as unknown as { isWebGPUBackend?: boolean };
    const backend: RendererBackendKind = backendObj?.isWebGPUBackend ? 'webgpu' : 'webgl2';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030409);

    const initialPose = computeAdaptiveCameraPose(width, height, 'player');
    const camera = new THREE.PerspectiveCamera(initialPose.fov, width / height, 0.05, 22);
    camera.position.copy(initialPose.position);
    camera.lookAt(initialPose.target);

    const timer = new THREE.Timer();
    timer.connect(document);

    const envTarget = createCathedralEnvironmentMap(renderer);
    if (envTarget) {
      scene.environment = envTarget.texture;
      scene.environmentIntensity = 0.32;
    }

    setupSceneLighting(scene, width < 768);

    const playfieldTextures = createPlayfieldDeckTextures();
    const glassTextures = createStainedGlassTextureSet();

    const glbUrl = options?.glbUrl ?? DEFAULT_GLB_URL;
    const loadedScene = await tryLoadTableGlb(glbUrl);
    const tableHost = loadedScene ?? buildProceduralFallbackTable();
    scene.add(tableHost);

    const tableRoot =
      tableHost.getObjectByName(TABLE_SPEC.anchorNodes.root) ?? tableHost;

    const tableRefs = bindAndUpgradeTable(tableRoot, playfieldTextures, glassTextures);

    let renderPipeline: THREE.RenderPipeline | null = null;
    let scenePass: ReturnType<typeof pass> | null = null;
    let selectiveBloomEnabled = false;

    try {
      scenePass = pass(scene, camera);
      scenePass.setMRT(
        mrt({
          output,
          emissive: vec4(emissive, output.a),
        }),
      );
      const scenePassColor = scenePass.getTextureNode('output');
      const emissivePass = scenePass.getTextureNode('emissive');
      const bloomPass = bloom(emissivePass, 0.88, 0.48, 0.12);

      const pipeline = new THREE.RenderPipeline(renderer);
      pipeline.outputNode = scenePassColor.add(bloomPass);
      renderPipeline = pipeline;
      selectiveBloomEnabled = true;
    } catch {
      scenePass?.dispose();
      scenePass = null;
      renderPipeline = null;
      selectiveBloomEnabled = false;
    }

    const instance = new PinballRenderer({
      container,
      bus,
      renderer,
      scene,
      camera,
      timer,
      playfieldTextures,
      glassTextures,
      tableRefs,
      envTarget,
      renderPipeline,
      scenePass,
      selectiveBloomEnabled,
      backend,
      forcedWebGL,
      webgpuAvailable,
    });

    // Warm up and verify MRT pipeline compatibility before returning
    let warmupError = false;
    const prevOnError = renderer.onError;
    renderer.onError = () => {
      warmupError = true;
    };
    instance.render();
    renderer.onError = prevOnError;

    if (warmupError && instance.renderPipeline) {
      instance.disposePipeline();
      instance.selectiveBloomEnabled = false;
      instance.render();
    }
    return instance;
  }

  getCapabilities(): RendererCapabilities {
    return {
      backend: this.backend,
      forcedWebGL: this.forcedWebGL,
      webgpuAvailable: this.webgpuAvailable,
      transmittedShadowsEnabled:
        this.renderer.shadowMap.enabled && this.renderer.shadowMap.transmitted,
      selectiveBloomEnabled: this.selectiveBloomEnabled,
      selectiveTransmissionOnly: true,
      devicePixelRatio: this.renderer.getPixelRatio(),
    };
  }

  sync(state: PhysicsVisualSync, dt: number): void {
    if (this.disposed) return;

    const clampedDt = Math.max(0, Math.min(dt, 0.1));
    this.timer.update();
    const elapsed = this.timer.getElapsed();

    // Update flippers
    if (this.tableRefs.flipperLeft) {
      this.tableRefs.flipperLeft.rotation.y = state.flipperAngles.left;
    }
    if (this.tableRefs.flipperRight) {
      this.tableRefs.flipperRight.rotation.y = state.flipperAngles.right;
    }

    // Update plunger rod Z offset
    if (this.tableRefs.plungerRod) {
      this.tableRefs.plungerRod.position.z =
        this.tableRefs.plungerRestZ + state.plungerPullM;
    }

    // Update 3 drop targets Y offset
    const dropAlpha = clampedDt > 0 ? 1 - Math.exp(-26 * clampedDt) : 1;
    for (let i = 0; i < 3; i++) {
      const obj = this.tableRefs.dropTargets[i];
      if (!obj) continue;
      const targetOffset = state.dropTargetDown[i] ? -DROP_TARGET_TRAVEL_M : 0;
      this.dropTargetYOffsets[i] += (targetOffset - this.dropTargetYOffsets[i]) * dropAlpha;
      obj.position.y = this.tableRefs.dropTargetRestY[i] + this.dropTargetYOffsets[i];
    }

    // Sync pooled chrome steel pinballs & subtle velocity motion trails in Pinball_Table_Root local Y-up space
    const balls = state.snapshot.balls;
    while (this.ballPool.length < balls.length) {
      this.allocatePoolBall();
    }

    let primaryBall = balls[0] ?? null;
    for (let i = 0; i < this.ballPool.length; i++) {
      const mesh = this.ballPool[i];
      const trailRow = this.trailMeshes[i];
      if (i < balls.length) {
        const b = balls[i];
        if (!primaryBall || (!b.locked && (primaryBall.locked || b.speedMps > primaryBall.speedMps))) {
          primaryBall = b;
        }
        mesh.visible = true;
        mesh.position.set(b.position.x, b.position.y, b.position.z);

        const prev = this.ballPrevPositions.get(b.id);
        if (prev && clampedDt > 0) {
          const dx = b.position.x - prev.x;
          const dz = b.position.z - prev.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 1e-5) {
            _rollAxis.set(dz, 0, -dx).normalize();
            _rollQuat.setFromAxisAngle(_rollAxis, dist / TABLE_SPEC.ball.radius);
            mesh.quaternion.premultiply(_rollQuat);
          }
          prev.set(b.position.x, b.position.y, b.position.z);
        } else {
          this.ballPrevPositions.set(
            b.id,
            new THREE.Vector3(b.position.x, b.position.y, b.position.z),
          );
        }

        // Update motion trail ring buffer
        let history = this.ballTrailHistory.get(b.id);
        if (!history) {
          history = [];
          this.ballTrailHistory.set(b.id, history);
        }
        if (clampedDt > 0 && !b.locked) {
          history.unshift(new THREE.Vector3(b.position.x, b.position.y, b.position.z));
          if (history.length > TRAIL_SEGMENTS_PER_BALL) {
            history.length = TRAIL_SEGMENTS_PER_BALL;
          }
        }
        const showTrail = !b.locked && b.speedMps > 0.45 && history.length >= 2;
        if (trailRow) {
          for (let s = 0; s < trailRow.length; s++) {
            const ghost = trailRow[s];
            const histPt = history[Math.min(s + 1, history.length - 1)];
            if (showTrail && histPt) {
              ghost.visible = true;
              ghost.position.copy(histPt);
              const scale = Math.max(0.24, 0.78 - s * 0.1);
              ghost.scale.setScalar(scale);
            } else {
              ghost.visible = false;
            }
          }
        }
      } else {
        mesh.visible = false;
        if (trailRow) {
          for (const ghost of trailRow) ghost.visible = false;
        }
      }
    }

    // Dynamic ball-tracking point light illuminates nearby stained glass & chrome
    if (primaryBall && !primaryBall.locked) {
      this.ballLightTargetPos.set(
        primaryBall.position.x,
        primaryBall.position.y + 0.036,
        primaryBall.position.z,
      );
      const lightAlpha = clampedDt > 0 ? 1 - Math.exp(-20 * clampedDt) : 1;
      this.tableRefs.ballTrackLight.position.lerp(this.ballLightTargetPos, lightAlpha);
      this.tableRefs.ballTrackLight.intensity = 0.85 + Math.min(primaryBall.speedMps / 4, 1) * 0.65;
      if (state.snapshot.ballSaveRemainingSec > 0) {
        this.tableRefs.ballTrackLight.color.setHex(0x6ee7b7);
      } else if (state.snapshot.phase === 'multiball') {
        this.tableRefs.ballTrackLight.color.setHex(0xe879f9);
      } else {
        this.tableRefs.ballTrackLight.color.setHex(0x93c5fd);
      }
    } else {
      this.tableRefs.ballTrackLight.intensity = 0.35;
    }

    // Update reactive lights & material emissive pulses
    this.updateLightsAndEmissive(clampedDt, elapsed, state.snapshot);

    // Update camera pose & decaying micro-shake / nudge impulse
    this.updateCamera(clampedDt);
  }

  render(): void {
    if (this.disposed) return;

    if (this.renderPipeline) {
      try {
        this.renderPipeline.render();
        return;
      } catch {
        this.disposePipeline();
        this.selectiveBloomEnabled = false;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.refreshAdaptiveCameraTarget();
  }

  toggleCameraMode(): CameraMode {
    this.cameraMode = this.cameraMode === 'player' ? 'overview' : 'player';
    this.refreshAdaptiveCameraTarget();
    return this.cameraMode;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;

    window.removeEventListener('resize', this.windowResizeHandler);
    window.removeEventListener('orientationchange', this.windowResizeHandler);
    window.visualViewport?.removeEventListener('resize', this.windowResizeHandler);
    this.resizeObserver?.disconnect();

    this.timer.disconnect();
    this.timer.dispose();

    this.disposePipeline();

    const disposedMaterials = new Set<THREE.Material>();
    const disposedGeometries = new Set<THREE.BufferGeometry>();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (!disposedGeometries.has(obj.geometry)) {
          obj.geometry.dispose();
          disposedGeometries.add(obj.geometry);
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat && !disposedMaterials.has(mat)) {
            mat.dispose();
            disposedMaterials.add(mat);
          }
        }
      }
    });

    this.ballGeometry.dispose();
    this.ballMaterial.dispose();
    this.trailGeometry.dispose();
    for (const mat of this.trailMaterials) {
      mat.dispose();
    }
    this.trailMaterials.length = 0;
    this.ballTrailHistory.clear();
    this.playfieldTextures.dispose();
    this.glassTextures.dispose();
    this.envTarget?.dispose();

    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    void this.renderer.dispose();
  }

  private allocatePoolBall(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
    mesh.name = `Pinball_Ball_${this.ballPool.length + 1}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.tableRefs.root.add(mesh);
    this.ballPool.push(mesh);

    const row: THREE.Mesh[] = [];
    for (let s = 0; s < TRAIL_SEGMENTS_PER_BALL; s++) {
      const ghost = new THREE.Mesh(this.trailGeometry, this.trailMaterials[s]);
      ghost.castShadow = false;
      ghost.receiveShadow = false;
      ghost.visible = false;
      this.tableRefs.root.add(ghost);
      row.push(ghost);
    }
    this.trailMeshes.push(row);
    return mesh;
  }

  private bindBusEvents(): void {
    this.unsubscribers.push(
      this.bus.on('bumperHit', ({ bumperId }) => {
        this.bumperFlash[bumperId] = 1.0;
        this.roseFlash = Math.max(this.roseFlash, 0.72);
        this.nudgeVel.x += (Math.random() - 0.5) * 0.008;
        this.nudgeVel.z += 0.006;
      }),
      this.bus.on('slingshotHit', ({ side }) => {
        if (side === 'left') {
          this.slingshotLeftFlash = 1.0;
          this.nudgeVel.x += 0.0065;
        } else {
          this.slingshotRightFlash = 1.0;
          this.nudgeVel.x -= 0.0065;
        }
        this.nudgeVel.z += 0.004;
      }),
      this.bus.on('dropTargetHit', ({ bankComplete }) => {
        this.roseFlash = Math.max(this.roseFlash, bankComplete ? 1.1 : 0.45);
        if (bankComplete) {
          this.nudgeVel.z += 0.009;
        }
      }),
      this.bus.on('rampCompleted', () => {
        this.roseFlash = 1.15;
      }),
      this.bus.on('ballSave', () => {
        this.roseFlash = 1.1;
        this.nudgeVel.z -= 0.007;
      }),
      this.bus.on('multiballLock', () => {
        this.roseFlash = 0.95;
      }),
      this.bus.on('multiballStart', () => {
        this.multiballActive = true;
        this.roseFlash = 1.35;
        this.nudgeVel.z += 0.011;
      }),
      this.bus.on('multiballEnd', () => {
        this.multiballActive = false;
      }),
      this.bus.on('lampPulse', ({ lampId, intensity }) => {
        if (lampId === 'bumper-top' || lampId === 'bumper-left' || lampId === 'bumper-right') {
          this.bumperFlash[lampId] = Math.max(this.bumperFlash[lampId], Math.min(intensity, 1.25));
        } else if (lampId.includes('sling-left')) {
          this.slingshotLeftFlash = Math.max(this.slingshotLeftFlash, 0.9);
        } else if (lampId.includes('sling-right')) {
          this.slingshotRightFlash = Math.max(this.slingshotRightFlash, 0.9);
        } else {
          this.roseFlash = Math.max(this.roseFlash, 0.78);
        }
      }),
      this.bus.on('nudge', ({ direction }) => {
        const kick = 0.025;
        if (direction === 'left') this.nudgeVel.x -= kick;
        else if (direction === 'right') this.nudgeVel.x += kick;
        else this.nudgeVel.z -= kick;
      }),
      this.bus.on('gameStateChanged', ({ current }) => {
        this.multiballActive = current === 'multiball';
      }),
    );
  }

  private updateLightsAndEmissive(
    dt: number,
    elapsed: number,
    snapshot: GameStateSnapshot,
  ): void {
    const decay = Math.exp(-8.5 * dt);

    for (const bumper of TABLE_SPEC.bumpers) {
      const f = (this.bumperFlash[bumper.id] *= decay);
      const light = this.tableRefs.bumperLights[bumper.id];
      light.intensity = 0.16 + f * 3.2;
      const capMat = this.tableRefs.bumperCapMaterials[bumper.id];
      if (capMat) {
        capMat.emissiveIntensity = 1.25 + f * 2.8;
      }
    }

    this.slingshotLeftFlash *= decay;
    this.slingshotRightFlash *= decay;
    this.tableRefs.slingshotLights.left.intensity = 0.08 + this.slingshotLeftFlash * 2.4;
    this.tableRefs.slingshotLights.right.intensity = 0.08 + this.slingshotRightFlash * 2.4;

    if (this.tableRefs.slingshotMaterials.left) {
      this.tableRefs.slingshotMaterials.left.emissiveIntensity =
        0.24 + this.slingshotLeftFlash * 2.6;
    }
    if (this.tableRefs.slingshotMaterials.right) {
      this.tableRefs.slingshotMaterials.right.emissiveIntensity =
        0.24 + this.slingshotRightFlash * 2.6;
    }

    this.roseFlash *= Math.exp(-5.0 * dt);
    const multiballPulse =
      this.multiballActive || snapshot.phase === 'multiball'
        ? 0.55 + 0.35 * Math.sin(elapsed * 8.0)
        : 0.18 + 0.08 * Math.sin(elapsed * 2.1);

    this.tableRefs.roseFlashLight.intensity = 0.28 + multiballPulse * 0.95 + this.roseFlash * 2.8;

    if (this.tableRefs.roseMaterial) {
      this.tableRefs.roseMaterial.emissiveIntensity =
        1.35 + multiballPulse * 0.8 + this.roseFlash * 2.3;
    }
    if (this.tableRefs.playfieldMaterial) {
      this.tableRefs.playfieldMaterial.emissiveIntensity =
        1.65 + multiballPulse * 0.55 + this.roseFlash * 0.95;
    }
  }

  private refreshAdaptiveCameraTarget(): void {
    const width = Math.max(this.container.clientWidth || window.innerWidth, 1);
    const height = Math.max(this.container.clientHeight || window.innerHeight, 1);
    const pose = computeAdaptiveCameraPose(width, height, this.cameraMode);
    this.targetCamFov = pose.fov;
    this.targetCamPos.copy(pose.position);
    this.targetCamTarget.copy(pose.target);
  }

  private updateCamera(dt: number): void {
    const lerpFactor = dt > 0 ? 1 - Math.exp(-10 * dt) : 1;

    this.currentCamPos.lerp(this.targetCamPos, lerpFactor);
    this.currentCamTarget.lerp(this.targetCamTarget, lerpFactor);

    if (Math.abs(this.camera.fov - this.targetCamFov) > 0.02) {
      this.camera.fov += (this.targetCamFov - this.camera.fov) * lerpFactor;
      this.camera.updateProjectionMatrix();
    }

    // Damped spring camera shake on cabinet nudge & heavy impacts
    if (dt > 0) {
      this.nudgeVel.addScaledVector(this.nudgeOffset, -140 * dt);
      this.nudgeVel.multiplyScalar(Math.exp(-14 * dt));
      this.nudgeOffset.addScaledVector(this.nudgeVel, dt);
    }

    this.camera.position.copy(this.currentCamPos).add(this.nudgeOffset);
    this.camera.lookAt(this.currentCamTarget);
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth || window.innerWidth, 1);
    const height = Math.max(this.container.clientHeight || window.innerHeight, 1);
    const pose = computeAdaptiveCameraPose(width, height, this.cameraMode);
    this.targetCamFov = pose.fov;
    this.targetCamPos.copy(pose.position);
    this.targetCamTarget.copy(pose.target);
    this.camera.aspect = width / height;
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  private disposePipeline(): void {
    try {
      this.renderPipeline?.dispose();
    } catch {
      // Ignore pipeline disposal errors on fallback
    }
    try {
      this.scenePass?.dispose();
    } catch {
      // Ignore pass disposal errors on fallback
    }
    this.renderPipeline = null;
    this.scenePass = null;
  }
}

const _rollAxis = new THREE.Vector3();
const _rollQuat = new THREE.Quaternion();

function setupSceneLighting(scene: THREE.Scene, compactShadowMap = false): void {
  // Cut ambient/hemisphere fill by ~68% for rich dark obsidian & aged walnut mood
  const hemi = new THREE.HemisphereLight(0x4b69b8, 0x090610, 0.23);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xffe7c7, 1.7);
  keyLight.position.set(0.58, 1.95, -0.45);
  keyLight.castShadow = true;
  const shadowSize = compactShadowMap ? 1024 : 2048;
  keyLight.shadow.mapSize.set(shadowSize, shadowSize);
  keyLight.shadow.camera.near = 0.4;
  keyLight.shadow.camera.far = 4.2;
  keyLight.shadow.camera.left = -0.55;
  keyLight.shadow.camera.right = 0.55;
  keyLight.shadow.camera.top = 0.75;
  keyLight.shadow.camera.bottom = -0.75;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.normalBias = 0.012;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x3b82f6, 0.48);
  rimLight.position.set(-0.85, 1.05, 0.55);
  scene.add(rimLight);

  const apronFill = new THREE.PointLight(0xffb45c, 0.22, 2.0, 1.8);
  apronFill.position.set(0, 0.72, 0.65);
  scene.add(apronFill);
}

async function tryLoadTableGlb(url: string): Promise<THREE.Object3D | null> {
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  } catch {
    return null;
  }
}

function resolveMeshSemanticName(mesh: THREE.Mesh, tableRoot: THREE.Object3D): string {
  const candidates = [mesh.name];
  if (mesh.parent && mesh.parent !== tableRoot) {
    candidates.push(mesh.parent.name);
  }
  for (const name of candidates) {
    if (
      name === TABLE_SPEC.anchorNodes.playfieldDeck ||
      name === TABLE_SPEC.anchorNodes.stainedGlassRamp ||
      name === TABLE_SPEC.anchorNodes.roseWindowInsert ||
      name === 'Backglass_StainedGlass' ||
      name === 'Slingshot_Left' ||
      name === 'Slingshot_Right' ||
      /^Bumper_.*_Cap$/i.test(name)
    ) {
      return name;
    }
  }
  return mesh.name;
}

function bindAndUpgradeTable(
  tableRoot: THREE.Object3D,
  playfieldTextures: StainedGlassTextureSet,
  glassTextures: StainedGlassTextureSet,
): TableNodeRefs {
  let playfieldMaterial: THREE.MeshStandardNodeMaterial | null = null;
  let roseMaterial: THREE.MeshPhysicalNodeMaterial | null = null;
  const bumperCapMaterials: Partial<Record<BumperId, THREE.MeshPhysicalNodeMaterial>> = {};
  const slingshotMaterials: {
    left: THREE.MeshStandardNodeMaterial | null;
    right: THREE.MeshStandardNodeMaterial | null;
  } = { left: null, right: null };

  const bumperColorById: Record<BumperId, number> = {
    'bumper-top': TABLE_SPEC.bumpers[0].colorHex,
    'bumper-left': TABLE_SPEC.bumpers[1].colorHex,
    'bumper-right': TABLE_SPEC.bumpers[2].colorHex,
  };

  tableRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    obj.castShadow = true;
    obj.receiveShadow = true;

    const name = resolveMeshSemanticName(obj, tableRoot);
    const hasUv = Boolean(obj.geometry?.attributes?.uv);

    if (name === TABLE_SPEC.anchorNodes.playfieldDeck) {
      playfieldMaterial = new THREE.MeshStandardNodeMaterial({
        color: 0xffffff,
        map: playfieldTextures.albedo,
        roughnessMap: playfieldTextures.roughness,
        normalMap: playfieldTextures.normal,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: playfieldTextures.emissive,
        emissiveIntensity: 1.65,
        metalness: 0.14,
        roughness: 1.0,
      });
      obj.material = playfieldMaterial;
      obj.castShadow = false;
      return;
    }

    if (name === TABLE_SPEC.anchorNodes.stainedGlassRamp) {
      obj.material = buildStainedGlassMaterial(glassTextures, 0xd8b4fe, hasUv);
      return;
    }

    if (name === TABLE_SPEC.anchorNodes.roseWindowInsert) {
      roseMaterial = buildStainedGlassMaterial(glassTextures, 0xffe4ff, hasUv);
      obj.material = roseMaterial;
      obj.castShadow = false;
      return;
    }

    const capId = matchBumperCapId(name);
    if (capId) {
      const mat = buildStainedGlassMaterial(glassTextures, bumperColorById[capId], hasUv);
      bumperCapMaterials[capId] = mat;
      obj.material = mat;
      return;
    }

    if (name === 'Backglass_StainedGlass') {
      obj.material = new THREE.MeshStandardNodeMaterial({
        color: 0xffffff,
        map: glassTextures.albedo,
        roughnessMap: glassTextures.roughness,
        normalMap: glassTextures.normal,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: glassTextures.emissive,
        emissiveIntensity: 2.35,
        metalness: 0.08,
        roughness: 0.3,
        side: THREE.DoubleSide,
      });
      return;
    }

    const stdMat = convertToOpaqueStandardNodeMaterial(
      Array.isArray(obj.material) ? obj.material[0] : obj.material,
    );

    if (
      name.startsWith('Cabinet_Wall') ||
      name === 'Cabinet_Floor' ||
      name === 'Cabinet_Backbox_Arch'
    ) {
      stdMat.color.multiplyScalar(0.55);
      stdMat.roughness = Math.min(1, Math.max(0.45, stdMat.roughness));
    }

    if (name === 'Slingshot_Left') {
      stdMat.emissive.setHex(0x38bdf8);
      stdMat.emissiveIntensity = 0.24;
      slingshotMaterials.left = stdMat;
    } else if (name === 'Slingshot_Right') {
      stdMat.emissive.setHex(0xf59e0b);
      stdMat.emissiveIntensity = 0.24;
      slingshotMaterials.right = stdMat;
    }

    obj.material = stdMat;
  });

  // Attach dynamic local PointLights directly under Pinball_Table_Root
  const makeLocalFlashLight = (
    colorHex: number,
    x: number,
    y: number,
    z: number,
    distance: number,
  ): THREE.PointLight => {
    const light = new THREE.PointLight(colorHex, 0.14, distance, 1.8);
    light.position.set(x, y, z);
    tableRoot.add(light);
    return light;
  };

  const bumperLights: Record<BumperId, THREE.PointLight> = {
    'bumper-top': makeLocalFlashLight(
      TABLE_SPEC.bumpers[0].colorHex,
      TABLE_SPEC.bumpers[0].positionLocal.x,
      0.068,
      TABLE_SPEC.bumpers[0].positionLocal.z,
      0.42,
    ),
    'bumper-left': makeLocalFlashLight(
      TABLE_SPEC.bumpers[1].colorHex,
      TABLE_SPEC.bumpers[1].positionLocal.x,
      0.068,
      TABLE_SPEC.bumpers[1].positionLocal.z,
      0.42,
    ),
    'bumper-right': makeLocalFlashLight(
      TABLE_SPEC.bumpers[2].colorHex,
      TABLE_SPEC.bumpers[2].positionLocal.x,
      0.068,
      TABLE_SPEC.bumpers[2].positionLocal.z,
      0.42,
    ),
  };

  const slingshotLights = {
    left: makeLocalFlashLight(0x38bdf8, -0.17, 0.052, 0.23, 0.34),
    right: makeLocalFlashLight(0xf59e0b, 0.125, 0.052, 0.23, 0.34),
  };

  const roseFlashLight = makeLocalFlashLight(
    0xe879f9,
    TABLE_SPEC.playfield.mainCenterX,
    0.095,
    -0.04,
    0.65,
  );

  const ballTrackLight = makeLocalFlashLight(
    0x93c5fd,
    TABLE_SPEC.plungerLane.ballSpawnLocal.x,
    0.045,
    TABLE_SPEC.plungerLane.ballSpawnLocal.z,
    0.42,
  );
  ballTrackLight.intensity = 0.85;

  const plungerRod = tableRoot.getObjectByName('Plunger_Rod') ?? null;
  const dt1 = tableRoot.getObjectByName('DropTarget_1') ?? null;
  const dt2 = tableRoot.getObjectByName('DropTarget_2') ?? null;
  const dt3 = tableRoot.getObjectByName('DropTarget_3') ?? null;

  return {
    root: tableRoot,
    flipperLeft: tableRoot.getObjectByName(TABLE_SPEC.anchorNodes.flipperPivotLeft) ?? null,
    flipperRight: tableRoot.getObjectByName(TABLE_SPEC.anchorNodes.flipperPivotRight) ?? null,
    plungerRod,
    plungerRestZ: plungerRod ? plungerRod.position.z : 0.515,
    dropTargets: [dt1, dt2, dt3],
    dropTargetRestY: [
      dt1 ? dt1.position.y : 0,
      dt2 ? dt2.position.y : 0,
      dt3 ? dt3.position.y : 0,
    ],
    bumperLights,
    bumperCapMaterials,
    slingshotLights,
    slingshotMaterials,
    roseFlashLight,
    ballTrackLight,
    roseMaterial,
    playfieldMaterial,
  };
}
