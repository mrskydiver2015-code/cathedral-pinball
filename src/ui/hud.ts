import type { HighScoreStore, RecordedHighScoreResult } from '../game/highScores.ts';
import type { PinballEventBus } from '../shared/events.ts';
import { TABLE_SPEC } from '../shared/tableSpec.ts';
import type {
  CameraMode,
  GamePhase,
  GameStateSnapshot,
  RendererCapabilities,
} from '../shared/types.ts';

export interface HudCallbacks {
  onStartOrRestart(): void;
  onToggleMute(): boolean;
  onCycleCamera(): CameraMode;
  getCameraMode(): CameraMode;
  onRescueBall(): void;
  onNudge(): void;
  onPlungerDrag(ratio: number): void;
  onPlungerRelease(ratio: number): void;
  getHighScoreStore(): HighScoreStore;
  getLastGameOverRecord(): RecordedHighScoreResult | null;
}

const INITIAL_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const CAMERA_LABELS: Readonly<Record<CameraMode, string>> = {
  classic: 'Classic',
  action: 'Action',
  top: 'Top',
};

const CAMERA_DESCRIPTIONS: Readonly<Record<CameraMode, string>> = {
  classic: 'Camera: Classic Cabinet',
  action: 'Camera: Action Zoom (Follow)',
  top: 'Camera: Overhead Table',
};

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
  background: linear-gradient(180deg, rgba(10, 14, 30, 0.84) 0%, rgba(6, 9, 20, 0.88) 100%);
  border: 1px solid rgba(165, 192, 255, 0.22);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

/* Top-Left Scoreboard — compact 3-row layout that never obscures upper playfield */
.cp-top-left {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  left: calc(12px + env(safe-area-inset-left));
  padding: 10px 13px;
  min-width: 248px;
  max-width: calc(54vw - env(safe-area-inset-left));
}

.cp-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}

.cp-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #cbd5f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cp-backend-badge {
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 6px;
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

.cp-score-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.cp-score {
  font-size: 27px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  letter-spacing: 0.015em;
  color: #ffffff;
  text-shadow: 0 0 18px rgba(125, 211, 252, 0.4);
}

.cp-best-btn {
  appearance: none;
  pointer-events: auto;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid rgba(251, 191, 36, 0.36);
  background: rgba(120, 53, 15, 0.34);
  color: #fde68a;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  touch-action: manipulation;
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.08s ease;
}

.cp-best-btn:hover {
  background: rgba(146, 64, 14, 0.52);
  border-color: rgba(251, 191, 36, 0.68);
}

.cp-best-btn:active {
  transform: translateY(1px);
}

.cp-metrics-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 5px;
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px solid rgba(148, 179, 255, 0.15);
  font-size: 10.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
}

.cp-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2.5px 6px;
  border-radius: 6px;
  background: rgba(24, 34, 68, 0.72);
  border: 1px solid rgba(148, 179, 255, 0.16);
  white-space: nowrap;
  flex-shrink: 0;
}

.cp-pill-mult {
  color: #f9a8d4;
  border-color: rgba(232, 121, 249, 0.4);
}

.cp-lock-pips {
  display: inline-flex;
  gap: 3px;
}

.cp-lock-pip {
  width: 6.5px;
  height: 6.5px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.28);
  border: 1px solid rgba(167, 243, 208, 0.35);
}

.cp-lock-pip.active {
  background: #34d399;
  box-shadow: 0 0 7px #34d399;
}

.cp-status-badge {
  margin-left: auto;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2.5px 6.5px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.24);
  border: 1px solid rgba(96, 165, 250, 0.32);
  color: #bfdbfe;
  white-space: nowrap;
  flex-shrink: 0;
}

.cp-status-badge.save {
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.58);
  background: rgba(6, 78, 59, 0.52);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.24);
}

.cp-status-badge.skill {
  color: #fde68a;
  border-color: rgba(251, 191, 36, 0.58);
  background: rgba(120, 53, 15, 0.52);
}

.cp-status-badge.multiball {
  background: rgba(192, 38, 211, 0.42);
  color: #fae8ff;
  border-color: rgba(232, 121, 249, 0.65);
}

.cp-status-badge.danger {
  background: rgba(225, 29, 72, 0.42);
  color: #ffe4e6;
  border-color: rgba(251, 113, 133, 0.6);
}

/* Unified Top-Right Control Grid */
.cp-top-right {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: calc(12px + env(safe-area-inset-right));
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 5px;
  justify-content: end;
  max-width: calc(41vw - env(safe-area-inset-right));
  pointer-events: auto;
}

.cp-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(148, 179, 255, 0.26);
  background: rgba(10, 15, 34, 0.84);
  color: #eef2ff;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 7px 11px;
  border-radius: 9px;
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.08s ease;
}

.cp-btn:hover {
  background: rgba(28, 42, 84, 0.92);
  border-color: rgba(125, 211, 252, 0.58);
}

.cp-btn:active {
  transform: translateY(1px);
}

.cp-btn-primary {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.62), rgba(168, 85, 247, 0.62));
  border-color: rgba(196, 181, 253, 0.58);
}

.cp-btn-gold {
  border-color: rgba(251, 191, 36, 0.42);
  color: #fde68a;
  background: rgba(38, 26, 14, 0.82);
}

.cp-btn-cam-active {
  border-color: rgba(56, 189, 248, 0.58);
  color: #bae6fd;
  background: rgba(12, 46, 78, 0.84);
}

.cp-btn-unstick {
  grid-column: 2;
  justify-self: end;
  font-size: 10px;
  padding: 5px 9px;
  color: #a5b4fc;
  border-color: rgba(129, 140, 248, 0.25);
  background: rgba(10, 14, 30, 0.7);
}

/* Transient Callout & Floating Combo Popups */
.cp-callout {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%) translateY(-6px);
  padding: 6px 16px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fef3c7;
  background: rgba(12, 18, 40, 0.92);
  border: 1px solid rgba(251, 191, 36, 0.58);
  box-shadow: 0 0 24px rgba(245, 158, 11, 0.32);
  opacity: 0;
  transition: opacity 0.18s ease, transform 0.18s ease;
  white-space: nowrap;
  pointer-events: none;
  z-index: 25;
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
    transform: translate(-50%, -32px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -48px) scale(0.95);
  }
}

.cp-float-pop {
  position: absolute;
  left: 50%;
  top: 38%;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fffbeb;
  background: rgba(15, 23, 48, 0.86);
  border: 1px solid rgba(251, 191, 36, 0.55);
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.65);
  box-shadow: 0 4px 18px rgba(245, 158, 11, 0.25);
  white-space: nowrap;
  animation: cpFloatPop 1.15s cubic-bezier(0.18, 0.85, 0.3, 1) forwards;
}

/* Sculpted Right-Side Plunger Slider with Brass Knob */
.cp-plunger-wrap {
  position: absolute;
  right: calc(14px + env(safe-area-inset-right));
  bottom: calc(28px + env(safe-area-inset-bottom));
  padding: 12px 11px 10px;
  width: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  border-color: rgba(214, 166, 82, 0.34);
}

.cp-plunger-wrap.dragging {
  cursor: grabbing;
  border-color: rgba(251, 191, 36, 0.78);
  box-shadow: 0 0 24px rgba(245, 158, 11, 0.36);
}

.cp-plunger-track {
  position: relative;
  width: 16px;
  height: 102px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(8, 12, 26, 0.95) 0%, rgba(18, 27, 52, 0.95) 100%);
  border: 1px solid rgba(165, 192, 255, 0.28);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: flex-end;
}

.cp-plunger-fill {
  width: 100%;
  height: 0%;
  border-radius: 999px;
  background: linear-gradient(180deg, #fb7185 0%, #f59e0b 52%, #38bdf8 100%);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.55);
  transition: height 0.03s linear;
}

.cp-plunger-knob {
  position: absolute;
  left: 50%;
  top: 4px;
  transform: translateX(-50%);
  width: 26px;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, #fef08a 0%, #d97706 100%);
  border: 1px solid rgba(255, 251, 235, 0.8);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.65), 0 0 10px rgba(245, 158, 11, 0.35);
  pointer-events: none;
  transition: top 0.03s linear;
}

.cp-plunger-label {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: #fde68a;
}

/* Large Sculpted AAA Arcade NUDGE Button at 40% Left Edge */
.cp-nudge-btn {
  appearance: none;
  position: absolute;
  left: calc(14px + env(safe-area-inset-left));
  bottom: 40%;
  transform: translateY(50%);
  width: 66px;
  height: 70px;
  border-radius: 18px;
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 4px;
  color: #fef3c7;
  background:
    radial-gradient(circle at 50% 24%, rgba(251, 191, 36, 0.28), rgba(15, 20, 42, 0.92) 72%);
  border: 1.5px solid rgba(251, 191, 36, 0.52);
  box-shadow:
    0 10px 24px rgba(0, 0, 0, 0.58),
    inset 0 1px 1px rgba(255, 255, 255, 0.22),
    0 0 16px rgba(245, 158, 11, 0.18);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  touch-action: none;
  transition: transform 0.08s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.cp-nudge-btn:hover {
  border-color: rgba(253, 224, 71, 0.82);
  box-shadow:
    0 10px 26px rgba(0, 0, 0, 0.62),
    0 0 22px rgba(245, 158, 11, 0.34);
}

.cp-nudge-btn:active,
.cp-nudge-btn.pulsing {
  transform: translateY(calc(50% + 2px)) scale(0.95);
  border-color: #fde047;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6), 0 0 26px rgba(251, 191, 36, 0.58);
}

.cp-nudge-btn.warn-1 {
  border-color: rgba(249, 115, 22, 0.78);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.58), 0 0 18px rgba(249, 115, 22, 0.35);
}

.cp-nudge-btn.warn-2 {
  border-color: rgba(244, 63, 94, 0.88);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.58), 0 0 22px rgba(244, 63, 94, 0.45);
}

.cp-nudge-btn.tilted {
  border-color: rgba(225, 29, 72, 0.9);
  color: #fda4af;
  opacity: 0.75;
}

.cp-nudge-icon {
  width: 24px;
  height: 24px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.45));
}

.cp-nudge-text {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  line-height: 1;
}

.cp-nudge-leds {
  display: flex;
  gap: 5px;
  margin-top: 1px;
}

.cp-nudge-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.28);
  border: 1px solid rgba(251, 191, 36, 0.35);
}

.cp-nudge-led.warn {
  background: #f97316;
  border-color: #fdba74;
  box-shadow: 0 0 7px #f97316;
}

.cp-nudge-led.danger {
  background: #f43f5e;
  border-color: #fda4af;
  box-shadow: 0 0 8px #f43f5e;
}

/* Clean Bottom Corner Touch Glows (no text clutter over lockdown bar!) */
.cp-flipper-glow {
  position: absolute;
  bottom: 0;
  width: 34vw;
  max-width: 180px;
  height: 6px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.9) 0%, rgba(56, 189, 248, 0) 75%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.08s ease;
}

.cp-flipper-glow.left {
  left: 4vw;
}

.cp-flipper-glow.right {
  right: 4vw;
}

.cp-flipper-glow.active {
  opacity: 0.95;
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
  max-width: calc(100% - 170px);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* High Score Leaderboard & Game Over Modal */
.cp-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(3, 5, 14, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: none;
  align-items: center;
  justify-content: center;
  padding: calc(16px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right))
    calc(16px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left));
  pointer-events: auto;
  z-index: 60;
}

.cp-modal-backdrop.open {
  display: flex;
}

.cp-modal-card {
  width: 100%;
  max-width: 400px;
  max-height: 86dvh;
  display: flex;
  flex-direction: column;
  padding: 18px 18px 16px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(13, 19, 40, 0.96) 0%, rgba(7, 10, 24, 0.98) 100%);
  border: 1px solid rgba(251, 191, 36, 0.42);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.78), 0 0 36px rgba(56, 189, 248, 0.14);
  overflow: hidden;
}

.cp-modal-header {
  text-align: center;
  margin-bottom: 10px;
}

.cp-modal-kicker {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #fbbf24;
}

.cp-modal-title {
  margin-top: 3px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #ffffff;
}

.cp-modal-run-score {
  margin-top: 4px;
  font-size: 28px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #7dd3fc;
  text-shadow: 0 0 18px rgba(56, 189, 248, 0.4);
}

/* Tactile 3-Letter Initials Stepper (mobile + desktop keyboard friendly) */
.cp-initials-box {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border-radius: 12px;
  background: rgba(30, 41, 78, 0.5);
  border: 1px solid rgba(251, 191, 36, 0.42);
}

.cp-initials-box.visible {
  display: flex;
}

.cp-initials-label {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fde68a;
}

.cp-initials-slots {
  display: flex;
  gap: 10px;
}

.cp-initial-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.cp-step-btn {
  appearance: none;
  width: 40px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid rgba(148, 179, 255, 0.28);
  background: rgba(15, 23, 48, 0.9);
  color: #cbd5f5;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  touch-action: manipulation;
}

.cp-step-btn:active {
  background: rgba(56, 189, 248, 0.35);
}

.cp-initial-char {
  width: 40px;
  height: 40px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21px;
  font-weight: 900;
  letter-spacing: 0.04em;
  color: #fef3c7;
  background: rgba(8, 12, 28, 0.92);
  border: 1.5px solid rgba(251, 191, 36, 0.55);
  cursor: pointer;
}

.cp-initial-char.selected {
  border-color: #38bdf8;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.45);
  color: #ffffff;
}

.cp-leaderboard-list {
  flex: 1 1 auto;
  overflow-y: auto;
  touch-action: pan-y;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-right: 2px;
  margin-bottom: 12px;
}

.cp-lb-row {
  display: grid;
  grid-template-columns: 34px 54px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 9px;
  background: rgba(16, 24, 50, 0.62);
  border: 1px solid rgba(148, 179, 255, 0.12);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.cp-lb-row.rank-1 {
  background: linear-gradient(90deg, rgba(120, 53, 15, 0.46), rgba(20, 29, 58, 0.72));
  border-color: rgba(251, 191, 36, 0.48);
}

.cp-lb-row.highlight {
  border-color: #38bdf8;
  box-shadow: inset 0 0 14px rgba(56, 189, 248, 0.22);
}

.cp-lb-rank {
  font-weight: 800;
  color: #94a3b8;
  font-size: 12px;
}

.cp-lb-row.rank-1 .cp-lb-rank {
  color: #fbbf24;
}
.cp-lb-row.rank-2 .cp-lb-rank {
  color: #e2e8f0;
}
.cp-lb-row.rank-3 .cp-lb-rank {
  color: #fdba74;
}

.cp-lb-initials {
  font-weight: 900;
  letter-spacing: 0.12em;
  color: #f8fafc;
}

.cp-lb-mult {
  font-size: 10.5px;
  font-weight: 700;
  color: #f472b6;
  justify-self: end;
}

.cp-lb-score {
  font-weight: 800;
  color: #ffffff;
  text-align: right;
  min-width: 72px;
}

.cp-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.cp-modal-actions .cp-btn {
  flex: 1;
  padding: 10px 14px;
  font-size: 13px;
}

@media (pointer: coarse), (max-width: 760px) {
  .cp-hints {
    display: none;
  }
}

@media (max-width: 600px) {
  .cp-top-left {
    top: calc(8px + env(safe-area-inset-top));
    left: calc(8px + env(safe-area-inset-left));
    padding: 7px 9px;
    min-width: 0;
    width: calc(53vw - env(safe-area-inset-left));
    max-width: calc(53vw - env(safe-area-inset-left));
  }
  .cp-title {
    font-size: 8.5px;
    letter-spacing: 0.07em;
  }
  .cp-backend-badge {
    font-size: 7.5px;
    padding: 1px 5px;
  }
  .cp-score {
    font-size: 20px;
  }
  .cp-best-btn {
    font-size: 9px;
    padding: 2px 5.5px;
  }
  .cp-metrics-row {
    gap: 3px;
    margin-top: 5px;
    padding-top: 4px;
    font-size: 9px;
  }
  .cp-pill {
    padding: 2px 4.5px;
    gap: 3px;
  }
  .cp-status-badge {
    font-size: 8.5px;
    padding: 2px 5px;
  }
  .cp-top-right {
    top: calc(8px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
    max-width: calc(42vw - env(safe-area-inset-right));
    gap: 4px;
  }
  .cp-btn {
    padding: 5.5px 7.5px;
    font-size: 10px;
    border-radius: 8px;
    gap: 3px;
  }
  .cp-btn-unstick {
    font-size: 9px;
    padding: 4px 7px;
  }
  .cp-callout {
    top: calc(92px + env(safe-area-inset-top));
    font-size: 10.5px;
    padding: 5px 12px;
  }
  .cp-plunger-wrap {
    bottom: calc(20px + env(safe-area-inset-bottom));
    right: calc(8px + env(safe-area-inset-right));
    padding: 10px 9px 8px;
    width: 50px;
  }
  .cp-plunger-track {
    height: 86px;
  }
  .cp-nudge-btn {
    left: calc(8px + env(safe-area-inset-left));
    bottom: 40%;
    width: 58px;
    height: 62px;
    border-radius: 16px;
  }
  .cp-nudge-icon {
    width: 21px;
    height: 21px;
  }
  .cp-nudge-text {
    font-size: 8.5px;
  }
}

@media (max-height: 480px) {
  .cp-top-left {
    padding: 6px 10px;
    min-width: 210px;
  }
  .cp-score {
    font-size: 19px;
  }
  .cp-metrics-row {
    margin-top: 4px;
    padding-top: 4px;
    gap: 4px;
    font-size: 9.5px;
  }
  .cp-btn {
    padding: 5px 8px;
    font-size: 10.5px;
  }
  .cp-plunger-track {
    height: 68px;
  }
  .cp-plunger-wrap {
    bottom: calc(16px + env(safe-area-inset-bottom));
  }
  .cp-nudge-btn {
    bottom: 38%;
    width: 56px;
    height: 58px;
  }
  .cp-modal-card {
    padding: 12px 14px;
    max-width: 440px;
  }
  .cp-modal-run-score {
    font-size: 22px;
  }
}
`;

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
  private readonly bestBtnText: HTMLSpanElement;
  private readonly ballPill: HTMLSpanElement;
  private readonly multiplierPill: HTMLSpanElement;
  private readonly lockPips: readonly HTMLSpanElement[];
  private readonly statusBadge: HTMLSpanElement;

  private readonly startBtn: HTMLButtonElement;
  private readonly scoresBtn: HTMLButtonElement;
  private readonly cameraBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly rescueBtn: HTMLButtonElement;
  private readonly nudgeBtn: HTMLButtonElement;
  private readonly nudgeLeds: readonly [HTMLSpanElement, HTMLSpanElement];

  private readonly calloutBanner: HTMLDivElement;
  private readonly floatLayer: HTMLDivElement;
  private readonly plungerTrack: HTMLDivElement;
  private readonly plungerFill: HTMLDivElement;
  private readonly plungerKnob: HTMLDivElement;
  private readonly leftGlow: HTMLDivElement;
  private readonly rightGlow: HTMLDivElement;

  // High Score Leaderboard Modal
  private readonly modalBackdrop: HTMLDivElement;
  private readonly modalKicker: HTMLDivElement;
  private readonly modalTitle: HTMLDivElement;
  private readonly modalRunScore: HTMLDivElement;
  private readonly initialsBox: HTMLDivElement;
  private readonly initialsLabel: HTMLDivElement;
  private readonly initialCharEls: readonly [HTMLDivElement, HTMLDivElement, HTMLDivElement];
  private readonly leaderboardList: HTMLDivElement;
  private readonly modalPlayBtn: HTMLButtonElement;

  private modalOpen = false;
  private activeRecordEntryId: string | null = null;
  private currentInitials: [string, string, string] = ['Y', 'O', 'U'];
  private selectedInitialSlot: 0 | 1 | 2 = 0;
  private gameOverModalTimer: number | null = null;
  private nudgePulseTimer: number | null = null;

  private calloutTimer: number | null = null;
  private plungerDragPointerId: number | null = null;
  private plungerDragStartY = 0;
  private plungerCurrentRatio = 0;
  private plungerDidDrag = false;
  private disposed = false;

  // Cached values to avoid redundant 60fps DOM churn
  private lastScore = -1;
  private lastHighScore = -1;
  private lastBallNum = -1;
  private lastMaxBalls = -1;
  private lastMultiplier = -1;
  private lastLocked = -1;
  private lastStatusKey = '';
  private lastPhase: GamePhase | null = null;
  private lastBackendKey = '';
  private lastPlungerPct = -1;
  private lastLeftActive: boolean | null = null;
  private lastRightActive: boolean | null = null;
  private lastTiltKey = '';
  private lastCamMode: CameraMode | null = null;

  constructor(container: HTMLElement, bus: PinballEventBus, callbacks: HudCallbacks) {
    this.container = container;
    this.bus = bus;
    this.callbacks = callbacks;

    const pref = callbacks.getHighScoreStore().getPreferredInitials();
    this.currentInitials = [pref[0] ?? 'Y', pref[1] ?? 'O', pref[2] ?? 'U'];

    if (typeof window !== 'undefined' && window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const root = document.createElement('div');
    root.className = 'cp-hud';
    this.root = root;

    const styleEl = document.createElement('style');
    styleEl.textContent = HUD_STYLES;
    root.appendChild(styleEl);

    // 1. Top-Left Compact Scoreboard
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

    const scoreRow = document.createElement('div');
    scoreRow.className = 'cp-score-row';
    this.scoreValue = document.createElement('div');
    this.scoreValue.className = 'cp-score';
    this.scoreValue.textContent = '0';

    const bestBtn = document.createElement('button');
    bestBtn.type = 'button';
    bestBtn.className = 'cp-best-btn';
    bestBtn.dataset.uiControl = 'true';
    bestBtn.title = 'Open High Score Leaderboard';
    const trophySpan = document.createElement('span');
    trophySpan.textContent = '🏆';
    this.bestBtnText = document.createElement('span');
    this.bestBtnText.textContent = '0';
    bestBtn.append(trophySpan, this.bestBtnText);
    bestBtn.addEventListener('click', () => {
      this.openLeaderboardModal(false);
    });
    scoreRow.append(this.scoreValue, bestBtn);

    const metricsRow = document.createElement('div');
    metricsRow.className = 'cp-metrics-row';

    this.ballPill = document.createElement('span');
    this.ballPill.className = 'cp-pill';
    this.ballPill.textContent = `B 1/${TABLE_SPEC.rules.ballsPerGame}`;

    this.multiplierPill = document.createElement('span');
    this.multiplierPill.className = 'cp-pill cp-pill-mult';
    this.multiplierPill.textContent = '1x';

    const lockPill = document.createElement('span');
    lockPill.className = 'cp-pill';
    lockPill.title = 'Sanctuary Multiball Locks';
    const lockLabel = document.createElement('span');
    lockLabel.textContent = 'LCK';
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
    lockPill.append(lockLabel, pipsWrap);

    this.statusBadge = document.createElement('span');
    this.statusBadge.className = 'cp-status-badge';
    this.statusBadge.textContent = 'Ready';

    metricsRow.append(this.ballPill, this.multiplierPill, lockPill, this.statusBadge);
    topLeft.append(headerRow, scoreRow, metricsRow);

    // 2. Top-Right Harmonious 2-Column Action Grid
    const topRight = document.createElement('div');
    topRight.className = 'cp-top-right';
    topRight.dataset.uiControl = 'true';

    this.startBtn = document.createElement('button');
    this.startBtn.type = 'button';
    this.startBtn.className = 'cp-btn cp-btn-primary';
    this.startBtn.dataset.uiControl = 'true';
    this.startBtn.textContent = '↻ New';
    this.startBtn.addEventListener('click', () => {
      this.closeLeaderboardModal();
      this.callbacks.onStartOrRestart();
    });

    this.scoresBtn = document.createElement('button');
    this.scoresBtn.type = 'button';
    this.scoresBtn.className = 'cp-btn cp-btn-gold';
    this.scoresBtn.dataset.uiControl = 'true';
    this.scoresBtn.textContent = '🏆 Top';
    this.scoresBtn.addEventListener('click', () => {
      if (this.modalOpen) {
        this.closeLeaderboardModal();
      } else {
        this.openLeaderboardModal(false);
      }
    });

    this.cameraBtn = document.createElement('button');
    this.cameraBtn.type = 'button';
    this.cameraBtn.className = 'cp-btn';
    this.cameraBtn.dataset.uiControl = 'true';
    this.updateCameraButtonLabel(this.callbacks.getCameraMode());
    this.cameraBtn.addEventListener('click', () => {
      const next = this.callbacks.onCycleCamera();
      this.updateCameraButtonLabel(next);
      this.showCallout(CAMERA_DESCRIPTIONS[next], 1450);
    });

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'cp-btn';
    this.muteBtn.dataset.uiControl = 'true';
    this.muteBtn.textContent = '♪ Sound';
    this.muteBtn.addEventListener('click', () => {
      const isMuted = this.callbacks.onToggleMute();
      this.muteBtn.textContent = isMuted ? '✕ Muted' : '♪ Sound';
    });

    this.rescueBtn = document.createElement('button');
    this.rescueBtn.type = 'button';
    this.rescueBtn.className = 'cp-btn cp-btn-unstick';
    this.rescueBtn.dataset.uiControl = 'true';
    this.rescueBtn.title = 'Unstick / Rescue active ball';
    this.rescueBtn.textContent = '⚡ Unstick';
    this.rescueBtn.addEventListener('click', () => {
      this.callbacks.onRescueBall();
    });

    topRight.append(this.startBtn, this.scoresBtn, this.cameraBtn, this.muteBtn, this.rescueBtn);

    // 3. Callout Banner & Floating Combo Layer
    this.calloutBanner = document.createElement('div');
    this.calloutBanner.className = 'cp-callout';

    this.floatLayer = document.createElement('div');
    this.floatLayer.className = 'cp-float-layer';

    // 4. Right-Side Plunger Slider with Physical Brass Knob
    const plungerWrap = document.createElement('div');
    plungerWrap.className = 'cp-panel cp-plunger-wrap';
    plungerWrap.dataset.uiControl = 'true';

    this.plungerTrack = document.createElement('div');
    this.plungerTrack.className = 'cp-plunger-track';
    this.plungerFill = document.createElement('div');
    this.plungerFill.className = 'cp-plunger-fill';
    this.plungerKnob = document.createElement('div');
    this.plungerKnob.className = 'cp-plunger-knob';
    this.plungerTrack.append(this.plungerFill, this.plungerKnob);

    const plungerLabel = document.createElement('span');
    plungerLabel.className = 'cp-plunger-label';
    plungerLabel.textContent = 'Pull';
    plungerWrap.append(this.plungerTrack, plungerLabel);

    this.bindTouchPlunger(plungerWrap);

    // 5. Large Sculpted Arcade NUDGE Button at 40% Left Edge
    this.nudgeBtn = document.createElement('button');
    this.nudgeBtn.type = 'button';
    this.nudgeBtn.className = 'cp-nudge-btn';
    this.nudgeBtn.dataset.uiControl = 'true';
    this.nudgeBtn.title = 'Nudge Table (careful not to TILT!)';
    this.nudgeBtn.innerHTML = `
      <svg class="cp-nudge-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4l-3.5 3.5M12 4l3.5 3.5M12 4v8" />
        <path d="M5 14.5c2-2 4.5-3 7-3s5 1 7 3" />
        <path d="M7.5 18.5c1.4-1.2 3-1.8 4.5-1.8s3.1.6 4.5 1.8" />
      </svg>
    `;
    const nudgeText = document.createElement('span');
    nudgeText.className = 'cp-nudge-text';
    nudgeText.textContent = 'Nudge';

    const ledsWrap = document.createElement('span');
    ledsWrap.className = 'cp-nudge-leds';
    const led1 = document.createElement('span');
    led1.className = 'cp-nudge-led';
    const led2 = document.createElement('span');
    led2.className = 'cp-nudge-led';
    ledsWrap.append(led1, led2);
    this.nudgeLeds = [led1, led2];
    this.nudgeBtn.append(nudgeText, ledsWrap);

    const onNudgeTouchStart = (e: TouchEvent): void => {
      e.preventDefault();
    };
    const onNudgePointerDown = (e: PointerEvent): void => {
      e.stopPropagation();
      e.preventDefault();
      this.nudgeBtn.classList.add('pulsing');
      if (this.nudgePulseTimer !== null) window.clearTimeout(this.nudgePulseTimer);
      this.nudgePulseTimer = window.setTimeout(() => {
        this.nudgeBtn.classList.remove('pulsing');
        this.nudgePulseTimer = null;
      }, 140);
      this.callbacks.onNudge();
    };
    this.nudgeBtn.addEventListener('touchstart', onNudgeTouchStart, { passive: false });
    this.nudgeBtn.addEventListener('pointerdown', onNudgePointerDown);
    this.domCleanups.push(() => {
      this.nudgeBtn.removeEventListener('touchstart', onNudgeTouchStart);
      this.nudgeBtn.removeEventListener('pointerdown', onNudgePointerDown);
    });

    // 6. Subtle Bottom Edge Flipper Glows
    this.leftGlow = document.createElement('div');
    this.leftGlow.className = 'cp-flipper-glow left';
    this.rightGlow = document.createElement('div');
    this.rightGlow.className = 'cp-flipper-glow right';

    // 7. Desktop Keyboard Hint Strip
    const hints = document.createElement('div');
    hints.className = 'cp-panel cp-hints';
    hints.textContent =
      'A / ← Left  •  D / → Right  •  Space / ↓ Plunger  •  Z / X / ↑ Nudge  •  C Camera  •  M Mute';

    // 8. High Score Leaderboard & Game Over Modal
    this.modalBackdrop = document.createElement('div');
    this.modalBackdrop.className = 'cp-modal-backdrop';
    this.modalBackdrop.dataset.uiControl = 'true';

    const modalCard = document.createElement('div');
    modalCard.className = 'cp-modal-card';
    modalCard.dataset.uiControl = 'true';
    modalCard.dataset.modalCard = 'true';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'cp-modal-header';
    this.modalKicker = document.createElement('div');
    this.modalKicker.className = 'cp-modal-kicker';
    this.modalKicker.textContent = 'Cathedral Sanctuary';
    this.modalTitle = document.createElement('div');
    this.modalTitle.className = 'cp-modal-title';
    this.modalTitle.textContent = 'Hall of Champions';
    this.modalRunScore = document.createElement('div');
    this.modalRunScore.className = 'cp-modal-run-score';
    this.modalRunScore.style.display = 'none';
    modalHeader.append(this.modalKicker, this.modalTitle, this.modalRunScore);

    // 3-Letter Arcade Initials Stepper
    this.initialsBox = document.createElement('div');
    this.initialsBox.className = 'cp-initials-box';
    this.initialsLabel = document.createElement('div');
    this.initialsLabel.className = 'cp-initials-label';
    this.initialsLabel.textContent = 'New High Score — Set Initials';

    const slotsRow = document.createElement('div');
    slotsRow.className = 'cp-initials-slots';
    const charEls: HTMLDivElement[] = [];

    for (let slot = 0; slot < 3; slot++) {
      const slotIdx = slot as 0 | 1 | 2;
      const col = document.createElement('div');
      col.className = 'cp-initial-col';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'cp-step-btn';
      upBtn.dataset.uiControl = 'true';
      upBtn.textContent = '▲';
      upBtn.addEventListener('click', () => {
        this.selectedInitialSlot = slotIdx;
        this.stepInitialChar(slotIdx, 1);
      });

      const charEl = document.createElement('div');
      charEl.className = slotIdx === 0 ? 'cp-initial-char selected' : 'cp-initial-char';
      charEl.dataset.uiControl = 'true';
      charEl.textContent = this.currentInitials[slotIdx];
      charEl.addEventListener('click', () => {
        this.selectInitialSlot(slotIdx);
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'cp-step-btn';
      downBtn.dataset.uiControl = 'true';
      downBtn.textContent = '▼';
      downBtn.addEventListener('click', () => {
        this.selectedInitialSlot = slotIdx;
        this.stepInitialChar(slotIdx, -1);
      });

      col.append(upBtn, charEl, downBtn);
      slotsRow.appendChild(col);
      charEls.push(charEl);
    }
    this.initialCharEls = [charEls[0], charEls[1], charEls[2]];
    this.initialsBox.append(this.initialsLabel, slotsRow);

    this.leaderboardList = document.createElement('div');
    this.leaderboardList.className = 'cp-leaderboard-list';
    this.leaderboardList.dataset.uiControl = 'true';

    const modalActions = document.createElement('div');
    modalActions.className = 'cp-modal-actions';

    this.modalPlayBtn = document.createElement('button');
    this.modalPlayBtn.type = 'button';
    this.modalPlayBtn.className = 'cp-btn cp-btn-primary';
    this.modalPlayBtn.dataset.uiControl = 'true';
    this.modalPlayBtn.textContent = '▶ Play Again';
    this.modalPlayBtn.addEventListener('click', () => {
      this.closeLeaderboardModal();
      this.callbacks.onStartOrRestart();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cp-btn';
    closeBtn.dataset.uiControl = 'true';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      this.closeLeaderboardModal();
    });

    modalActions.append(this.modalPlayBtn, closeBtn);
    modalCard.append(modalHeader, this.initialsBox, this.leaderboardList, modalActions);
    this.modalBackdrop.appendChild(modalCard);

    this.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === this.modalBackdrop) {
        this.closeLeaderboardModal();
      }
    });

    root.append(
      topLeft,
      topRight,
      this.calloutBanner,
      this.floatLayer,
      plungerWrap,
      this.nudgeBtn,
      this.leftGlow,
      this.rightGlow,
      hints,
      this.modalBackdrop,
    );
    container.appendChild(root);

    this.bindEvents();
  }

  isModalOpen(): boolean {
    return this.modalOpen;
  }

  handleModalKeyDown(event: KeyboardEvent): boolean {
    if (!this.modalOpen) return false;

    if (event.code === 'Escape') {
      event.preventDefault();
      this.closeLeaderboardModal();
      return true;
    }

    if (event.code === 'Enter') {
      event.preventDefault();
      this.closeLeaderboardModal();
      this.callbacks.onStartOrRestart();
      return true;
    }

    if (this.activeRecordEntryId) {
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        this.selectInitialSlot(((this.selectedInitialSlot + 2) % 3) as 0 | 1 | 2);
        return true;
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        this.selectInitialSlot(((this.selectedInitialSlot + 1) % 3) as 0 | 1 | 2);
        return true;
      }
      if (event.code === 'ArrowUp') {
        event.preventDefault();
        this.stepInitialChar(this.selectedInitialSlot, 1);
        return true;
      }
      if (event.code === 'ArrowDown') {
        event.preventDefault();
        this.stepInitialChar(this.selectedInitialSlot, -1);
        return true;
      }
      if (event.code === 'Backspace') {
        event.preventDefault();
        const prevSlot = Math.max(0, this.selectedInitialSlot - 1) as 0 | 1 | 2;
        this.selectInitialSlot(prevSlot);
        return true;
      }

      const keyUpper = event.key.toUpperCase();
      if (keyUpper.length === 1 && /^[A-Z0-9ÅÄÖ]$/.test(keyUpper)) {
        event.preventDefault();
        this.currentInitials[this.selectedInitialSlot] = keyUpper;
        this.commitInitialsUpdate();
        if (this.selectedInitialSlot < 2) {
          this.selectInitialSlot((this.selectedInitialSlot + 1) as 0 | 1 | 2);
        } else {
          this.renderInitialSlots();
        }
        return true;
      }
    }

    return true;
  }

  openLeaderboardModal(fromGameOver: boolean, finalScore?: number): void {
    if (this.disposed) return;
    this.modalOpen = true;
    const store = this.callbacks.getHighScoreStore();
    const record = fromGameOver ? this.callbacks.getLastGameOverRecord() : null;

    if (fromGameOver) {
      this.modalKicker.textContent = record?.isNewBest
        ? '★ New Cathedral Record ★'
        : record
          ? `Top 10 Finish — Rank #${record.rank}`
          : 'Ball 3 Drained';
      this.modalTitle.textContent = 'Game Over';
      this.modalRunScore.style.display = 'block';
      this.modalRunScore.textContent = formatScore(finalScore ?? 0);
      this.modalPlayBtn.textContent = '▶ Play Again';
    } else {
      this.modalKicker.textContent = 'Local Arcade Leaderboard';
      this.modalTitle.textContent = 'Hall of Champions';
      this.modalRunScore.style.display = 'none';
      this.modalPlayBtn.textContent = '↻ New Game';
    }

    if (record) {
      this.activeRecordEntryId = record.entry.id;
      const init = record.entry.initials;
      this.currentInitials = [init[0] ?? 'Y', init[1] ?? 'O', init[2] ?? 'U'];
      this.selectedInitialSlot = 0;
      this.initialsLabel.textContent = `Rank #${record.rank} — Your Initials`;
      this.initialsBox.classList.add('visible');
      this.renderInitialSlots();
    } else {
      this.activeRecordEntryId = null;
      this.initialsBox.classList.remove('visible');
    }

    this.renderLeaderboardRows(store, record?.entry.id ?? null);
    this.modalBackdrop.classList.add('open');
  }

  closeLeaderboardModal(): void {
    this.modalOpen = false;
    this.modalBackdrop.classList.remove('open');
  }

  private selectInitialSlot(slot: 0 | 1 | 2): void {
    this.selectedInitialSlot = slot;
    this.renderInitialSlots();
  }

  private stepInitialChar(slot: 0 | 1 | 2, delta: 1 | -1): void {
    const cur = this.currentInitials[slot];
    const idx = INITIAL_CHARSET.indexOf(cur);
    const nextIdx =
      idx === -1
        ? 0
        : (idx + delta + INITIAL_CHARSET.length) % INITIAL_CHARSET.length;
    this.currentInitials[slot] = INITIAL_CHARSET[nextIdx];
    this.commitInitialsUpdate();
    this.renderInitialSlots();
  }

  private renderInitialSlots(): void {
    for (let i = 0; i < 3; i++) {
      const el = this.initialCharEls[i];
      el.textContent = this.currentInitials[i];
      el.classList.toggle('selected', i === this.selectedInitialSlot);
    }
  }

  private commitInitialsUpdate(): void {
    if (!this.activeRecordEntryId) return;
    const store = this.callbacks.getHighScoreStore();
    const joined = this.currentInitials.join('');
    store.updateEntryInitials(this.activeRecordEntryId, joined);
    this.renderLeaderboardRows(store, this.activeRecordEntryId);
  }

  private renderLeaderboardRows(store: HighScoreStore, highlightId: string | null): void {
    this.leaderboardList.innerHTML = '';
    const entries = store.getEntries();

    entries.forEach((entry, idx) => {
      const rank = idx + 1;
      const row = document.createElement('div');
      row.className = `cp-lb-row rank-${rank}${entry.id === highlightId ? ' highlight' : ''}`;

      const rankEl = document.createElement('span');
      rankEl.className = 'cp-lb-rank';
      rankEl.textContent = rank === 1 ? '👑 #1' : `#${rank}`;

      const initEl = document.createElement('span');
      initEl.className = 'cp-lb-initials';
      initEl.textContent = entry.initials;

      const multEl = document.createElement('span');
      multEl.className = 'cp-lb-mult';
      multEl.textContent = entry.maxMultiplier > 1 ? `${entry.maxMultiplier}x` : '';

      const scoreEl = document.createElement('span');
      scoreEl.className = 'cp-lb-score';
      scoreEl.textContent = formatScore(entry.score);

      row.append(rankEl, initEl, multEl, scoreEl);
      this.leaderboardList.appendChild(row);
    });
  }

  private updateCameraButtonLabel(mode: CameraMode): void {
    this.lastCamMode = mode;
    this.cameraBtn.textContent = `Cam: ${CAMERA_LABELS[mode]}`;
    this.cameraBtn.classList.toggle('cp-btn-cam-active', mode !== 'classic');
  }

  private bindTouchPlunger(plungerWrap: HTMLDivElement): void {
    const onTouchStart = (e: TouchEvent): void => {
      e.preventDefault();
    };
    plungerWrap.addEventListener('touchstart', onTouchStart, { passive: false });

    const onPointerDown = (e: PointerEvent): void => {
      e.stopPropagation();
      e.preventDefault();
      if (this.modalOpen) {
        this.closeLeaderboardModal();
      }
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

    const camMode = this.callbacks.getCameraMode();
    if (camMode !== this.lastCamMode) {
      this.updateCameraButtonLabel(camMode);
    }

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
      this.bestBtnText.textContent = formatScore(snapshot.highScore);
    }

    if (snapshot.ballNumber !== this.lastBallNum || snapshot.maxBalls !== this.lastMaxBalls) {
      this.lastBallNum = snapshot.ballNumber;
      this.lastMaxBalls = snapshot.maxBalls;
      this.ballPill.textContent = `B ${snapshot.ballNumber}/${snapshot.maxBalls}`;
    }

    if (snapshot.multiplier !== this.lastMultiplier) {
      this.lastMultiplier = snapshot.multiplier;
      this.multiplierPill.textContent = `${snapshot.multiplier}x`;
    }

    if (snapshot.lockedBalls !== this.lastLocked) {
      this.lastLocked = snapshot.lockedBalls;
      this.lockPips.forEach((pip, idx) => {
        pip.classList.toggle('active', idx < snapshot.lockedBalls);
      });
    }

    if (snapshot.phase !== this.lastPhase) {
      this.lastPhase = snapshot.phase;
      this.startBtn.textContent =
        snapshot.phase === 'attract' || snapshot.phase === 'gameOver'
          ? '▶ Start'
          : '↻ New';
    }

    // Single smart priority status badge so top-left scoreboard never overflows vertically
    const saveSec = Math.ceil(Math.max(0, snapshot.ballSaveRemainingSec));
    const skillVisible =
      snapshot.skillShotAvailable && (snapshot.phase === 'ready' || snapshot.phase === 'playing');

    let statusText = 'Ready';
    let statusVariant = '';
    if (snapshot.phase === 'tilted') {
      statusText = 'TILT';
      statusVariant = 'danger';
    } else if (snapshot.phase === 'gameOver') {
      statusText = 'Over';
      statusVariant = 'danger';
    } else if (snapshot.phase === 'multiball') {
      statusText = saveSec > 0 ? `MB • ${saveSec}s` : 'Multiball';
      statusVariant = 'multiball';
    } else if (skillVisible && snapshot.phase === 'ready') {
      statusText = 'Skill Shot';
      statusVariant = 'skill';
    } else if (saveSec > 0) {
      statusText = `Save ${saveSec}s`;
      statusVariant = 'save';
    } else if (skillVisible) {
      statusText = 'Skill Shot';
      statusVariant = 'skill';
    } else if (snapshot.phase === 'playing') {
      statusText = 'In Play';
    }

    const statusKey = `${statusVariant}:${statusText}`;
    if (statusKey !== this.lastStatusKey) {
      this.lastStatusKey = statusKey;
      this.statusBadge.textContent = statusText;
      this.statusBadge.className = statusVariant
        ? `cp-status-badge ${statusVariant}`
        : 'cp-status-badge';
    }

    // Live Nudge button warning LEDs & danger ring
    const tiltKey = `${snapshot.tilted ? 1 : 0}:${snapshot.tiltWarnings}`;
    if (tiltKey !== this.lastTiltKey) {
      this.lastTiltKey = tiltKey;
      this.nudgeBtn.classList.toggle('tilted', snapshot.tilted);
      this.nudgeBtn.classList.toggle('warn-1', !snapshot.tilted && snapshot.tiltWarnings === 1);
      this.nudgeBtn.classList.toggle('warn-2', !snapshot.tilted && snapshot.tiltWarnings >= 2);

      this.nudgeLeds[0].className = snapshot.tilted
        ? 'cp-nudge-led danger'
        : snapshot.tiltWarnings >= 1
          ? 'cp-nudge-led warn'
          : 'cp-nudge-led';
      this.nudgeLeds[1].className =
        snapshot.tilted || snapshot.tiltWarnings >= 2
          ? 'cp-nudge-led danger'
          : 'cp-nudge-led';
    }

    if (snapshot.leftFlipperActive !== this.lastLeftActive) {
      this.lastLeftActive = snapshot.leftFlipperActive;
      this.leftGlow.classList.toggle('active', snapshot.leftFlipperActive);
    }

    if (snapshot.rightFlipperActive !== this.lastRightActive) {
      this.lastRightActive = snapshot.rightFlipperActive;
      this.rightGlow.classList.toggle('active', snapshot.rightFlipperActive);
    }

    const ratio = Math.max(0, Math.min(1, snapshot.plungerCharge));
    const plungerPct = Math.round(ratio * 100);
    if (plungerPct !== this.lastPlungerPct) {
      this.lastPlungerPct = plungerPct;
      this.plungerFill.style.height = `${plungerPct}%`;
      const trackHeight = this.plungerTrack.clientHeight || 96;
      const knobTravel = Math.max(0, trackHeight - 22);
      this.plungerKnob.style.top = `${4 + Math.round(ratio * knobTravel)}px`;
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
    if (this.gameOverModalTimer !== null) {
      window.clearTimeout(this.gameOverModalTimer);
      this.gameOverModalTimer = null;
    }
    if (this.nudgePulseTimer !== null) {
      window.clearTimeout(this.nudgePulseTimer);
      this.nudgePulseTimer = null;
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
        this.showCallout(manual ? 'Ball Rescued' : 'Loop Broken — Ball Freed', 1350);
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
          this.showCallout(`Nudge Warning ${warningCount}/${TABLE_SPEC.rules.maxTiltWarnings}`, 1250);
        }
      }),
      this.bus.on('gameStateChanged', ({ current, snapshot }) => {
        if (current === 'gameOver') {
          this.showCallout('Game Over', 2000);
          if (this.gameOverModalTimer !== null) {
            window.clearTimeout(this.gameOverModalTimer);
          }
          this.gameOverModalTimer = window.setTimeout(() => {
            this.gameOverModalTimer = null;
            if (!this.disposed && this.lastPhase === 'gameOver') {
              this.openLeaderboardModal(true, snapshot.score);
            }
          }, 520);
        } else if (current === 'ready' && this.modalOpen) {
          this.closeLeaderboardModal();
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
    const slotTopPct = this.floatLayer.childElementCount === 0 ? 23 : 30;
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
