import type { PinballEventBus } from '../shared/events.ts';
import type { BumperId, Side } from '../shared/types.ts';

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const BUMPER_FREQUENCIES: Readonly<Record<BumperId, number>> = {
  'bumper-top': 659.25, // E5
  'bumper-left': 880.0, // A5
  'bumper-right': 1108.73, // C#6
};

// Cathedral Lydian ascending escalation pitches (C5 -> C6)
const CATHEDRAL_COMBO_SCALE = [
  523.25, 587.33, 659.25, 739.99, 783.99, 880.0, 987.77, 1046.5,
] as const;

export class PinballAudioSynth {
  private readonly bus: PinballEventBus;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly gestureUnlockHandler: () => void;
  private readonly visibilityHandler: () => void;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private rollSource: AudioBufferSourceNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rollGain: GainNode | null = null;
  private rollRumbleFilter: BiquadFilterNode | null = null;
  private rollRumbleGain: GainNode | null = null;
  private rollSilenceTimer: number | null = null;

  private muted = false;
  private disposed = false;
  private lastPlungerStep = -1;
  private comboStep = 0;
  private lastComboTimeMs = 0;
  private readonly lastBumperTriggerMs: Record<BumperId, number> = {
    'bumper-top': 0,
    'bumper-left': 0,
    'bumper-right': 0,
  };

  constructor(bus: PinballEventBus) {
    this.bus = bus;
    this.gestureUnlockHandler = () => {
      this.unlock();
    };
    this.visibilityHandler = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (this.ctx) {
          const state = this.ctx.state as string;
          if (state !== 'running' && state !== 'closed') {
            void this.ctx.resume().catch(() => undefined);
          }
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('touchstart', this.gestureUnlockHandler, { passive: true });
      window.addEventListener('pointerdown', this.gestureUnlockHandler, { passive: true });
      window.addEventListener('keydown', this.gestureUnlockHandler, { passive: true });
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    this.bindEvents();
  }

  unlock(): void {
    if (this.disposed) return;

    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtor =
        window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!AudioCtor) return;

      try {
        const ctx = new AudioCtor();
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 18;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.12;

        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.72;

        compressor.connect(master);
        master.connect(ctx.destination);

        this.ctx = ctx;
        this.compressor = compressor;
        this.masterGain = master;
        this.noiseBuffer = createNoiseBuffer(ctx, 1.0);
        this.initRollVoice(ctx, compressor);
      } catch {
        return;
      }
    }

    if (this.ctx) {
      const state = this.ctx.state as string;
      // iOS Safari can transition AudioContext to 'interrupted' or 'suspended' after app switching
      if (state !== 'running' && state !== 'closed') {
        void this.ctx.resume().catch(() => undefined);
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, now, 0.015);
    }
    if (muted && this.ctx) {
      if (this.rollGain) {
        this.rollGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
      }
      if (this.rollRumbleGain) {
        this.rollRumbleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.removeGestureListeners();
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;

    if (this.rollSilenceTimer !== null) {
      window.clearTimeout(this.rollSilenceTimer);
      this.rollSilenceTimer = null;
    }

    if (this.rollSource) {
      try {
        this.rollSource.stop();
      } catch {
        // Ignore already-stopped source
      }
      this.rollSource.disconnect();
      this.rollSource = null;
    }

    this.rollFilter?.disconnect();
    this.rollGain?.disconnect();
    this.rollRumbleFilter?.disconnect();
    this.rollRumbleGain?.disconnect();
    this.compressor?.disconnect();
    this.masterGain?.disconnect();

    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.compressor = null;
    this.masterGain = null;
    this.noiseBuffer = null;
  }

  private removeGestureListeners(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('touchstart', this.gestureUnlockHandler);
    window.removeEventListener('pointerdown', this.gestureUnlockHandler);
    window.removeEventListener('keydown', this.gestureUnlockHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  private initRollVoice(ctx: AudioContext, destination: AudioNode): void {
    if (!this.noiseBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    // Metallic steel-on-playfield / glass shimmer band
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 2.2;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    // Deep wooden cabinet rolling rumble band
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 175;
    rumbleFilter.Q.value = 1.2;

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    source.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(destination);

    source.start();

    this.rollSource = source;
    this.rollFilter = filter;
    this.rollGain = gain;
    this.rollRumbleFilter = rumbleFilter;
    this.rollRumbleGain = rumbleGain;
  }

  private getActiveOutput(): { ctx: AudioContext; out: AudioNode } | null {
    if (this.disposed || this.muted || !this.ctx || !this.compressor) {
      return null;
    }
    if (this.ctx.state !== 'running') {
      return null;
    }
    return { ctx: this.ctx, out: this.compressor };
  }

  private createPanner(ctx: AudioContext, destination: AudioNode, pan: number): AudioNode {
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(destination);
      return panner;
    }
    return destination;
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      this.bus.on('flipperFire', ({ side, pressed, angularSpeedRadPerSec }) => {
        this.playFlipper(side, pressed, angularSpeedRadPerSec);
      }),
      this.bus.on('bumperHit', ({ bumperId, impulseMps }) => {
        this.playBumper(bumperId, impulseMps);
      }),
      this.bus.on('slingshotHit', ({ side, impulseMps }) => {
        this.playSlingshot(side, impulseMps);
      }),
      this.bus.on('dropTargetHit', ({ bankComplete }) => {
        this.playDropTarget(bankComplete);
      }),
      this.bus.on('plungerCharge', ({ ratio }) => {
        const step = Math.floor(Math.max(0, Math.min(1, ratio)) * 10);
        if (step !== this.lastPlungerStep && step > 0) {
          this.lastPlungerStep = step;
          this.playPlungerRatchet(step / 10);
        } else if (ratio <= 0.02) {
          this.lastPlungerStep = -1;
        }
      }),
      this.bus.on('plungerRelease', ({ ratio }) => {
        this.lastPlungerStep = -1;
        this.playPlungerRelease(ratio);
      }),
      this.bus.on('rampCompleted', () => {
        this.playRampChime();
      }),
      this.bus.on('multiballLock', ({ lockedCount }) => {
        this.playLockChime(lockedCount);
      }),
      this.bus.on('multiballStart', () => {
        this.playMultiballFanfare();
      }),
      this.bus.on('ballDrain', ({ activeBallsRemaining }) => {
        this.playBallDrain(activeBallsRemaining === 0);
      }),
      this.bus.on('rolloverHit', ({ laneIndex, skillShot }) => {
        this.playRollover(laneIndex, skillShot);
      }),
      this.bus.on('ballSave', () => {
        this.playBallSave();
      }),
      this.bus.on('ballRescue', () => {
        this.playBallRescue();
      }),
      this.bus.on('nudge', ({ tilted }) => {
        this.playNudge(tilted);
      }),
      this.bus.on('ballRoll', ({ speedMps, onRamp }) => {
        this.updateBallRoll(speedMps, onRamp);
      }),
      this.bus.on('gameStateChanged', ({ current, snapshot }) => {
        if (current === 'gameOver' && snapshot.score > 0 && snapshot.score >= snapshot.highScore) {
          this.playHighScoreFanfare();
        }
      }),
    );
  }

  private playHighScoreFanfare(): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
    notes.forEach((freq, idx) => {
      this.playBellPartial(ctx, out, now + idx * 0.075, freq, 0.65, 0.14);
    });
  }

  private nextComboPitchFactor(): number {
    const nowMs = performance.now();
    if (nowMs - this.lastComboTimeMs > 3500) {
      this.comboStep = 0;
    } else {
      this.comboStep = Math.min(CATHEDRAL_COMBO_SCALE.length - 1, this.comboStep + 1);
    }
    this.lastComboTimeMs = nowMs;
    return CATHEDRAL_COMBO_SCALE[this.comboStep] / CATHEDRAL_COMBO_SCALE[0];
  }

  private playFlipper(side: Side, pressed: boolean, speed: number): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const target = this.createPanner(ctx, out, side === 'left' ? -0.38 : 0.38);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';

    if (pressed) {
      const scale = Math.min(1.22, Math.max(0.75, speed / 26));
      osc.frequency.setValueAtTime(205 * scale, now);
      osc.frequency.exponentialRampToValueAtTime(46, now + 0.052);
      gain.gain.setValueAtTime(0.36, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      // Solenoid coil relay buzz transient
      const coil = ctx.createOscillator();
      const coilGain = ctx.createGain();
      coil.type = 'square';
      coil.frequency.setValueAtTime(120, now);
      coilGain.gain.setValueAtTime(0.08, now);
      coilGain.gain.exponentialRampToValueAtTime(0.001, now + 0.016);
      coil.connect(coilGain);
      coilGain.connect(target);
      coil.start(now);
      coil.stop(now + 0.02);

      this.triggerNoiseBurst(ctx, target, now, 0.026, 2250, 1.9, 0.28);
    } else {
      // Crisp mechanical return-stop click + soft thud
      osc.frequency.setValueAtTime(106, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.032);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);
      this.triggerNoiseBurst(ctx, target, now, 0.014, 1550, 2.8, 0.14);
    }

    osc.connect(gain);
    gain.connect(target);
    osc.start(now);
    osc.stop(now + 0.068);
  }

  private playBumper(bumperId: BumperId, impulseMps: number): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const nowMs = performance.now();
    if (nowMs - this.lastBumperTriggerMs[bumperId] < 24) return;
    this.lastBumperTriggerMs[bumperId] = nowMs;

    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const pan = bumperId === 'bumper-left' ? -0.3 : bumperId === 'bumper-right' ? 0.3 : 0;
    const target = this.createPanner(ctx, out, pan);
    const strength = Math.min(1.2, Math.max(0.65, impulseMps / 1.45));
    const comboRatio = this.nextComboPitchFactor();

    // Solenoid pop kick
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(220 * strength, now);
    thump.frequency.exponentialRampToValueAtTime(46, now + 0.07);
    thumpGain.gain.setValueAtTime(0.36, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.078);
    thump.connect(thumpGain);
    thumpGain.connect(target);
    thump.start(now);
    thump.stop(now + 0.085);

    this.triggerNoiseBurst(ctx, target, now, 0.025, 2250, 1.5, 0.2);

    // Escalating cathedral bell + harmonic fifth pipe-organ shimmer
    const baseFreq = BUMPER_FREQUENCIES[bumperId] * Math.min(1.5, comboRatio);
    this.playBellPartial(ctx, target, now, baseFreq, 0.28, 0.16);
    this.playBellPartial(ctx, target, now, baseFreq * 1.5, 0.22, 0.07);
    this.playBellPartial(ctx, target, now, baseFreq * 2.01, 0.18, 0.06);
  }

  private playSlingshot(side: Side, impulseMps: number): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const target = this.createPanner(ctx, out, side === 'left' ? -0.45 : 0.45);
    const scale = Math.min(1.2, Math.max(0.7, impulseMps / 1.35));

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260 * scale, now);
    osc.frequency.exponentialRampToValueAtTime(108, now + 0.065);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.07);
    filter.Q.value = 3.2;

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(target);
    osc.start(now);
    osc.stop(now + 0.08);

    this.triggerNoiseBurst(ctx, target, now, 0.024, 2400, 2.0, 0.16);
  }

  private playDropTarget(bankComplete: boolean): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const target = this.createPanner(ctx, out, -0.4);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.055);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(target);
    osc.start(now);
    osc.stop(now + 0.07);

    if (bankComplete) {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((freq, idx) => {
        this.playBellPartial(ctx, out, now + idx * 0.065, freq, 0.34, 0.16);
      });
    }
  }

  private playPlungerRatchet(normalizedPull: number): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const target = this.createPanner(ctx, out, 0.45);
    const freq = 320 + normalizedPull * 460;
    this.triggerNoiseBurst(ctx, target, now, 0.015, freq, 5.0, 0.09);
  }

  private playPlungerRelease(ratio: number): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const target = this.createPanner(ctx, out, 0.45);
    const energy = Math.max(0.25, Math.min(1, ratio));

    // Spring coil recoil + steel ball strike transient
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(420 * (0.72 + energy * 0.38), now + 0.042);
    osc.frequency.exponentialRampToValueAtTime(145, now + 0.19);

    gain.gain.setValueAtTime(0.28 * energy, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);

    osc.connect(gain);
    gain.connect(target);
    osc.start(now);
    osc.stop(now + 0.22);

    const springTwang = ctx.createOscillator();
    const twangGain = ctx.createGain();
    springTwang.type = 'sawtooth';
    springTwang.frequency.setValueAtTime(240 + energy * 140, now + 0.012);
    springTwang.frequency.exponentialRampToValueAtTime(115, now + 0.16);
    twangGain.gain.setValueAtTime(0.09 * energy, now + 0.012);
    twangGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    springTwang.connect(twangGain);
    twangGain.connect(target);
    springTwang.start(now + 0.012);
    springTwang.stop(now + 0.18);

    this.triggerNoiseBurst(ctx, target, now, 0.065, 1650, 1.5, 0.25 * energy);
  }

  private playRollover(laneIndex: 0 | 1 | 2, skillShot: boolean): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const comboRatio = this.nextComboPitchFactor();
    const laneNotes = [587.33, 739.99, 880.0];
    const base = laneNotes[laneIndex] * Math.min(1.4, comboRatio);

    this.playBellPartial(ctx, out, now, base, 0.28, 0.15);
    this.playBellPartial(ctx, out, now + 0.02, base * 1.5, 0.22, 0.06);

    if (skillShot) {
      const chord = [523.25, 659.25, 783.99, 987.77, 1318.51];
      chord.forEach((f, idx) => {
        this.playBellPartial(ctx, out, now + idx * 0.048, f, 0.55, 0.16);
      });
    }
  }

  private playBallSave(): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const notes = [392.0, 493.88, 587.33, 783.99, 987.77];
    notes.forEach((f, idx) => {
      this.playBellPartial(ctx, out, now + idx * 0.05, f, 0.48, 0.15);
    });
  }

  private playBallRescue(): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    this.triggerNoiseBurst(ctx, out, now, 0.03, 1400, 1.8, 0.16);
    this.playBellPartial(ctx, out, now, 440, 0.2, 0.1);
  }

  private playRampChime(): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const notes = [587.33, 739.99, 880.0, 1174.66, 1479.98]; // D5 F#5 A5 D6 F#6
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.055;
      this.playBellPartial(ctx, out, start, freq, 0.45, 0.16);
      this.playBellPartial(ctx, out, start, freq * 1.5, 0.28, 0.05);
    });
  }

  private playLockChime(lockedCount: number): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const chords: readonly number[][] = [
      [261.63, 392.0, 523.25],
      [293.66, 440.0, 587.33],
      [329.63, 493.88, 659.25],
    ];
    const chord = chords[Math.max(0, Math.min(chords.length - 1, lockedCount - 1))];
    chord.forEach((freq, idx) => {
      this.playBellPartial(ctx, out, now + idx * 0.045, freq, 0.55, 0.15);
    });
  }

  private playMultiballFanfare(): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    // Deep cathedral pipe-organ pedal root
    const pedal = ctx.createOscillator();
    const pedalGain = ctx.createGain();
    pedal.type = 'sawtooth';
    pedal.frequency.setValueAtTime(130.81, now);
    const pedalFilter = ctx.createBiquadFilter();
    pedalFilter.type = 'lowpass';
    pedalFilter.frequency.setValueAtTime(420, now);
    pedalGain.gain.setValueAtTime(0.001, now);
    pedalGain.gain.linearRampToValueAtTime(0.18, now + 0.06);
    pedalGain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
    pedal.connect(pedalFilter);
    pedalFilter.connect(pedalGain);
    pedalGain.connect(out);
    pedal.start(now);
    pedal.stop(now + 1.3);

    const fanfare = [
      { freq: 261.63, time: 0.0, dur: 0.45 },
      { freq: 392.0, time: 0.09, dur: 0.45 },
      { freq: 523.25, time: 0.18, dur: 0.5 },
      { freq: 659.25, time: 0.28, dur: 0.6 },
      { freq: 783.99, time: 0.38, dur: 0.7 },
      { freq: 1046.5, time: 0.48, dur: 0.95 },
    ];

    for (const note of fanfare) {
      const t = now + note.time;
      // Rich cathedral organ brass voice
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      oscA.type = 'sawtooth';
      oscB.type = 'triangle';
      oscA.frequency.setValueAtTime(note.freq, t);
      oscB.frequency.setValueAtTime(note.freq * 1.004, t);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, t);
      filter.frequency.exponentialRampToValueAtTime(950, t + note.dur);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.dur);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(out);

      oscA.start(t);
      oscB.start(t);
      oscA.stop(t + note.dur + 0.03);
      oscB.stop(t + note.dur + 0.03);

      this.playBellPartial(ctx, out, t, note.freq * 2, note.dur * 0.75, 0.08);
    }
  }

  private playBallDrain(lastBallOnPlayfield: boolean): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    if (!lastBallOnPlayfield) {
      this.playBellPartial(ctx, out, now, 329.63, 0.25, 0.12);
      this.playBellPartial(ctx, out, now + 0.07, 246.94, 0.3, 0.1);
      return;
    }

    const notes = [392.0, 311.13, 261.63, 196.0];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.095;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.16, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }

  private playNudge(tilted: boolean): void {
    const audio = this.getActiveOutput();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(86, now);
    thud.frequency.exponentialRampToValueAtTime(34, now + 0.11);
    thudGain.gain.setValueAtTime(0.32, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    thud.connect(thudGain);
    thudGain.connect(out);
    thud.start(now);
    thud.stop(now + 0.14);

    this.triggerNoiseBurst(ctx, out, now, 0.08, 220, 1.0, 0.2);

    if (tilted) {
      const buzz = ctx.createOscillator();
      const buzzGain = ctx.createGain();
      buzz.type = 'sawtooth';
      buzz.frequency.setValueAtTime(220, now);
      buzz.frequency.exponentialRampToValueAtTime(55, now + 0.45);
      buzzGain.gain.setValueAtTime(0.2, now);
      buzzGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      buzz.connect(buzzGain);
      buzzGain.connect(out);
      buzz.start(now);
      buzz.stop(now + 0.5);
    }
  }

  private updateBallRoll(speedMps: number, onRamp: boolean): void {
    if (
      this.disposed ||
      this.muted ||
      !this.ctx ||
      !this.rollFilter ||
      !this.rollGain ||
      !this.rollRumbleFilter ||
      !this.rollRumbleGain
    ) {
      return;
    }
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const normalized = Math.max(0, Math.min(1, (speedMps - 0.12) / 3.5));

    // Metallic rolling shimmer (enhanced Q resonance on stained-glass ramp)
    const shimmerGain = normalized * (onRamp ? 0.095 : 0.048);
    const shimmerFreq = onRamp ? 1150 + normalized * 950 : 880 + normalized * 680;
    this.rollFilter.Q.setTargetAtTime(onRamp ? 4.4 : 2.1, now, 0.04);
    this.rollFilter.frequency.setTargetAtTime(shimmerFreq, now, 0.04);
    this.rollGain.gain.setTargetAtTime(shimmerGain, now, 0.04);

    // Low cabinet wood rolling rumble
    const rumbleGain = normalized * (onRamp ? 0.03 : 0.075);
    const rumbleFreq = 130 + normalized * 145;
    this.rollRumbleFilter.frequency.setTargetAtTime(rumbleFreq, now, 0.04);
    this.rollRumbleGain.gain.setTargetAtTime(rumbleGain, now, 0.04);

    if (this.rollSilenceTimer !== null) {
      window.clearTimeout(this.rollSilenceTimer);
    }
    this.rollSilenceTimer = window.setTimeout(() => {
      if (this.ctx && !this.disposed) {
        this.rollGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        this.rollRumbleGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
      this.rollSilenceTimer = null;
    }, 120);
  }

  private playBellPartial(
    ctx: AudioContext,
    destination: AudioNode,
    startTime: number,
    freq: number,
    durationSec: number,
    peakGain: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + durationSec);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);
  }

  private triggerNoiseBurst(
    ctx: AudioContext,
    destination: AudioNode,
    startTime: number,
    durationSec: number,
    centerFreq: number,
    q: number,
    peakGain: number,
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(centerFreq, startTime);
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    src.start(startTime);
    src.stop(startTime + durationSec + 0.015);
  }
}

function createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    // Slight warm tilt for mechanical authenticity
    last = last * 0.25 + white * 0.75;
    data[i] = last;
  }
  return buffer;
}
