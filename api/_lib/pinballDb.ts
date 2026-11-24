import { getCache, metric } from '@vercel/functions';

export type UserRole = 'player' | 'vip' | 'admin';

export interface DbUser {
  userId: string;
  friendCode: string;
  displayName: string;
  initials: string;
  avatarColor: string;
  role: UserRole;
  banned: boolean;
  gamesPlayed: number;
  totalScore: number;
  bestScore: number;
  bestMultiplier: number;
  friendIds: string[];
  isSeed?: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export interface DbScoreEntry {
  id: string;
  userId: string;
  displayName: string;
  initials: string;
  avatarColor: string;
  friendCode: string;
  score: number;
  maxMultiplier: number;
  createdAt: string;
}

export interface DbAuditEntry {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  target: string;
  details: string;
}

export interface DbLiveConfig {
  announcement: string;
  doubleScoreActive: boolean;
  updatedAt: string;
}

export interface PinballDatabaseState {
  version: number;
  users: Record<string, DbUser>;
  scores: DbScoreEntry[];
  auditLogs: DbAuditEntry[];
  liveConfig: DbLiveConfig;
}

const DB_CACHE_KEY = 'state-v1';
const DB_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year
const MAX_STORED_SCORES = 250;
const MAX_AUDIT_LOGS = 120;
const MAX_REASONABLE_SCORE = 5_000_000;

const AVATAR_PALETTE = [
  '#38bdf8',
  '#f59e0b',
  '#e879f9',
  '#34d399',
  '#fb7185',
  '#a78bfa',
] as const;

let memoryFallbackState: PinballDatabaseState | null = null;

export function getExpectedAdminKey(): string {
  const fromEnv =
    typeof process !== 'undefined' && process.env?.PINBALL_ADMIN_KEY
      ? process.env.PINBALL_ADMIN_KEY.trim()
      : '';
  return fromEnv || 'CATHEDRAL-2026';
}

export function verifyAdminRequest(request: Request): boolean {
  const provided = (request.headers.get('x-admin-key') ?? '').trim();
  return Boolean(provided && provided === getExpectedAdminKey());
}

export function safeEmitMetric(
  name: string,
  value: number,
  tags?: Record<string, string>,
): void {
  try {
    metric(name, value, tags);
  } catch {
    // Safe no-op outside Vercel Function runtime
  }
}

export function sanitizeInitials(raw: unknown): string {
  const str = typeof raw === 'string' ? raw : 'YOU';
  const cleaned = str
    .toUpperCase()
    .replace(/[^A-Z0-9ÅÄÖ]/g, '')
    .slice(0, 3);
  return (cleaned || 'YOU').padEnd(3, 'X');
}

export function sanitizeDisplayName(raw: unknown, fallbackInitials: string): string {
  const str = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  const cleaned = str.replace(/[<>]/g, '').slice(0, 22);
  return cleaned || `Pilgrim ${fallbackInitials}`;
}

export function sanitizeAvatarColor(raw: unknown): string {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  return AVATAR_PALETTE[0];
}

function deterministicCodeFromId(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = 1000 + (Math.abs(hash) % 9000);
  return `CAT-${num}`;
}

function generateUniqueFriendCode(
  userId: string,
  existingUsers: Record<string, DbUser>,
): string {
  const used = new Set(Object.values(existingUsers).map((u) => u.friendCode.toUpperCase()));
  const candidate = deterministicCodeFromId(userId);
  if (!used.has(candidate)) return candidate;
  for (let offset = 1; offset < 9000; offset++) {
    const alt = `CAT-${1000 + ((Number(candidate.slice(4)) + offset) % 9000)}`;
    if (!used.has(alt)) return alt;
  }
  return `CAT-${Math.floor(1000 + Math.random() * 8999)}`;
}

function buildInitialSeedState(): PinballDatabaseState {
  const now = '2026-11-24T06:00:00.000Z';
  const seeds: Array<{
    id: string;
    code: string;
    name: string;
    initials: string;
    color: string;
    role: UserRole;
    score: number;
    mult: number;
    games: number;
  }> = [
    {
      id: 'rival-aria',
      code: 'CAT-7777',
      name: 'Aria Voss',
      initials: 'ARI',
      color: '#e879f9',
      role: 'vip',
      score: 48500,
      mult: 5,
      games: 19,
    },
    {
      id: 'rival-kael',
      code: 'CAT-3104',
      name: 'Brother Kael',
      initials: 'KAE',
      color: '#f59e0b',
      role: 'player',
      score: 34200,
      mult: 4,
      games: 14,
    },
    {
      id: 'rival-lyra',
      code: 'CAT-8821',
      name: 'Sister Lyra',
      initials: 'LYR',
      color: '#38bdf8',
      role: 'player',
      score: 24800,
      mult: 3,
      games: 11,
    },
    {
      id: 'rival-vespera',
      code: 'CAT-5510',
      name: 'Vespera',
      initials: 'VES',
      color: '#34d399',
      role: 'player',
      score: 15600,
      mult: 3,
      games: 8,
    },
    {
      id: 'rival-tomas',
      code: 'CAT-1902',
      name: 'Novice Tomas',
      initials: 'TOM',
      color: '#a78bfa',
      role: 'player',
      score: 8400,
      mult: 2,
      games: 5,
    },
  ];

  const users: Record<string, DbUser> = {};
  const scores: DbScoreEntry[] = [];

  for (const s of seeds) {
    users[s.id] = {
      userId: s.id,
      friendCode: s.code,
      displayName: s.name,
      initials: s.initials,
      avatarColor: s.color,
      role: s.role,
      banned: false,
      gamesPlayed: s.games,
      totalScore: s.score * Math.max(1, Math.floor(s.games * 0.55)),
      bestScore: s.score,
      bestMultiplier: s.mult,
      friendIds: [],
      isSeed: true,
      createdAt: now,
      lastSeenAt: now,
    };
    scores.push({
      id: `seed-score-${s.id}`,
      userId: s.id,
      displayName: s.name,
      initials: s.initials,
      avatarColor: s.color,
      friendCode: s.code,
      score: s.score,
      maxMultiplier: s.mult,
      createdAt: now,
    });
  }

  return {
    version: 1,
    users,
    scores,
    auditLogs: [
      {
        id: 'audit-boot',
        createdAt: now,
        actor: 'system',
        action: 'db.initialized',
        target: 'cathedral-pinball-v1',
        details: 'Initialized Sanctuary leaderboard & rival champions',
      },
    ],
    liveConfig: {
      announcement: '',
      doubleScoreActive: false,
      updatedAt: now,
    },
  };
}

export async function loadDb(): Promise<{
  state: PinballDatabaseState;
  storageDriver: 'vercel-runtime-cache' | 'memory-local';
}> {
  try {
    const cache = getCache({ namespace: 'cathedral-pinball-v1' });
    const cached = (await cache.get(DB_CACHE_KEY)) as PinballDatabaseState | null;
    if (cached && typeof cached === 'object' && cached.users && Array.isArray(cached.scores)) {
      memoryFallbackState = cached;
      return { state: cached, storageDriver: 'vercel-runtime-cache' };
    }
    const fresh = memoryFallbackState ?? buildInitialSeedState();
    await cache.set(DB_CACHE_KEY, fresh, {
      ttl: DB_CACHE_TTL_SECONDS,
      tags: ['pinball-db'],
      name: 'cathedral-pinball-state',
    });
    memoryFallbackState = fresh;
    return { state: fresh, storageDriver: 'vercel-runtime-cache' };
  } catch {
    if (!memoryFallbackState) {
      memoryFallbackState = buildInitialSeedState();
    }
    return { state: memoryFallbackState, storageDriver: 'memory-local' };
  }
}

export async function saveDb(state: PinballDatabaseState): Promise<void> {
  memoryFallbackState = state;
  try {
    const cache = getCache({ namespace: 'cathedral-pinball-v1' });
    await cache.set(DB_CACHE_KEY, state, {
      ttl: DB_CACHE_TTL_SECONDS,
      tags: ['pinball-db'],
      name: 'cathedral-pinball-state',
    });
  } catch {
    // Local dev / test environment keeps state in memoryFallbackState
  }
}

export function appendAudit(
  state: PinballDatabaseState,
  actor: string,
  action: string,
  target: string,
  details = '',
): void {
  state.auditLogs.unshift({
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    actor,
    action,
    target,
    details,
  });
  if (state.auditLogs.length > MAX_AUDIT_LOGS) {
    state.auditLogs.length = MAX_AUDIT_LOGS;
  }
}

function trimAndSortScores(scores: DbScoreEntry[]): DbScoreEntry[] {
  return [...scores]
    .filter((s) => Number.isFinite(s.score) && s.score > 0 && s.score <= MAX_REASONABLE_SCORE)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, MAX_STORED_SCORES);
}

/**
 * Deduplicated best-per-player leaderboard so one player doesn't flood all 25 slots,
 * making Global and Friends rankings clean, competitive, and App-Store authentic.
 */
export function computeBestPerPlayerLeaderboard(
  state: PinballDatabaseState,
  allowedUserIds?: Set<string>,
  limit = 25,
): DbScoreEntry[] {
  const bestByUser = new Map<string, DbScoreEntry>();

  for (const user of Object.values(state.users)) {
    if (user.banned || user.bestScore <= 0) continue;
    if (allowedUserIds && !allowedUserIds.has(user.userId)) continue;
    bestByUser.set(user.userId, {
      id: `best-${user.userId}`,
      userId: user.userId,
      displayName: user.displayName,
      initials: user.initials,
      avatarColor: user.avatarColor,
      friendCode: user.friendCode,
      score: user.bestScore,
      maxMultiplier: user.bestMultiplier,
      createdAt: user.lastSeenAt,
    });
  }

  for (const entry of state.scores) {
    const owner = state.users[entry.userId];
    if (owner?.banned) continue;
    if (allowedUserIds && !allowedUserIds.has(entry.userId)) continue;
    const prev = bestByUser.get(entry.userId);
    if (!prev || entry.score > prev.score) {
      bestByUser.set(entry.userId, {
        ...entry,
        displayName: owner?.displayName ?? entry.displayName,
        initials: owner?.initials ?? entry.initials,
        avatarColor: owner?.avatarColor ?? entry.avatarColor,
        friendCode: owner?.friendCode ?? entry.friendCode,
      });
    }
  }

  return [...bestByUser.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.maxMultiplier - a.maxMultiplier;
    })
    .slice(0, limit);
}

export function upsertUserInState(
  state: PinballDatabaseState,
  input: {
    userId: string;
    displayName?: string;
    initials?: string;
    avatarColor?: string;
    clientBestScore?: number;
    clientBestMultiplier?: number;
  },
): DbUser {
  const cleanId = input.userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  if (!cleanId) {
    throw new Error('Invalid userId');
  }

  const now = new Date().toISOString();
  const existing = state.users[cleanId];
  const initials = input.initials
    ? sanitizeInitials(input.initials)
    : existing?.initials ?? 'YOU';
  const displayName = input.displayName
    ? sanitizeDisplayName(input.displayName, initials)
    : existing?.displayName ?? `Pilgrim ${initials}`;
  const avatarColor = input.avatarColor
    ? sanitizeAvatarColor(input.avatarColor)
    : existing?.avatarColor ?? AVATAR_PALETTE[Math.abs(cleanId.charCodeAt(0)) % AVATAR_PALETTE.length];

  const syncedBest = Math.min(
    MAX_REASONABLE_SCORE,
    Math.max(0, Math.floor(Number(input.clientBestScore) || 0)),
  );
  const syncedMult = Math.max(1, Math.min(8, Math.floor(Number(input.clientBestMultiplier) || 1)));

  if (existing) {
    existing.displayName = displayName;
    existing.initials = initials;
    existing.avatarColor = avatarColor;
    existing.lastSeenAt = now;

    // Self-healing sync: preserve verified client personal best if higher than server state
    if (!existing.banned && syncedBest > existing.bestScore) {
      existing.bestScore = syncedBest;
      existing.bestMultiplier = Math.max(existing.bestMultiplier, syncedMult);
      existing.gamesPlayed = Math.max(1, existing.gamesPlayed);
      existing.totalScore = Math.max(existing.totalScore, syncedBest);
      state.scores = trimAndSortScores([
        ...state.scores,
        {
          id: `sync-${cleanId}-${syncedBest}`,
          userId: cleanId,
          displayName: existing.displayName,
          initials: existing.initials,
          avatarColor: existing.avatarColor,
          friendCode: existing.friendCode,
          score: syncedBest,
          maxMultiplier: existing.bestMultiplier,
          createdAt: now,
        },
      ]);
    }
    return existing;
  }

  const friendCode = generateUniqueFriendCode(cleanId, state.users);
  const created: DbUser = {
    userId: cleanId,
    friendCode,
    displayName,
    initials,
    avatarColor,
    role: 'player',
    banned: false,
    gamesPlayed: syncedBest > 0 ? 1 : 0,
    totalScore: syncedBest,
    bestScore: syncedBest,
    bestMultiplier: syncedMult,
    friendIds: ['rival-aria', 'rival-kael'], // Start with 2 friendly Cathedral rivals so Friends list is immediately alive
    createdAt: now,
    lastSeenAt: now,
  };
  state.users[cleanId] = created;

  if (syncedBest > 0) {
    state.scores = trimAndSortScores([
      ...state.scores,
      {
        id: `init-${cleanId}-${syncedBest}`,
        userId: cleanId,
        displayName: created.displayName,
        initials: created.initials,
        avatarColor: created.avatarColor,
        friendCode: created.friendCode,
        score: syncedBest,
        maxMultiplier: syncedMult,
        createdAt: now,
      },
    ]);
  }

  appendAudit(state, cleanId, 'user.registered', friendCode, `${displayName} (${initials})`);
  return created;
}

export function recordScoreInState(
  state: PinballDatabaseState,
  input: {
    userId: string;
    score: number;
    maxMultiplier?: number;
    displayName?: string;
    initials?: string;
  },
): { entry: DbScoreEntry | null; globalRank: number; user: DbUser } {
  const user = upsertUserInState(state, {
    userId: input.userId,
    displayName: input.displayName,
    initials: input.initials,
  });

  const cleanScore = Math.floor(Number(input.score) || 0);
  const cleanMult = Math.max(1, Math.min(8, Math.floor(Number(input.maxMultiplier) || 1)));

  if (user.banned || !Number.isFinite(cleanScore) || cleanScore <= 0 || cleanScore > MAX_REASONABLE_SCORE) {
    const board = computeBestPerPlayerLeaderboard(state, undefined, 100);
    const rankIdx = board.findIndex((e) => e.userId === user.userId);
    return { entry: null, globalRank: rankIdx >= 0 ? rankIdx + 1 : 0, user };
  }

  const effectiveScore = Math.min(MAX_REASONABLE_SCORE, cleanScore);

  const now = new Date().toISOString();
  user.gamesPlayed += 1;
  user.totalScore += effectiveScore;
  user.lastSeenAt = now;
  if (effectiveScore > user.bestScore) {
    user.bestScore = effectiveScore;
  }
  if (cleanMult > user.bestMultiplier) {
    user.bestMultiplier = cleanMult;
  }

  const entry: DbScoreEntry = {
    id: `scr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: user.userId,
    displayName: user.displayName,
    initials: user.initials,
    avatarColor: user.avatarColor,
    friendCode: user.friendCode,
    score: effectiveScore,
    maxMultiplier: cleanMult,
    createdAt: now,
  };

  state.scores = trimAndSortScores([...state.scores, entry]);
  const board = computeBestPerPlayerLeaderboard(state, undefined, 100);
  const rankIdx = board.findIndex((e) => e.userId === user.userId);

  return {
    entry,
    globalRank: rankIdx >= 0 ? rankIdx + 1 : 0,
    user,
  };
}

export function findUserByQuery(state: PinballDatabaseState, query: string): DbUser | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  const normalizedCode = q.startsWith('CAT-') ? q : /^\d{4}$/.test(q) ? `CAT-${q}` : q;

  for (const u of Object.values(state.users)) {
    if (u.friendCode.toUpperCase() === normalizedCode) return u;
  }
  for (const u of Object.values(state.users)) {
    if (u.userId.toUpperCase() === q) return u;
  }
  for (const u of Object.values(state.users)) {
    if (u.displayName.toUpperCase() === q || u.initials.toUpperCase() === q) return u;
  }
  return null;
}
