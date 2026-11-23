import type {
  BumperId,
  DropTargetId,
  GamePhase,
  GameStateSnapshot,
  NudgeDirection,
  RampId,
  Side,
  Vec3,
} from './types.ts';

/**
 * Typed pub/sub event contracts decoupling Rapier3D physics & ruleset triggers
 * from Three.js WebGPU lighting/VFX, procedural Web Audio synthesis, and HUD updates.
 */
export interface PinballEventMap {
  bumperHit: {
    readonly bumperId: BumperId;
    readonly position: Vec3;
    readonly impulseMps: number;
    readonly points: number;
  };
  slingshotHit: {
    readonly side: Side;
    readonly position: Vec3;
    readonly impulseMps: number;
    readonly points: number;
  };
  dropTargetHit: {
    readonly targetId: DropTargetId;
    readonly bankComplete: boolean;
    readonly points: number;
  };
  flipperFire: {
    readonly side: Side;
    readonly pressed: boolean;
    readonly angularSpeedRadPerSec: number;
  };
  plungerCharge: {
    readonly ratio: number;
    readonly pullDistanceM: number;
  };
  plungerRelease: {
    readonly ratio: number;
    readonly launchSpeedMps: number;
  };
  ballSpawn: {
    readonly ballId: number;
    readonly inPlungerLane: boolean;
  };
  ballDrain: {
    readonly ballId: number;
    readonly activeBallsRemaining: number;
    readonly ballsRemainingInGame: number;
  };
  ballRoll: {
    readonly ballId: number;
    readonly speedMps: number;
    readonly onRamp: boolean;
  };
  rampEntered: {
    readonly rampId: RampId;
    readonly ballId: number;
  };
  rampCompleted: {
    readonly rampId: RampId;
    readonly ballId: number;
    readonly points: number;
  };
  multiballLock: {
    readonly ballId: number;
    readonly lockedCount: number;
    readonly requiredCount: number;
    readonly multiballTriggered: boolean;
  };
  multiballStart: {
    readonly ballCount: number;
  };
  multiballEnd: {
    readonly remainingBallCount: number;
  };
  nudge: {
    readonly direction: NudgeDirection;
    readonly warningCount: number;
    readonly tilted: boolean;
  };
  scoreDelta: {
    readonly delta: number;
    readonly totalScore: number;
    readonly multiplier: number;
    readonly reason: string;
  };
  lampPulse: {
    readonly lampId: string;
    readonly colorHex: number;
    readonly intensity: number;
    readonly durationMs: number;
  };
  gameStateChanged: {
    readonly previous: GamePhase;
    readonly current: GamePhase;
    readonly snapshot: GameStateSnapshot;
  };
}

export type PinballEventType = keyof PinballEventMap;

export type PinballEventHandler<K extends PinballEventType> = (
  payload: PinballEventMap[K],
) => void;

export interface PinballEventBus {
  on<K extends PinballEventType>(type: K, handler: PinballEventHandler<K>): () => void;
  once<K extends PinballEventType>(type: K, handler: PinballEventHandler<K>): () => void;
  off<K extends PinballEventType>(type: K, handler: PinballEventHandler<K>): void;
  emit<K extends PinballEventType>(type: K, payload: PinballEventMap[K]): void;
  getEventCounts(): Readonly<Record<string, number>>;
  clear(): void;
}

/** Create a lightweight synchronous pub/sub event bus with emission counters for QA telemetry. */
export function createEventBus(): PinballEventBus {
  const listeners = new Map<PinballEventType, Set<PinballEventHandler<PinballEventType>>>();
  const counts: Record<string, number> = {};

  function getOrCreateSet<K extends PinballEventType>(
    type: K,
  ): Set<PinballEventHandler<PinballEventType>> {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    return set;
  }

  function off<K extends PinballEventType>(type: K, handler: PinballEventHandler<K>): void {
    const set = listeners.get(type);
    if (!set) return;
    set.delete(handler as PinballEventHandler<PinballEventType>);
    if (set.size === 0) {
      listeners.delete(type);
    }
  }

  function on<K extends PinballEventType>(
    type: K,
    handler: PinballEventHandler<K>,
  ): () => void {
    const set = getOrCreateSet(type);
    set.add(handler as PinballEventHandler<PinballEventType>);
    return () => off(type, handler);
  }

  function once<K extends PinballEventType>(
    type: K,
    handler: PinballEventHandler<K>,
  ): () => void {
    const wrapped: PinballEventHandler<K> = (payload) => {
      off(type, wrapped);
      handler(payload);
    };
    return on(type, wrapped);
  }

  function emit<K extends PinballEventType>(type: K, payload: PinballEventMap[K]): void {
    counts[type] = (counts[type] ?? 0) + 1;
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      (listener as PinballEventHandler<K>)(payload);
    }
  }

  function getEventCounts(): Readonly<Record<string, number>> {
    return { ...counts };
  }

  function clear(): void {
    listeners.clear();
    for (const key of Object.keys(counts)) {
      delete counts[key];
    }
  }

  return {
    on,
    once,
    off,
    emit,
    getEventCounts,
    clear,
  };
}
