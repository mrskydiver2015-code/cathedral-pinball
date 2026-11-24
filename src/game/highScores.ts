import type { HighScoreEntry } from '../shared/types.ts';

const LEADERBOARD_STORAGE_KEY = 'cathedral-pinball-leaderboard-v1';
const LEGACY_HIGH_SCORE_KEY = 'cathedral-pinball-high-score';
const PREFERRED_INITIALS_KEY = 'cathedral-pinball-player-initials';
const MAX_ENTRIES = 10;

const DEFAULT_SEED_ENTRIES: readonly HighScoreEntry[] = [
  { id: 'seed-1', initials: 'SAN', score: 30000, maxMultiplier: 4, dateIso: '2026-01-01', isPlayer: false },
  { id: 'seed-2', initials: 'LUX', score: 20000, maxMultiplier: 3, dateIso: '2026-01-01', isPlayer: false },
  { id: 'seed-3', initials: 'ORB', score: 12500, maxMultiplier: 2, dateIso: '2026-01-01', isPlayer: false },
  { id: 'seed-4', initials: 'SOL', score: 7500, maxMultiplier: 2, dateIso: '2026-01-01', isPlayer: false },
  { id: 'seed-5', initials: 'NOV', score: 3500, maxMultiplier: 1, dateIso: '2026-01-01', isPlayer: false },
];

export interface RecordedHighScoreResult {
  readonly entry: HighScoreEntry;
  readonly rank: number; // 1-based rank in Top 10
  readonly isNewBest: boolean;
}

export function sanitizeInitials(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9ÅÄÖ]/g, '')
    .slice(0, 3);
  return cleaned.padEnd(3, 'A');
}

function readLocalStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

function todayIsoDate(): string {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch {
    return '2026-11-24';
  }
}

function sortAndTrim(entries: readonly HighScoreEntry[]): HighScoreEntry[] {
  return [...entries]
    .filter((e) => Number.isFinite(e.score) && e.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.maxMultiplier !== a.maxMultiplier) return b.maxMultiplier - a.maxMultiplier;
      return (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0);
    })
    .slice(0, MAX_ENTRIES);
}

/**
 * Persistent local arcade High Score Leaderboard shared seamlessly across mobile and desktop browsers.
 * Automatically migrates any existing single `cathedral-pinball-high-score` value on first load.
 */
export class HighScoreStore {
  private entries: HighScoreEntry[];
  private preferredInitials: string;

  constructor() {
    const storedInitials = readLocalStorage(PREFERRED_INITIALS_KEY);
    this.preferredInitials = storedInitials ? sanitizeInitials(storedInitials) : 'YOU';
    this.entries = this.loadOrInitialize();
  }

  private loadOrInitialize(): HighScoreEntry[] {
    const raw = readLocalStorage(LEADERBOARD_STORAGE_KEY);
    const legacyRaw = readLocalStorage(LEGACY_HIGH_SCORE_KEY);
    const legacyScore = legacyRaw ? Math.floor(Number(legacyRaw)) : 0;

    let loaded: HighScoreEntry[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          loaded = parsed
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
            .map((item, idx) => ({
              id: typeof item.id === 'string' && item.id ? item.id : `loaded-${idx}`,
              initials: sanitizeInitials(typeof item.initials === 'string' ? item.initials : 'YOU'),
              score: Math.max(0, Math.floor(Number(item.score) || 0)),
              maxMultiplier: Math.max(1, Math.min(8, Math.floor(Number(item.maxMultiplier) || 1))),
              dateIso: typeof item.dateIso === 'string' ? item.dateIso : todayIsoDate(),
              isPlayer: Boolean(item.isPlayer),
            }));
        }
      } catch {
        loaded = [];
      }
    }

    if (loaded.length === 0) {
      loaded = [...DEFAULT_SEED_ENTRIES];
    }

    // Migrate legacy single high score if higher than any stored player score
    if (Number.isFinite(legacyScore) && legacyScore > 0) {
      const alreadyPresent = loaded.some((e) => e.score === legacyScore && e.isPlayer);
      const highestPlayer = loaded.reduce((max, e) => (e.isPlayer && e.score > max ? e.score : max), 0);
      if (!alreadyPresent && legacyScore > highestPlayer) {
        loaded.push({
          id: `migrated-${legacyScore}`,
          initials: this.preferredInitials,
          score: legacyScore,
          maxMultiplier: 1,
          dateIso: todayIsoDate(),
          isPlayer: true,
        });
      }
    }

    const sorted = sortAndTrim(loaded);
    this.persist(sorted);
    return sorted;
  }

  private persist(entries: readonly HighScoreEntry[]): void {
    writeLocalStorage(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries));
    const top = entries[0]?.score ?? 0;
    if (top > 0) {
      writeLocalStorage(LEGACY_HIGH_SCORE_KEY, String(top));
    }
  }

  getEntries(): readonly HighScoreEntry[] {
    return this.entries;
  }

  getTopScore(): number {
    return this.entries[0]?.score ?? 0;
  }

  getPreferredInitials(): string {
    return this.preferredInitials;
  }

  setPreferredInitials(initials: string): string {
    const clean = sanitizeInitials(initials);
    this.preferredInitials = clean;
    writeLocalStorage(PREFERRED_INITIALS_KEY, clean);
    return clean;
  }

  qualifies(score: number): boolean {
    const cleanScore = Math.floor(score);
    if (!Number.isFinite(cleanScore) || cleanScore <= 0) return false;
    if (this.entries.length < MAX_ENTRIES) return true;
    const lowest = this.entries[this.entries.length - 1]?.score ?? 0;
    return cleanScore > lowest;
  }

  recordScore(
    score: number,
    initials?: string,
    maxMultiplier = 1,
  ): RecordedHighScoreResult | null {
    const cleanScore = Math.floor(score);
    if (!this.qualifies(cleanScore)) {
      return null;
    }

    const previousTop = this.getTopScore();
    const cleanInitials = initials
      ? this.setPreferredInitials(initials)
      : this.preferredInitials;

    const entry: HighScoreEntry = {
      id: `hs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      initials: cleanInitials,
      score: cleanScore,
      maxMultiplier: Math.max(1, Math.min(8, Math.floor(maxMultiplier))),
      dateIso: todayIsoDate(),
      isPlayer: true,
    };

    this.entries = sortAndTrim([...this.entries, entry]);
    this.persist(this.entries);

    const rankIndex = this.entries.findIndex((e) => e.id === entry.id);
    if (rankIndex === -1) {
      return null;
    }

    return {
      entry,
      rank: rankIndex + 1,
      isNewBest: cleanScore > previousTop,
    };
  }

  updateEntryInitials(entryId: string, initials: string): HighScoreEntry | null {
    const clean = this.setPreferredInitials(initials);
    const idx = this.entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return null;

    const updated: HighScoreEntry = {
      ...this.entries[idx],
      initials: clean,
    };
    const copy = [...this.entries];
    copy[idx] = updated;
    this.entries = copy;
    this.persist(this.entries);
    return updated;
  }
}
