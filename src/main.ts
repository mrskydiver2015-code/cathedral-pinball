import * as THREE from 'three/webgpu';
import { TABLE_GLB_PATH } from './assets/manifest.ts';
import { PinballAudioSynth } from './audio/synth.ts';
import { PinballGameController } from './game/pinballGame.ts';
import { PinballRenderer } from './render/renderer.ts';
import { createEventBus } from './shared/events.ts';
import type { PinballDebugHandle, Side } from './shared/types.ts';
import { PinballHud } from './ui/hud.ts';

function getForceWebGLFlag(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('forceWebGL') === '1' || params.get('forceWebGL') === 'true';
}

function isInteractiveUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-ui-control="true"], [data-modal-card="true"], button, input'),
  );
}

function isInsideLeaderboardScroll(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('.cp-leaderboard-list'));
}

function bindControls(params: {
  container: HTMLElement;
  game: PinballGameController;
  audio: PinballAudioSynth;
  renderer: PinballRenderer;
  hud: PinballHud;
}): () => void {
  const { container, game, audio, renderer, hud } = params;

  const keyLeft = new Set<string>();
  const keyRight = new Set<string>();
  const touchLeft = new Set<number>();
  const touchRight = new Set<number>();
  let plungerHeld = false;

  const syncFlippers = (): void => {
    game.setFlipperInput('left', keyLeft.size > 0 || touchLeft.size > 0);
    game.setFlipperInput('right', keyRight.size > 0 || touchRight.size > 0);
  };

  const isLeftFlipperKey = (code: string): boolean =>
    code === 'ArrowLeft' || code === 'KeyA' || code === 'ShiftLeft';
  const isRightFlipperKey = (code: string): boolean =>
    code === 'ArrowRight' || code === 'KeyD' || code === 'ShiftRight';
  const isPlungerKey = (code: string): boolean =>
    code === 'Space' || code === 'ArrowDown';

  const onKeyDown = (event: KeyboardEvent): void => {
    audio.unlock();

    // Route keyboard input to High Score modal / initial entry when open
    if (hud.isModalOpen()) {
      hud.handleModalKeyDown(event);
      return;
    }

    if (
      event.code === 'Space' ||
      event.code === 'ArrowLeft' ||
      event.code === 'ArrowRight' ||
      event.code === 'ArrowUp' ||
      event.code === 'ArrowDown'
    ) {
      event.preventDefault();
    }

    if (event.repeat) return;

    if (isLeftFlipperKey(event.code)) {
      keyLeft.add(event.code);
      syncFlippers();
      return;
    }

    if (isRightFlipperKey(event.code)) {
      keyRight.add(event.code);
      syncFlippers();
      return;
    }

    if (isPlungerKey(event.code)) {
      if (!plungerHeld) {
        plungerHeld = true;
        game.setPlungerCharging(true);
      }
      return;
    }

    if (event.code === 'KeyZ') {
      game.nudge('left');
      return;
    }
    if (event.code === 'KeyX') {
      game.nudge('right');
      return;
    }
    if (event.code === 'ArrowUp' || event.code === 'KeyW') {
      game.nudge('forward');
      return;
    }
    if (event.code === 'KeyM') {
      audio.toggleMute();
      return;
    }
    if (event.code === 'KeyC') {
      renderer.cycleCameraMode();
      return;
    }
    if (event.code === 'KeyH' || event.code === 'KeyL') {
      hud.openLeaderboardModal(false);
      return;
    }
    if (event.code === 'Enter' || event.code === 'KeyR') {
      game.startNewGame();
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (isLeftFlipperKey(event.code)) {
      keyLeft.delete(event.code);
      syncFlippers();
      return;
    }

    if (isRightFlipperKey(event.code)) {
      keyRight.delete(event.code);
      syncFlippers();
      return;
    }

    if (isPlungerKey(event.code) && plungerHeld) {
      plungerHeld = false;
      game.setPlungerCharging(false);
    }
  };

  // True simultaneous multi-touch: left screen half -> Left Flipper, right half -> Right Flipper
  const onPointerDown = (event: PointerEvent): void => {
    audio.unlock();
    if (hud.isModalOpen() || isInteractiveUiTarget(event.target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const rect = container.getBoundingClientRect();
    const isLeftHalf = event.clientX < rect.left + rect.width * 0.5;
    if (isLeftHalf) {
      touchLeft.add(event.pointerId);
    } else {
      touchRight.add(event.pointerId);
    }
    syncFlippers();
  };

  const releasePointer = (event: PointerEvent): void => {
    const removedLeft = touchLeft.delete(event.pointerId);
    const removedRight = touchRight.delete(event.pointerId);
    if (removedLeft || removedRight) {
      syncFlippers();
    }
  };

  // Prevent iOS Safari pinch-to-zoom, double-tap zoom, and page rubber-band pan
  let lastTouchEndMs = 0;
  const preventGestureZoom = (event: Event): void => {
    event.preventDefault();
  };
  const onDocumentTouchStart = (event: TouchEvent): void => {
    audio.unlock();
    if (event.touches.length > 1 || !isInteractiveUiTarget(event.target)) {
      event.preventDefault();
    }
  };
  const onDocumentTouchMove = (event: TouchEvent): void => {
    if (hud.isModalOpen() && event.touches.length === 1 && isInsideLeaderboardScroll(event.target)) {
      return;
    }
    event.preventDefault();
  };
  const onDocumentTouchEnd = (event: TouchEvent): void => {
    const now = performance.now();
    if (now - lastTouchEndMs < 350 && !isInteractiveUiTarget(event.target)) {
      event.preventDefault();
    }
    lastTouchEndMs = now;
  };
  const onDocumentDblClick = (event: MouseEvent): void => {
    event.preventDefault();
  };

  const onBlur = (): void => {
    keyLeft.clear();
    keyRight.clear();
    touchLeft.clear();
    touchRight.clear();
    syncFlippers();
    if (plungerHeld) {
      plungerHeld = false;
      game.setPlungerCharging(false);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  window.addEventListener('blur', onBlur);
  document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
  document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
  document.addEventListener('gestureend', preventGestureZoom, { passive: false });
  document.addEventListener('touchstart', onDocumentTouchStart, { passive: false });
  document.addEventListener('touchmove', onDocumentTouchMove, { passive: false });
  document.addEventListener('touchend', onDocumentTouchEnd, { passive: false });
  document.addEventListener('dblclick', onDocumentDblClick, { passive: false });

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    container.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', releasePointer);
    window.removeEventListener('pointercancel', releasePointer);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('gesturestart', preventGestureZoom);
    document.removeEventListener('gesturechange', preventGestureZoom);
    document.removeEventListener('gestureend', preventGestureZoom);
    document.removeEventListener('touchstart', onDocumentTouchStart);
    document.removeEventListener('touchmove', onDocumentTouchMove);
    document.removeEventListener('touchend', onDocumentTouchEnd);
    document.removeEventListener('dblclick', onDocumentDblClick);
  };
}

async function bootstrap(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container) {
    throw new Error('Missing #app mount element');
  }
  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.height = '100dvh';
  container.style.overflow = 'hidden';
  container.style.touchAction = 'none';

  const bus = createEventBus();
  const forceWebGL = getForceWebGLFlag();

  const [game, renderer] = await Promise.all([
    PinballGameController.create(bus),
    PinballRenderer.create(container, bus, {
      forceWebGL,
      glbUrl: TABLE_GLB_PATH,
    }),
  ]);

  const audio = new PinballAudioSynth(bus);
  const hud = new PinballHud(container, bus, {
    onStartOrRestart: () => {
      audio.unlock();
      game.startNewGame();
    },
    onToggleMute: () => {
      audio.unlock();
      return audio.toggleMute();
    },
    onCycleCamera: () => {
      audio.unlock();
      return renderer.cycleCameraMode();
    },
    getCameraMode: () => renderer.getCameraMode(),
    onRescueBall: () => {
      audio.unlock();
      game.rescueStuckBalls();
    },
    onNudge: () => {
      audio.unlock();
      game.nudge('forward');
    },
    onPlungerDrag: (ratio: number) => {
      audio.unlock();
      game.setManualPlungerCharge(ratio);
    },
    onPlungerRelease: (ratio: number) => {
      audio.unlock();
      game.launchPlunger(ratio);
    },
    getHighScoreStore: () => game.getHighScoreStore(),
    getLastGameOverRecord: () => game.getLastGameOverRecord(),
  });

  // Ready the first ball in the plunger lane immediately for instant play
  game.startNewGame();

  const debugHandle: PinballDebugHandle = {
    getSnapshot: () => game.getSnapshot(),
    getRendererCapabilities: () => renderer.getCapabilities(),
    getEventCounts: () => bus.getEventCounts(),
    getCameraMode: () => renderer.getCameraMode(),
    cycleCameraMode: () => renderer.cycleCameraMode(),
    getLeaderboard: () => game.getHighScoreStore().getEntries(),
    setFlipperInput: (side: Side, pressed: boolean) => game.setFlipperInput(side, pressed),
    setPlungerCharge: (ratio: number) => game.setManualPlungerCharge(ratio),
    launchPlunger: (chargeRatio: number) => game.launchPlunger(chargeRatio),
    rescueStuckBalls: () => game.rescueStuckBalls(),
    forceMultiball: () => game.forceMultiball(),
    resetGame: () => game.startNewGame(),
  };
  window.__PINBALL_DEBUG__ = debugHandle;

  const unbindControls = bindControls({ container, game, audio, renderer, hud });

  const timer = new THREE.Timer();
  timer.connect(document);
  let rafId = 0;
  let disposed = false;

  const frame = (): void => {
    if (disposed) return;
    timer.update();
    const dt = timer.getDelta();

    const { snapshot, physics } = game.update(dt);
    renderer.sync(
      {
        snapshot,
        flipperAngles: physics.flipperAngles,
        dropTargetDown: physics.dropTargetDown,
        plungerPullM: physics.plungerPullM,
      },
      dt,
    );
    renderer.render();
    hud.update(snapshot, renderer.getCapabilities());

    rafId = window.requestAnimationFrame(frame);
  };

  rafId = window.requestAnimationFrame(frame);

  window.addEventListener(
    'pagehide',
    () => {
      if (disposed) return;
      disposed = true;
      window.cancelAnimationFrame(rafId);
      unbindControls();
      timer.disconnect();
      timer.dispose();
      hud.dispose();
      audio.dispose();
      renderer.dispose();
      game.dispose();
      delete window.__PINBALL_DEBUG__;
    },
    { once: true },
  );
}

void bootstrap().catch((err: unknown) => {
  console.error('[Cathedral Pinball] Fatal initialization error:', err);
  const container = document.querySelector<HTMLDivElement>('#app');
  if (container) {
    container.innerHTML = `<pre style="padding:24px;color:#fda4af;">Initialization failed: ${
      err instanceof Error ? err.message : String(err)
    }</pre>`;
  }
});
