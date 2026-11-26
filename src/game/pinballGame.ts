import {
  HighScoreStore,
  type RecordedHighScoreResult,
} from './highScores.ts';
import { SocialClient } from './socialClient.ts';
import { PinballPhysicsWorld, type PhysicsFrameData } from '../physics/pinballPhysics.ts';
import type { PinballEventBus } from '../shared/events.ts';
import { TABLE_SPEC } from '../shared/tableSpec.ts';
import type {
  GamePhase,
  GameStateSnapshot,
  NudgeDirection,
  QuestId,
  QuestProgressSnapshot,
  Side,
} from '../shared/types.ts';

const DROP_TARGET_RESET_DELAY_SEC = 0.85;
const TILT_WARNING_DECAY_SEC = 10.0;
const BALL_SAVE_DURATION_SEC = 12.0;
const MULTIBALL_SAVE_DURATION_SEC = 8.0;
const SKILL_SHOT_WINDOW_SEC = 4.8;
const COMBO_WINDOW_SEC = 4.0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Coordinates game ruleset state (attract/ready/playing/multiball/tilted/gameOver),
 * scoring + multiplier, 3-ball multiball locks, tilt warnings, and Rapier3D physics.
 */
export class PinballGameController {
  private readonly bus: PinballEventBus;
  private readonly physics: PinballPhysicsWorld;
  private readonly highScores = new HighScoreStore();
  private readonly social = new SocialClient(this.highScores);
  private readonly unsubscribers: (() => void)[] = [];

  private phase: GamePhase = 'attract';
  private userPaused = false;
  private overlayPaused = false;
  private score = 0;
  private highScore: number;
  private ballNumber = 1;
  private lockedBalls = 0;
  private multiplier = 1;
  private maxMultiplierReached = 1;
  private lastGameOverRecord: RecordedHighScoreResult | null = null;
  private tiltWarnings = 0;
  private tilted = false;
  private plungerCharge = 0;
  private plungerCharging = false;
  private leftFlipperActive = false;
  private rightFlipperActive = false;

  private dropTargetResetTimerSec = 0;
  private tiltDecayTimerSec = 0;
  private ballSaveRemainingSec = 0;
  private ballSaveUsedThisBall = false;
  private skillShotAvailable = false;
  private skillShotWindowSec = 0;
  private rolloverLanesLit: [boolean, boolean, boolean] = [false, false, false];
  private comboCount = 0;
  private comboTimerSec = 0;
  private roseRitualProgress = 0;
  private rampAscensionProgress = 0;
  private sanctuaryChoirProgress = 0;
  private wizardModeActive = false;
  private wizardTimerSec = 0;
  private wizardCompletions = 0;
  private latestFrame: PhysicsFrameData;
  private disposed = false;

  private constructor(
    bus: PinballEventBus,
    physicsFactory: (hooks: {
      onBallDrain: (ballId: number, activeRemaining: number) => void;
      onMultiballLockHit: (ballId: number) => void;
      onRolloverHit: (ballId: number, laneIndex: 0 | 1 | 2) => void;
    }) => PinballPhysicsWorld,
  ) {
    this.bus = bus;
    this.highScore = this.highScores.getPlayerBestScore();
    this.physics = physicsFactory({
      onBallDrain: (ballId, activeRemaining) => this.handleBallDrain(ballId, activeRemaining),
      onMultiballLockHit: (ballId) => this.handleMultiballLockHit(ballId),
      onRolloverHit: (ballId, laneIndex) => this.handleRolloverHit(ballId, laneIndex),
    });
    this.latestFrame = this.physics.getFrameData();
    this.bindScoringEvents();
  }

  static async create(bus: PinballEventBus): Promise<PinballGameController> {
    let resolvedPhysics: PinballPhysicsWorld | null = null;
    const hooksRef: {
      onBallDrain?: (ballId: number, activeRemaining: number) => void;
      onMultiballLockHit?: (ballId: number) => void;
      onRolloverHit?: (ballId: number, laneIndex: 0 | 1 | 2) => void;
    } = {};

    resolvedPhysics = await PinballPhysicsWorld.create(bus, {
      onBallDrain: (ballId, activeRemaining) => hooksRef.onBallDrain?.(ballId, activeRemaining),
      onMultiballLockHit: (ballId) => hooksRef.onMultiballLockHit?.(ballId),
      onRolloverHit: (ballId, laneIndex) => hooksRef.onRolloverHit?.(ballId, laneIndex),
    });

    const controller = new PinballGameController(bus, (hooks) => {
      hooksRef.onBallDrain = hooks.onBallDrain;
      hooksRef.onMultiballLockHit = hooks.onMultiballLockHit;
      hooksRef.onRolloverHit = hooks.onRolloverHit;
      return resolvedPhysics!;
    });
    return controller;
  }

  private bindScoringEvents(): void {
    this.unsubscribers.push(
      this.bus.on('bumperHit', (payload) => {
        if (!this.canScore()) return;
        this.registerCombo('BUMPER');
        const bonus = this.wizardModeActive
          ? TABLE_SPEC.rules.wizardMode.bumperFrenzyBonusPoints
          : 0;
        this.addScore(payload.points + bonus, `bumper:${payload.bumperId}`);
        if (!this.wizardModeActive) {
          this.advanceQuest('rose-ritual', 1);
        }
      }),
      this.bus.on('slingshotHit', (payload) => {
        if (!this.canScore()) return;
        this.registerCombo('SLING');
        const bonus = this.wizardModeActive
          ? TABLE_SPEC.rules.wizardMode.bumperFrenzyBonusPoints
          : 0;
        this.addScore(payload.points + bonus, `slingshot:${payload.side}`);
      }),
      this.bus.on('dropTargetHit', (payload) => {
        if (!this.canScore()) return;
        if (payload.bankComplete) {
          this.multiplier = Math.min(TABLE_SPEC.rules.maxMultiplier, this.multiplier + 1);
          this.maxMultiplierReached = Math.max(this.maxMultiplierReached, this.multiplier);
          this.dropTargetResetTimerSec = DROP_TARGET_RESET_DELAY_SEC;
        }
        this.registerCombo(payload.bankComplete ? 'TARGET BANK!' : 'TARGET');
        this.addScore(
          payload.points,
          payload.bankComplete ? 'dropTarget:bankComplete' : `dropTarget:${payload.targetId}`,
        );
        if (this.wizardModeActive && payload.bankComplete) {
          this.awardWizardSuperJackpot('CHOIR BANK');
        } else if (!this.wizardModeActive) {
          this.advanceQuest('sanctuary-choir', 1);
        }
      }),
      this.bus.on('rampCompleted', (payload) => {
        if (!this.canScore()) return;
        this.multiplier = Math.min(TABLE_SPEC.rules.maxMultiplier, this.multiplier + 1);
        this.maxMultiplierReached = Math.max(this.maxMultiplierReached, this.multiplier);
        this.registerCombo('RAMP COMBO!');
        this.addScore(payload.points, `ramp:${payload.rampId}`);
        if (this.wizardModeActive) {
          this.awardWizardSuperJackpot('STAINED-GLASS RAMP');
        } else {
          this.advanceQuest('ramp-ascension', 1);
        }
      }),
      this.bus.on('ballRescue', () => {
        // Clear combo streak on auto/manual loop-break or rescue so loops cannot farm score
        this.comboCount = 0;
        this.comboTimerSec = 0;
      }),
    );
  }

  private awardWizardSuperJackpot(source: string): void {
    const base = TABLE_SPEC.rules.wizardMode.superJackpotPoints;
    const totalJackpot = base * this.multiplier;
    this.addScore(base, `wizardJackpot:${source}`);
    this.bus.emit('wizardSuperJackpot', {
      source,
      points: totalJackpot,
    });
    this.bus.emit('lampPulse', {
      lampId: 'wizard-jackpot',
      colorHex: 0xfde047,
      intensity: 4.0,
      durationMs: 550,
    });
  }

  private advanceQuest(questId: QuestId, delta = 1): void {
    if (this.wizardModeActive || !this.canScore()) return;
    const qRules = TABLE_SPEC.rules.quests;

    let title = '';
    let target = 1;
    let rewardBase = 0;
    let prev = 0;
    let next = 0;

    if (questId === 'rose-ritual') {
      title = 'Rose Window Ritual';
      target = qRules.roseRitualHits;
      rewardBase = qRules.roseRitualRewardPoints;
      prev = this.roseRitualProgress;
      if (prev >= target) return;
      next = Math.min(target, prev + delta);
      this.roseRitualProgress = next;
    } else if (questId === 'ramp-ascension') {
      title = 'Ascension Rush';
      target = qRules.rampAscensionShots;
      rewardBase = qRules.rampAscensionRewardPoints;
      prev = this.rampAscensionProgress;
      if (prev >= target) return;
      next = Math.min(target, prev + delta);
      this.rampAscensionProgress = next;
    } else {
      title = 'Sanctuary Choir';
      target = qRules.sanctuaryChoirHits;
      rewardBase = qRules.sanctuaryChoirRewardPoints;
      prev = this.sanctuaryChoirProgress;
      if (prev >= target) return;
      next = Math.min(target, prev + delta);
      this.sanctuaryChoirProgress = next;
    }

    const completed = next >= target;
    let awardedPoints = 0;
    if (completed) {
      this.multiplier = Math.min(TABLE_SPEC.rules.maxMultiplier, this.multiplier + 1);
      this.maxMultiplierReached = Math.max(this.maxMultiplierReached, this.multiplier);
      awardedPoints = rewardBase * this.multiplier;
      this.addScore(rewardBase, `questComplete:${questId}`);
      this.bus.emit('lampPulse', {
        lampId: `quest-${questId}`,
        colorHex: 0xfbbf24,
        intensity: 3.6,
        durationMs: 650,
      });
    }

    this.bus.emit('questProgress', {
      questId,
      title,
      progress: next,
      target,
      completed,
      points: awardedPoints,
    });

    if (
      completed &&
      this.roseRitualProgress >= qRules.roseRitualHits &&
      this.rampAscensionProgress >= qRules.rampAscensionShots &&
      this.sanctuaryChoirProgress >= qRules.sanctuaryChoirHits
    ) {
      this.triggerWizardMode();
    }
  }

  private triggerWizardMode(): void {
    if (this.disposed) return;
    const wiz = TABLE_SPEC.rules.wizardMode;
    this.wizardModeActive = true;
    this.wizardTimerSec = wiz.durationSec;

    this.multiplier = Math.min(
      TABLE_SPEC.rules.maxMultiplier,
      Math.max(this.multiplier + 1, 4),
    );
    this.maxMultiplierReached = Math.max(this.maxMultiplierReached, this.multiplier);

    const bonusAwarded = wiz.startBonusPoints * this.multiplier;
    this.addScore(wiz.startBonusPoints, 'wizardMode:start');

    this.physics.launchAnyBallInPlungerLane(0.9);
    const activeCount = this.physics.releaseLockedBalls(undefined, wiz.ballCount);
    this.lockedBalls = 0;
    this.ballSaveRemainingSec = Math.max(this.ballSaveRemainingSec, wiz.ballSaveSec);
    this.latestFrame = this.physics.getFrameData();

    this.bus.emit('wizardModeStart', {
      ballCount: activeCount,
      durationSec: wiz.durationSec,
      bonusPoints: bonusAwarded,
    });
    this.bus.emit('multiballStart', { ballCount: activeCount });
    this.bus.emit('lampPulse', {
      lampId: 'wizard-start',
      colorHex: 0xfde047,
      intensity: 4.5,
      durationMs: 950,
    });
    this.transitionPhase('multiball');
  }

  private endWizardMode(): void {
    if (!this.wizardModeActive) return;
    this.wizardModeActive = false;
    this.wizardTimerSec = 0;
    this.wizardCompletions += 1;
    this.roseRitualProgress = 0;
    this.rampAscensionProgress = 0;
    this.sanctuaryChoirProgress = 0;
    this.bus.emit('wizardModeEnd', { completions: this.wizardCompletions });
  }

  private getQuestSnapshots(): readonly QuestProgressSnapshot[] {
    const q = TABLE_SPEC.rules.quests;
    return [
      {
        id: 'rose-ritual',
        shortLabel: 'ROSE',
        title: 'Rose Window Ritual',
        progress: this.wizardModeActive ? q.roseRitualHits : this.roseRitualProgress,
        target: q.roseRitualHits,
        completed: this.wizardModeActive || this.roseRitualProgress >= q.roseRitualHits,
      },
      {
        id: 'ramp-ascension',
        shortLabel: 'RAMP',
        title: 'Ascension Rush',
        progress: this.wizardModeActive ? q.rampAscensionShots : this.rampAscensionProgress,
        target: q.rampAscensionShots,
        completed: this.wizardModeActive || this.rampAscensionProgress >= q.rampAscensionShots,
      },
      {
        id: 'sanctuary-choir',
        shortLabel: 'CHOIR',
        title: 'Sanctuary Choir',
        progress: this.wizardModeActive ? q.sanctuaryChoirHits : this.sanctuaryChoirProgress,
        target: q.sanctuaryChoirHits,
        completed: this.wizardModeActive || this.sanctuaryChoirProgress >= q.sanctuaryChoirHits,
      },
    ];
  }

  private registerCombo(sourceLabel: string): void {
    this.comboCount += 1;
    this.comboTimerSec = COMBO_WINDOW_SEC;
    if (this.comboCount >= 2) {
      const bonus = 50 * this.comboCount;
      this.addScore(bonus, `combo:${this.comboCount}`);
      this.bus.emit('comboUpdate', {
        comboCount: this.comboCount,
        multiplier: this.multiplier,
        points: bonus * this.multiplier,
        label: this.comboCount >= 5 ? `${this.comboCount}x CATHEDRAL CHAIN!` : `${this.comboCount}x ${sourceLabel}`,
      });
    }
  }

  private canScore(): boolean {
    return (
      !this.tilted &&
      (this.phase === 'playing' || this.phase === 'multiball' || this.phase === 'ready')
    );
  }

  private addScore(basePoints: number, reason: string): void {
    const liveBoost = this.social.getLiveConfig().doubleScoreActive ? 2 : 1;
    const delta = Math.round(basePoints * this.multiplier * liveBoost);
    if (delta <= 0) return;
    this.score += delta;
    if (this.score > this.highScore) {
      this.highScore = this.score;
    }
    this.bus.emit('scoreDelta', {
      delta,
      totalScore: this.score,
      multiplier: this.multiplier * liveBoost,
      reason,
    });
  }

  private transitionPhase(next: GamePhase): void {
    if (this.phase === next) return;
    const previous = this.phase;
    this.phase = next;
    this.latestFrame = this.physics.getFrameData();
    this.bus.emit('gameStateChanged', {
      previous,
      current: next,
      snapshot: this.getSnapshot(),
    });
  }

  startNewGame(): void {
    if (this.disposed) return;
    const previous = this.phase;
    this.physics.resetWorld();

    this.score = 0;
    this.userPaused = false;
    this.highScore = Math.max(
      this.highScores.getPlayerBestScore(),
      this.social.getProfile().bestScore,
    );
    this.ballNumber = 1;
    this.lockedBalls = 0;
    this.multiplier = 1;
    this.maxMultiplierReached = 1;
    this.lastGameOverRecord = null;
    this.tiltWarnings = 0;
    this.tilted = false;
    this.plungerCharge = 0;
    this.plungerCharging = false;
    this.leftFlipperActive = false;
    this.rightFlipperActive = false;
    this.dropTargetResetTimerSec = 0;
    this.tiltDecayTimerSec = 0;
    this.ballSaveRemainingSec = 0;
    this.ballSaveUsedThisBall = false;
    this.skillShotAvailable = true;
    this.skillShotWindowSec = 0;
    this.rolloverLanesLit = [false, false, false];
    this.comboCount = 0;
    this.comboTimerSec = 0;
    this.roseRitualProgress = 0;
    this.rampAscensionProgress = 0;
    this.sanctuaryChoirProgress = 0;
    this.wizardModeActive = false;
    this.wizardTimerSec = 0;
    this.wizardCompletions = 0;

    this.physics.spawnBallInPlungerLane();
    this.phase = 'ready';
    this.latestFrame = this.physics.getFrameData();

    this.bus.emit('gameStateChanged', {
      previous,
      current: 'ready',
      snapshot: this.getSnapshot(),
    });
  }

  setManualPlungerCharge(ratio: number): void {
    if (this.disposed) return;
    if (this.phase === 'attract' || this.phase === 'gameOver') {
      this.startNewGame();
    }
    this.plungerCharging = false;
    this.plungerCharge = clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1);
    this.physics.setManualPlungerCharge(this.plungerCharge);
  }

  rescueStuckBalls(): number {
    if (this.disposed) return 0;
    if (
      (this.phase === 'ready' || this.phase === 'playing' || this.phase === 'multiball') &&
      this.physics.getActiveBallCount() === 0
    ) {
      this.physics.spawnBallInPlungerLane();
      this.latestFrame = this.physics.getFrameData();
      this.transitionPhase('ready');
      return 1;
    }
    const rescued = this.physics.rescueStuckBalls();
    if (rescued > 0 && this.phase === 'ready') {
      if (!this.ballSaveUsedThisBall) {
        this.ballSaveRemainingSec = BALL_SAVE_DURATION_SEC;
      }
      this.skillShotAvailable = true;
      this.skillShotWindowSec = SKILL_SHOT_WINDOW_SEC;
      this.transitionPhase('playing');
    }
    return rescued;
  }

  setFlipperInput(side: Side, pressed: boolean): void {
    if (this.disposed) return;
    const effectivePressed = this.tilted || this.phase === 'gameOver' ? false : pressed;
    if (side === 'left') {
      this.leftFlipperActive = effectivePressed;
    } else {
      this.rightFlipperActive = effectivePressed;
    }
    this.physics.setFlipperInput(side, effectivePressed);
  }

  setPlungerCharging(charging: boolean): void {
    if (this.disposed) return;
    if (charging && (this.phase === 'attract' || this.phase === 'gameOver')) {
      this.startNewGame();
    }

    if (!charging && this.plungerCharging) {
      const pulledRatio = clamp(
        this.physics.getFrameData().plungerPullM / TABLE_SPEC.plungerLane.maxPullM,
        0,
        1,
      );
      const releaseCharge = Math.max(this.plungerCharge, pulledRatio);
      this.plungerCharging = false;
      this.plungerCharge = 0;
      this.physics.setPlungerCharging(false);
      if (releaseCharge > 0.02) {
        this.launchPlunger(releaseCharge);
      }
      return;
    }

    this.plungerCharging = charging;
    this.physics.setPlungerCharging(charging);
  }

  launchPlunger(chargeRatio: number): void {
    if (this.disposed) return;
    if (this.phase === 'attract' || this.phase === 'gameOver') {
      this.startNewGame();
    }

    this.plungerCharging = false;
    this.plungerCharge = 0;
    this.physics.launchPlunger(chargeRatio);
    this.latestFrame = this.physics.getFrameData();

    if (this.phase === 'ready') {
      if (!this.ballSaveUsedThisBall) {
        this.ballSaveRemainingSec = BALL_SAVE_DURATION_SEC;
      }
      this.skillShotAvailable = true;
      this.skillShotWindowSec = SKILL_SHOT_WINDOW_SEC;
      this.transitionPhase('playing');
    }
  }

  nudge(direction: NudgeDirection): void {
    if (this.disposed) return;
    if (this.phase === 'attract' || this.phase === 'gameOver' || this.tilted) {
      return;
    }

    this.physics.nudge(direction);
    this.tiltWarnings += 1;
    this.tiltDecayTimerSec = TILT_WARNING_DECAY_SEC;

    if (this.tiltWarnings > TABLE_SPEC.rules.maxTiltWarnings) {
      this.tilted = true;
      this.leftFlipperActive = false;
      this.rightFlipperActive = false;
      this.physics.setFlipperInput('left', false);
      this.physics.setFlipperInput('right', false);

      this.bus.emit('nudge', {
        direction,
        warningCount: this.tiltWarnings,
        tilted: true,
      });
      this.bus.emit('lampPulse', {
        lampId: 'tilt',
        colorHex: 0xef4444,
        intensity: 4.0,
        durationMs: 700,
      });
      this.transitionPhase('tilted');
      return;
    }

    this.bus.emit('nudge', {
      direction,
      warningCount: this.tiltWarnings,
      tilted: false,
    });
    this.bus.emit('lampPulse', {
      lampId: 'tilt-warning',
      colorHex: 0xf59e0b,
      intensity: 2.5,
      durationMs: 300,
    });
  }

  forceMultiball(): void {
    if (this.disposed) return;
    if (this.phase === 'attract' || this.phase === 'gameOver') {
      this.startNewGame();
    }

    if (this.tilted) {
      this.tilted = false;
      this.tiltWarnings = 0;
    }

    // Ensure any ball resting in the plunger lane joins play immediately
    this.physics.launchAnyBallInPlungerLane(0.88);
    const activeCount = this.physics.releaseLockedBalls(
      undefined,
      TABLE_SPEC.multiballLock.releaseBallCount,
    );
    this.lockedBalls = 0;
    this.latestFrame = this.physics.getFrameData();

    this.bus.emit('multiballStart', { ballCount: activeCount });
    this.bus.emit('lampPulse', {
      lampId: 'multiball',
      colorHex: 0x38bdf8,
      intensity: 3.5,
      durationMs: 650,
    });
    this.ballSaveRemainingSec = Math.max(this.ballSaveRemainingSec, MULTIBALL_SAVE_DURATION_SEC);
    this.transitionPhase('multiball');
  }

  forceWizardMode(): void {
    if (this.disposed) return;
    if (this.phase === 'attract' || this.phase === 'gameOver') {
      this.startNewGame();
    }
    if (this.tilted) {
      this.tilted = false;
      this.tiltWarnings = 0;
    }
    const q = TABLE_SPEC.rules.quests;
    this.roseRitualProgress = q.roseRitualHits;
    this.rampAscensionProgress = q.rampAscensionShots;
    this.sanctuaryChoirProgress = q.sanctuaryChoirHits;
    this.triggerWizardMode();
  }

  private handleRolloverHit(_ballId: number, laneIndex: 0 | 1 | 2): void {
    if (!this.canScore()) return;
    this.rolloverLanesLit[laneIndex] = true;

    const isSkillShot = this.skillShotAvailable && this.skillShotWindowSec > 0;
    if (isSkillShot) {
      this.skillShotAvailable = false;
      this.skillShotWindowSec = 0;
      const skillPoints = laneIndex === 1 ? 2500 : 1500;
      this.multiplier = Math.min(TABLE_SPEC.rules.maxMultiplier, this.multiplier + 1);
      this.maxMultiplierReached = Math.max(this.maxMultiplierReached, this.multiplier);
      this.bus.emit('rolloverHit', { laneIndex, skillShot: true, points: skillPoints });
      this.bus.emit('lampPulse', {
        lampId: `rollover-${laneIndex}`,
        colorHex: 0xfde047,
        intensity: 3.4,
        durationMs: 420,
      });
      this.registerCombo('SKILL SHOT!');
      this.addScore(skillPoints, `skillShot:lane-${laneIndex}`);
      if (!this.wizardModeActive) {
        this.advanceQuest('sanctuary-choir', 1);
      }
      return;
    }

    let points = 300;
    const allLit = this.rolloverLanesLit.every(Boolean);
    if (allLit) {
      this.rolloverLanesLit = [false, false, false];
      this.multiplier = Math.min(TABLE_SPEC.rules.maxMultiplier, this.multiplier + 1);
      this.maxMultiplierReached = Math.max(this.maxMultiplierReached, this.multiplier);
      points += 1500;
    }

    this.bus.emit('rolloverHit', { laneIndex, skillShot: false, points });
    this.bus.emit('lampPulse', {
      lampId: `rollover-${laneIndex}`,
      colorHex: 0x38bdf8,
      intensity: 2.2,
      durationMs: 240,
    });
    this.registerCombo(allLit ? 'LANES COMPLETE!' : 'ROLLOVER');
    this.addScore(points, allLit ? 'rollover:allComplete' : `rollover:lane-${laneIndex}`);
    if (this.wizardModeActive && allLit) {
      this.awardWizardSuperJackpot('UPPER ARCH CHOIR');
    } else if (!this.wizardModeActive) {
      this.advanceQuest('sanctuary-choir', 1);
    }
  }

  private handleMultiballLockHit(ballId: number): void {
    if (
      this.disposed ||
      this.tilted ||
      this.phase === 'multiball' ||
      this.phase === 'attract' ||
      this.phase === 'gameOver'
    ) {
      return;
    }

    this.lockedBalls += 1;
    const required = TABLE_SPEC.multiballLock.locksRequired;
    const triggered = this.lockedBalls >= required;

    this.bus.emit('multiballLock', {
      ballId,
      lockedCount: this.lockedBalls,
      requiredCount: required,
      multiballTriggered: triggered,
    });
    this.bus.emit('lampPulse', {
      lampId: 'multiball-lock',
      colorHex: 0x38bdf8,
      intensity: 3.0,
      durationMs: 420,
    });

    if (!triggered) {
      this.addScore(500, 'multiball:lock');
      this.physics.lockBall(ballId, this.lockedBalls - 1);
      this.ballSaveRemainingSec = 0;
      this.ballSaveUsedThisBall = false;
      this.skillShotAvailable = true;
      this.skillShotWindowSec = 0;
      this.physics.spawnBallInPlungerLane();
      this.transitionPhase('ready');
      return;
    }

    this.addScore(1500, 'multiball:release');
    const activeCount = this.physics.releaseLockedBalls(
      ballId,
      TABLE_SPEC.multiballLock.releaseBallCount,
    );
    this.lockedBalls = 0;
    this.ballSaveRemainingSec = Math.max(this.ballSaveRemainingSec, MULTIBALL_SAVE_DURATION_SEC);
    this.bus.emit('multiballStart', { ballCount: activeCount });
    this.transitionPhase('multiball');
  }

  private handleBallDrain(ballId: number, activeRemaining: number): void {
    if (this.disposed) return;

    // During Wizard Mode's Sovereign Ball Save, keep all 4 balls roaring in play!
    if (
      !this.tilted &&
      this.wizardModeActive &&
      this.ballSaveRemainingSec > 0 &&
      activeRemaining > 0 &&
      activeRemaining < TABLE_SPEC.rules.wizardMode.ballCount
    ) {
      this.physics.spawnMultiballWave(1);
      this.bus.emit('ballSave', { ballId, remainingSec: this.ballSaveRemainingSec });
      this.bus.emit('lampPulse', {
        lampId: 'ball-save',
        colorHex: 0xfde047,
        intensity: 3.2,
        durationMs: 450,
      });
      return;
    }

    if (!this.tilted && activeRemaining === 0 && this.ballSaveRemainingSec > 0) {
      const savedWithRemaining = this.ballSaveRemainingSec;
      this.ballSaveRemainingSec = 0;
      this.ballSaveUsedThisBall = true;
      this.skillShotAvailable = true;
      this.skillShotWindowSec = SKILL_SHOT_WINDOW_SEC;
      this.physics.spawnBallInPlungerLane();
      this.physics.launchPlunger(0.84);
      this.bus.emit('ballSave', { ballId, remainingSec: savedWithRemaining });
      this.bus.emit('lampPulse', {
        lampId: 'ball-save',
        colorHex: 0x34d399,
        intensity: 3.5,
        durationMs: 600,
      });
      if (this.phase !== 'playing') {
        this.transitionPhase('playing');
      }
      return;
    }

    const ballsRemainingInGame = Math.max(0, TABLE_SPEC.rules.ballsPerGame - this.ballNumber);
    this.bus.emit('ballDrain', {
      ballId,
      activeBallsRemaining: activeRemaining,
      ballsRemainingInGame,
    });

    if (this.phase === 'multiball') {
      if (activeRemaining === 1) {
        if (this.wizardModeActive) {
          this.endWizardMode();
        }
        this.bus.emit('multiballEnd', { remainingBallCount: 1 });
        this.transitionPhase(this.tilted ? 'tilted' : 'playing');
        return;
      }
      if (activeRemaining > 1) {
        return;
      }
      if (this.wizardModeActive) {
        this.endWizardMode();
      }
      this.bus.emit('multiballEnd', { remainingBallCount: 0 });
    }

    if (activeRemaining > 0) {
      return;
    }

    if (this.ballNumber < TABLE_SPEC.rules.ballsPerGame) {
      this.ballNumber += 1;
      this.tilted = false;
      this.tiltWarnings = 0;
      this.tiltDecayTimerSec = 0;
      this.multiplier = 1;
      this.dropTargetResetTimerSec = 0;
      this.ballSaveRemainingSec = 0;
      this.ballSaveUsedThisBall = false;
      this.skillShotAvailable = true;
      this.skillShotWindowSec = 0;
      this.comboCount = 0;
      this.comboTimerSec = 0;
      this.physics.resetDropTargets();
      this.physics.spawnBallInPlungerLane();
      this.transitionPhase('ready');
      return;
    }

    this.tilted = false;
    this.ballSaveRemainingSec = 0;
    this.skillShotAvailable = false;
    this.skillShotWindowSec = 0;
    this.comboCount = 0;
    this.comboTimerSec = 0;
    this.leftFlipperActive = false;
    this.rightFlipperActive = false;
    this.physics.setFlipperInput('left', false);
    this.physics.setFlipperInput('right', false);
    this.physics.clearLockedBalls();
    this.lockedBalls = 0;
    this.wizardModeActive = false;
    this.wizardTimerSec = 0;
    this.lastGameOverRecord = this.highScores.recordScore(
      this.score,
      undefined,
      this.maxMultiplierReached,
    );
    this.highScore = Math.max(this.highScore, this.highScores.getPlayerBestScore());
    void this.social.submitCompletedGameScore(this.score, this.maxMultiplierReached);
    this.transitionPhase('gameOver');
  }

  getHighScoreStore(): HighScoreStore {
    return this.highScores;
  }

  getSocialClient(): SocialClient {
    return this.social;
  }

  getLastGameOverRecord(): RecordedHighScoreResult | null {
    return this.lastGameOverRecord;
  }

  isPaused(): boolean {
    return this.userPaused || this.overlayPaused;
  }

  setPaused(paused: boolean): boolean {
    this.userPaused = paused;
    if (this.isPaused()) {
      this.physics.setFlipperInput('left', false);
      this.physics.setFlipperInput('right', false);
    }
    return this.userPaused;
  }

  togglePaused(): boolean {
    return this.setPaused(!this.userPaused);
  }

  setOverlayPaused(open: boolean): void {
    this.overlayPaused = open;
    if (open) {
      this.leftFlipperActive = false;
      this.rightFlipperActive = false;
      this.physics.setFlipperInput('left', false);
      this.physics.setFlipperInput('right', false);
    }
  }

  update(dtSeconds: number): { snapshot: GameStateSnapshot; physics: PhysicsFrameData } {
    if (this.disposed || this.isPaused()) {
      return {
        snapshot: this.getSnapshot(),
        physics: this.latestFrame,
      };
    }

    const safeDt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;

    if (this.dropTargetResetTimerSec > 0) {
      this.dropTargetResetTimerSec -= safeDt;
      if (this.dropTargetResetTimerSec <= 0) {
        this.dropTargetResetTimerSec = 0;
        this.physics.resetDropTargets();
      }
    }

    if (this.tiltDecayTimerSec > 0 && !this.tilted) {
      this.tiltDecayTimerSec -= safeDt;
      if (this.tiltDecayTimerSec <= 0) {
        this.tiltWarnings = Math.max(0, this.tiltWarnings - 1);
        this.tiltDecayTimerSec = this.tiltWarnings > 0 ? TILT_WARNING_DECAY_SEC : 0;
      }
    }

    if ((this.phase === 'playing' || this.phase === 'multiball') && !this.tilted) {
      if (this.ballSaveRemainingSec > 0) {
        this.ballSaveRemainingSec = Math.max(0, this.ballSaveRemainingSec - safeDt);
      }
      if (this.skillShotWindowSec > 0) {
        this.skillShotWindowSec = Math.max(0, this.skillShotWindowSec - safeDt);
        if (this.skillShotWindowSec === 0) {
          this.skillShotAvailable = false;
        }
      }
      if (this.wizardModeActive && this.wizardTimerSec > 0) {
        this.wizardTimerSec = Math.max(0, this.wizardTimerSec - safeDt);
        if (this.wizardTimerSec === 0) {
          this.endWizardMode();
        }
      }
    }

    if (this.comboTimerSec > 0) {
      this.comboTimerSec -= safeDt;
      if (this.comboTimerSec <= 0) {
        this.comboTimerSec = 0;
        this.comboCount = 0;
      }
    }

    this.latestFrame = this.physics.step(safeDt);

    if (this.plungerCharging || this.latestFrame.plungerPullM > 0) {
      this.plungerCharge = clamp(
        this.latestFrame.plungerPullM / TABLE_SPEC.plungerLane.maxPullM,
        0,
        1,
      );
    } else {
      this.plungerCharge = 0;
    }

    return {
      snapshot: this.getSnapshot(),
      physics: this.latestFrame,
    };
  }

  getSnapshot(): GameStateSnapshot {
    const balls = this.latestFrame.balls;
    const activeBalls = balls.reduce((count, b) => count + (b.locked ? 0 : 1), 0);

    return {
      phase: this.phase,
      paused: this.isPaused(),
      score: this.score,
      highScore: this.highScore,
      ballNumber: this.ballNumber,
      maxBalls: TABLE_SPEC.rules.ballsPerGame,
      activeBalls,
      lockedBalls: this.lockedBalls,
      multiplier: this.multiplier,
      tiltWarnings: this.tiltWarnings,
      tilted: this.tilted,
      plungerCharge: this.plungerCharge,
      leftFlipperActive: this.leftFlipperActive,
      rightFlipperActive: this.rightFlipperActive,
      ballSaveRemainingSec: Number(this.ballSaveRemainingSec.toFixed(2)),
      skillShotAvailable: this.skillShotAvailable,
      comboCount: this.comboCount,
      autoRescueCount: this.physics.getAutoRescueCount(),
      quests: this.getQuestSnapshots(),
      wizardModeActive: this.wizardModeActive,
      wizardTimerSec: Number(this.wizardTimerSec.toFixed(1)),
      wizardCompletions: this.wizardCompletions,
      balls,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    this.physics.dispose();
  }
}
