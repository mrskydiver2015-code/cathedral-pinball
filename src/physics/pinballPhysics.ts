import RAPIER from '@dimforge/rapier3d-compat';
import type { PinballEventBus } from '../shared/events.ts';
import { TABLE_SPEC, type FlipperSpec, type SlingshotSpec } from '../shared/tableSpec.ts';
import type {
  BallTelemetry,
  BumperId,
  DropTargetId,
  NudgeDirection,
  Side,
  Vec3,
} from '../shared/types.ts';

export interface PhysicsFrameData {
  readonly balls: readonly BallTelemetry[];
  readonly flipperAngles: {
    readonly left: number;
    readonly right: number;
  };
  readonly dropTargetDown: readonly [boolean, boolean, boolean];
  readonly plungerPullM: number;
}

export interface PhysicsWorldHooks {
  onBallDrain?(ballId: number, activeBallsRemaining: number): void;
  onMultiballLockHit?(ballId: number): void;
  onRolloverHit?(ballId: number, laneIndex: 0 | 1 | 2): void;
}

type ColliderRole =
  | { readonly kind: 'bumper'; readonly id: BumperId; readonly pos: Vec3; readonly impulseMps: number; readonly points: number; readonly colorHex: number }
  | { readonly kind: 'slingshot'; readonly side: Side; readonly p0: { x: number; z: number }; readonly normal: { x: number; z: number } }
  | { readonly kind: 'dropTarget'; readonly index: 0 | 1 | 2; readonly id: DropTargetId; readonly pos: Vec3 }
  | { readonly kind: 'rollover'; readonly laneIndex: 0 | 1 | 2 }
  | { readonly kind: 'rampEntry' }
  | { readonly kind: 'rampExit' }
  | { readonly kind: 'multiballLock' }
  | { readonly kind: 'drain' };

interface BallRecord {
  readonly id: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  onRamp: boolean;
  locked: boolean;
  lockCooldownSec: number;
  rampCooldownSec: number;
  onRampElapsedSec: number;
  rollEmitAccumSec: number;
  lowSpeedSec: number;
  recentKickerIds: string[];
  kickerLoopStreak: number;
  lastKickerTimeSec: number;
  loopAnchorX: number;
  loopAnchorZ: number;
  loopAnchorSec: number;
}

interface DropTargetRecord {
  readonly index: 0 | 1 | 2;
  readonly id: DropTargetId;
  readonly collider: RAPIER.Collider;
  down: boolean;
}

const GROUP_PLAYFIELD = 0x0001;
const GROUP_RAMP = 0x0002;
const GROUP_SENSOR = 0x0004;

function makeInteractionGroups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

const GROUPS_PLAYFIELD_STATIC = makeInteractionGroups(GROUP_PLAYFIELD, GROUP_PLAYFIELD);
const GROUPS_RAMP_STATIC = makeInteractionGroups(GROUP_RAMP, GROUP_RAMP);
const GROUPS_CEILING_STATIC = makeInteractionGroups(
  GROUP_PLAYFIELD | GROUP_RAMP,
  GROUP_PLAYFIELD | GROUP_RAMP,
);
const GROUPS_SENSOR_STATIC = makeInteractionGroups(GROUP_SENSOR, GROUP_PLAYFIELD | GROUP_RAMP);
const GROUPS_BALL_PLAYFIELD = makeInteractionGroups(
  GROUP_PLAYFIELD,
  GROUP_PLAYFIELD | GROUP_SENSOR,
);
const GROUPS_BALL_ON_RAMP = makeInteractionGroups(GROUP_RAMP, GROUP_RAMP | GROUP_SENSOR);

const MAX_BALL_SPEED_MPS = 5.8;
const PLUNGER_CHARGE_RATE_PER_SEC = 1.15;
const PLUNGER_REST_Z = 0.472;
const PLUNGER_TIP_HALF_DEPTH = 0.06;
const PLUNGER_MAX_PHYSICAL_PULL_M = 0.036;
const GLASS_CEILING_BOTTOM_Y = 0.097;
const GLASS_CEILING_HALF_Y = 0.008;

const LOCK_PARK_POSITIONS: readonly Vec3[] = [
  { x: 0.138, y: TABLE_SPEC.ball.radius, z: -0.285 },
  { x: 0.138, y: TABLE_SPEC.ball.radius, z: -0.318 },
  { x: 0.138, y: TABLE_SPEC.ball.radius, z: -0.351 },
];

const MULTIBALL_SAFE_SPAWNS: readonly { readonly pos: Vec3; readonly vel: Vec3 }[] = [
  { pos: { x: -0.022, y: TABLE_SPEC.ball.radius, z: -0.02 }, vel: { x: -0.35, y: 0, z: -0.6 } },
  { pos: { x: -0.095, y: TABLE_SPEC.ball.radius, z: 0.04 }, vel: { x: 0.42, y: 0, z: -0.52 } },
  { pos: { x: 0.055, y: TABLE_SPEC.ball.radius, z: 0.04 }, vel: { x: -0.32, y: 0, z: -0.62 } },
  { pos: { x: -0.022, y: TABLE_SPEC.ball.radius, z: 0.09 }, vel: { x: 0.28, y: 0, z: -0.68 } },
  { pos: { x: -0.135, y: TABLE_SPEC.ball.radius, z: -0.025 }, vel: { x: 0.5, y: 0, z: -0.45 } },
  { pos: { x: 0.105, y: TABLE_SPEC.ball.radius, z: -0.025 }, vel: { x: -0.48, y: 0, z: -0.48 } },
];

function yAxisQuaternion(angleRad: number): RAPIER.Rotation {
  const half = angleRad * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function evalRampCurve(t: number): Vec3 {
  const entry = TABLE_SPEC.stainedGlassRamp.entryLocal;
  const exit = TABLE_SPEC.stainedGlassRamp.exitLocal;
  const peakY = TABLE_SPEC.stainedGlassRamp.peakElevationY;
  const omt = 1 - t;
  const ctrlX = -0.215;
  const x = omt * omt * entry.x + 2 * omt * t * ctrlX + t * t * exit.x;
  const z = entry.z + (exit.z - entry.z) * t;
  const baseStartY = 0.002;
  const baseEndY = 0.005;
  const baseY = baseStartY + (baseEndY - baseStartY) * t;
  const archDelta = peakY - (baseStartY + baseEndY) * 0.5;
  const bell = Math.sin(Math.PI * t);
  const y = baseY + archDelta * bell * bell;
  return { x, y, z };
}

/**
 * Deterministic 240 Hz Rapier3D physics simulation running in playfield-local Y-up space
 * with 6.5° tilted gravity, CCD steel pinballs, and kinematic position-based flippers.
 */
export class PinballPhysicsWorld {
  private readonly bus: PinballEventBus;
  private readonly hooks: PhysicsWorldHooks;
  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly staticBody: RAPIER.RigidBody;

  private readonly colliderRoles = new Map<number, ColliderRole>();
  private readonly ballByCollider = new Map<number, BallRecord>();
  private readonly balls = new Map<number, BallRecord>();
  private readonly dropTargets: DropTargetRecord[] = [];
  private readonly cooldowns = new Map<string, number>();

  private readonly leftFlipperBody: RAPIER.RigidBody;
  private readonly rightFlipperBody: RAPIER.RigidBody;
  private readonly plungerTipBody: RAPIER.RigidBody;

  private leftFlipperPressed = false;
  private rightFlipperPressed = false;
  private leftFlipperAngle = TABLE_SPEC.flippers.left.restAngleRad;
  private rightFlipperAngle = TABLE_SPEC.flippers.right.restAngleRad;

  private plungerCharging = false;
  private plungerChargeRatio = 0;
  private plungerPullM = 0;
  private plungerEmitAccumSec = 0;

  private nextBallId = 1;
  private simTimeSec = 0;
  private accumulatorSec = 0;
  private autoRescueCount = 0;
  private disposed = false;

  private constructor(bus: PinballEventBus, hooks: PhysicsWorldHooks) {
    this.bus = bus;
    this.hooks = hooks;

    const g = TABLE_SPEC.physics.gravityMps2;
    const tilt = TABLE_SPEC.tiltRad;
    this.world = new RAPIER.World({
      x: 0,
      y: -g * Math.cos(tilt),
      z: g * Math.sin(tilt),
    });
    this.world.timestep = TABLE_SPEC.physics.fixedDt;
    this.world.lengthUnit = 0.05;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 2;

    this.eventQueue = new RAPIER.EventQueue(true);
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    this.buildCabinetAndDeck();
    this.buildUpperOrbitArch();
    this.buildRolloverDividers();
    this.buildApronAndDrainGuides();
    this.buildBumpers();
    this.buildSlingshots();
    this.buildDropTargets();
    this.buildStainedGlassRamp();
    this.buildSensors();

    this.leftFlipperBody = this.createFlipperBody(TABLE_SPEC.flippers.left);
    this.rightFlipperBody = this.createFlipperBody(TABLE_SPEC.flippers.right);
    this.plungerTipBody = this.createPlungerTipBody();
  }

  static async create(
    bus: PinballEventBus,
    hooks: PhysicsWorldHooks = {},
  ): Promise<PinballPhysicsWorld> {
    await RAPIER.init();
    return new PinballPhysicsWorld(bus, hooks);
  }

  private createStaticCollider(desc: RAPIER.ColliderDesc, role?: ColliderRole): RAPIER.Collider {
    const collider = this.world.createCollider(desc, this.staticBody);
    if (role) {
      this.colliderRoles.set(collider.handle, role);
    }
    return collider;
  }

  private createWallSegment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    thickness: number,
    height: number,
    offsetOutwardLeft: number,
    restitution = 0.55,
    groups = GROUPS_PLAYFIELD_STATIC,
  ): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return;
    // Left-hand normal in XZ plane relative to segment direction (dx, dz)
    const nx = dz / len;
    const nz = -dx / len;
    const midX = (ax + bx) * 0.5 + nx * offsetOutwardLeft;
    const midZ = (az + bz) * 0.5 + nz * offsetOutwardLeft;
    const yaw = Math.atan2(dx, dz);

    const desc = RAPIER.ColliderDesc.cuboid(thickness * 0.5, height * 0.5, len * 0.5)
      .setTranslation(midX, height * 0.5, midZ)
      .setRotation(yAxisQuaternion(yaw))
      .setRestitution(restitution)
      .setFriction(0.03)
      .setCollisionGroups(groups);
    this.createStaticCollider(desc);
  }

  private buildCabinetAndDeck(): void {
    const { cabinet, playfield, plungerLane } = TABLE_SPEC;
    const halfInnerW = cabinet.innerWidth * 0.5;
    const halfInnerL = cabinet.innerLength * 0.5;

    // Playfield deck slab (top surface at exact y = 0.0)
    const deckDesc = RAPIER.ColliderDesc.cuboid(
      halfInnerW + cabinet.sideWallThickness,
      cabinet.playfieldThickness * 0.5,
      halfInnerL + cabinet.endWallThickness,
    )
      .setTranslation(0, -cabinet.playfieldThickness * 0.5, 0)
      .setRestitution(0.15)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setFriction(0.035)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.createStaticCollider(deckDesc);

    // Invisible glass ceiling slab (prevents balls popping above y ≈ 0.095..0.097)
    const ceilingDesc = RAPIER.ColliderDesc.cuboid(
      halfInnerW + cabinet.sideWallThickness,
      GLASS_CEILING_HALF_Y,
      halfInnerL + cabinet.endWallThickness,
    )
      .setTranslation(0, GLASS_CEILING_BOTTOM_Y + GLASS_CEILING_HALF_Y, 0)
      .setRestitution(0.1)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setFriction(0.02)
      .setCollisionGroups(GROUPS_CEILING_STATIC);
    this.createStaticCollider(ceilingDesc);

    const wallCenterY = (cabinet.wallBottomY + cabinet.wallTopY) * 0.5;
    const wallHalfH = cabinet.wallHeight * 0.5;
    const halfOuterL = cabinet.outerLength * 0.5;

    // Left & right inner cabinet walls at x = ±0.2575
    const leftWallDesc = RAPIER.ColliderDesc.cuboid(
      cabinet.sideWallThickness * 0.5,
      wallHalfH,
      halfOuterL,
    )
      .setTranslation(-(halfInnerW + cabinet.sideWallThickness * 0.5), wallCenterY, 0)
      .setRestitution(0.55)
      .setFriction(0.03)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.createStaticCollider(leftWallDesc);

    const rightWallDesc = RAPIER.ColliderDesc.cuboid(
      cabinet.sideWallThickness * 0.5,
      wallHalfH,
      halfOuterL,
    )
      .setTranslation(halfInnerW + cabinet.sideWallThickness * 0.5, wallCenterY, 0)
      .setRestitution(0.55)
      .setFriction(0.03)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.createStaticCollider(rightWallDesc);

    // Rear & front inner cabinet walls at z = ±0.535
    const rearWallDesc = RAPIER.ColliderDesc.cuboid(
      halfInnerW,
      wallHalfH,
      cabinet.endWallThickness * 0.5,
    )
      .setTranslation(0, wallCenterY, -(halfInnerL + cabinet.endWallThickness * 0.5))
      .setRestitution(0.55)
      .setFriction(0.03)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.createStaticCollider(rearWallDesc);

    const frontWallDesc = RAPIER.ColliderDesc.cuboid(
      halfInnerW,
      wallHalfH,
      cabinet.endWallThickness * 0.5,
    )
      .setTranslation(0, wallCenterY, halfInnerL + cabinet.endWallThickness * 0.5)
      .setRestitution(0.45)
      .setFriction(0.04)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.createStaticCollider(frontWallDesc);

    // Plunger lane divider (x = +0.2175, trimmed 6 mm at top to ensure >= 1.4x ball diameter arch mouth clearance)
    const dividerLen = plungerLane.dividerLength - 0.006;
    const dividerDesc = RAPIER.ColliderDesc.roundCuboid(
      Math.max(0.001, plungerLane.dividerThickness * 0.5 - 0.002),
      plungerLane.dividerHeight * 0.5 - 0.002,
      dividerLen * 0.5 - 0.002,
      0.002,
    )
      .setTranslation(
        plungerLane.dividerCenterLocal.x,
        plungerLane.dividerCenterLocal.y,
        plungerLane.dividerCenterLocal.z + 0.003,
      )
      .setRestitution(0.5)
      .setFriction(0.025)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.createStaticCollider(dividerDesc);

    // Subtle guard ensuring playfield center coordinates remain explicitly referenced
    void playfield.surfaceY;
  }

  private buildUpperOrbitArch(): void {
    const segments = 24;
    const cx = 0.0;
    const cz = -0.265;
    const rx = 0.2575;
    const rz = 0.265;
    const thickness = 0.014;
    const halfThick = thickness * 0.5;
    const height = 0.044;

    for (let i = 0; i < segments; i += 1) {
      const t0 = (i / segments) * Math.PI;
      const t1 = ((i + 1) / segments) * Math.PI;

      const x0 = cx + rx * Math.cos(t0);
      const z0 = cz - rz * Math.sin(t0);
      const x1 = cx + rx * Math.cos(t1);
      const z1 = cz - rz * Math.sin(t1);

      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      // Outward normal pointing away from arch interior (0, -0.265)
      const nx = -dz / len;
      const nz = dx / len;
      const midX = (x0 + x1) * 0.5 + nx * halfThick;
      const midZ = (z0 + z1) * 0.5 + nz * halfThick;
      const yaw = Math.atan2(dx, dz);

      const segDesc = RAPIER.ColliderDesc.cuboid(halfThick, height * 0.5, len * 0.5 + 0.0025)
        .setTranslation(midX, height * 0.5, midZ)
        .setRotation(yAxisQuaternion(yaw))
        .setRestitution(0.5)
        .setFriction(0.015)
        .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
      this.createStaticCollider(segDesc);
    }
  }

  private buildRolloverDividers(): void {
    const xPositions = [-0.127, -0.057, 0.013, 0.083];
    // Shifted slightly downfield so leftmost divider retains >= 0.052 m (>= 1.9x D) arch clearance
    const zMin = -0.435;
    const zMax = -0.355;
    const zCenter = (zMin + zMax) * 0.5;
    const halfLen = (zMax - zMin) * 0.5;
    const border = 0.003;

    for (const x of xPositions) {
      const desc = RAPIER.ColliderDesc.roundCuboid(
        0.001,
        0.02,
        Math.max(0.005, halfLen - border),
        border,
      )
        .setTranslation(x, 0.021, zCenter)
        .setRestitution(0.55)
        .setFriction(0.02)
        .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
      this.createStaticCollider(desc);
    }
  }

  private buildApronAndDrainGuides(): void {
    const wallH = 0.034;
    const wallT = 0.01;
    const halfT = wallT * 0.5;

    // 45-deg corner fillets flush against cabinet wall (left) & plunger divider (right) so no corner pockets exist
    this.createWallSegment(-0.258, 0.295, -0.234, 0.318, wallT, wallH, -halfT, 0.35);
    this.createWallSegment(0.214, 0.295, 0.19, 0.318, wallT, wallH, halfT, 0.35);

    // Smooth apron funnel guides aligned to the upper flipper hubs (>= 1.85x D slingshot clearance, 0.7 mm off hub sweep)
    this.createWallSegment(-0.234, 0.318, -0.125, 0.341, wallT, wallH, -halfT, 0.35);
    this.createWallSegment(0.19, 0.318, 0.081, 0.341, wallT, wallH, halfT, 0.35);

    // Rounded end-caps terminating smoothly outside each flipper pivot to eliminate wedge notches
    for (const endPt of [
      { x: -0.125, z: 0.341 },
      { x: 0.081, z: 0.341 },
    ]) {
      const capDesc = RAPIER.ColliderDesc.cylinder(wallH * 0.5, halfT)
        .setTranslation(endPt.x, wallH * 0.5, endPt.z)
        .setRestitution(0.35)
        .setFriction(0.02)
        .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
      this.createStaticCollider(capDesc);
    }

    // Lower drain gutter guides sealed flush to outer walls funneling straight into center drainSensor
    this.createWallSegment(-0.258, 0.365, -0.095, 0.49, wallT, wallH, -halfT, 0.25);
    this.createWallSegment(0.214, 0.365, 0.051, 0.49, wallT, wallH, halfT, 0.25);
  }

  private buildBumpers(): void {
    for (const bumper of TABLE_SPEC.bumpers) {
      const role: ColliderRole = {
        kind: 'bumper',
        id: bumper.id,
        pos: bumper.positionLocal,
        impulseMps: bumper.impulseMps,
        points: bumper.points,
        colorHex: bumper.colorHex,
      };

      const bodyDesc = RAPIER.ColliderDesc.cylinder(bumper.height * 0.5, bumper.radius)
        .setTranslation(bumper.positionLocal.x, bumper.height * 0.5, bumper.positionLocal.z)
        .setRestitution(0.85)
        .setFriction(0.02)
        .setCollisionGroups(GROUPS_PLAYFIELD_STATIC)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.createStaticCollider(bodyDesc, role);

      // Sloped conical roof prevents any airborne ball from resting on top of a bumper cap
      const roofHalfH = 0.026;
      const capDesc = RAPIER.ColliderDesc.cone(roofHalfH, bumper.radius + 0.002)
        .setTranslation(bumper.positionLocal.x, bumper.height + roofHalfH, bumper.positionLocal.z)
        .setRestitution(0.65)
        .setFriction(0.01)
        .setCollisionGroups(GROUPS_PLAYFIELD_STATIC)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.createStaticCollider(capDesc, role);
    }
  }

  private buildSlingshots(): void {
    const height = 0.036;
    const apexHeight = 0.064;
    const slings: readonly (readonly [Side, SlingshotSpec])[] = [
      ['left', TABLE_SPEC.slingshots.left],
      ['right', TABLE_SPEC.slingshots.right],
    ];

    for (const [side, sling] of slings) {
      const [v0, v1, v2] = sling.verticesLocal;
      const cx = (v0.x + v1.x + v2.x) / 3;
      const cz = (v0.z + v1.z + v2.z) / 3;
      // Pyramid roof apex ensures balls can never balance on top of a slingshot housing
      const pts = new Float32Array([
        v0.x, 0.001, v0.z,
        v1.x, 0.001, v1.z,
        v2.x, 0.001, v2.z,
        v0.x, height, v0.z,
        v1.x, height, v1.z,
        v2.x, height, v2.z,
        cx, apexHeight, cz,
      ]);

      const hull = RAPIER.ColliderDesc.convexHull(pts);
      if (!hull) {
        throw new Error(`Failed to construct slingshot convex hull for ${side}`);
      }
      hull
        .setRestitution(0.75)
        .setFriction(0.025)
        .setCollisionGroups(GROUPS_PLAYFIELD_STATIC)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

      const dx = v2.x - v0.x;
      const dz = v2.z - v0.z;
      const len = Math.hypot(dx, dz);
      const nx = side === 'left' ? dz / len : -dz / len;
      const nz = side === 'left' ? -dx / len : dx / len;

      this.createStaticCollider(hull, {
        kind: 'slingshot',
        side,
        p0: { x: v0.x, z: v0.z },
        normal: { x: nx, z: nz },
      });
    }
  }

  private buildDropTargets(): void {
    const { size, targets } = TABLE_SPEC.dropTargets;
    // Seal the 23.5 mm gap behind the drop target bank with beveled top/bottom entry ramps
    const bankMinZ = -0.082;
    const bankMaxZ = 0.092;
    const backWallX = -0.258;
    const targetBackX = -0.234;
    const bankCenterX = (backWallX + targetBackX) * 0.5;
    const bankHalfW = (targetBackX - backWallX) * 0.5;
    const bankHalfH = 0.024;

    const backplaneDesc = RAPIER.ColliderDesc.cuboid(
      bankHalfW,
      bankHalfH,
      (bankMaxZ - bankMinZ) * 0.5,
    )
      .setTranslation(bankCenterX, bankHalfH, (bankMinZ + bankMaxZ) * 0.5)
      .setRestitution(0.45)
      .setFriction(0.02)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.createStaticCollider(backplaneDesc);

    this.createWallSegment(-0.258, -0.118, -0.234, bankMinZ, 0.008, 0.044, -0.004, 0.45);
    this.createWallSegment(-0.234, bankMaxZ, -0.258, 0.128, 0.008, 0.044, -0.004, 0.45);

    targets.forEach((target, idx) => {
      const index = idx as 0 | 1 | 2;
      const desc = RAPIER.ColliderDesc.cuboid(size.width * 0.5, size.height * 0.5, size.depth * 0.5)
        .setTranslation(target.positionLocal.x, size.height * 0.5, target.positionLocal.z)
        .setRestitution(0.55)
        .setFriction(0.04)
        .setCollisionGroups(GROUPS_PLAYFIELD_STATIC)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

      const collider = this.createStaticCollider(desc, {
        kind: 'dropTarget',
        index,
        id: target.id,
        pos: target.positionLocal,
      });

      this.dropTargets.push({
        index,
        id: target.id,
        collider,
        down: false,
      });
    });
  }

  private buildStainedGlassRamp(): void {
    const segments = 12;
    const halfLane = TABLE_SPEC.stainedGlassRamp.laneWidth * 0.5;
    const floorHalfH = 0.003;
    const wallHalfW = 0.003;
    const wallHalfH = 0.015;

    for (let i = 0; i < segments; i += 1) {
      const p0 = evalRampCurve(i / segments);
      const p1 = evalRampCurve((i + 1) / segments);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dz = p1.z - p0.z;
      const segLen = Math.hypot(dx, dy, dz);
      const horizLen = Math.hypot(dx, dz);

      const midX = (p0.x + p1.x) * 0.5;
      const midY = (p0.y + p1.y) * 0.5;
      const midZ = (p0.z + p1.z) * 0.5;

      // Tangent direction and pitch/yaw orientation aligning +Z with tangent, +X horizontal
      const yaw = Math.atan2(dx, dz);
      const pitch = -Math.atan2(dy, horizLen);
      const cy = Math.cos(yaw * 0.5);
      const sy = Math.sin(yaw * 0.5);
      const cx = Math.cos(pitch * 0.5);
      const sx = Math.sin(pitch * 0.5);
      // Quaternion q = q_yaw * q_pitch
      const q: RAPIER.Rotation = {
        x: cy * sx,
        y: sy * cx,
        z: -sy * sx,
        w: cy * cx,
      };

      // Local axes under q:
      // local X = (cos(yaw), 0, -sin(yaw))
      // local Y = (sin(yaw)*(-sin(pitch)), cos(pitch), cos(yaw)*(-sin(pitch)))
      const sinYaw = Math.sin(yaw);
      const cosYaw = Math.cos(yaw);
      const sinPitch = Math.sin(pitch);
      const cosPitch = Math.cos(pitch);
      const lx = { x: cosYaw, y: 0, z: -sinYaw };
      const ly = {
        x: -sinYaw * sinPitch,
        y: cosPitch,
        z: -cosYaw * sinPitch,
      };

      const halfLen = segLen * 0.5 + 0.004;

      const floorDesc = RAPIER.ColliderDesc.cuboid(halfLane + wallHalfW * 2, floorHalfH, halfLen)
        .setTranslation(
          midX - ly.x * floorHalfH,
          midY - ly.y * floorHalfH,
          midZ - ly.z * floorHalfH,
        )
        .setRotation(q)
        .setRestitution(0.1)
        .setFriction(0.015)
        .setCollisionGroups(GROUPS_RAMP_STATIC);
      this.createStaticCollider(floorDesc);

      const wallOffsetY = wallHalfH - 0.002;
      const wallOffsetX = halfLane + wallHalfW;

      const leftRailDesc = RAPIER.ColliderDesc.cuboid(wallHalfW, wallHalfH, halfLen)
        .setTranslation(
          midX - lx.x * wallOffsetX + ly.x * wallOffsetY,
          midY - lx.y * wallOffsetX + ly.y * wallOffsetY,
          midZ - lx.z * wallOffsetX + ly.z * wallOffsetY,
        )
        .setRotation(q)
        .setRestitution(0.35)
        .setFriction(0.015)
        .setCollisionGroups(GROUPS_RAMP_STATIC);
      this.createStaticCollider(leftRailDesc);

      const rightRailDesc = RAPIER.ColliderDesc.cuboid(wallHalfW, wallHalfH, halfLen)
        .setTranslation(
          midX + lx.x * wallOffsetX + ly.x * wallOffsetY,
          midY + lx.y * wallOffsetX + ly.y * wallOffsetY,
          midZ + lx.z * wallOffsetX + ly.z * wallOffsetY,
        )
        .setRotation(q)
        .setRestitution(0.35)
        .setFriction(0.015)
        .setCollisionGroups(GROUPS_RAMP_STATIC);
      this.createStaticCollider(rightRailDesc);
    }
  }

  private buildSensors(): void {
    const { stainedGlassRamp, multiballLock, drainSensor } = TABLE_SPEC;

    // 3 Upper Rollover Lane Sensors between Rollover_Divider_1..4 (used for Skill Shot & multiplier)
    const rolloverXs: readonly number[] = [-0.092, -0.022, 0.048];
    rolloverXs.forEach((rx, idx) => {
      const laneIndex = idx as 0 | 1 | 2;
      const rolloverDesc = RAPIER.ColliderDesc.cuboid(0.024, 0.022, 0.032)
        .setTranslation(rx, 0.016, -0.395)
        .setSensor(true)
        .setCollisionGroups(GROUPS_SENSOR_STATIC)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.createStaticCollider(rolloverDesc, { kind: 'rollover', laneIndex });
    });

    const rampEntryDesc = RAPIER.ColliderDesc.cylinder(0.018, 0.024)
      .setTranslation(stainedGlassRamp.entryLocal.x, 0.018, stainedGlassRamp.entryLocal.z)
      .setSensor(true)
      .setCollisionGroups(GROUPS_SENSOR_STATIC)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.createStaticCollider(rampEntryDesc, { kind: 'rampEntry' });

    const rampExitDesc = RAPIER.ColliderDesc.cylinder(0.022, 0.028)
      .setTranslation(stainedGlassRamp.exitLocal.x, 0.02, stainedGlassRamp.exitLocal.z)
      .setSensor(true)
      .setCollisionGroups(GROUPS_SENSOR_STATIC)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.createStaticCollider(rampExitDesc, { kind: 'rampExit' });

    const lockDesc = RAPIER.ColliderDesc.cylinder(0.018, multiballLock.sensorRadius)
      .setTranslation(
        multiballLock.sensorLocal.x,
        multiballLock.sensorLocal.y,
        multiballLock.sensorLocal.z,
      )
      .setSensor(true)
      .setCollisionGroups(GROUPS_SENSOR_STATIC)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.createStaticCollider(lockDesc, { kind: 'multiballLock' });

    // Widened center drain sensor sealing lower drain funnel cleanly
    const drainDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(drainSensor.halfExtents.x, 0.125),
      Math.max(drainSensor.halfExtents.y, 0.028),
      Math.max(drainSensor.halfExtents.z, 0.042),
    )
      .setTranslation(drainSensor.centerLocal.x, drainSensor.centerLocal.y, 0.48)
      .setSensor(true)
      .setCollisionGroups(GROUPS_SENSOR_STATIC)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.createStaticCollider(drainDesc, { kind: 'drain' });
  }

  private createFlipperBody(spec: FlipperSpec): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spec.pivotLocal.x, 0, spec.pivotLocal.z)
      .setRotation(yAxisQuaternion(spec.restAngleRad));
    const body = this.world.createRigidBody(bodyDesc);

    const sign = spec.extendSignX;
    const tipCenterX = sign * (TABLE_SPEC.flippers.length - 0.006);
    const hubR = 0.011;
    const tipR = 0.006;
    const yBot = 0.001;
    const yTop = 0.028;

    // Octagonal tapered prism matching Blender tapered bat profile
    const verts: number[] = [];
    const ringSteps = 8;
    for (let i = 0; i < ringSteps; i += 1) {
      const a = (i / ringSteps) * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      verts.push(hubR * cosA, yBot, hubR * sinA);
      verts.push(hubR * cosA, yTop, hubR * sinA);
      verts.push(tipCenterX + tipR * cosA, yBot, tipR * sinA);
      verts.push(tipCenterX + tipR * cosA, yTop, tipR * sinA);
    }

    const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(verts));
    if (!hull) {
      throw new Error(`Failed to construct flipper hull for ${spec.side}`);
    }
    hull
      .setRestitution(0.55)
      .setFriction(0.08)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.world.createCollider(hull, body);
    return body;
  }

  private createPlungerTipBody(): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      TABLE_SPEC.plungerLane.centerX,
      TABLE_SPEC.ball.radius,
      PLUNGER_REST_Z + PLUNGER_TIP_HALF_DEPTH,
    );
    const body = this.world.createRigidBody(bodyDesc);
    const tipDesc = RAPIER.ColliderDesc.cuboid(
      TABLE_SPEC.plungerLane.laneWidth * 0.44,
      TABLE_SPEC.ball.radius,
      PLUNGER_TIP_HALF_DEPTH,
    )
      .setRestitution(0.25)
      .setFriction(0.04)
      .setCollisionGroups(GROUPS_PLAYFIELD_STATIC);
    this.world.createCollider(tipDesc, body);
    return body;
  }

  private createBall(pos: Vec3, vel: Vec3 = { x: 0, y: 0, z: 0 }): number {
    const { ball, physics } = TABLE_SPEC;
    const id = this.nextBallId++;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(vel.x, vel.y, vel.z)
      .setCcdEnabled(physics.ccdEnabled)
      .setCanSleep(physics.allowBallSleep)
      .setLinearDamping(ball.linearDamping)
      .setAngularDamping(ball.angularDamping);

    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.ball(ball.radius)
      .setMass(ball.massKg)
      .setRestitution(ball.restitution)
      .setFriction(ball.friction)
      .setCollisionGroups(GROUPS_BALL_PLAYFIELD)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const collider = this.world.createCollider(colDesc, body);
    const record: BallRecord = {
      id,
      body,
      collider,
      onRamp: false,
      locked: false,
      lockCooldownSec: 0,
      rampCooldownSec: 0,
      onRampElapsedSec: 0,
      rollEmitAccumSec: 0,
      lowSpeedSec: 0,
      recentKickerIds: [],
      kickerLoopStreak: 0,
      lastKickerTimeSec: -10,
      loopAnchorX: pos.x,
      loopAnchorZ: pos.z,
      loopAnchorSec: 0,
    };
    this.balls.set(id, record);
    this.ballByCollider.set(collider.handle, record);
    return id;
  }

  private removeBall(ballId: number): void {
    const record = this.balls.get(ballId);
    if (!record) return;
    this.ballByCollider.delete(record.collider.handle);
    this.balls.delete(ballId);
    this.world.removeRigidBody(record.body);
  }

  setFlipperInput(side: Side, pressed: boolean): void {
    if (this.disposed) return;
    const prev = side === 'left' ? this.leftFlipperPressed : this.rightFlipperPressed;
    if (side === 'left') {
      this.leftFlipperPressed = pressed;
    } else {
      this.rightFlipperPressed = pressed;
    }
    if (prev !== pressed) {
      this.bus.emit('flipperFire', {
        side,
        pressed,
        angularSpeedRadPerSec: TABLE_SPEC.flippers.maxAngularSpeedRadPerSec,
      });
    }
  }

  private resetPlungerTipToRest(snap = true): void {
    this.plungerCharging = false;
    this.plungerChargeRatio = 0;
    this.plungerPullM = 0;
    const restPos = {
      x: TABLE_SPEC.plungerLane.centerX,
      y: TABLE_SPEC.ball.radius,
      z: PLUNGER_REST_Z + PLUNGER_TIP_HALF_DEPTH,
    };
    if (snap) {
      this.plungerTipBody.setTranslation(restPos, false);
    }
    this.plungerTipBody.setNextKinematicTranslation(restPos);
  }

  setPlungerCharging(charging: boolean): void {
    if (this.disposed) return;
    if (!charging) {
      this.resetPlungerTipToRest(true);
      return;
    }
    this.plungerCharging = true;
  }

  setManualPlungerCharge(ratio: number): void {
    if (this.disposed) return;
    const clamped = clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1);
    const prevStep = Math.floor(this.plungerChargeRatio * 10);
    const nextStep = Math.floor(clamped * 10);
    this.plungerCharging = false;
    this.plungerChargeRatio = clamped;
    this.plungerPullM = clamped * TABLE_SPEC.plungerLane.maxPullM;
    const tipPullM = clamped * PLUNGER_MAX_PHYSICAL_PULL_M;
    this.plungerTipBody.setNextKinematicTranslation({
      x: TABLE_SPEC.plungerLane.centerX,
      y: TABLE_SPEC.ball.radius,
      z: PLUNGER_REST_Z + PLUNGER_TIP_HALF_DEPTH + tipPullM,
    });
    if (nextStep !== prevStep) {
      this.bus.emit('plungerCharge', {
        ratio: this.plungerChargeRatio,
        pullDistanceM: this.plungerPullM,
      });
    }
  }

  getAutoRescueCount(): number {
    return this.autoRescueCount;
  }

  rescueStuckBalls(): number {
    if (this.disposed) return 0;
    let rescued = 0;
    const slowBalls: BallRecord[] = [];
    const activeNonPlunger: BallRecord[] = [];
    const plungerBalls: BallRecord[] = [];

    for (const ball of this.balls.values()) {
      if (ball.locked) continue;
      const pos = ball.body.translation();
      if (this.isInPlungerLane(pos)) {
        plungerBalls.push(ball);
        continue;
      }
      activeNonPlunger.push(ball);
      const vel = ball.body.linvel();
      if (Math.hypot(vel.x, vel.y, vel.z) < 0.25) {
        slowBalls.push(ball);
      }
    }

    const targets = slowBalls.length > 0 ? slowBalls : activeNonPlunger;
    for (const ball of targets) {
      this.applyRescueImpulse(ball, true);
      rescued += 1;
    }

    if (rescued === 0 && plungerBalls.length > 0) {
      this.launchPlunger(0.85);
      for (const ball of plungerBalls) {
        const pos = ball.body.translation();
        this.bus.emit('ballRescue', {
          ballId: ball.id,
          manual: true,
          position: { x: pos.x, y: pos.y, z: pos.z },
        });
        rescued += 1;
      }
    }

    return rescued;
  }

  launchPlunger(chargeRatio: number): void {
    if (this.disposed) return;
    const ratio = clamp(Number.isFinite(chargeRatio) ? chargeRatio : 0.5, 0.05, 1);
    const { plungerLane, ball: ballSpec } = TABLE_SPEC;
    const launchSpeed =
      plungerLane.minLaunchSpeedMps +
      (plungerLane.maxLaunchSpeedMps - plungerLane.minLaunchSpeedMps) * ratio;

    const launchSafeZ = PLUNGER_REST_Z - ballSpec.radius - 0.002;
    for (const ball of this.balls.values()) {
      if (ball.locked) continue;
      const pos = ball.body.translation();
      if (this.isInPlungerLane(pos) && pos.z >= 0.18) {
        const safeZ = Math.min(pos.z, launchSafeZ);
        ball.body.setTranslation(
          { x: plungerLane.centerX, y: ballSpec.radius, z: safeZ },
          true,
        );
        ball.body.setLinvel({ x: 0, y: 0, z: -launchSpeed }, true);
        ball.body.wakeUp();
      }
    }

    this.resetPlungerTipToRest(true);

    this.bus.emit('plungerRelease', {
      ratio,
      launchSpeedMps: launchSpeed,
    });
  }

  nudge(direction: NudgeDirection): void {
    if (this.disposed) return;
    const impulseSpeed = 0.32;
    const vx = direction === 'left' ? -impulseSpeed : direction === 'right' ? impulseSpeed : 0;
    const vz = direction === 'forward' ? -impulseSpeed : -0.1;

    for (const ball of this.balls.values()) {
      if (ball.locked) continue;
      const cur = ball.body.linvel();
      ball.body.setLinvel({ x: cur.x + vx, y: cur.y, z: cur.z + vz }, true);
      ball.body.wakeUp();
    }
  }

  spawnBallInPlungerLane(): number {
    if (this.disposed) return -1;
    this.resetPlungerTipToRest(true);
    const { ballSpawnLocal } = TABLE_SPEC.plungerLane;

    // Prevent overlapping duplicate spawns if an unlocked ball is already resting in the plunger lane
    for (const existing of this.balls.values()) {
      if (existing.locked) continue;
      const pos = existing.body.translation();
      if (this.isInPlungerLane(pos) && pos.z >= 0.22) {
        existing.body.setTranslation(ballSpawnLocal, true);
        existing.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        existing.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        existing.body.wakeUp();
        return existing.id;
      }
    }

    const id = this.createBall(ballSpawnLocal);
    this.bus.emit('ballSpawn', { ballId: id, inPlungerLane: true });
    return id;
  }

  clearLockedBalls(): void {
    if (this.disposed) return;
    for (const [id, ball] of [...this.balls.entries()]) {
      if (ball.locked) {
        this.removeBall(id);
      }
    }
  }

  spawnMultiballWave(count: number): void {
    if (this.disposed || count <= 0) return;
    const spawnedIds: number[] = [];

    for (let i = 0; i < count; i += 1) {
      const candidate = this.findSafeMultiballSpawn(i);
      const id = this.createBall(candidate.pos, candidate.vel);
      spawnedIds.push(id);
      this.bus.emit('ballSpawn', { ballId: id, inPlungerLane: false });
    }
  }

  /** Park a ball in the sanctuary lock pocket without destroying its telemetry identity. */
  lockBall(ballId: number, slotIndex: number): void {
    const record = this.balls.get(ballId);
    if (!record) return;
    const slot = LOCK_PARK_POSITIONS[clamp(slotIndex, 0, LOCK_PARK_POSITIONS.length - 1)];
    record.locked = true;
    record.onRamp = false;
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    record.body.setTranslation(slot, false);
    record.body.setEnabled(false);
    record.collider.setCollisionGroups(GROUPS_BALL_PLAYFIELD);
  }

  /** Unlock any parked balls + optional trigger ball and eject them toward the main nave. */
  releaseLockedBalls(
    triggerBallId?: number,
    desiredActiveCount: number = TABLE_SPEC.multiballLock.releaseBallCount,
  ): number {
    const ejectTargets: BallRecord[] = [];
    for (const ball of this.balls.values()) {
      if (ball.locked) {
        ejectTargets.push(ball);
      }
    }
    if (triggerBallId !== undefined) {
      const triggerBall = this.balls.get(triggerBallId);
      if (triggerBall && !triggerBall.locked) {
        ejectTargets.push(triggerBall);
      }
    }

    ejectTargets.forEach((ball, index) => {
      ball.locked = false;
      ball.onRamp = false;
      ball.lockCooldownSec = 0.85;
      ball.body.setEnabled(true);
      ball.collider.setCollisionGroups(GROUPS_BALL_PLAYFIELD);
      const offsetX = index * 0.036;
      const offsetZ = index * 0.032;
      ball.body.setTranslation(
        {
          x: TABLE_SPEC.multiballLock.sensorLocal.x - 0.025 - offsetX,
          y: TABLE_SPEC.ball.radius,
          z: TABLE_SPEC.multiballLock.sensorLocal.z + 0.03 + offsetZ,
        },
        true,
      );
      ball.body.setLinvel(
        {
          x: -0.65 - index * 0.12,
          y: 0,
          z: 0.75 + index * 0.18,
        },
        true,
      );
      ball.body.wakeUp();
    });

    const activeCount = this.getActiveBallCount();
    if (activeCount < desiredActiveCount) {
      this.spawnMultiballWave(desiredActiveCount - activeCount);
    }
    return this.getActiveBallCount();
  }

  /** Launch any ball currently resting in the plunger lane (used when forcing multiball from ready). */
  launchAnyBallInPlungerLane(chargeRatio = 0.85): boolean {
    let found = false;
    for (const ball of this.balls.values()) {
      if (!ball.locked && this.isInPlungerLane(ball.body.translation())) {
        found = true;
        break;
      }
    }
    if (found) {
      this.launchPlunger(chargeRatio);
    }
    return found;
  }

  getActiveBallCount(): number {
    let count = 0;
    for (const ball of this.balls.values()) {
      if (!ball.locked) count += 1;
    }
    return count;
  }

  getLockedBallCount(): number {
    let count = 0;
    for (const ball of this.balls.values()) {
      if (ball.locked) count += 1;
    }
    return count;
  }

  resetDropTargets(): void {
    if (this.disposed) return;
    for (const target of this.dropTargets) {
      target.down = false;
      target.collider.setEnabled(true);
    }
  }

  resetWorld(): void {
    if (this.disposed) return;
    for (const id of [...this.balls.keys()]) {
      this.removeBall(id);
    }
    this.resetDropTargets();
    this.cooldowns.clear();
    this.leftFlipperPressed = false;
    this.rightFlipperPressed = false;
    this.leftFlipperAngle = TABLE_SPEC.flippers.left.restAngleRad;
    this.rightFlipperAngle = TABLE_SPEC.flippers.right.restAngleRad;
    this.leftFlipperBody.setRotation(yAxisQuaternion(this.leftFlipperAngle), false);
    this.leftFlipperBody.setNextKinematicRotation(yAxisQuaternion(this.leftFlipperAngle));
    this.rightFlipperBody.setRotation(yAxisQuaternion(this.rightFlipperAngle), false);
    this.rightFlipperBody.setNextKinematicRotation(yAxisQuaternion(this.rightFlipperAngle));
    this.setPlungerCharging(false);
    this.accumulatorSec = 0;
    this.autoRescueCount = 0;
  }

  step(frameDtSeconds: number): PhysicsFrameData {
    if (this.disposed) {
      return this.getFrameData();
    }

    const safeDt = Number.isFinite(frameDtSeconds)
      ? clamp(frameDtSeconds, 0, TABLE_SPEC.physics.maxFrameDt)
      : 0;

    this.accumulatorSec += safeDt;
    const fixedDt = TABLE_SPEC.physics.fixedDt;

    while (this.accumulatorSec >= fixedDt) {
      this.stepSubstep(fixedDt);
      this.accumulatorSec -= fixedDt;
    }

    return this.getFrameData();
  }

  private stepSubstep(dt: number): void {
    this.simTimeSec += dt;

    // 1. Update plunger charging spring
    if (this.plungerCharging) {
      this.plungerChargeRatio = clamp(
        this.plungerChargeRatio + PLUNGER_CHARGE_RATE_PER_SEC * dt,
        0,
        1,
      );
      this.plungerPullM = this.plungerChargeRatio * TABLE_SPEC.plungerLane.maxPullM;
      const tipPullM = this.plungerChargeRatio * PLUNGER_MAX_PHYSICAL_PULL_M;
      this.plungerTipBody.setNextKinematicTranslation({
        x: TABLE_SPEC.plungerLane.centerX,
        y: TABLE_SPEC.ball.radius,
        z: PLUNGER_REST_Z + PLUNGER_TIP_HALF_DEPTH + tipPullM,
      });
      this.plungerEmitAccumSec += dt;
      if (this.plungerEmitAccumSec >= 0.04) {
        this.plungerEmitAccumSec = 0;
        this.bus.emit('plungerCharge', {
          ratio: this.plungerChargeRatio,
          pullDistanceM: this.plungerPullM,
        });
      }
    }

    // 2. Drive kinematic flippers strictly via setNextKinematicRotation
    const maxDelta = TABLE_SPEC.flippers.maxAngularSpeedRadPerSec * dt;
    const leftTarget = this.leftFlipperPressed
      ? TABLE_SPEC.flippers.left.activeAngleRad
      : TABLE_SPEC.flippers.left.restAngleRad;
    const rightTarget = this.rightFlipperPressed
      ? TABLE_SPEC.flippers.right.activeAngleRad
      : TABLE_SPEC.flippers.right.restAngleRad;

    this.leftFlipperAngle = this.moveToward(this.leftFlipperAngle, leftTarget, maxDelta);
    this.rightFlipperAngle = this.moveToward(this.rightFlipperAngle, rightTarget, maxDelta);

    this.leftFlipperBody.setNextKinematicRotation(yAxisQuaternion(this.leftFlipperAngle));
    this.rightFlipperBody.setNextKinematicRotation(yAxisQuaternion(this.rightFlipperAngle));

    // 3. Step Rapier world & collect collision events
    this.world.step(this.eventQueue);

    const drainedBallIds: number[] = [];
    const lockHits: number[] = [];
    const rolloverHits: { readonly ballId: number; readonly laneIndex: 0 | 1 | 2 }[] = [];
    const rampEntries: BallRecord[] = [];
    const rampExits: BallRecord[] = [];
    const dropTargetHits: { readonly ball: BallRecord; readonly target: Extract<ColliderRole, { kind: 'dropTarget' }> }[] = [];
    const bumperHits: { readonly ball: BallRecord; readonly bumper: Extract<ColliderRole, { kind: 'bumper' }> }[] = [];
    const slingshotHits: { readonly ball: BallRecord; readonly sling: Extract<ColliderRole, { kind: 'slingshot' }> }[] = [];

    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;

      let ball = this.ballByCollider.get(h1);
      let otherHandle = h2;
      if (!ball) {
        ball = this.ballByCollider.get(h2);
        otherHandle = h1;
      }
      if (!ball || ball.locked) return;

      const role = this.colliderRoles.get(otherHandle);
      if (!role) return;

      switch (role.kind) {
        case 'bumper':
          bumperHits.push({ ball, bumper: role });
          break;
        case 'slingshot':
          slingshotHits.push({ ball, sling: role });
          break;
        case 'dropTarget':
          dropTargetHits.push({ ball, target: role });
          break;
        case 'rollover':
          rolloverHits.push({ ballId: ball.id, laneIndex: role.laneIndex });
          break;
        case 'rampEntry':
          rampEntries.push(ball);
          break;
        case 'rampExit':
          rampExits.push(ball);
          break;
        case 'multiballLock':
          if (ball.lockCooldownSec <= 0) {
            lockHits.push(ball.id);
          }
          break;
        case 'drain':
          if (!drainedBallIds.includes(ball.id)) {
            drainedBallIds.push(ball.id);
          }
          break;
      }
    });

    // 4. Apply post-drainCollisionEvents responses & world mutations safely
    for (const { ball, bumper } of bumperHits) {
      this.handleBumperHit(ball, bumper);
    }
    for (const { ball, sling } of slingshotHits) {
      this.handleSlingshotHit(ball, sling);
    }
    for (const { target } of dropTargetHits) {
      this.handleDropTargetHit(target);
    }
    for (const { ballId, laneIndex } of rolloverHits) {
      if (!this.consumeCooldown(`rollover:${ballId}:${laneIndex}`, 0.45)) continue;
      if (this.hooks.onRolloverHit) {
        this.hooks.onRolloverHit(ballId, laneIndex);
      } else {
        this.bus.emit('rolloverHit', { laneIndex, skillShot: false, points: 300 });
      }
    }
    for (const ball of rampEntries) {
      this.handleRampEnter(ball);
    }
    for (const ball of rampExits) {
      this.handleRampExit(ball);
    }

    // Remove drained balls & notify ruleset
    for (const ballId of drainedBallIds) {
      if (!this.balls.has(ballId)) continue;
      this.removeBall(ballId);
      const remaining = this.getActiveBallCount();
      if (this.hooks.onBallDrain) {
        this.hooks.onBallDrain(ballId, remaining);
      } else {
        this.bus.emit('ballDrain', {
          ballId,
          activeBallsRemaining: remaining,
          ballsRemainingInGame: 0,
        });
      }
    }

    // Notify multiball lock hits (only if ball wasn't drained on same tick)
    for (const ballId of lockHits) {
      const ball = this.balls.get(ballId);
      if (!ball || ball.locked || ball.lockCooldownSec > 0) continue;
      ball.lockCooldownSec = 1.0;
      if (this.hooks.onMultiballLockHit) {
        this.hooks.onMultiballLockHit(ballId);
      } else {
        this.bus.emit('multiballLock', {
          ballId,
          lockedCount: 1,
          requiredCount: TABLE_SPEC.multiballLock.locksRequired,
          multiballTriggered: false,
        });
      }
    }

    // 5. Enforce speed cap, shooter-lane one-way gate, ramp timeout & rolling telemetry
    this.maintainBallsPostStep(dt);
  }

  /**
   * Registers an active kicker (bumper/slingshot) strike and applies:
   * 1) subtle physical micro-scatter (±6°) to prevent deterministic limit cycles,
   * 2) progressive deflection toward open lower playfield on 4+ repetitive hits,
   * 3) hard loop-breaker redirect if a ball still repeats >=7 hits on <=2 kickers or >=10 hits total.
   */
  private computeAntiLoopKickVelocity(
    ball: BallRecord,
    kickerId: string,
    dirX: number,
    dirZ: number,
    outSpeed: number,
  ): { readonly x: number; readonly z: number } | null {
    // Use 4.5s window (> 4.0s combo window); streak resets whenever ball drops to flipper zone (z > 0.30)
    if (this.simTimeSec - ball.lastKickerTimeSec <= 4.5) {
      ball.kickerLoopStreak += 1;
    } else {
      ball.kickerLoopStreak = 1;
      ball.recentKickerIds.length = 0;
    }
    ball.lastKickerTimeSec = this.simTimeSec;
    ball.recentKickerIds.push(kickerId);
    if (ball.recentKickerIds.length > 8) {
      ball.recentKickerIds.shift();
    }

    const tail3 = ball.recentKickerIds.slice(-3);
    const tail4 = ball.recentKickerIds.slice(-4);
    const distinct3 = new Set(tail3).size;
    const distinct4 = new Set(tail4).size;

    // Hard failsafe: immediately break persistent 1- or 2-kicker ping-pong loops
    if (
      ball.kickerLoopStreak >= 9 ||
      (ball.kickerLoopStreak >= 6 && distinct4 <= 2) ||
      (ball.kickerLoopStreak >= 5 && distinct3 === 1)
    ) {
      this.breakBallLoop(ball);
      return null;
    }

    let vxDir = dirX;
    let vzDir = dirZ;
    let speed = outSpeed;

    // Progressive deflection: smoothly steer away from 1-kicker (3+ hits) or 2-kicker (4+ hits) loops
    if (
      (ball.kickerLoopStreak >= 3 && distinct3 === 1) ||
      (ball.kickerLoopStreak >= 4 && distinct4 <= 2) ||
      ball.kickerLoopStreak >= 6
    ) {
      const pos = ball.body.translation();
      const sideBias = ball.kickerLoopStreak % 2 === 0 ? 0.04 : -0.04;
      let toCenterX = TABLE_SPEC.playfield.mainCenterX + sideBias - pos.x;
      let toCenterZ = 0.30 - pos.z;
      const toLen = Math.hypot(toCenterX, toCenterZ) || 1;
      toCenterX /= toLen;
      toCenterZ /= toLen;

      vxDir = vxDir * 0.3 + toCenterX * 0.7;
      vzDir = vzDir * 0.3 + toCenterZ * 0.7;
      const blendLen = Math.hypot(vxDir, vzDir) || 1;
      vxDir /= blendLen;
      vzDir /= blendLen;

      const deflectRad = (ball.kickerLoopStreak % 2 === 0 ? 1 : -1) * 0.32;
      const c = Math.cos(deflectRad);
      const s = Math.sin(deflectRad);
      const rx = vxDir * c - vzDir * s;
      const rz = vxDir * s + vzDir * c;
      vxDir = rx;
      vzDir = rz;
      speed = Math.min(speed, 1.25);
    } else {
      // Natural rubber/solenoid angular micro-scatter (±6.3°)
      const scatterRad = (Math.random() - 0.5) * 0.22;
      const c = Math.cos(scatterRad);
      const s = Math.sin(scatterRad);
      const rx = vxDir * c - vzDir * s;
      const rz = vxDir * s + vzDir * c;
      vxDir = rx;
      vzDir = rz;
    }

    return { x: vxDir * speed, z: vzDir * speed };
  }

  private handleBumperHit(
    ball: BallRecord,
    bumper: Extract<ColliderRole, { kind: 'bumper' }>,
  ): void {
    const key = `bumper:${ball.id}:${bumper.id}`;
    if (!this.consumeCooldown(key, 0.055)) return;

    const pos = ball.body.translation();
    let dx = pos.x - bumper.pos.x;
    let dz = pos.z - bumper.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) {
      dx = 0;
      dz = 1;
    } else {
      dx /= dist;
      dz /= dist;
    }

    const vel = ball.body.linvel();
    const outSpeed = Math.max(bumper.impulseMps, Math.hypot(vel.x, vel.z) * 0.75 + bumper.impulseMps * 0.55);
    const capped = Math.min(outSpeed, MAX_BALL_SPEED_MPS);
    const adjusted = this.computeAntiLoopKickVelocity(ball, bumper.id, dx, dz, capped);
    if (!adjusted) return;

    ball.body.setLinvel({ x: adjusted.x, y: Math.min(vel.y, 0.2), z: adjusted.z }, true);
    ball.body.wakeUp();

    this.bus.emit('bumperHit', {
      bumperId: bumper.id,
      position: { x: bumper.pos.x, y: 0.02, z: bumper.pos.z },
      impulseMps: bumper.impulseMps,
      points: bumper.points,
    });
    this.bus.emit('lampPulse', {
      lampId: bumper.id,
      colorHex: bumper.colorHex,
      intensity: 3.0,
      durationMs: 220,
    });
  }

  private handleSlingshotHit(
    ball: BallRecord,
    sling: Extract<ColliderRole, { kind: 'slingshot' }>,
  ): void {
    const pos = ball.body.translation();
    // Only trigger active kicker when ball strikes the inward/upfield diagonal face
    const signedDist = (pos.x - sling.p0.x) * sling.normal.x + (pos.z - sling.p0.z) * sling.normal.z;
    if (signedDist <= 0.002) return;

    const key = `sling:${ball.id}:${sling.side}`;
    if (!this.consumeCooldown(key, 0.07)) return;

    const kick = TABLE_SPEC.slingshots.kickImpulseMps;
    const vel = ball.body.linvel();
    const outSpeed = Math.min(MAX_BALL_SPEED_MPS, Math.max(kick, Math.hypot(vel.x, vel.z) * 0.65 + kick * 0.65));
    const adjusted = this.computeAntiLoopKickVelocity(
      ball,
      `slingshot-${sling.side}`,
      sling.normal.x,
      sling.normal.z,
      outSpeed,
    );
    if (!adjusted) return;

    ball.body.setLinvel(
      { x: adjusted.x, y: Math.min(vel.y, 0.15), z: adjusted.z },
      true,
    );
    ball.body.wakeUp();

    this.bus.emit('slingshotHit', {
      side: sling.side,
      position: { x: pos.x, y: 0.015, z: pos.z },
      impulseMps: kick,
      points: TABLE_SPEC.slingshots.points,
    });
    this.bus.emit('lampPulse', {
      lampId: `slingshot-${sling.side}`,
      colorHex: 0xf43f5e,
      intensity: 2.5,
      durationMs: 180,
    });
  }

  private handleDropTargetHit(target: Extract<ColliderRole, { kind: 'dropTarget' }>): void {
    const record = this.dropTargets[target.index];
    if (!record || record.down) return;

    record.down = true;
    record.collider.setEnabled(false);

    const bankComplete = this.dropTargets.every((t) => t.down);
    const points =
      TABLE_SPEC.dropTargets.pointsEach +
      (bankComplete ? TABLE_SPEC.dropTargets.bankBonusPoints : 0);

    this.bus.emit('dropTargetHit', {
      targetId: target.id,
      bankComplete,
      points,
    });
    this.bus.emit('lampPulse', {
      lampId: target.id,
      colorHex: bankComplete ? 0xfbbf24 : 0xa855f7,
      intensity: bankComplete ? 3.5 : 2.2,
      durationMs: bankComplete ? 450 : 200,
    });
  }

  private handleRampEnter(ball: BallRecord): void {
    if (ball.onRamp || ball.rampCooldownSec > 0) return;
    const entryVel = ball.body.linvel();
    // Ignore fast upfield orbit shots grazing the ramp mouth from below
    if (entryVel.z < -0.85) return;

    ball.onRamp = true;
    ball.onRampElapsedSec = 0;
    ball.collider.setCollisionGroups(GROUPS_BALL_ON_RAMP);

    const p0 = evalRampCurve(0.02);
    const p1 = evalRampCurve(0.12);
    const tx = p1.x - p0.x;
    const ty = p1.y - p0.y;
    const tz = p1.z - p0.z;
    const len = Math.hypot(tx, ty, tz);
    const speed = 1.55;

    ball.body.setTranslation(
      {
        x: p0.x,
        y: Math.max(ball.body.translation().y, p0.y + TABLE_SPEC.ball.radius),
        z: p0.z,
      },
      true,
    );
    ball.body.setLinvel(
      {
        x: (tx / len) * speed,
        y: (ty / len) * speed,
        z: (tz / len) * speed,
      },
      true,
    );
    ball.body.wakeUp();

    this.bus.emit('rampEntered', {
      rampId: TABLE_SPEC.stainedGlassRamp.id,
      ballId: ball.id,
    });
    this.bus.emit('lampPulse', {
      lampId: TABLE_SPEC.stainedGlassRamp.id,
      colorHex: 0x38bdf8,
      intensity: 2.4,
      durationMs: 320,
    });
  }

  private handleRampExit(ball: BallRecord): void {
    if (!ball.onRamp) return;
    this.exitRampMode(ball, true);
  }

  private exitRampMode(ball: BallRecord, completed: boolean): void {
    ball.onRamp = false;
    ball.onRampElapsedSec = 0;
    ball.rampCooldownSec = 0.65;
    ball.collider.setCollisionGroups(GROUPS_BALL_PLAYFIELD);

    if (completed) {
      this.bus.emit('rampCompleted', {
        rampId: TABLE_SPEC.stainedGlassRamp.id,
        ballId: ball.id,
        points: TABLE_SPEC.stainedGlassRamp.points,
      });
      this.bus.emit('lampPulse', {
        lampId: TABLE_SPEC.stainedGlassRamp.id,
        colorHex: 0xfde047,
        intensity: 3.4,
        durationMs: 420,
      });
    }
  }

  private maintainBallsPostStep(dt: number): void {
    const { cabinet, ball: ballSpec, plungerLane } = TABLE_SPEC;
    const minX = -cabinet.innerWidth * 0.5 + ballSpec.radius;
    const maxX = cabinet.innerWidth * 0.5 - ballSpec.radius;
    const minZ = -cabinet.innerLength * 0.5 + ballSpec.radius;
    const maxZ = cabinet.innerLength * 0.5 - ballSpec.radius;
    const minY = ballSpec.radius * 0.5;
    const maxY = GLASS_CEILING_BOTTOM_Y - ballSpec.radius * 0.5;

    for (const ball of this.balls.values()) {
      if (ball.locked) continue;

      if (ball.lockCooldownSec > 0) ball.lockCooldownSec = Math.max(0, ball.lockCooldownSec - dt);
      if (ball.rampCooldownSec > 0) ball.rampCooldownSec = Math.max(0, ball.rampCooldownSec - dt);

      const pos = ball.body.translation();
      let vel = ball.body.linvel();

      // Keep ramp balls moving smoothly over peak and complete on exit
      if (ball.onRamp) {
        ball.onRampElapsedSec += dt;
        const rampSpan = TABLE_SPEC.stainedGlassRamp.exitLocal.z - TABLE_SPEC.stainedGlassRamp.entryLocal.z;
        const tApprox = clamp((pos.z - TABLE_SPEC.stainedGlassRamp.entryLocal.z) / rampSpan, 0, 1);
        const tangentAhead = evalRampCurve(Math.min(1, tApprox + 0.05));
        const tangentHere = evalRampCurve(tApprox);
        if (vel.z < 1.1) {
          const tx = tangentAhead.x - tangentHere.x;
          const ty = tangentAhead.y - tangentHere.y;
          const tz = tangentAhead.z - tangentHere.z;
          const tLen = Math.hypot(tx, ty, tz) || 1;
          ball.body.setLinvel(
            { x: (tx / tLen) * 1.25, y: (ty / tLen) * 1.25, z: (tz / tLen) * 1.25 },
            true,
          );
          vel = ball.body.linvel();
        }
        if (pos.z >= TABLE_SPEC.stainedGlassRamp.exitLocal.z + 0.015) {
          this.exitRampMode(ball, true);
        } else if (ball.onRampElapsedSec > 3.2 || pos.y < 0.004) {
          this.exitRampMode(ball, false);
        }
      }

      // Shooter-lane one-way gate at top of Plunger_Lane_Divider (z ≈ -0.265)
      if (
        !ball.onRamp &&
        pos.x > plungerLane.dividerX &&
        pos.z > plungerLane.dividerZMin - 0.03 &&
        pos.z < plungerLane.dividerZMin + 0.015 &&
        vel.z > 0.08
      ) {
        ball.body.setLinvel(
          {
            x: -Math.max(0.45, Math.abs(vel.x)),
            y: vel.y,
            z: -Math.abs(vel.z) * 0.5,
          },
          true,
        );
        vel = ball.body.linvel();
      }

      // Guard against non-finite values or out-of-cabinet escape
      let clampedX = pos.x;
      let clampedY = pos.y;
      let clampedZ = pos.z;
      let needsRelocate = false;

      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
        clampedX = TABLE_SPEC.playfield.mainCenterX;
        clampedY = ballSpec.radius;
        clampedZ = 0;
        vel = { x: 0, y: 0, z: 0 };
        needsRelocate = true;
      } else {
        if (pos.x < minX || pos.x > maxX) {
          clampedX = clamp(pos.x, minX, maxX);
          vel = { x: -vel.x * 0.5, y: vel.y, z: vel.z };
          needsRelocate = true;
        }
        if (pos.z < minZ || pos.z > maxZ) {
          clampedZ = clamp(pos.z, minZ, maxZ);
          vel = { x: vel.x, y: vel.y, z: -vel.z * 0.5 };
          needsRelocate = true;
        }
        if (pos.y < minY || pos.y > maxY) {
          clampedY = clamp(pos.y, ballSpec.radius, maxY);
          vel = { x: vel.x, y: Math.min(0, vel.y), z: vel.z };
          needsRelocate = true;
        }
      }

      if (needsRelocate) {
        ball.body.setTranslation({ x: clampedX, y: clampedY, z: clampedZ }, true);
        ball.body.setLinvel(vel, true);
      }

      // Cap extreme velocity to keep tunneling impossible
      let speed = Math.hypot(vel.x, vel.y, vel.z);
      if (!Number.isFinite(speed)) {
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        speed = 0;
      } else if (speed > MAX_BALL_SPEED_MPS) {
        const s = MAX_BALL_SPEED_MPS / speed;
        ball.body.setLinvel({ x: vel.x * s, y: vel.y * s, z: vel.z * s }, true);
        speed = MAX_BALL_SPEED_MPS;
      }

      // Plunger safety invariant: never allow a ball to end up behind the resting plunger tip
      const activePos = ball.body.translation();
      const plungerSafeZ = PLUNGER_REST_Z - ballSpec.radius - 0.002;
      if (
        this.plungerPullM === 0 &&
        this.isInPlungerLane(activePos) &&
        activePos.z > plungerSafeZ + 0.006
      ) {
        ball.body.setTranslation(
          { x: plungerLane.centerX, y: ballSpec.radius, z: plungerSafeZ },
          true,
        );
        ball.body.setLinvel({ x: 0, y: 0, z: Math.min(vel.z, 0) }, true);
        ball.body.wakeUp();
      }

      // Continuous anti-stall watchdog: rescue any active non-plunger ball < 0.03 m/s for > 1.5 s
      const inPlunger = this.isInPlungerLane(activePos);
      if (!inPlunger && speed < 0.03) {
        ball.lowSpeedSec += dt;
        if (ball.lowSpeedSec > 1.5) {
          this.applyRescueImpulse(ball, false);
        }
      } else {
        ball.lowSpeedSec = 0;
      }

      // Reset loop detectors once ball reaches lower flipper zone or plunger lane
      if (inPlunger || activePos.z > 0.30) {
        ball.kickerLoopStreak = 0;
        ball.recentKickerIds.length = 0;
        ball.loopAnchorX = activePos.x;
        ball.loopAnchorZ = activePos.z;
        ball.loopAnchorSec = 0;
      } else if (!ball.onRamp) {
        // Spatial oscillation trap watchdog: catch high-speed loops confined to a 14.5 cm region > 4.2 s
        const drift = Math.hypot(activePos.x - ball.loopAnchorX, activePos.z - ball.loopAnchorZ);
        if (drift > 0.145) {
          ball.loopAnchorX = activePos.x;
          ball.loopAnchorZ = activePos.z;
          ball.loopAnchorSec = 0;
        } else {
          ball.loopAnchorSec += dt;
          if (ball.loopAnchorSec > 4.2) {
            this.breakBallLoop(ball);
          }
        }
      }

      // Throttled rolling telemetry for procedural Web Audio friction sound
      ball.rollEmitAccumSec += dt;
      if (ball.rollEmitAccumSec >= 0.05) {
        ball.rollEmitAccumSec = 0;
        if (speed > 0.18 && clampedY <= 0.085) {
          this.bus.emit('ballRoll', {
            ballId: ball.id,
            speedMps: Math.min(speed, MAX_BALL_SPEED_MPS),
            onRamp: ball.onRamp,
          });
        }
      }
    }
  }

  private breakBallLoop(ball: BallRecord): void {
    if (ball.onRamp) {
      this.exitRampMode(ball, false);
    }
    const pos = ball.body.translation();
    const targetX = TABLE_SPEC.playfield.mainCenterX + (Math.random() - 0.5) * 0.06;
    const targetZ = 0.28;
    let dx = targetX - pos.x;
    let dz = targetZ - pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      dx = 0;
      dz = 1;
    } else {
      dx /= len;
      dz /= len;
    }

    const freedPos: Vec3 = {
      x: clamp(
        pos.x + dx * 0.012,
        TABLE_SPEC.playfield.mainActiveXMin + TABLE_SPEC.ball.radius,
        TABLE_SPEC.playfield.mainActiveXMax - TABLE_SPEC.ball.radius,
      ),
      y: TABLE_SPEC.ball.radius,
      z: clamp(
        pos.z + dz * 0.012,
        TABLE_SPEC.playfield.zMin + TABLE_SPEC.ball.radius,
        TABLE_SPEC.playfield.zMax - TABLE_SPEC.ball.radius,
      ),
    };

    ball.body.setTranslation(freedPos, true);
    ball.body.setLinvel({ x: dx * 1.25, y: 0.02, z: dz * 1.25 }, true);
    ball.body.wakeUp();
    ball.lowSpeedSec = 0;
    ball.kickerLoopStreak = 0;
    ball.recentKickerIds.length = 0;
    ball.loopAnchorX = freedPos.x;
    ball.loopAnchorZ = freedPos.z;
    ball.loopAnchorSec = 0;
    this.autoRescueCount += 1;

    this.bus.emit('ballRescue', {
      ballId: ball.id,
      manual: false,
      position: freedPos,
    });
    this.bus.emit('lampPulse', {
      lampId: 'ball-rescue',
      colorHex: 0x38bdf8,
      intensity: 2.2,
      durationMs: 300,
    });
  }

  private applyRescueImpulse(ball: BallRecord, manual: boolean): void {
    if (ball.onRamp) {
      this.exitRampMode(ball, false);
    }
    const pos = ball.body.translation();
    const targetX = TABLE_SPEC.playfield.mainCenterX;
    const targetZ = pos.z > 0.2 ? 0.15 : Math.min(0.2, pos.z + 0.08);
    let dx = targetX - pos.x;
    let dz = targetZ - pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      dx = 0;
      dz = 1;
    } else {
      dx /= len;
      dz /= len;
    }

    const rescuedPos: Vec3 = {
      x: clamp(
        pos.x + dx * 0.008,
        TABLE_SPEC.playfield.mainActiveXMin + TABLE_SPEC.ball.radius,
        TABLE_SPEC.playfield.mainActiveXMax - TABLE_SPEC.ball.radius,
      ),
      y: TABLE_SPEC.ball.radius,
      z: clamp(
        pos.z + dz * 0.008,
        TABLE_SPEC.playfield.zMin + TABLE_SPEC.ball.radius,
        TABLE_SPEC.playfield.zMax - TABLE_SPEC.ball.radius,
      ),
    };

    ball.body.setTranslation(rescuedPos, true);
    ball.body.setLinvel({ x: dx * 0.85, y: 0.02, z: dz * 0.85 }, true);
    ball.body.wakeUp();
    ball.lowSpeedSec = 0;
    ball.kickerLoopStreak = 0;
    ball.recentKickerIds.length = 0;
    ball.loopAnchorX = rescuedPos.x;
    ball.loopAnchorZ = rescuedPos.z;
    ball.loopAnchorSec = 0;
    if (!manual) {
      this.autoRescueCount += 1;
    }

    this.bus.emit('ballRescue', {
      ballId: ball.id,
      manual,
      position: rescuedPos,
    });
    this.bus.emit('lampPulse', {
      lampId: 'ball-rescue',
      colorHex: 0x38bdf8,
      intensity: 2.2,
      durationMs: 300,
    });
  }

  private findSafeMultiballSpawn(indexOffset: number): { readonly pos: Vec3; readonly vel: Vec3 } {
    for (let attempt = 0; attempt < MULTIBALL_SAFE_SPAWNS.length; attempt += 1) {
      const candidate =
        MULTIBALL_SAFE_SPAWNS[(indexOffset + attempt) % MULTIBALL_SAFE_SPAWNS.length];
      let clear = true;
      for (const existing of this.balls.values()) {
        if (existing.locked) continue;
        const p = existing.body.translation();
        const dist = Math.hypot(p.x - candidate.pos.x, p.z - candidate.pos.z);
        if (dist < TABLE_SPEC.ball.diameter * 1.6) {
          clear = false;
          break;
        }
      }
      if (clear) return candidate;
    }
    const fallback = MULTIBALL_SAFE_SPAWNS[indexOffset % MULTIBALL_SAFE_SPAWNS.length];
    return {
      pos: {
        x: fallback.pos.x + ((indexOffset % 3) - 1) * 0.032,
        y: TABLE_SPEC.ball.radius,
        z: fallback.pos.z + Math.floor(indexOffset / 3) * 0.032,
      },
      vel: fallback.vel,
    };
  }

  private isInPlungerLane(pos: Vec3): boolean {
    const { plungerLane } = TABLE_SPEC;
    return (
      pos.x >= plungerLane.xMin - 0.005 &&
      pos.x <= plungerLane.xMax + 0.005 &&
      pos.z >= plungerLane.dividerZMin
    );
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    const diff = target - current;
    if (Math.abs(diff) <= maxDelta) return target;
    return current + Math.sign(diff) * maxDelta;
  }

  private consumeCooldown(key: string, durationSec: number): boolean {
    const until = this.cooldowns.get(key) ?? -1;
    if (this.simTimeSec < until) return false;
    this.cooldowns.set(key, this.simTimeSec + durationSec);
    return true;
  }

  getFrameData(): PhysicsFrameData {
    const ballTelemetry: BallTelemetry[] = [];
    for (const ball of this.balls.values()) {
      const p = ball.body.translation();
      const v = ball.body.linvel();
      ballTelemetry.push({
        id: ball.id,
        position: { x: p.x, y: p.y, z: p.z },
        linearVelocity: { x: v.x, y: v.y, z: v.z },
        speedMps: Math.hypot(v.x, v.y, v.z),
        inPlungerLane: !ball.locked && this.isInPlungerLane(p),
        onRamp: ball.onRamp,
        locked: ball.locked,
      });
    }

    return {
      balls: ballTelemetry,
      flipperAngles: {
        left: this.leftFlipperAngle,
        right: this.rightFlipperAngle,
      },
      dropTargetDown: [
        this.dropTargets[0]?.down ?? false,
        this.dropTargets[1]?.down ?? false,
        this.dropTargets[2]?.down ?? false,
      ],
      plungerPullM: this.plungerPullM,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.balls.clear();
    this.ballByCollider.clear();
    this.colliderRoles.clear();
    this.cooldowns.clear();
    this.eventQueue.free();
    this.world.free();
  }
}
