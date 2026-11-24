import {
  appendAudit,
  computeBestPerPlayerLeaderboard,
  loadDb,
  safeEmitMetric,
  sanitizeDisplayName,
  sanitizeInitials,
  saveDb,
  upsertUserInState,
  verifyAdminRequest,
} from './_lib/pinballDb.js';

export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    if (!verifyAdminRequest(request)) {
      safeEmitMetric('pinball.admin.actions', 1, { outcome: 'unauthorized' });
      return Response.json({ ok: false, error: 'Ogiltig administratörskod.' }, { status: 401 });
    }

    const { state, storageDriver } = await loadDb();
    const usersList = Object.values(state.users).sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    });

    const totalGames = usersList.reduce((sum, u) => sum + u.gamesPlayed, 0);
    const highestScore = usersList.reduce((max, u) => (!u.banned && u.bestScore > max ? u.bestScore : max), 0);
    const bannedCount = usersList.filter((u) => u.banned).length;
    const realPlayersCount = usersList.filter((u) => !u.isSeed).length;

    return Response.json({
      ok: true,
      storageDriver,
      kpis: {
        totalUsers: usersList.length,
        realPlayersCount,
        totalGames,
        highestScore,
        bannedCount,
        storedScoresCount: state.scores.length,
      },
      liveConfig: state.liveConfig,
      users: usersList,
      topScores: computeBestPerPlayerLeaderboard(state, undefined, 50),
      recentScores: state.scores.slice(0, 40),
      auditLogs: state.auditLogs.slice(0, 40),
    });
  } catch (err) {
    console.error('[api/admin GET] error:', err);
    return Response.json({ ok: false, error: 'Failed to load admin overview' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'admin',
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    if (!verifyAdminRequest(request)) {
      safeEmitMetric('pinball.admin.actions', 1, { outcome: 'unauthorized' });
      return Response.json({ ok: false, error: 'Ogiltig administratörskod.' }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    const { state } = await loadDb();

    switch (action) {
      case 'toggleBan': {
        const targetId = typeof body.userId === 'string' ? body.userId : '';
        const target = state.users[targetId];
        if (!target) {
          return Response.json({ ok: false, error: 'User not found' }, { status: 404 });
        }
        target.banned = !target.banned;
        appendAudit(
          state,
          'admin',
          target.banned ? 'user.banned' : 'user.unbanned',
          target.friendCode,
          target.displayName,
        );
        break;
      }

      case 'resetUserScore': {
        const targetId = typeof body.userId === 'string' ? body.userId : '';
        const target = state.users[targetId];
        if (!target) {
          return Response.json({ ok: false, error: 'User not found' }, { status: 404 });
        }
        target.bestScore = 0;
        target.totalScore = 0;
        target.bestMultiplier = 1;
        state.scores = state.scores.filter((s) => s.userId !== targetId);
        appendAudit(state, 'admin', 'user.score_reset', target.friendCode, target.displayName);
        break;
      }

      case 'editUser': {
        const targetId = typeof body.userId === 'string' ? body.userId : '';
        const target = state.users[targetId];
        if (!target) {
          return Response.json({ ok: false, error: 'User not found' }, { status: 404 });
        }
        if (typeof body.initials === 'string') {
          target.initials = sanitizeInitials(body.initials);
        }
        if (typeof body.displayName === 'string') {
          target.displayName = sanitizeDisplayName(body.displayName, target.initials);
        }
        if (body.role === 'player' || body.role === 'vip' || body.role === 'admin') {
          target.role = body.role;
        }
        for (const s of state.scores) {
          if (s.userId === targetId) {
            s.displayName = target.displayName;
            s.initials = target.initials;
          }
        }
        appendAudit(
          state,
          'admin',
          'user.updated',
          target.friendCode,
          `${target.displayName} (${target.role})`,
        );
        break;
      }

      case 'deleteUser': {
        const targetId = typeof body.userId === 'string' ? body.userId : '';
        const target = state.users[targetId];
        if (!target) {
          return Response.json({ ok: false, error: 'User not found' }, { status: 404 });
        }
        delete state.users[targetId];
        for (const u of Object.values(state.users)) {
          u.friendIds = u.friendIds.filter((fid) => fid !== targetId);
        }
        state.scores = state.scores.filter((s) => s.userId !== targetId);
        appendAudit(state, 'admin', 'user.deleted', target.friendCode, target.displayName);
        break;
      }

      case 'deleteScore': {
        const scoreId = typeof body.scoreId === 'string' ? body.scoreId : '';
        const removed = state.scores.find((s) => s.id === scoreId);
        state.scores = state.scores.filter((s) => s.id !== scoreId);
        if (removed && state.users[removed.userId]) {
          const u = state.users[removed.userId];
          const nextBest = state.scores
            .filter((s) => s.userId === u.userId)
            .reduce((m, s) => (s.score > m ? s.score : m), 0);
          u.bestScore = nextBest;
        }
        appendAudit(state, 'admin', 'score.deleted', scoreId, removed ? `${removed.score}` : '');
        break;
      }

      case 'createPlayer': {
        const name = typeof body.displayName === 'string' ? body.displayName : 'Challenger';
        const initials = sanitizeInitials(body.initials ?? name.slice(0, 3));
        const score = Math.max(0, Math.min(5_000_000, Math.floor(Number(body.score) || 0)));
        const newId = `usr-${Date.now().toString(36)}`;
        const created = upsertUserInState(state, {
          userId: newId,
          displayName: name,
          initials,
          clientBestScore: score,
          clientBestMultiplier: Math.max(1, Math.min(8, Math.floor(Number(body.multiplier) || 2))),
        });
        appendAudit(
          state,
          'admin',
          'user.created_manual',
          created.friendCode,
          `${created.displayName} (${score})`,
        );
        break;
      }

      case 'updateLiveConfig': {
        if (typeof body.announcement === 'string') {
          state.liveConfig.announcement = body.announcement.trim().slice(0, 90);
        }
        if (typeof body.doubleScoreActive === 'boolean') {
          state.liveConfig.doubleScoreActive = body.doubleScoreActive;
        }
        state.liveConfig.updatedAt = new Date().toISOString();
        appendAudit(
          state,
          'admin',
          'liveconfig.updated',
          'global',
          `2x=${state.liveConfig.doubleScoreActive} msg="${state.liveConfig.announcement}"`,
        );
        break;
      }

      default:
        return Response.json({ ok: false, error: `Unknown admin action: ${action}` }, { status: 400 });
    }

    await saveDb(state);
    safeEmitMetric('pinball.admin.actions', 1, { outcome: 'success', action });

    return GET(request);
  } catch (err) {
    console.error('[api/admin POST] error:', err);
    safeEmitMetric('pinball.admin.actions', 1, { outcome: 'error' });
    return Response.json({ ok: false, error: 'Admin action failed' }, { status: 500 });
  } finally {
    safeEmitMetric('pinball.api.duration_ms', performance.now() - startedAt, {
      route: 'admin',
    });
  }
}
