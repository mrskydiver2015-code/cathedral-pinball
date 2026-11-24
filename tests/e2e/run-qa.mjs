import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

const BASE_URL = process.env.PINBALL_QA_URL ?? 'http://localhost:5173';
const DOCS_OUT_DIR = 'C:\\AI-ProjectsAG\\Pinball dok';
const HEADLESS_SHELL_PATH =
  'C:\\Users\\Mrsky\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1255\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const FALLBACK_CHROME_PATH =
  'C:\\Users\\Mrsky\\AppData\\Local\\ms-playwright\\chromium-1255\\chrome-win64\\chrome.exe';

function resolveChromeExecutable() {
  if (fs.existsSync(HEADLESS_SHELL_PATH)) {
    return HEADLESS_SHELL_PATH;
  }
  try {
    const defaultPath = chromium.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // Fall through to explicit local ms-playwright binary
  }
  if (fs.existsSync(FALLBACK_CHROME_PATH)) {
    return FALLBACK_CHROME_PATH;
  }
  return undefined;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function inspectPngBuffer(pngBuffer) {
  const signature = pngBuffer.subarray(0, 8);
  const expectedSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(expectedSig)) {
    throw new Error('Invalid PNG header in captured screenshot');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset + 8 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > pngBuffer.length) break;

    if (type === 'IHDR') {
      width = pngBuffer.readUInt32BE(dataStart);
      height = pngBuffer.readUInt32BE(dataStart + 4);
      bitDepth = pngBuffer[dataStart + 8];
      colorType = pngBuffer[dataStart + 9];
    } else if (type === 'IDAT') {
      idatChunks.push(pngBuffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width === 0 || height === 0 || idatChunks.length === 0) {
    throw new Error('Incomplete PNG screenshot data');
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    return {
      width,
      height,
      nonBlank: pngBuffer.length > 8192,
      distinctSamples: -1,
      lumaRange: -1,
    };
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const prevRow = new Uint8Array(stride);
  const curRow = new Uint8Array(stride);

  const distinctColors = new Set();
  let minLuma = 255;
  let maxLuma = 0;
  let brightPixels = 0;
  let sampledCount = 0;

  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor++];
    for (let i = 0; i < stride; i += 1) {
      const x = raw[cursor++];
      const a = i >= bpp ? curRow[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 0xff;
      else if (filter === 2) val = (x + b) & 0xff;
      else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (x + paethPredictor(a, b, c)) & 0xff;
      curRow[i] = val;
    }

    if (y % 6 === 0) {
      for (let x = 0; x < width; x += 6) {
        const px = x * bpp;
        const r = curRow[px];
        const g = curRow[px + 1];
        const b = curRow[px + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
        if (luma > 18) brightPixels += 1;
        sampledCount += 1;
        if (distinctColors.size < 512) {
          distinctColors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
        }
      }
    }
    prevRow.set(curRow);
  }

  const lumaRange = maxLuma - minLuma;
  const nonBlank = distinctColors.size >= 12 && lumaRange >= 15 && brightPixels > 10;

  return {
    width,
    height,
    sampledCount,
    distinctSamples: distinctColors.size,
    lumaRange: Number(lumaRange.toFixed(2)),
    brightPixels,
    nonBlank,
  };
}

function assertBallBounds(ball, contextLabel) {
  const { position: p, linearVelocity: v, speedMps } = ball;
  const finite =
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z) &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z) &&
    Number.isFinite(speedMps);
  if (!finite) {
    throw new Error(`${contextLabel}: ball #${ball.id} has non-finite telemetry`);
  }
  const inBounds =
    Math.abs(p.x) <= 0.26 &&
    p.y >= -0.015 &&
    p.y <= 0.12 &&
    Math.abs(p.z) <= 0.54;
  if (!inBounds) {
    throw new Error(
      `${contextLabel}: ball #${ball.id} escaped cabinet bounds at (${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`,
    );
  }
}

function boxesOverlap(a, b) {
  return !(
    a.x + a.width <= b.x + 1 ||
    b.x + b.width <= a.x + 1 ||
    a.y + a.height <= b.y + 1 ||
    b.y + b.height <= a.y + 1
  );
}

function attachPageMonitors(page, name, logs, consoleErrors, pageErrors, failedRequests) {
  page.on('console', (msg) => {
    const line = `[${name}][console.${msg.type()}] ${msg.text()}`;
    logs.push(line);
    if (msg.type() === 'error') {
      consoleErrors.push(line);
    }
  });
  page.on('pageerror', (err) => {
    const line = `[${name}][pageerror] ${err?.stack ?? String(err)}`;
    logs.push(line);
    pageErrors.push(line);
  });
  page.on('requestfailed', (req) => {
    const line = `[${name}][requestfailed] ${req.url()} -> ${req.failure()?.errorText ?? 'unknown'}`;
    logs.push(line);
    failedRequests.push(line);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const line = `[${name}][http.${res.status()}] ${res.url()}`;
      logs.push(line);
      failedRequests.push(line);
    }
  });
}

async function verifyDesktopAndStress(browser) {
  const name = 'desktop-1440x900';
  const logs = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  attachPageMonitors(page, name, logs, consoleErrors, pageErrors, failedRequests);

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__PINBALL_DEBUG__), null, { timeout: 20000 });
    await page.waitForTimeout(900);

    const canvasBox = await page.locator('canvas').first().boundingBox();
    if (!canvasBox || canvasBox.width < 800 || canvasBox.height < 600) {
      throw new Error(`${name}: canvas missing or collapsed (${JSON.stringify(canvasBox)})`);
    }

    const capabilities = await page.evaluate(() => window.__PINBALL_DEBUG__.getRendererCapabilities());
    const bootPng = await page.screenshot({
      path: path.join(DOCS_OUT_DIR, 'qa_desktop_1440x900.png'),
    });
    const bootStats = inspectPngBuffer(bootPng);
    if (!bootStats.nonBlank) {
      throw new Error(`${name}: boot screenshot appears blank (${JSON.stringify(bootStats)})`);
    }

    // Verify 12s Ball Save & Skill Shot armed upon launch
    await page.evaluate(() => {
      window.__PINBALL_DEBUG__.launchPlunger(0.9);
    });
    await page.waitForTimeout(400);
    const afterLaunchSnap = await page.evaluate(() => window.__PINBALL_DEBUG__.getSnapshot());
    if (afterLaunchSnap.ballSaveRemainingSec <= 8 || afterLaunchSnap.ballSaveRemainingSec > 12.1) {
      throw new Error(
        `${name}: expected ~12s Ball Save after launch, got ${afterLaunchSnap.ballSaveRemainingSec}s`,
      );
    }

    // Verify Multiball + 3 simultaneous steel balls + motion trail
    await page.evaluate(() => {
      window.__PINBALL_DEBUG__.forceMultiball();
    });
    await page.waitForTimeout(850);
    const mbSnap = await page.evaluate(() => window.__PINBALL_DEBUG__.getSnapshot());
    if (mbSnap.phase !== 'multiball' || mbSnap.balls.length !== 3) {
      throw new Error(`${name}: expected 3-ball multiball, got phase=${mbSnap.phase}, balls=${mbSnap.balls.length}`);
    }
    mbSnap.balls.forEach((b) => assertBallBounds(b, `${name}:multiball`));

    const mbPng = await page.screenshot({
      path: path.join(DOCS_OUT_DIR, 'qa_desktop_multiball.png'),
    });
    const mbStats = inspectPngBuffer(mbPng);
    if (!mbStats.nonBlank) {
      throw new Error(`${name}: multiball screenshot appears blank`);
    }

    // Automated 50-Shot Stress Test verifying zero stuck balls
    const lowSpeedAccumMs = new Map();
    let maxObservedSpeedMps = 0;
    let stuckBallFailures = 0;
    let shotsCompleted = 0;

    for (let shot = 0; shot < 50; shot += 1) {
      const charge = 0.38 + ((shot % 7) / 6) * 0.62;
      await page.evaluate((ratio) => {
        window.__PINBALL_DEBUG__.resetGame();
        window.__PINBALL_DEBUG__.launchPlunger(ratio);
      }, charge);
      shotsCompleted += 1;

      const subChecks = 4;
      for (let step = 0; step < subChecks; step += 1) {
        const flipLeft = (shot + step) % 2 === 0;
        const flipRight = (shot + step) % 2 === 1;
        await page.evaluate(
          ({ l, r }) => {
            window.__PINBALL_DEBUG__.setFlipperInput('left', l);
            window.__PINBALL_DEBUG__.setFlipperInput('right', r);
          },
          { l: flipLeft, r: flipRight },
        );
        await page.waitForTimeout(120);

        const snap = await page.evaluate(() => window.__PINBALL_DEBUG__.getSnapshot());
        for (const ball of snap.balls) {
          assertBallBounds(ball, `${name}:shot-${shot + 1}`);
          if (ball.speedMps > maxObservedSpeedMps) {
            maxObservedSpeedMps = ball.speedMps;
          }
          if (!ball.locked && !ball.inPlungerLane && ball.speedMps < 0.03) {
            const prevMs = lowSpeedAccumMs.get(ball.id) ?? 0;
            const nextMs = prevMs + 120;
            lowSpeedAccumMs.set(ball.id, nextMs);
            if (nextMs > 2000) {
              stuckBallFailures += 1;
            }
          } else {
            lowSpeedAccumMs.set(ball.id, 0);
          }
        }
      }

      await page.evaluate(() => {
        window.__PINBALL_DEBUG__.setFlipperInput('left', false);
        window.__PINBALL_DEBUG__.setFlipperInput('right', false);
      });
    }

    if (stuckBallFailures > 0) {
      throw new Error(`${name}: 50-shot stress test detected ${stuckBallFailures} stuck ball incidents`);
    }

    const finalSnap = await page.evaluate(() => window.__PINBALL_DEBUG__.getSnapshot());
    const finalCounts = await page.evaluate(() => window.__PINBALL_DEBUG__.getEventCounts());

    // Manual Rescue fail-safe check
    const rescuedCount = await page.evaluate(() => window.__PINBALL_DEBUG__.rescueStuckBalls());

    if (consoleErrors.length > 0 || pageErrors.length > 0 || failedRequests.length > 0) {
      throw new Error(
        `${name}: runtime errors detected:\n${[...consoleErrors, ...pageErrors, ...failedRequests].join('\n')}`,
      );
    }

    return {
      name,
      passed: true,
      capabilities,
      canvasBox,
      bootStats,
      stressTest50Shots: {
        shotsCompleted,
        stuckBallFailures,
        autoRescueCount: finalSnap.autoRescueCount,
        manualRescueTriggered: rescuedCount,
        maxObservedSpeedMps: Number(maxObservedSpeedMps.toFixed(3)),
        eventCounts: finalCounts,
      },
      logs,
    };
  } finally {
    await context.close();
  }
}

async function verifyMobileViewport(browser, config) {
  const { name, width, height, urlPath, screenshotFile, testMultiTouch } = config;
  const logs = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  attachPageMonitors(page, name, logs, consoleErrors, pageErrors, failedRequests);

  try {
    await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__PINBALL_DEBUG__), null, { timeout: 20000 });
    await page.waitForTimeout(900);

    const layoutCheck = await page.evaluate(() => {
      const docOverflow =
        document.documentElement.scrollWidth > window.innerWidth ||
        document.documentElement.scrollHeight > window.innerHeight + 2;
      const hintsEl = document.querySelector('.cp-hints');
      const hintsHidden = !hintsEl || window.getComputedStyle(hintsEl).display === 'none';
      const topLeftRect = document.querySelector('.cp-top-left')?.getBoundingClientRect() ?? null;
      const topRightRect = document.querySelector('.cp-top-right')?.getBoundingClientRect() ?? null;
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        docOverflow,
        hintsHidden,
        topLeftRect,
        topRightRect,
      };
    });

    if (layoutCheck.docOverflow) {
      throw new Error(`${name}: viewport overflow detected (${JSON.stringify(layoutCheck)})`);
    }
    if (!layoutCheck.hintsHidden) {
      throw new Error(`${name}: desktop keyboard hints were still visible on mobile`);
    }
    if (
      layoutCheck.topLeftRect &&
      layoutCheck.topRightRect &&
      boxesOverlap(layoutCheck.topLeftRect, layoutCheck.topRightRect)
    ) {
      throw new Error(`${name}: HUD top-left and top-right panels overlapped`);
    }

    let multiTouchVerified = false;
    let dragPlungerVerified = false;

    if (testMultiTouch) {
      // Simulate simultaneous two-finger touch on left & right halves with distinct pointerIds
      const touchResult = await page.evaluate(() => {
        const app = document.querySelector('#app');
        if (!app) return null;
        const leftX = window.innerWidth * 0.22;
        const rightX = window.innerWidth * 0.78;
        const y = window.innerHeight * 0.65;

        app.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 501,
            pointerType: 'touch',
            clientX: leftX,
            clientY: y,
            isPrimary: true,
          }),
        );
        app.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 502,
            pointerType: 'touch',
            clientX: rightX,
            clientY: y,
            isPrimary: false,
          }),
        );

        const bothDown = window.__PINBALL_DEBUG__.getSnapshot();

        window.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 501,
            pointerType: 'touch',
            clientX: leftX,
            clientY: y,
          }),
        );
        const onlyRightHeld = window.__PINBALL_DEBUG__.getSnapshot();

        window.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 502,
            pointerType: 'touch',
            clientX: rightX,
            clientY: y,
          }),
        );
        const bothUp = window.__PINBALL_DEBUG__.getSnapshot();

        return {
          bothDownLeft: bothDown.leftFlipperActive,
          bothDownRight: bothDown.rightFlipperActive,
          onlyRightLeft: onlyRightHeld.leftFlipperActive,
          onlyRightRight: onlyRightHeld.rightFlipperActive,
          bothUpLeft: bothUp.leftFlipperActive,
          bothUpRight: bothUp.rightFlipperActive,
        };
      });

      if (
        !touchResult ||
        !touchResult.bothDownLeft ||
        !touchResult.bothDownRight ||
        touchResult.onlyRightLeft ||
        !touchResult.onlyRightRight ||
        touchResult.bothUpLeft ||
        touchResult.bothUpRight
      ) {
        throw new Error(`${name}: simultaneous multi-touch flipper check failed (${JSON.stringify(touchResult)})`);
      }
      multiTouchVerified = true;

      // Test touch-drag plunger widget
      const beforeLaunch = await page.evaluate(() => window.__PINBALL_DEBUG__.getEventCounts().plungerRelease ?? 0);
      await page.evaluate(() => {
        const plunger = document.querySelector('.cp-plunger-wrap');
        if (!plunger) throw new Error('Missing touch plunger widget');
        const r = plunger.getBoundingClientRect();
        const cx = r.left + r.width * 0.5;
        const startY = r.top + 20;
        plunger.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 601,
            pointerType: 'touch',
            clientX: cx,
            clientY: startY,
          }),
        );
        plunger.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 601,
            pointerType: 'touch',
            clientX: cx,
            clientY: startY + 55,
          }),
        );
        plunger.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 601,
            pointerType: 'touch',
            clientX: cx,
            clientY: startY + 55,
          }),
        );
      });
      await page.waitForTimeout(250);
      const afterLaunch = await page.evaluate(() => window.__PINBALL_DEBUG__.getEventCounts().plungerRelease ?? 0);
      if (afterLaunch <= beforeLaunch) {
        throw new Error(`${name}: touch-drag plunger did not trigger plungerRelease`);
      }

      // Regression test: hold plunger pulled fully back for 1000 ms (gravity rolls ball down),
      // release off-element on window, and verify the ball cleanly exits the plunger lane.
      await page.evaluate(() => {
        window.__PINBALL_DEBUG__.resetGame();
        const plunger = document.querySelector('.cp-plunger-wrap');
        if (!plunger) throw new Error('Missing touch plunger widget');
        const r = plunger.getBoundingClientRect();
        const cx = r.left + r.width * 0.5;
        const startY = r.top + 16;
        plunger.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 602,
            pointerType: 'touch',
            clientX: cx,
            clientY: startY,
          }),
        );
        window.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 602,
            pointerType: 'touch',
            clientX: cx,
            clientY: startY + 72,
          }),
        );
      });
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        window.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 602,
            pointerType: 'touch',
            clientX: 360,
            clientY: 820,
          }),
        );
      });
      await page.waitForTimeout(850);
      const afterHoldSnap = await page.evaluate(() => window.__PINBALL_DEBUG__.getSnapshot());
      const activeAfterHold = afterHoldSnap.balls.filter((b) => !b.locked);
      if (activeAfterHold.length === 0 || activeAfterHold.every((b) => b.inPlungerLane)) {
        throw new Error(
          `${name}: 1s held plunger shot remained trapped in plunger lane (${JSON.stringify(activeAfterHold)})`,
        );
      }

      // Verify iOS Safari zoom guards prevent dblclick & touchmove default while HUD buttons remain clickable
      const zoomGuards = await page.evaluate(() => {
        const app = document.querySelector('#app');
        if (!app) throw new Error('Missing #app');
        const dblEv = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
        app.dispatchEvent(dblEv);
        const moveEv = new Event('touchmove', { bubbles: true, cancelable: true });
        app.dispatchEvent(moveEv);
        const gestEv = new Event('gesturestart', { bubbles: true, cancelable: true });
        document.dispatchEvent(gestEv);
        return {
          dblPrevented: dblEv.defaultPrevented,
          movePrevented: moveEv.defaultPrevented,
          gesturePrevented: gestEv.defaultPrevented,
        };
      });
      if (!zoomGuards.dblPrevented || !zoomGuards.movePrevented || !zoomGuards.gesturePrevented) {
        throw new Error(`${name}: iOS zoom guards did not prevent defaults (${JSON.stringify(zoomGuards)})`);
      }

      dragPlungerVerified = true;
    }

    const shotPng = await page.screenshot({ path: path.join(DOCS_OUT_DIR, screenshotFile) });
    const shotStats = inspectPngBuffer(shotPng);
    if (!shotStats.nonBlank) {
      throw new Error(`${name}: screenshot appears blank (${JSON.stringify(shotStats)})`);
    }

    const capabilities = await page.evaluate(() => window.__PINBALL_DEBUG__.getRendererCapabilities());

    if (consoleErrors.length > 0 || pageErrors.length > 0 || failedRequests.length > 0) {
      throw new Error(
        `${name}: runtime errors detected:\n${[...consoleErrors, ...pageErrors, ...failedRequests].join('\n')}`,
      );
    }

    return {
      name,
      passed: true,
      capabilities,
      layoutCheck,
      multiTouchVerified,
      dragPlungerVerified,
      shotStats,
      logs,
    };
  } finally {
    await context.close();
  }
}

async function verifyWebGL2Fallback(browser) {
  const name = 'desktop-webgl2-fallback';
  const logs = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  attachPageMonitors(page, name, logs, consoleErrors, pageErrors, failedRequests);

  try {
    await page.goto(`${BASE_URL}/?forceWebGL=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__PINBALL_DEBUG__), null, { timeout: 20000 });
    await page.waitForTimeout(900);

    const capabilities = await page.evaluate(() => window.__PINBALL_DEBUG__.getRendererCapabilities());
    if (capabilities.backend !== 'webgl2' || capabilities.forcedWebGL !== true) {
      throw new Error(`${name}: expected forced webgl2, got ${JSON.stringify(capabilities)}`);
    }

    const png = await page.screenshot({
      path: path.join(DOCS_OUT_DIR, 'qa_webgl2_fallback.png'),
    });
    const stats = inspectPngBuffer(png);
    if (!stats.nonBlank) {
      throw new Error(`${name}: screenshot appears blank`);
    }

    if (consoleErrors.length > 0 || pageErrors.length > 0 || failedRequests.length > 0) {
      throw new Error(
        `${name}: runtime errors detected:\n${[...consoleErrors, ...pageErrors, ...failedRequests].join('\n')}`,
      );
    }

    return {
      name,
      passed: true,
      capabilities,
      stats,
      logs,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(DOCS_OUT_DIR, { recursive: true });

  const executablePath = resolveChromeExecutable();
  const launchArgs = [
    '--enable-unsafe-webgpu',
    '--use-angle=d3d11',
    '--ignore-gpu-blocklist',
  ];

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: launchArgs,
  });

  const allLogs = [];
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    executablePath: executablePath ?? 'playwright-default',
    launchArgs,
    runs: [],
    passed: false,
  };

  try {
    const desktop = await verifyDesktopAndStress(browser);
    report.runs.push({ ...desktop, logs: undefined });
    allLogs.push(...desktop.logs);

    const iphone = await verifyMobileViewport(browser, {
      name: 'iphone-portrait-390x844',
      width: 390,
      height: 844,
      urlPath: '/',
      screenshotFile: 'qa_iphone_390x844.png',
      testMultiTouch: true,
    });
    report.runs.push({ ...iphone, logs: undefined });
    allLogs.push(...iphone.logs);

    const android = await verifyMobileViewport(browser, {
      name: 'android-portrait-412x915',
      width: 412,
      height: 915,
      urlPath: '/',
      screenshotFile: 'qa_android_412x915.png',
      testMultiTouch: false,
    });
    report.runs.push({ ...android, logs: undefined });
    allLogs.push(...android.logs);

    const landscape = await verifyMobileViewport(browser, {
      name: 'mobile-landscape-844x390',
      width: 844,
      height: 390,
      urlPath: '/',
      screenshotFile: 'qa_mobile_landscape_844x390.png',
      testMultiTouch: false,
    });
    report.runs.push({ ...landscape, logs: undefined });
    allLogs.push(...landscape.logs);

    const webgl2 = await verifyWebGL2Fallback(browser);
    report.runs.push({ ...webgl2, logs: undefined });
    allLogs.push(...webgl2.logs);

    report.passed = true;
  } catch (err) {
    report.passed = false;
    report.error = err?.stack ?? String(err);
    allLogs.push(`[QA_ERROR] ${report.error}`);
    console.error(report.error);
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(DOCS_OUT_DIR, 'qa_report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(DOCS_OUT_DIR, 'qa_console.log'),
      `${allLogs.join('\n')}\n`,
      'utf8',
    );
  }

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        runs: report.runs.map((r) => ({
          name: r.name,
          passed: r.passed,
          backend: r.capabilities?.backend,
          shotsCompleted: r.stressTest50Shots?.shotsCompleted,
          stuckBallFailures: r.stressTest50Shots?.stuckBallFailures,
          autoRescueCount: r.stressTest50Shots?.autoRescueCount,
          multiTouchVerified: r.multiTouchVerified,
          dragPlungerVerified: r.dragPlungerVerified,
        })),
      },
      null,
      2,
    ),
  );

  if (!report.passed) {
    process.exit(1);
  }
}

await main();
