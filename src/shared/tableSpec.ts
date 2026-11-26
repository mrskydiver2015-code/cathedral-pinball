import type {
  BoxExtents3D,
  BumperId,
  DropTargetId,
  Quat,
  RampId,
  Side,
  Vec3,
} from './types.ts';

/**
 * Coordinate Mapping Convention between Blender 5.2.3 LTS and Three.js / Rapier3D.
 *
 * - Scale: 1 unit = 1 meter across all subsystems.
 * - Blender space (right-handed Z-up): +X right, +Y rear/top of table, -Y front/player, +Z up.
 * - Three.js & Rapier3D space (glTF 2.0 +Y Up, right-handed): +X right, +Y up, +Z front/player, -Z rear/top.
 * - Exact axis mapping: Blender (X, Y, Z) -> Three.js / Rapier3D (X, Z, -Y).
 * - Playfield tilt: +6.5 deg around +X in BOTH Blender and Three.js/Rapier3D raises the rear
 *   (+Y_blender / -Z_three) and lowers the front (-Y_blender / +Z_three) so world gravity (0, -9.81, 0)
 *   accelerates pinballs cleanly toward the flippers (+Z_three).
 */
export const COORDINATE_SYSTEM = {
  units: 'meters',
  blenderUpAxis: '+Z',
  threeRapierUpAxis: '+Y',
  blenderToThreeFormula: '(x, y, z) => ({ x, y: z, z: -y })',
  threeToBlenderFormula: '(x, y, z) => ({ x, y: -z, z: y })',
  tiltAxis: '+X',
  tiltDeg: 6.5,
} as const;

const DEG_TO_RAD = Math.PI / 180;
const TILT_DEG = 6.5;
const TILT_RAD = TILT_DEG * DEG_TO_RAD;

const INNER_WIDTH = 0.515;
const INNER_LENGTH = 1.07;
const PLAYFIELD_THICKNESS = 0.018;
const SIDE_WALL_THICKNESS = 0.02;
const END_WALL_THICKNESS = 0.022;
const OUTER_WIDTH = INNER_WIDTH + 2 * SIDE_WALL_THICKNESS; // 0.555 m
const OUTER_LENGTH = INNER_LENGTH + 2 * END_WALL_THICKNESS; // 1.114 m
const WALL_BOTTOM_Y = -0.1;
const WALL_TOP_Y = 0.11;
const WALL_HEIGHT = WALL_TOP_Y - WALL_BOTTOM_Y; // 0.210 m
const FLOOR_THICKNESS = 0.016;

// Lift Pinball_Table_Root so the front-bottom outer cabinet edge sits flush on world Y = 0.0
const ROOT_LIFT_Y = -(
  (-OUTER_LENGTH * 0.5) * Math.sin(TILT_RAD) +
  WALL_BOTTOM_Y * Math.cos(TILT_RAD)
);

const PLUNGER_LANE_WIDTH = 0.036;
const DIVIDER_THICKNESS = 0.008;
const DIVIDER_LENGTH = 0.8;
const DIVIDER_HEIGHT = 0.042;
const DIVIDER_X = INNER_WIDTH * 0.5 - PLUNGER_LANE_WIDTH - DIVIDER_THICKNESS * 0.5; // +0.2175 m
const PLUNGER_X_MIN = DIVIDER_X + DIVIDER_THICKNESS * 0.5; // +0.2215 m
const PLUNGER_X_MAX = INNER_WIDTH * 0.5; // +0.2575 m
const PLUNGER_CENTER_X = (PLUNGER_X_MIN + PLUNGER_X_MAX) * 0.5; // +0.2395 m
const DIVIDER_Z_MAX = INNER_LENGTH * 0.5; // +0.535 m (front inner wall)
const DIVIDER_Z_MIN = DIVIDER_Z_MAX - DIVIDER_LENGTH; // -0.265 m (leaves 0.270 m upper arch gap)

const MAIN_ACTIVE_X_MIN = -INNER_WIDTH * 0.5; // -0.2575 m
const MAIN_ACTIVE_X_MAX = DIVIDER_X - DIVIDER_THICKNESS * 0.5; // +0.2135 m
const MAIN_ACTIVE_WIDTH = MAIN_ACTIVE_X_MAX - MAIN_ACTIVE_X_MIN; // 0.471 m
const MAIN_CENTER_X = (MAIN_ACTIVE_X_MIN + MAIN_ACTIVE_X_MAX) * 0.5; // -0.022 m

const FLIPPER_PIVOT_Z = 0.345; // Blender y = -0.345 m
const FLIPPER_HALF_SPAN_X = 0.092;
const FLIPPER_LEFT_X = MAIN_CENTER_X - FLIPPER_HALF_SPAN_X; // -0.114 m
const FLIPPER_RIGHT_X = MAIN_CENTER_X + FLIPPER_HALF_SPAN_X; // +0.070 m
const FLIPPER_LENGTH = 0.076;
const FLIPPER_THICKNESS = 0.014;
const FLIPPER_HEIGHT = 0.024;
const FLIPPER_REST_ANGLE_DEG = 28;
const FLIPPER_ACTIVE_ANGLE_DEG = 24;
const FLIPPER_REST_RAD = FLIPPER_REST_ANGLE_DEG * DEG_TO_RAD;
const FLIPPER_ACTIVE_RAD = FLIPPER_ACTIVE_ANGLE_DEG * DEG_TO_RAD;
const FLIPPER_TIP_GAP_AT_REST_M =
  FLIPPER_RIGHT_X - FLIPPER_LEFT_X - 2 * FLIPPER_LENGTH * Math.cos(FLIPPER_REST_RAD);

const BALL_DIAMETER = 0.027;
const BALL_RADIUS = BALL_DIAMETER * 0.5; // 0.0135 m

export interface FlipperSpec {
  readonly side: Side;
  readonly pivotLocal: Vec3;
  readonly restAngleRad: number;
  readonly activeAngleRad: number;
  readonly extendSignX: 1 | -1;
}

export interface BumperSpec {
  readonly id: BumperId;
  readonly positionLocal: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly impulseMps: number;
  readonly points: number;
  readonly colorHex: number;
}

export interface SlingshotSpec {
  readonly side: Side;
  readonly verticesLocal: readonly [Vec3, Vec3, Vec3];
}

export interface DropTargetSpec {
  readonly id: DropTargetId;
  readonly positionLocal: Vec3;
}

export const TABLE_SPEC = {
  tiltDeg: TILT_DEG,
  tiltRad: TILT_RAD,

  physics: {
    fixedDt: 1 / 240,
    maxFrameDt: 0.05,
    gravityMps2: 9.81,
    ccdEnabled: true,
    allowBallSleep: false,
  },

  cabinet: {
    innerWidth: INNER_WIDTH,
    innerLength: INNER_LENGTH,
    playfieldThickness: PLAYFIELD_THICKNESS,
    sideWallThickness: SIDE_WALL_THICKNESS,
    endWallThickness: END_WALL_THICKNESS,
    outerWidth: OUTER_WIDTH,
    outerLength: OUTER_LENGTH,
    wallBottomY: WALL_BOTTOM_Y,
    wallTopY: WALL_TOP_Y,
    wallHeight: WALL_HEIGHT,
    floorThickness: FLOOR_THICKNESS,
    rootLiftY: ROOT_LIFT_Y,
  },

  playfield: {
    xMin: -INNER_WIDTH * 0.5,
    xMax: INNER_WIDTH * 0.5,
    zMin: -INNER_LENGTH * 0.5,
    zMax: INNER_LENGTH * 0.5,
    surfaceY: 0,
    mainActiveXMin: MAIN_ACTIVE_X_MIN,
    mainActiveXMax: MAIN_ACTIVE_X_MAX,
    mainActiveWidth: MAIN_ACTIVE_WIDTH,
    mainCenterX: MAIN_CENTER_X,
  },

  plungerLane: {
    laneWidth: PLUNGER_LANE_WIDTH,
    xMin: PLUNGER_X_MIN,
    xMax: PLUNGER_X_MAX,
    centerX: PLUNGER_CENTER_X,
    dividerX: DIVIDER_X,
    dividerThickness: DIVIDER_THICKNESS,
    dividerLength: DIVIDER_LENGTH,
    dividerHeight: DIVIDER_HEIGHT,
    dividerZMin: DIVIDER_Z_MIN,
    dividerZMax: DIVIDER_Z_MAX,
    dividerCenterLocal: {
      x: DIVIDER_X,
      y: DIVIDER_HEIGHT * 0.5,
      z: (DIVIDER_Z_MIN + DIVIDER_Z_MAX) * 0.5,
    } satisfies Vec3,
    ballSpawnLocal: {
      x: PLUNGER_CENTER_X,
      y: BALL_RADIUS,
      z: 0.455,
    } satisfies Vec3,
    maxPullM: 0.07,
    minLaunchSpeedMps: 2.65,
    maxLaunchSpeedMps: 4.55,
  },

  ball: {
    diameter: BALL_DIAMETER,
    radius: BALL_RADIUS,
    massKg: 0.08,
    restitution: 0.55,
    friction: 0.08,
    linearDamping: 0.05,
    angularDamping: 0.05,
  },

  flippers: {
    length: FLIPPER_LENGTH,
    thickness: FLIPPER_THICKNESS,
    height: FLIPPER_HEIGHT,
    pivotZ: FLIPPER_PIVOT_Z,
    halfSpanX: FLIPPER_HALF_SPAN_X,
    restAngleDeg: FLIPPER_REST_ANGLE_DEG,
    activeAngleDeg: FLIPPER_ACTIVE_ANGLE_DEG,
    maxAngularSpeedRadPerSec: 26,
    tipGapAtRestM: FLIPPER_TIP_GAP_AT_REST_M,
    left: {
      side: 'left',
      pivotLocal: { x: FLIPPER_LEFT_X, y: 0, z: FLIPPER_PIVOT_Z },
      restAngleRad: -FLIPPER_REST_RAD,
      activeAngleRad: FLIPPER_ACTIVE_RAD,
      extendSignX: 1,
    } satisfies FlipperSpec,
    right: {
      side: 'right',
      pivotLocal: { x: FLIPPER_RIGHT_X, y: 0, z: FLIPPER_PIVOT_Z },
      restAngleRad: FLIPPER_REST_RAD,
      activeAngleRad: -FLIPPER_ACTIVE_RAD,
      extendSignX: -1,
    } satisfies FlipperSpec,
  },

  bumpers: [
    {
      id: 'bumper-top',
      positionLocal: { x: MAIN_CENTER_X, y: 0, z: -0.24 },
      radius: 0.03,
      height: 0.04,
      impulseMps: 1.45,
      points: 250,
      colorHex: 0xf59e0b,
    },
    {
      id: 'bumper-left',
      positionLocal: { x: -0.112, y: 0, z: -0.125 },
      radius: 0.03,
      height: 0.04,
      impulseMps: 1.45,
      points: 250,
      colorHex: 0x38bdf8,
    },
    {
      id: 'bumper-right',
      positionLocal: { x: 0.068, y: 0, z: -0.125 },
      radius: 0.03,
      height: 0.04,
      impulseMps: 1.45,
      points: 250,
      colorHex: 0xe879f9,
    },
  ] as const satisfies readonly BumperSpec[],

  slingshots: {
    kickImpulseMps: 1.35,
    points: 150,
    left: {
      side: 'left',
      verticesLocal: [
        { x: -0.195, y: 0, z: 0.165 },
        { x: -0.195, y: 0, z: 0.275 },
        { x: -0.13, y: 0, z: 0.265 },
      ],
    } satisfies SlingshotSpec,
    right: {
      side: 'right',
      verticesLocal: [
        { x: 0.151, y: 0, z: 0.165 },
        { x: 0.151, y: 0, z: 0.275 },
        { x: 0.086, y: 0, z: 0.265 },
      ],
    } satisfies SlingshotSpec,
  },

  dropTargets: {
    size: {
      width: 0.012,
      height: 0.034,
      depth: 0.042,
    } satisfies BoxExtents3D,
    pointsEach: 500,
    bankBonusPoints: 2500,
    targets: [
      { id: 'target-1', positionLocal: { x: -0.228, y: 0, z: -0.055 } },
      { id: 'target-2', positionLocal: { x: -0.228, y: 0, z: 0.005 } },
      { id: 'target-3', positionLocal: { x: -0.228, y: 0, z: 0.065 } },
    ] as const satisfies readonly DropTargetSpec[],
  },

  stainedGlassRamp: {
    id: 'stained-glass-ramp' satisfies RampId,
    entryLocal: { x: -0.155, y: 0, z: -0.295 } satisfies Vec3,
    peakElevationY: 0.068,
    exitLocal: { x: -0.215, y: 0, z: 0.21 } satisfies Vec3,
    laneWidth: 0.042,
    points: 1000,
  },

  multiballLock: {
    sensorLocal: { x: 0.138, y: 0.014, z: -0.285 } satisfies Vec3,
    sensorRadius: 0.024,
    locksRequired: 3,
    releaseBallCount: 3,
  },

  drainSensor: {
    centerLocal: { x: MAIN_CENTER_X, y: 0.015, z: 0.475 } satisfies Vec3,
    halfExtents: { x: 0.11, y: 0.025, z: 0.03 } satisfies Vec3,
  },

  rules: {
    ballsPerGame: 3,
    maxTiltWarnings: 2,
    maxMultiplier: 8,
    quests: {
      roseRitualHits: 10,
      roseRitualRewardPoints: 4000,
      rampAscensionShots: 3,
      rampAscensionRewardPoints: 5000,
      sanctuaryChoirHits: 5,
      sanctuaryChoirRewardPoints: 4500,
    },
    wizardMode: {
      ballCount: 4,
      durationSec: 25,
      ballSaveSec: 15,
      startBonusPoints: 10000,
      superJackpotPoints: 2500,
      bumperFrenzyBonusPoints: 500,
    },
  },

  anchorNodes: {
    root: 'Pinball_Table_Root',
    playfieldDeck: 'Playfield_Deck',
    plungerDivider: 'Plunger_Lane_Divider',
    flipperPivotLeft: 'Flipper_Pivot_Left',
    flipperPivotRight: 'Flipper_Pivot_Right',
    bumperTop: 'Bumper_Top',
    bumperLeft: 'Bumper_Left',
    bumperRight: 'Bumper_Right',
    stainedGlassRamp: 'Ramp_StainedGlass',
    roseWindowInsert: 'RoseWindow_Insert',
  },
} as const;

/** Convert a position from Blender Z-up coordinates to Three.js / Rapier3D Y-up coordinates. */
export function blenderToThree(v: Vec3): Vec3 {
  return { x: v.x, y: v.z, z: -v.y };
}

/** Convert a position from Three.js / Rapier3D Y-up coordinates back to Blender Z-up coordinates. */
export function threeToBlender(v: Vec3): Vec3 {
  return { x: v.x, y: -v.z, z: v.y };
}

/** Canonical quaternion rotating playfield-local coordinates by +6.5 deg around +X. */
export function playfieldTiltQuaternion(): Quat {
  const half = TILT_RAD * 0.5;
  return {
    x: Math.sin(half),
    y: 0,
    z: 0,
    w: Math.cos(half),
  };
}

/** Transform a playfield-local Y-up point into tilted world Y-up space. */
export function playfieldLocalToWorld(local: Vec3): Vec3 {
  const c = Math.cos(TILT_RAD);
  const s = Math.sin(TILT_RAD);
  return {
    x: local.x,
    y: local.y * c - local.z * s + ROOT_LIFT_Y,
    z: local.y * s + local.z * c,
  };
}

/** Transform a world Y-up point back into untitled playfield-local Y-up coordinates. */
export function worldToPlayfieldLocal(world: Vec3): Vec3 {
  const c = Math.cos(TILT_RAD);
  const s = Math.sin(TILT_RAD);
  const dy = world.y - ROOT_LIFT_Y;
  const dz = world.z;
  return {
    x: world.x,
    y: dy * c + dz * s,
    z: -dy * s + dz * c,
  };
}
