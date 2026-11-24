import type { HighScoreStore } from './highScores.ts';
import { sanitizeInitials } from './highScores.ts';
import type {
  FriendSummary,
  HighScoreEntry,
  LiveServerConfig,
  PlayerProfile,
} from '../shared/types.ts';

const USER_ID_STORAGE_KEY = 'cathedral-pinball-user-id';
const PROFILE_CACHE_KEY = 'cathedral-pinball-profile-cache-v1';
const ADMIN_KEY_STORAGE = 'cathedral-pinball-admin-key';

export interface AdminOverviewResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly storageDriver: string;
  readonly kpis: {
    readonly totalUsers: number;
    readonly realPlayersCount: number;
    readonly totalGames: number;
    readonly highestScore: number;
    readonly bannedCount: number;
    readonly storedScoresCount: number;
  };
  readonly liveConfig: LiveServerConfig;
  readonly users: readonly (PlayerProfile & {
    readonly isSeed?: boolean;
    readonly createdAt: string;
    readonly lastSeenAt: string;
  })[];
  readonly recentScores: readonly {
    readonly id: string;
    readonly userId: string;
    readonly displayName: string;
    readonly initials: string;
    readonly friendCode: string;
    readonly score: number;
    readonly maxMultiplier: number;
    readonly createdAt: string;
  }[];
  readonly auditLogs: readonly {
    readonly id: string;
    readonly createdAt: string;
    readonly actor: string;
    readonly action: string;
    readonly target: string;
    readonly details: string;
  }[];
}

function readStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore restricted storage
  }
}

function getOrCreateUserId(): string {
  const existing = readStorage(USER_ID_STORAGE_KEY);
  if (existing && /^[a-zA-Z0-9_-]{6,48}$/.test(existing)) {
    return existing;
  }
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const id = `plr_${rand}`;
  writeStorage(USER_ID_STORAGE_KEY, id);
  return id;
}

function deriveLocalFriendCode(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `CAT-${1000 + (Math.abs(hash) % 9000)}`;
}

function mapServerScore(
  raw: Record<string, unknown>,
  myUserId: string,
): HighScoreEntry {
  const uid = typeof raw.userId === 'string' ? raw.userId : '';
  return {
    id: typeof raw.id === 'string' ? raw.id : `srv-${uid}`,
    userId: uid,
    initials: sanitizeInitials(typeof raw.initials === 'string' ? raw.initials : 'YOU'),
    displayName: typeof raw.displayName === 'string' ? raw.displayName : undefined,
    avatarColor: typeof raw.avatarColor === 'string' ? raw.avatarColor : '#38bdf8',
    friendCode: typeof raw.friendCode === 'string' ? raw.friendCode : undefined,
    score: Math.max(0, Math.floor(Number(raw.score) || 0)),
    maxMultiplier: Math.max(1, Math.floor(Number(raw.maxMultiplier) || 1)),
    dateIso:
      typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 10) : '2026-11-24',
    isPlayer: uid === myUserId,
  };
}

/**
 * Handles seamless cloud synchronization with `/api/*` (Users, Global & Friends Leaderboards,
 * 1-click Friend Invites, and Admin Console) while remaining 100% resilient offline.
 */
export class SocialClient {
  private readonly localStore: HighScoreStore;
  private profile: PlayerProfile;
  private globalLeaderboard: HighScoreEntry[] = [];
  private friendsLeaderboard: HighScoreEntry[] = [];
  private friends: FriendSummary[] = [];
  private suggestions: FriendSummary[] = [];
  private liveConfig: LiveServerConfig = {
    announcement: '',
    doubleScoreActive: false,
    updatedAt: '',
  };
  private online = false;
  private readonly listeners = new Set<() => void>();

  constructor(localStore: HighScoreStore) {
    this.localStore = localStore;
    const userId = getOrCreateUserId();
    const cachedRaw = readStorage(PROFILE_CACHE_KEY);
    let cached: Partial<PlayerProfile> | null = null;
    if (cachedRaw) {
      try {
        cached = JSON.parse(cachedRaw) as Partial<PlayerProfile>;
      } catch {
        cached = null;
      }
    }

    const initials = localStore.getPreferredInitials();
    this.profile = {
      userId,
      friendCode: cached?.friendCode ?? deriveLocalFriendCode(userId),
      displayName: cached?.displayName ?? `Pilgrim ${initials}`,
      initials,
      avatarColor: cached?.avatarColor ?? '#38bdf8',
      role: cached?.role ?? 'player',
      banned: false,
      gamesPlayed: cached?.gamesPlayed ?? 0,
      totalScore: cached?.totalScore ?? 0,
      bestScore: Math.max(cached?.bestScore ?? 0, localStore.getPlayerBestScore()),
      bestMultiplier: cached?.bestMultiplier ?? 1,
      friendIds: cached?.friendIds ?? [],
    };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    writeStorage(PROFILE_CACHE_KEY, JSON.stringify(this.profile));
    for (const fn of this.listeners) {
      fn();
    }
  }

  isOnline(): boolean {
    return this.online;
  }

  getProfile(): PlayerProfile {
    return this.profile;
  }

  getLiveConfig(): LiveServerConfig {
    return this.liveConfig;
  }

  getGlobalLeaderboard(): readonly HighScoreEntry[] {
    return this.globalLeaderboard.length > 0
      ? this.globalLeaderboard
      : this.localStore.getEntries();
  }

  getFriendsLeaderboard(): readonly HighScoreEntry[] {
    if (this.friendsLeaderboard.length > 0) {
      return this.friendsLeaderboard;
    }
    return [
      {
        id: `local-${this.profile.userId}`,
        userId: this.profile.userId,
        initials: this.profile.initials,
        displayName: this.profile.displayName,
        avatarColor: this.profile.avatarColor,
        friendCode: this.profile.friendCode,
        score: this.profile.bestScore,
        maxMultiplier: this.profile.bestMultiplier,
        dateIso: '2026-11-24',
        isPlayer: true,
      },
    ].filter((e) => e.score > 0);
  }

  getFriends(): readonly FriendSummary[] {
    return this.friends;
  }

  getSuggestions(): readonly FriendSummary[] {
    return this.suggestions;
  }

  getInviteShareUrl(): string {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.delete('admin');
    url.searchParams.set('friend', this.profile.friendCode);
    url.hash = '';
    return url.toString();
  }

  async bootstrapAndCheckInviteLink(
    onFriendAutoAdded?: (friendName: string) => void,
  ): Promise<void> {
    await this.syncProfile();

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const inviteCode = params.get('friend')?.trim();
      if (inviteCode && inviteCode.toUpperCase() !== this.profile.friendCode.toUpperCase()) {
        const res = await this.addFriend(inviteCode);
        // Clean URL parameter without reloading page
        params.delete('friend');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', nextUrl);

        if (res.ok && res.friend && onFriendAutoAdded) {
          onFriendAutoAdded(res.friend.displayName);
        }
      }
    }

    await Promise.all([this.refreshLeaderboards(), this.refreshFriends()]);
  }

  async syncProfile(updates?: {
    displayName?: string;
    initials?: string;
    avatarColor?: string;
  }): Promise<PlayerProfile> {
    if (updates?.initials) {
      const cleanInit = this.localStore.setPreferredInitials(updates.initials);
      this.profile = { ...this.profile, initials: cleanInit };
    }
    if (updates?.displayName) {
      this.profile = { ...this.profile, displayName: updates.displayName.trim().slice(0, 22) };
    }
    if (updates?.avatarColor) {
      this.profile = { ...this.profile, avatarColor: updates.avatarColor };
    }

    const playerEntries = this.localStore.getEntries().filter((e) => e.isPlayer);
    const localPlayerBest = playerEntries.reduce((max, e) => (e.score > max ? e.score : max), 0);
    const localBestMult = playerEntries.reduce(
      (max, e) => (e.maxMultiplier > max ? e.maxMultiplier : max),
      1,
    );

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.profile.userId,
          displayName: this.profile.displayName,
          initials: this.profile.initials,
          avatarColor: this.profile.avatarColor,
          clientBestScore: Math.max(this.profile.bestScore, localPlayerBest),
          clientBestMultiplier: Math.max(this.profile.bestMultiplier, localBestMult),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ok: boolean;
          user?: PlayerProfile;
          liveConfig?: LiveServerConfig;
        };
        if (data.ok && data.user) {
          this.profile = data.user;
          this.online = true;
        }
        if (data.liveConfig) {
          this.liveConfig = data.liveConfig;
        }
      }
    } catch {
      this.online = false;
    }

    this.notify();
    return this.profile;
  }

  async refreshLeaderboards(): Promise<void> {
    try {
      const res = await fetch(
        `/api/leaderboard?userId=${encodeURIComponent(this.profile.userId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        global?: Record<string, unknown>[];
        friends?: Record<string, unknown>[];
        liveConfig?: LiveServerConfig;
      };
      if (!data.ok) return;
      this.online = true;
      if (Array.isArray(data.global)) {
        this.globalLeaderboard = data.global.map((r) => mapServerScore(r, this.profile.userId));
      }
      if (Array.isArray(data.friends)) {
        this.friendsLeaderboard = data.friends.map((r) => mapServerScore(r, this.profile.userId));
      }
      if (data.liveConfig) {
        this.liveConfig = data.liveConfig;
      }
      this.notify();
    } catch {
      this.online = false;
    }
  }

  async submitCompletedGameScore(score: number, maxMultiplier: number): Promise<void> {
    if (score <= 0) return;
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.profile.userId,
          displayName: this.profile.displayName,
          initials: this.profile.initials,
          score,
          maxMultiplier,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        user?: PlayerProfile;
        global?: Record<string, unknown>[];
        friends?: Record<string, unknown>[];
        liveConfig?: LiveServerConfig;
      };
      if (data.ok) {
        this.online = true;
        if (data.user) this.profile = data.user;
        if (Array.isArray(data.global)) {
          this.globalLeaderboard = data.global.map((r) => mapServerScore(r, this.profile.userId));
        }
        if (Array.isArray(data.friends)) {
          this.friendsLeaderboard = data.friends.map((r) => mapServerScore(r, this.profile.userId));
        }
        if (data.liveConfig) this.liveConfig = data.liveConfig;
        this.notify();
      }
    } catch {
      this.online = false;
    }
  }

  async refreshFriends(): Promise<void> {
    try {
      const res = await fetch(`/api/friends?userId=${encodeURIComponent(this.profile.userId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        friends?: FriendSummary[];
        suggestions?: FriendSummary[];
        friendsLeaderboard?: Record<string, unknown>[];
      };
      if (!data.ok) return;
      this.online = true;
      this.friends = data.friends ?? [];
      this.suggestions = data.suggestions ?? [];
      if (Array.isArray(data.friendsLeaderboard)) {
        this.friendsLeaderboard = data.friendsLeaderboard.map((r) =>
          mapServerScore(r, this.profile.userId),
        );
      }
      this.notify();
    } catch {
      this.online = false;
    }
  }

  async addFriend(
    query: string,
  ): Promise<{ ok: boolean; error?: string; friend?: FriendSummary }> {
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.profile.userId,
          query,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        addedFriend?: FriendSummary;
        friendsLeaderboard?: Record<string, unknown>[];
      };
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error ?? 'Kunde inte lägga till vän.' };
      }
      await this.refreshFriends();
      return { ok: true, friend: data.addedFriend };
    } catch {
      return { ok: false, error: 'Nätverksfel — kunde inte nå servern.' };
    }
  }

  async removeFriend(friendUserId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/friends?userId=${encodeURIComponent(this.profile.userId)}&friendUserId=${encodeURIComponent(friendUserId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) return false;
      await this.refreshFriends();
      return true;
    } catch {
      return false;
    }
  }

  getStoredAdminKey(): string {
    return readStorage(ADMIN_KEY_STORAGE) ?? 'CATHEDRAL-2026';
  }

  saveAdminKey(key: string): void {
    writeStorage(ADMIN_KEY_STORAGE, key.trim());
  }

  async fetchAdminOverview(adminKey: string): Promise<AdminOverviewResponse> {
    const res = await fetch('/api/admin', {
      headers: { 'x-admin-key': adminKey.trim() },
    });
    const data = (await res.json()) as AdminOverviewResponse;
    if (res.ok && data.ok) {
      this.saveAdminKey(adminKey);
    }
    return data;
  }

  async performAdminAction(
    adminKey: string,
    payload: Record<string, unknown>,
  ): Promise<AdminOverviewResponse> {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey.trim(),
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as AdminOverviewResponse;
    if (res.ok && data.ok) {
      void this.refreshLeaderboards();
      void this.refreshFriends();
    }
    return data;
  }
}
