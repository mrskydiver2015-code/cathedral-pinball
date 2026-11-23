/**
 * Pure TypeScript domain types for Cathedral Pinball.
 * Zero runtime dependency on Three.js or Rapier3D so every track (Assets, Render/Audio, Physics/QA)
 * can share a frozen, framework-agnostic contract.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface BoxExtents3D {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface Bounds3D {
  readonly min: Vec3;
  readonly max: Vec3;
}

export type Side = 'left' | 'right';
export type BumperId = 'bumper-top' | 'bumper-left' | 'bumper-right';
export type DropTargetId = 'target-1' | 'target-2' | 'target-3';
export type RampId = 'stained-glass-ramp';
export type NudgeDirection = 'left' | 'right' | 'forward';

export type GamePhase =
  | 'attract'
  | 'ready'
  | 'playing'
  | 'multiball'
  | 'tilted'
  | 'gameOver';

export interface BallTelemetry {
  readonly id: number;
  readonly position: Vec3;
  readonly linearVelocity: Vec3;
  readonly speedMps: number;
  readonly inPlungerLane: boolean;
  readonly onRamp: boolean;
  readonly locked: boolean;
}

export interface GameStateSnapshot {
  readonly phase: GamePhase;
  readonly score: number;
  readonly highScore: number;
  readonly ballNumber: number;
  readonly maxBalls: number;
  readonly activeBalls: number;
  readonly lockedBalls: number;
  readonly multiplier: number;
  readonly tiltWarnings: number;
  readonly tilted: boolean;
  readonly plungerCharge: number;
  readonly leftFlipperActive: boolean;
  readonly rightFlipperActive: boolean;
  readonly ballSaveRemainingSec: number;
  readonly skillShotAvailable: boolean;
  readonly comboCount: number;
  readonly autoRescueCount: number;
  readonly balls: readonly BallTelemetry[];
}

export type RendererBackendKind = 'webgpu' | 'webgl2';

export interface RendererCapabilities {
  readonly backend: RendererBackendKind;
  readonly forcedWebGL: boolean;
  readonly webgpuAvailable: boolean;
  readonly transmittedShadowsEnabled: boolean;
  readonly selectiveBloomEnabled: boolean;
  readonly selectiveTransmissionOnly: boolean;
  readonly devicePixelRatio: number;
}

export type AssetKind = 'glb' | 'texture';

/**
 * Enforces the Intel Arc GPU performance guardrail:
 * 'selective-transmission' is reserved strictly for hero stained-glass ramps, inserts, and bumper caps.
 */
export type MaterialPerformanceTier = 'opaque' | 'emissive' | 'selective-transmission';

export interface AssetManifestEntry {
  readonly id: string;
  readonly path: string;
  readonly kind: AssetKind;
  readonly role: string;
  readonly materialTier: MaterialPerformanceTier;
  readonly expectedNodes?: readonly string[];
}

export interface AssetManifest {
  readonly version: string;
  readonly entries: readonly AssetManifestEntry[];
}

export interface PinballDebugHandle {
  getSnapshot(): GameStateSnapshot;
  getRendererCapabilities(): RendererCapabilities;
  getEventCounts(): Readonly<Record<string, number>>;
  setFlipperInput(side: Side, pressed: boolean): void;
  setPlungerCharge(ratio: number): void;
  launchPlunger(chargeRatio: number): void;
  rescueStuckBalls(): number;
  forceMultiball(): void;
  resetGame(): void;
}

declare global {
  interface Window {
    __PINBALL_DEBUG__?: PinballDebugHandle;
  }
}
