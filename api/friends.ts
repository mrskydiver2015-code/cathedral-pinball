import {
  appendAudit,
  computeBestPerPlayerLeaderboard,
  findUserByQuery,
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
    if (!userId) {
      return Response.json({ ok: false, error: 'Missing userId' }, { status: 400 });
    }

    const { state } = await loadDb();
    const user = state.users[userId] ?? upsertUserInState(state, { userId });

    const friends = user.friendIds
      .map((fid) => state.users[fid])
      .filter((f): f is NonNullable<typeof f> => Boolean(f && !f.banned))
      .map((f) => ({
        userId: f.userId,
        friendCode: f.friendCode,
        displayName: f.displayName,
        initials: f.initials,
        avatarColor: f.avatarColor,
        bestScore: f.bestScore,
        bestMultiplier: f.bestMultiplier,
        gamesPlayed: f.gamesPlayed,
        lastSeenAt: f.lastSeenAt,
      }));

    // Suggested players not yet in the user's friends list for easy 1-tap rivalry
    const existingSet = new Set<string>([userId, ...user.friendIds]);
    const suggestions = Object.values(state.users)
      .filter((u) => !u.banned && !existingSet.has(u.userId) && u.bestScore > 0)
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, 6)
      .map((u) => ({
        userId: u.userId,
        friendCode: u.friendCode,
        displayName: u.displayName,
        initials: u.initials,
        avatarColor: u.avatarColor,
        bestScore: u.bestScore,
      }));

    const friendSet = new Set<string>([userId, ...user.friendIds]);
    const friendsLeaderboard = computeBestPerPlayerLeaderboard(state, friendSet, 25);

    return Response.json({
      ok: true,
      me: {
        userId: user.userId,
        friendCode: user.friendCode,
        displayName: user.displayName,
        initials: user.initials,
      },
      friends,
      suggestions,
      friendsLeaderboard,
    });
  } catch (err) {
    console.error('[api/friends GET] error:', err);
    return Response.json({ ok: false, error: 'Failed to load friends' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'friends',
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const query = typeof body.query === 'string' ? body.query.trim() : '';

    if (!userId || !query) {
      return Response.json(
        { ok: false, error: 'Ange en vänkod (t.ex. CAT-7777) eller spelarnamn.' },
        { status: 400 },
      );
    }

    const { state } = await loadDb();
    const me = state.users[userId] ?? upsertUserInState(state, { userId });
    const target = findUserByQuery(state, query);

    if (!target || target.banned) {
      safeEmitMetric('pinball.friends.added', 1, { outcome: 'not_found' });
      return Response.json(
        { ok: false, error: `Hittade ingen spelare med "${query}". Kontrollera vänkoden!` },
        { status: 404 },
      );
    }

    if (target.userId === me.userId) {
      return Response.json(
        { ok: false, error: 'Det där är din egen vänkod!' },
        { status: 400 },
      );
    }

    if (!me.friendIds.includes(target.userId)) {
      me.friendIds.push(target.userId);
    }
    // Mutual friendship so shared invite links connect both players' Friends lists automatically
    if (!target.friendIds.includes(me.userId)) {
      target.friendIds.push(me.userId);
    }

    appendAudit(
      state,
      me.friendCode,
      'friend.added',
      target.friendCode,
      `${me.displayName} <-> ${target.displayName}`,
    );
    await saveDb(state);

    const friendSet = new Set<string>([me.userId, ...me.friendIds]);
    const friendsLeaderboard = computeBestPerPlayerLeaderboard(state, friendSet, 25);

    safeEmitMetric('pinball.friends.added', 1, { outcome: 'success' });
    return Response.json({
      ok: true,
      addedFriend: {
        userId: target.userId,
        friendCode: target.friendCode,
        displayName: target.displayName,
        initials: target.initials,
        avatarColor: target.avatarColor,
        bestScore: target.bestScore,
      },
      friendsLeaderboard,
    });
  } catch (err) {
    console.error('[api/friends POST] error:', err);
    safeEmitMetric('pinball.friends.added', 1, { outcome: 'error' });
    return Response.json({ ok: false, error: 'Kunde inte lägga till vän.' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'friends',
    });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const url = new URL(request.url);
    const userId = (url.searchParams.get('userId') ?? '').trim();
    const friendUserId = (url.searchParams.get('friendUserId') ?? '').trim();

    if (!userId || !friendUserId) {
      return Response.json({ ok: false, error: 'Missing userId or friendUserId' }, { status: 400 });
    }

    const { state } = await loadDb();
    const me = state.users[userId];
    if (me) {
      me.friendIds = me.friendIds.filter((id) => id !== friendUserId);
      await saveDb(state);
    }

    const friendSet = new Set<string>([userId, ...(me?.friendIds ?? [])]);
    const friendsLeaderboard = computeBestPerPlayerLeaderboard(state, friendSet, 25);

    return Response.json({ ok: true, friendsLeaderboard });
  } catch (err) {
    console.error('[api/friends DELETE] error:', err);
    return Response.json({ ok: false, error: 'Failed to remove friend' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'friends',
    });
  }
}
