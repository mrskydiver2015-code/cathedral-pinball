import {
  computeBestPerPlayerLeaderboard,
  loadDb,
  recordScoreInState,
  safeEmitMetric,
  saveDb,
} from './_lib/pinballDb.js';

export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const url = new URL(request.url);
    const userId = (url.searchParams.get('userId') ?? '').trim();
    const { state, storageDriver } = await loadDb();

    const globalBoard = computeBestPerPlayerLeaderboard(state, undefined, 25);

    let friendsBoard = globalBoard.slice(0, 5);
    if (userId && state.users[userId]) {
      const user = state.users[userId];
      const friendSet = new Set<string>([userId, ...user.friendIds]);
      friendsBoard = computeBestPerPlayerLeaderboard(state, friendSet, 25);
    }

    safeEmitMetric('pinball.leaderboard.read', 1, { outcome: 'success' });
    return Response.json({
      ok: true,
      global: globalBoard,
      friends: friendsBoard,
      liveConfig: state.liveConfig,
      totalPlayers: Object.keys(state.users).length,
      storageDriver,
    });
  } catch (err) {
    console.error('[api/leaderboard GET] error:', err);
    safeEmitMetric('pinball.leaderboard.read', 1, { outcome: 'error' });
    return Response.json({ ok: false, error: 'Failed to fetch leaderboard' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'leaderboard',
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const score = Number(body.score) || 0;
    if (!userId) {
      return Response.json({ ok: false, error: 'Missing userId' }, { status: 400 });
    }

    const { state } = await loadDb();
    const result = recordScoreInState(state, {
      userId,
      score,
      maxMultiplier: typeof body.maxMultiplier === 'number' ? body.maxMultiplier : 1,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      initials: typeof body.initials === 'string' ? body.initials : undefined,
    });
    await saveDb(state);

    const friendSet = new Set<string>([userId, ...result.user.friendIds]);
    const globalBoard = computeBestPerPlayerLeaderboard(state, undefined, 25);
    const friendsBoard = computeBestPerPlayerLeaderboard(state, friendSet, 25);

    safeEmitMetric('pinball.scores.submitted', 1, { outcome: 'success' });
    return Response.json({
      ok: true,
      entry: result.entry,
      globalRank: result.globalRank,
      user: result.user,
      global: globalBoard,
      friends: friendsBoard,
      liveConfig: state.liveConfig,
    });
  } catch (err) {
    console.error('[api/leaderboard POST] error:', err);
    safeEmitMetric('pinball.scores.submitted', 1, { outcome: 'error' });
    return Response.json({ ok: false, error: 'Failed to submit score' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'leaderboard',
    });
  }
}
