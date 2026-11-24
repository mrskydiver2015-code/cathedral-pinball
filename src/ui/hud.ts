import type { PinballEventBus } from '../shared/events.ts';
import { TABLE_SPEC } from '../shared/tableSpec.ts';
import type {
  GamePhase,
  GameStateSnapshot,
  RendererCapabilities,
} from '../shared/types.ts';

export interface HudCallbacks {
  onStartOrRestart(): void;
  onToggleMute(): boolean;
  onToggleCamera(): void;
  onRescueBall(): void;
  onNudge(): void;
  onPlungerDrag(ratio: number): void;
  onPlungerRelease(ratio: number): void;
}

const HUD_STYLES = `
.cp-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  color: #eef2ff;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.cp-panel {
  background: rgba(7, 10, 22, 0.76);
  border: 1px solid rgba(148, 179, 255, 0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.52), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.cp-top-left {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  left: calc(12px + env(safe-area-inset-left));
  padding: 11px 14px;
  min-width: 240px;
  max-width: calc(56vw - env(safe-area-inset-left));
}

.cp-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.cp-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: #cbd5f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cp-backend-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(14, 116, 144, 0.35);
  color: #7dd3fc;
  flex-shrink: 0;
}

.cp-backend-badge.webgl2 {
  border-color: rgba(245, 158, 11, 0.5);
  background: rgba(146, 64, 14, 0.35);
  color: #fcd34d;
}

.cp-score {
  font-size: 28px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  letter-spacing: 0.02em;
  color: #ffffff;
  text-shadow: 0 0 18px rgba(125, 211, 252, 0.42);
}

.cp-highscore {
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #9fb0d8;
}

.cp-metrics-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid rgba(148, 179, 255, 0.16);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cp-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border-radius: 7px;
  background: rgba(24, 34, 68, 0.72);
  border: 1px solid rgba(148, 179, 255, 0.16);
}

.cp-pill-mult {
  color: #f9a8d4;
  border-color: rgba(232, 121, 249, 0.38);
}

.cp-pill-save {
  display: none;
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.55);
  background: rgba(6, 78, 59, 0.48);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.25);
}

.cp-pill-save.active {
  display: inline-flex;
}

.cp-pill-skill {
  display: none;
  color: #fde68a;
  border-color: rgba(251, 191, 36, 0.55);
  background: rgba(120, 53, 15, 0.48);
}

.cp-pill-skill.active {
  display: inline-flex;
}

.cp-lock-pips {
  display: inline-flex;
  gap: 3px;
  margin-left: 2px;
}

.cp-lock-pip {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.3);
  border: 1px solid rgba(167, 243, 208, 0.35);
}

.cp-lock-pip.active {
  background: #34d399;
  box-shadow: 0 0 8px #34d399;
}

.cp-phase-tag {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.25);
  color: #bfdbfe;
}

.cp-phase-tag.multiball {
  background: rgba(192, 38, 211, 0.38);
  color: #fae8ff;
  border: 1px solid rgba(232, 121, 249, 0.6);
}

.cp-phase-tag.tilted,
.cp-phase-tag.gameOver {
  background: rgba(225, 29, 72, 0.38);
  color: #ffe4e6;
  border: 1px solid rgba(251, 113, 133, 0.55);
}

.cp-top-right {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: calc(12px + env(safe-area-inset-right));
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: calc(40vw - env(safe-area-inset-right));
  pointer-events: auto;
}

.cp-btn {
  appearance: none;
  border: 1px solid rgba(148, 179, 255, 0.28);
  background: rgba(10, 15, 34, 0.82);
  color: #eef2ff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 8px 12px;
  border-radius: 9px;
  cursor: pointer;
  touch-action: manipulation;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.08s ease;
}

.cp-btn:hover {
  background: rgba(30, 44, 88, 0.9);
  border-color: rgba(125, 211, 252, 0.55);
}

.cp-btn:active {
  transform: translateY(1px);
}

.cp-btn-primary {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.6), rgba(168, 85, 247, 0.6));
  border-color: rgba(196, 181, 253, 0.55);
}

.cp-btn-subtle {
  color: #a5b4fc;
  border-color: rgba(129, 140, 248, 0.26);
  background: rgba(10, 15, 34, 0.68);
}

.cp-callout {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%) translateY(-6px);
  padding: 6px 16px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: #fef3c7;
  background: rgba(12, 18, 40, 0.9);
  border: 1px solid rgba(251, 191, 36, 0.55);
  box-shadow: 0 0 24px rgba(245, 158, 11, 0.32);
  opacity: 0;
  transition: opacity 0.18s ease, transform 0.18s ease;
  white-space: nowrap;
  pointer-events: none;
}

.cp-callout.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.cp-float-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

@keyframes cpFloatPop {
  0% {
    opacity: 0;
    transform: translate(-50%, 10px) scale(0.88);
  }
  18% {
    opacity: 1;
    transform: translate(-50%, 0px) scale(1.04);
  }
  80% {
    opacity: 0.95;
    transform: translate(-50%, -34px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -52px) scale(0.95);
  }
}

.cp-float-pop {
  position: absolute;
  left: 50%;
  top: 42%;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fffbeb;
  background: rgba(15, 23, 48, 0.85);
  border: 1px solid rgba(251, 191, 36, 0.55);
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.65);
  box-shadow: 0 4px 18px rgba(245, 158, 11, 0.25);
  white-space: nowrap;
  animation: cpFloatPop 1.15s cubic-bezier(0.18, 0.85, 0.3, 1) forwards;
}

.cp-plunger-wrap {
  position: absolute;
  right: calc(14px + env(safe-area-inset-right));
  bottom: calc(48px + env(safe-area-inset-bottom));
  padding: 12px 11px;
  min-width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}

.cp-plunger-wrap.dragging {
  cursor: grabbing;
  border-color: rgba(251, 191, 36, 0.65);
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.3);
}

.cp-plunger-track {
  width: 14px;
  height: 104px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(148, 179, 255, 0.28);
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}

.cp-plunger-fill {
  width: 100%;
  height: 0%;
  border-radius: 999px;
  background: linear-gradient(180deg, #f43f5e 0%, #f59e0b 48%, #38bdf8 100%);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.55);
  transition: height 0.04s linear;
}

.cp-plunger-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #cbd5f5;
}

.cp-nudge-btn {
  position: absolute;
  left: calc(14px + env(safe-area-inset-left));
  bottom: calc(48px + env(safe-area-inset-bottom));
  pointer-events: auto;
  padding: 10px 12px;
  border-radius: 11px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fde68a;
  background: rgba(12, 16, 36, 0.78);
  border: 1px solid rgba(251, 191, 36, 0.35);
  touch-action: none;
}

.cp-flipper-edge {
  position: absolute;
  bottom: calc(8px + env(safe-area-inset-bottom));
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(148, 179, 255, 0.55);
  background: rgba(9, 13, 28, 0.45);
  border: 1px solid rgba(148, 179, 255, 0.14);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.cp-flipper-edge.left {
  left: calc(14px + env(safe-area-inset-left));
}

.cp-flipper-edge.right {
  right: calc(14px + env(safe-area-inset-right));
}

.cp-flipper-edge.active {
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.65);
  background: rgba(14, 116, 144, 0.45);
  opacity: 1 !important;
}

.cp-hints {
  position: absolute;
  bottom: calc(10px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: #cbd5e1;
  white-space: nowrap;
  max-width: calc(100% - 28px);
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (pointer: coarse), (max-width: 760px) {
  .cp-hints {
    display: none;
  }
  .cp-flipper-edge {
    opacity: 0.72;
  }
}

@media (max-width: 600px) {
  .cp-top-left {
    top: calc(8px + env(safe-area-inset-top));
    left: calc(8px + env(safe-area-inset-left));
    padding: 7px 9px;
    min-width: 0;
    max-width: calc(52vw - env(safe-area-inset-left));
  }
  .cp-title {
    font-size: 9px;
    letter-spacing: 0.06em;
  }
  .cp-backend-badge {
    font-size: 8px;
    padding: 1px 5px;
  }
  .cp-score {
    font-size: 20px;
  }
  .cp-highscore {
    font-size: 9px;
  }
  .cp-metrics-row {
    gap: 3px;
    margin-top: 5px;
    padding-top: 4px;
    font-size: 9px;
  }
  .cp-pill {
    padding: 2px 4px;
    gap: 3px;
  }
  .cp-top-right {
    top: calc(8px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
    max-width: calc(41vw - env(safe-area-inset-right));
    gap: 4px;
  }
  .cp-btn {
    padding: 5px 7px;
    font-size: 10px;
    border-radius: 7px;
  }
  .cp-callout {
    top: calc(108px + env(safe-area-inset-top));
    font-size: 11px;
    padding: 5px 12px;
  }
  .cp-plunger-wrap {
    bottom: calc(44px + env(safe-area-inset-bottom));
    right: calc(8px + env(safe-area-inset-right));
    padding: 8px 8px;
    min-width: 44px;
  }
  .cp-plunger-track {
    height: 82px;
  }
  .cp-nudge-btn {
    bottom: calc(44px + env(safe-area-inset-bottom));
    left: calc(8px + env(safe-area-inset-left));
    padding: 8px 10px;
    font-size: 10px;
  }
}

@media (max-height: 480px) {
  .cp-top-left {
    padding: 7px 10px;
    min-width: 196px;
  }
  .cp-score {
    font-size: 20px;
  }
  .cp-metrics-row {
    margin-top: 5px;
    padding-top: 4px;
    gap: 4px;
    font-size: 10px;
  }
  .cp-btn {
    padding: 5px 8px;
    font-size: 11px;
  }
  .cp-plunger-track {
    height: 68px;
  }
  .cp-plunger-wrap {
    bottom: calc(38px + env(safe-area-inset-bottom));
  }
  .cp-nudge-btn {
    bottom: calc(38px + env(safe-area-inset-bottom));
    padding: 7px 10px;
  }
}
`;

const PHASE_LABELS: Readonly<Record<GamePhase, string>> = {
  attract: 'Attract',
  ready: 'Ready',
  playing: 'In Play',
  multiball: 'Multiball',
  tilted: 'Tilted',
  gameOver: 'Game Over',
};

function formatScore(score: number): string {
  return Math.max(0, Math.floor(score)).toLocaleString('en-US');
}

export class PinballHud {
  private readonly container: HTMLElement;
  private readonly bus: PinballEventBus;
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLDivElement;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly domCleanups: Array<() => void> = [];

  private readonly backendBadge: HTMLSpanElement;
  private readonly scoreValue: HTMLDivElement;
  private readonly highScoreValue: HTMLDivElement;
  private readonly ballPill: HTMLSpanElement;
  private readonly multiplierPill: HTMLSpanElement;
  private readonly ballSavePill: HTMLSpanElement;
  private readonly skillShotPill: HTMLSpanElement;
  private readonly lockCountText: HTMLSpanElement;
  private readonly lockPips: readonly HTMLSpanElement[];
  private readonly phaseTag: HTMLSpanElement;

  private readonly startBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly cameraBtn: HTMLButtonElement;
  private readonly rescueBtn: HTMLButtonElement;
  private readonly calloutBanner: HTMLDivElement;
  private readonly floatLayer: HTMLDivElement;
  private readonly plungerFill: HTMLDivElement;
  private readonly leftEdgeIndicator: HTMLDivElement;
  private readonly rightEdgeIndicator: HTMLDivElement;

  private calloutTimer: number | null = null;
  private plungerDragPointerId: number | null = null;
  private plungerDragStartY = 0;
  private plungerCurrentRatio = 0;
  private plungerDidDrag = false;
  private disposed = false;

  // Cached values to prevent redundant DOM writes inside 60fps loop
  private lastScore = -1;
  private lastHighScore = -1;
  private lastBallNum = -1;
  private lastMaxBalls = -1;
  private lastMultiplier = -1;
  private lastLocked = -1;
  private lastPhase: GamePhase | null = null;
  private lastBackendKey = '';
  private lastPlungerPct = -1;
  private lastSaveSec = -1;
  private lastSkillAvailable: boolean | null = null;
  private lastLeftActive: boolean | null = null;
  private lastRightActive: boolean | null = null;

  constructor(container: HTMLElement, bus: PinballEventBus, callbacks: HudCallbacks) {
    this.container = container;
    this.bus = bus;
    this.callbacks = callbacks;

    if (typeof window !== 'undefined' && window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const root = document.createElement('div');
    root.className = 'cp-hud';
    this.root = root;

    const styleEl = document.createElement('style');
    styleEl.textContent = HUD_STYLES;
    root.appendChild(styleEl);

    // Top-left scoreboard
    const topLeft = document.createElement('section');
    topLeft.className = 'cp-panel cp-top-left';

    const headerRow = document.createElement('div');
    headerRow.className = 'cp-header-row';
    const title = document.createElement('span');
    title.className = 'cp-title';
    title.textContent = 'Cathedral Pinball';
    this.backendBadge = document.createElement('span');
    this.backendBadge.className = 'cp-backend-badge';
    this.backendBadge.textContent = 'WebGPU';
    headerRow.append(title, this.backendBadge);

    this.scoreValue = document.createElement('div');
    this.scoreValue.className = 'cp-score';
    this.scoreValue.textContent = '0';

    this.highScoreValue = document.createElement('div');
    this.highScoreValue.className = 'cp-highscore';
    this.highScoreValue.textContent = 'BEST 0';

    const metricsRow = document.createElement('div');
    metricsRow.className = 'cp-metrics-row';

    this.ballPill = document.createElement('span');
    this.ballPill.className = 'cp-pill';
    this.ballPill.textContent = `BALL 1/${TABLE_SPEC.rules.ballsPerGame}`;

    this.multiplierPill = document.createElement('span');
    this.multiplierPill.className = 'cp-pill cp-pill-mult';
    this.multiplierPill.textContent = '1x';

    const lockPill = document.createElement('span');
    lockPill.className = 'cp-pill';
    this.lockCountText = document.createElement('span');
    this.lockCountText.textContent = `LOCKS 0/${TABLE_SPEC.multiballLock.locksRequired}`;
    const pipsWrap = document.createElement('span');
    pipsWrap.className = 'cp-lock-pips';
    const pips: HTMLSpanElement[] = [];
    for (let i = 0; i < TABLE_SPEC.multiballLock.locksRequired; i++) {
      const pip = document.createElement('span');
      pip.className = 'cp-lock-pip';
      pipsWrap.appendChild(pip);
      pips.push(pip);
    }
    this.lockPips = pips;
    lockPill.append(this.lockCountText, pipsWrap);

    this.phaseTag = document.createElement('span');
    this.phaseTag.className = 'cp-phase-tag';
    this.phaseTag.textContent = 'Ready';

    this.ballSavePill = document.createElement('span');
    this.ballSavePill.className = 'cp-pill cp-pill-save';
    this.ballSavePill.textContent = 'SAVE 12s';

    this.skillShotPill = document.createElement('span');
    this.skillShotPill.className = 'cp-pill cp-pill-skill';
    this.skillShotPill.textContent = 'SKILL SHOT';

    metricsRow.append(
      this.ballPill,
      this.multiplierPill,
      lockPill,
      this.phaseTag,
      this.ballSavePill,
      this.skillShotPill,
    );
    topLeft.append(headerRow, this.scoreValue, this.highScoreValue, metricsRow);

    // Top-right action buttons
    const topRight = document.createElement('div');
    topRight.className = 'cp-top-right';
    topRight.dataset.uiControl = 'true';

    this.startBtn = document.createElement('button');
    this.startBtn.type = 'button';
    this.startBtn.className = 'cp-btn cp-btn-primary';
    this.startBtn.dataset.uiControl = 'true';
    this.startBtn.textContent = 'Start';
    this.startBtn.addEventListener('click', () => {
      this.callbacks.onStartOrRestart();
    });

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'cp-btn';
    this.muteBtn.dataset.uiControl = 'true';
    this.muteBtn.textContent = 'Sound: ON';
    this.muteBtn.addEventListener('click', () => {
      const isMuted = this.callbacks.onToggleMute();
      this.muteBtn.textContent = isMuted ? 'Sound: OFF' : 'Sound: ON';
    });

    this.cameraBtn = document.createElement('button');
    this.cameraBtn.type = 'button';
    this.cameraBtn.className = 'cp-btn';
    this.cameraBtn.dataset.uiControl = 'true';
    this.cameraBtn.textContent = 'Cam';
    this.cameraBtn.addEventListener('click', () => {
      this.callbacks.onToggleCamera();
    });

    this.rescueBtn = document.createElement('button');
    this.rescueBtn.type = 'button';
    this.rescueBtn.className = 'cp-btn cp-btn-subtle';
    this.rescueBtn.dataset.uiControl = 'true';
    this.rescueBtn.title = 'Unstick / Rescue active ball';
    this.rescueBtn.textContent = 'Unstick';
    this.rescueBtn.addEventListener('click', () => {
      this.callbacks.onRescueBall();
    });

    topRight.append(this.startBtn, this.muteBtn, this.cameraBtn, this.rescueBtn);

    // Top-center transient callout & floating combo layer
    this.calloutBanner = document.createElement('div');
    this.calloutBanner.className = 'cp-callout';

    this.floatLayer = document.createElement('div');
    this.floatLayer.className = 'cp-float-layer';

    // Bottom-right interactive touch-drag Plunger zone
    const plungerWrap = document.createElement('div');
    plungerWrap.className = 'cp-panel cp-plunger-wrap';
    plungerWrap.dataset.uiControl = 'true';

    const plungerTrack = document.createElement('div');
    plungerTrack.className = 'cp-plunger-track';
    this.plungerFill = document.createElement('div');
    this.plungerFill.className = 'cp-plunger-fill';
    plungerTrack.appendChild(this.plungerFill);
    const plungerLabel = document.createElement('span');
    plungerLabel.className = 'cp-plunger-label';
    plungerLabel.textContent = 'Pull';
    plungerWrap.append(plungerTrack, plungerLabel);

    this.bindTouchPlunger(plungerWrap);

    // Bottom-left tactile Nudge button
    const nudgeBtn = document.createElement('button');
    nudgeBtn.type = 'button';
    nudgeBtn.className = 'cp-btn cp-nudge-btn';
    nudgeBtn.dataset.uiControl = 'true';
    nudgeBtn.textContent = 'Nudge';
    nudgeBtn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
      },
      { passive: false },
    );
    nudgeBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.callbacks.onNudge();
    });

    // Subtle multi-touch flipper edge cues
    this.leftEdgeIndicator = document.createElement('div');
    this.leftEdgeIndicator.className = 'cp-flipper-edge left';
    this.leftEdgeIndicator.textContent = '◄ L Flip';

    this.rightEdgeIndicator = document.createElement('div');
    this.rightEdgeIndicator.className = 'cp-flipper-edge right';
    this.rightEdgeIndicator.textContent = 'R Flip ►';

    // Desktop-only keybind hint strip
    const hints = document.createElement('div');
    hints.className = 'cp-panel cp-hints';
    hints.textContent =
      'A / ← Left Flipper  •  D / → Right Flipper  •  Space / ↓ Plunger  •  Z / X / ↑ Nudge  •  C Camera  •  M Mute';

    root.append(
      topLeft,
      topRight,
      this.calloutBanner,
      this.floatLayer,
      plungerWrap,
      nudgeBtn,
      this.leftEdgeIndicator,
      this.rightEdgeIndicator,
      hints,
    );
    container.appendChild(root);

    this.bindEvents();
  }

  private bindTouchPlunger(plungerWrap: HTMLDivElement): void {
    const onTouchStart = (e: TouchEvent): void => {
      e.preventDefault();
    };
    plungerWrap.addEventListener('touchstart', onTouchStart, { passive: false });

    const onPointerDown = (e: PointerEvent): void => {
      e.stopPropagation();
      e.preventDefault();
      this.plungerDragPointerId = e.pointerId;
      this.plungerDragStartY = e.clientY;
      this.plungerDidDrag = false;
      this.plungerCurrentRatio = 0.35;
      plungerWrap.classList.add('dragging');
      try {
        plungerWrap.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer capture rejection
      }
      this.callbacks.onPlungerDrag(this.plungerCurrentRatio);
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (this.plungerDragPointerId !== e.pointerId) return;
      e.stopPropagation();
      const dy = e.clientY - this.plungerDragStartY;
      if (Math.abs(dy) > 4) {
        this.plungerDidDrag = true;
      }
      // Support both downward pull (classic plunger) and upward flick swipe
      const pullMagnitude = dy >= 0 ? dy : Math.abs(dy) * 0.9;
      const ratio = Math.max(0.25, Math.min(1, 0.25 + pullMagnitude / 72));
      this.plungerCurrentRatio = ratio;
      this.callbacks.onPlungerDrag(ratio);
    };

    const releaseDrag = (e: PointerEvent): void => {
      if (this.plungerDragPointerId !== e.pointerId) return;
      e.stopPropagation();
      this.plungerDragPointerId = null;
      plungerWrap.classList.remove('dragging');
      try {
        if (plungerWrap.hasPointerCapture(e.pointerId)) {
          plungerWrap.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore synthetic release errors
      }
      const releaseStrength = this.plungerDidDrag
        ? Math.max(0.4, this.plungerCurrentRatio)
        : 0.85;
      this.callbacks.onPlungerRelease(releaseStrength);
    };

    plungerWrap.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', releaseDrag);
    window.addEventListener('pointercancel', releaseDrag);

    this.domCleanups.push(() => {
      plungerWrap.removeEventListener('touchstart', onTouchStart);
      plungerWrap.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', releaseDrag);
      window.removeEventListener('pointercancel', releaseDrag);
    });
  }

  update(snapshot: GameStateSnapshot, capabilities: RendererCapabilities): void {
    if (this.disposed) return;

    const backendKey = `${capabilities.backend}:${capabilities.forcedWebGL}`;
    if (backendKey !== this.lastBackendKey) {
      this.lastBackendKey = backendKey;
      const label = capabilities.backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
      this.backendBadge.textContent = capabilities.forcedWebGL ? `${label} (Forced)` : label;
      this.backendBadge.className =
        capabilities.backend === 'webgl2'
          ? 'cp-backend-badge webgl2'
          : 'cp-backend-badge';
    }

    if (snapshot.score !== this.lastScore) {
      this.lastScore = snapshot.score;
      this.scoreValue.textContent = formatScore(snapshot.score);
    }

    if (snapshot.highScore !== this.lastHighScore) {
      this.lastHighScore = snapshot.highScore;
      this.highScoreValue.textContent = `BEST ${formatScore(snapshot.highScore)}`;
    }

    if (snapshot.ballNumber !== this.lastBallNum || snapshot.maxBalls !== this.lastMaxBalls) {
      this.lastBallNum = snapshot.ballNumber;
      this.lastMaxBalls = snapshot.maxBalls;
      this.ballPill.textContent = `BALL ${snapshot.ballNumber}/${snapshot.maxBalls}`;
    }

    if (snapshot.multiplier !== this.lastMultiplier) {
      this.lastMultiplier = snapshot.multiplier;
      this.multiplierPill.textContent = `${snapshot.multiplier}x`;
    }

    if (snapshot.lockedBalls !== this.lastLocked) {
      this.lastLocked = snapshot.lockedBalls;
      const req = TABLE_SPEC.multiballLock.locksRequired;
      this.lockCountText.textContent = `LOCKS ${snapshot.lockedBalls}/${req}`;
      this.lockPips.forEach((pip, idx) => {
        pip.classList.toggle('active', idx < snapshot.lockedBalls);
      });
    }

    if (snapshot.phase !== this.lastPhase) {
      this.lastPhase = snapshot.phase;
      this.phaseTag.textContent = PHASE_LABELS[snapshot.phase];
      this.phaseTag.className = `cp-phase-tag ${snapshot.phase}`;
      this.startBtn.textContent =
        snapshot.phase === 'attract' || snapshot.phase === 'gameOver'
          ? 'Start'
          : 'Restart';
    }

    const saveSec = Math.ceil(Math.max(0, snapshot.ballSaveRemainingSec));
    if (saveSec !== this.lastSaveSec) {
      this.lastSaveSec = saveSec;
      this.ballSavePill.classList.toggle('active', saveSec > 0);
      if (saveSec > 0) {
        this.ballSavePill.textContent = `SAVE ${saveSec}s`;
      }
    }

    const skillVisible = snapshot.skillShotAvailable && (snapshot.phase === 'ready' || snapshot.phase === 'playing');
    if (skillVisible !== this.lastSkillAvailable) {
      this.lastSkillAvailable = skillVisible;
      this.skillShotPill.classList.toggle('active', skillVisible);
    }

    if (snapshot.leftFlipperActive !== this.lastLeftActive) {
      this.lastLeftActive = snapshot.leftFlipperActive;
      this.leftEdgeIndicator.classList.toggle('active', snapshot.leftFlipperActive);
    }

    if (snapshot.rightFlipperActive !== this.lastRightActive) {
      this.lastRightActive = snapshot.rightFlipperActive;
      this.rightEdgeIndicator.classList.toggle('active', snapshot.rightFlipperActive);
    }

    const plungerPct = Math.round(Math.max(0, Math.min(1, snapshot.plungerCharge)) * 100);
    if (plungerPct !== this.lastPlungerPct) {
      this.lastPlungerPct = plungerPct;
      this.plungerFill.style.height = `${plungerPct}%`;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;

    for (const cleanup of this.domCleanups) {
      cleanup();
    }
    this.domCleanups.length = 0;

    if (this.calloutTimer !== null) {
      window.clearTimeout(this.calloutTimer);
      this.calloutTimer = null;
    }

    if (this.root.parentElement === this.container) {
      this.container.removeChild(this.root);
    }
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      this.bus.on('multiballLock', ({ lockedCount, requiredCount, multiballTriggered }) => {
        if (!multiballTriggered) {
          this.showCallout(`Sanctuary Lock ${lockedCount}/${requiredCount}`, 1700);
        }
      }),
      this.bus.on('multiballStart', ({ ballCount }) => {
        this.showCallout(`Multiball Unleashed! (${ballCount} Balls)`, 2400);
        this.spawnFloatingPopup(`MULTIBALL! ${ballCount} BALLS`, '#e879f9');
      }),
      this.bus.on('rolloverHit', ({ skillShot, points }) => {
        if (skillShot) {
          this.showCallout(`Skill Shot! +${formatScore(points)}`, 1800);
          this.spawnFloatingPopup(`SKILL SHOT +${formatScore(points)}`, '#fde047');
        }
      }),
      this.bus.on('ballSave', () => {
        this.showCallout('Ball Saved! Re-Launching', 1700);
        this.spawnFloatingPopup('BALL SAVED!', '#34d399');
      }),
      this.bus.on('ballRescue', ({ manual }) => {
        this.showCallout(manual ? 'Ball Rescued' : 'Auto-Unstuck Ball', 1300);
      }),
      this.bus.on('comboUpdate', ({ comboCount, points, label }) => {
        if (comboCount >= 2) {
          this.spawnFloatingPopup(`${label} +${formatScore(points)}`, '#7dd3fc');
        }
      }),
      this.bus.on('rampCompleted', ({ points }) => {
        this.showCallout(`Stained-Glass Ramp +${formatScore(points)}`, 1600);
      }),
      this.bus.on('dropTargetHit', ({ bankComplete, points }) => {
        if (bankComplete) {
          this.showCallout(`Target Bank Complete! +${formatScore(points)}`, 1800);
        }
      }),
      this.bus.on('nudge', ({ tilted, warningCount }) => {
        if (tilted) {
          this.showCallout('TILT — Flippers Locked', 2200);
        } else {
          this.showCallout(`Danger — Nudge Warning ${warningCount}`, 1300);
        }
      }),
      this.bus.on('gameStateChanged', ({ current }) => {
        if (current === 'gameOver') {
          this.showCallout('Game Over — Press Start', 2800);
        }
      }),
    );
  }

  private spawnFloatingPopup(text: string, borderColor: string): void {
    if (this.disposed) return;
    while (this.floatLayer.childElementCount >= 2) {
      const first = this.floatLayer.firstElementChild;
      if (first) this.floatLayer.removeChild(first);
      else break;
    }

    const pop = document.createElement('div');
    pop.className = 'cp-float-pop';
    pop.textContent = text;
    pop.style.borderColor = borderColor;
    const slotTopPct = this.floatLayer.childElementCount === 0 ? 25 : 32;
    pop.style.left = '50%';
    pop.style.top = `${slotTopPct}%`;
    this.floatLayer.appendChild(pop);

    window.setTimeout(() => {
      if (pop.parentElement === this.floatLayer) {
        this.floatLayer.removeChild(pop);
      }
    }, 1180);
  }

  private showCallout(text: string, durationMs: number): void {
    if (this.disposed) return;
    this.calloutBanner.textContent = text;
    this.calloutBanner.classList.add('visible');

    if (this.calloutTimer !== null) {
      window.clearTimeout(this.calloutTimer);
    }
    this.calloutTimer = window.setTimeout(() => {
      this.calloutBanner.classList.remove('visible');
      this.calloutTimer = null;
    }, durationMs);
  }
}
