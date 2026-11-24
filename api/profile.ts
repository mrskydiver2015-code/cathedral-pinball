import {
  loadDb,
  safeEmitMetric,
  saveDb,
  upsertUserInState,
} from './_lib/pinballDb.js';

export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const url = new URL(request.url);
    const userId = (url.searchParams.get('userId') ?? '').trim();
    const { state, storageDriver } = await loadDb();

    const user = userId && state.users[userId] ? state.users[userId] : null;
    safeEmitMetric('pinball.profile.read', 1, { outcome: 'success' });
    return Response.json({
      ok: true,
      user,
      liveConfig: state.liveConfig,
      storageDriver,
    });
  } catch (err) {
    console.error('[api/profile GET] error:', err);
    safeEmitMetric('pinball.profile.read', 1, { outcome: 'error' });
    return Response.json({ ok: false, error: 'Failed to load profile' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'profile',
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId) {
      return Response.json({ ok: false, error: 'Missing userId' }, { status: 400 });
    }

    const { state, storageDriver } = await loadDb();
    const isNew = !state.users[userId];
    const user = upsertUserInState(state, {
      userId,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      initials: typeof body.initials === 'string' ? body.initials : undefined,
      avatarColor: typeof body.avatarColor === 'string' ? body.avatarColor : undefined,
      clientBestScore: typeof body.clientBestScore === 'number' ? body.clientBestScore : undefined,
      clientBestMultiplier:
        typeof body.clientBestMultiplier === 'number' ? body.clientBestMultiplier : undefined,
    });
    await saveDb(state);

    safeEmitMetric('pinball.users.synced', 1, {
      outcome: 'success',
      kind: isNew ? 'created' : 'updated',
    });

    return Response.json({
      ok: true,
      user,
      liveConfig: state.liveConfig,
      storageDriver,
    });
  } catch (err) {
    console.error('[api/profile POST] error:', err);
    safeEmitMetric('pinball.users.synced', 1, { outcome: 'error' });
    return Response.json({ ok: false, error: 'Failed to sync profile' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'profile',
    });
  }
}
