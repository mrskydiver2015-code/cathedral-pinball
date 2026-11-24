import type { AdminOverviewResponse, SocialClient } from '../game/socialClient.ts';

export interface AdminPanelOptions {
  readonly social: SocialClient;
  readonly onOpenChange: (open: boolean) => void;
}

type AdminTab = 'overview' | 'users' | 'scores' | 'audit';

const ADMIN_STYLES = `
.cp-admin-overlay {
  position: absolute;
  inset: 0;
  z-index: 90;
  display: none;
  flex-direction: column;
  background: radial-gradient(circle at 50% 0%, rgba(22, 32, 68, 0.98) 0%, rgba(5, 7, 16, 0.99) 70%);
  color: #eef2ff;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  pointer-events: auto;
  touch-action: pan-y;
  user-select: text;
  -webkit-user-select: text;
  padding: calc(12px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right))
    calc(14px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left));
  overflow: hidden;
}

.cp-admin-overlay.open {
  display: flex;
}

.cp-admin-shell {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.cp-admin-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 10px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(12, 18, 38, 0.9);
  border: 1px solid rgba(251, 191, 36, 0.35);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.45);
  flex-shrink: 0;
}

.cp-admin-brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cp-admin-kicker {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #fbbf24;
}

.cp-admin-heading {
  font-size: 17px;
  font-weight: 800;
  color: #ffffff;
}

.cp-admin-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cp-adm-btn {
  appearance: none;
  border: 1px solid rgba(148, 179, 255, 0.28);
  background: rgba(18, 27, 56, 0.9);
  color: #eef2ff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  padding: 7px 12px;
  border-radius: 9px;
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
}

.cp-adm-btn:hover {
  background: rgba(34, 50, 96, 0.95);
  border-color: rgba(125, 211, 252, 0.58);
}

.cp-adm-btn.primary {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.72), rgba(168, 85, 247, 0.72));
  border-color: rgba(196, 181, 253, 0.65);
}

.cp-adm-btn.gold {
  background: rgba(120, 53, 15, 0.62);
  border-color: rgba(251, 191, 36, 0.6);
  color: #fde68a;
}

.cp-adm-btn.danger {
  background: rgba(136, 19, 55, 0.58);
  border-color: rgba(251, 113, 133, 0.55);
  color: #ffe4e6;
}

.cp-adm-btn.small {
  font-size: 11px;
  padding: 5px 9px;
  border-radius: 7px;
}

.cp-admin-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.cp-admin-tab {
  appearance: none;
  border: 1px solid rgba(148, 179, 255, 0.2);
  background: rgba(12, 18, 38, 0.75);
  color: #94a3b8;
  font-family: inherit;
  font-size: 12px;
  font-weight: 800;
  padding: 8px 14px;
  border-radius: 10px;
  cursor: pointer;
  touch-action: manipulation;
}

.cp-admin-tab.active {
  color: #ffffff;
  background: rgba(30, 48, 96, 0.92);
  border-color: rgba(56, 189, 248, 0.65);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.2);
}

.cp-admin-body {
  flex: 1 1 auto;
  overflow-y: auto;
  touch-action: pan-y;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.cp-admin-gate {
  max-width: 420px;
  margin: 40px auto;
  padding: 22px;
  border-radius: 16px;
  background: rgba(12, 18, 38, 0.94);
  border: 1px solid rgba(251, 191, 36, 0.42);
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: center;
}

.cp-adm-input {
  width: 100%;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid rgba(148, 179, 255, 0.32);
  background: rgba(6, 10, 24, 0.92);
  color: #ffffff;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}

.cp-adm-input:focus {
  border-color: #38bdf8;
}

.cp-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.cp-kpi-card {
  padding: 13px 15px;
  border-radius: 13px;
  background: rgba(13, 20, 44, 0.86);
  border: 1px solid rgba(148, 179, 255, 0.18);
}

.cp-kpi-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.cp-kpi-val {
  margin-top: 4px;
  font-size: 24px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #ffffff;
}

.cp-kpi-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #7dd3fc;
}

.cp-adm-section {
  padding: 15px;
  border-radius: 14px;
  background: rgba(12, 18, 38, 0.86);
  border: 1px solid rgba(148, 179, 255, 0.18);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cp-adm-section-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fde68a;
}

.cp-adm-form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.cp-adm-form-row .cp-adm-input {
  flex: 1 1 180px;
}

.cp-adm-user-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.cp-adm-user-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 11px;
  background: rgba(18, 27, 56, 0.65);
  border: 1px solid rgba(148, 179, 255, 0.14);
}

.cp-adm-user-row.banned {
  border-color: rgba(244, 63, 94, 0.55);
  background: rgba(68, 14, 32, 0.45);
}

.cp-adm-user-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
}

.cp-adm-avatar {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  color: #04050b;
  flex-shrink: 0;
}

.cp-adm-name {
  font-size: 13.5px;
  font-weight: 800;
  color: #ffffff;
}

.cp-adm-sub {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.cp-adm-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
  margin-left: 5px;
  background: rgba(56, 189, 248, 0.22);
  color: #7dd3fc;
}

.cp-adm-tag.vip {
  background: rgba(251, 191, 36, 0.28);
  color: #fde68a;
}

.cp-adm-tag.banned {
  background: rgba(244, 63, 94, 0.35);
  color: #fda4af;
}

.cp-adm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cp-adm-status {
  font-size: 12px;
  color: #6ee7b7;
}

.cp-adm-status.err {
  color: #fda4af;
}

@media (max-width: 600px) {
  .cp-admin-topbar {
    padding: 10px 12px;
  }
  .cp-admin-top-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .cp-adm-status {
    margin-right: auto;
  }
  .cp-admin-heading {
    font-size: 14.5px;
  }
  .cp-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .cp-kpi-val {
    font-size: 20px;
  }
}
`;

function fmtNum(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString('en-US');
}

export class PinballAdminPanel {
  private readonly container: HTMLElement;
  private readonly social: SocialClient;
  private readonly onOpenChange: (open: boolean) => void;
  private readonly root: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly statusEl: HTMLSpanElement;
  private readonly tabBtns = new Map<AdminTab, HTMLButtonElement>();

  private openState = false;
  private authenticated = false;
  private adminKey: string;
  private activeTab: AdminTab = 'overview';
  private userSearchQuery = '';
  private overviewData: AdminOverviewResponse | null = null;
  private disposed = false;

  constructor(container: HTMLElement, options: AdminPanelOptions) {
    this.container = container;
    this.social = options.social;
    this.onOpenChange = options.onOpenChange;
    this.adminKey = this.social.getStoredAdminKey();

    const root = document.createElement('div');
    root.className = 'cp-admin-overlay';
    root.dataset.uiControl = 'true';
    root.dataset.modalCard = 'true';
    this.root = root;

    const styleEl = document.createElement('style');
    styleEl.textContent = ADMIN_STYLES;
    root.appendChild(styleEl);

    const shell = document.createElement('div');
    shell.className = 'cp-admin-shell';

    // Topbar
    const topbar = document.createElement('header');
    topbar.className = 'cp-admin-topbar';

    const brand = document.createElement('div');
    brand.className = 'cp-admin-brand';
    const kicker = document.createElement('span');
    kicker.className = 'cp-admin-kicker';
    kicker.textContent = 'Cathedral Pinball • Backoffice';
    const heading = document.createElement('span');
    heading.className = 'cp-admin-heading';
    heading.textContent = 'Administration & LiveOps';
    brand.append(kicker, heading);

    const topActions = document.createElement('div');
    topActions.className = 'cp-admin-top-actions';

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'cp-adm-status';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'cp-adm-btn small';
    refreshBtn.textContent = '↻ Uppdatera';
    refreshBtn.addEventListener('click', () => {
      void this.loadData();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cp-adm-btn primary';
    closeBtn.textContent = '← Till spelet';
    closeBtn.addEventListener('click', () => {
      this.close();
    });

    topActions.append(this.statusEl, refreshBtn, closeBtn);
    topbar.append(brand, topActions);

    // Navigation Tabs
    const tabsBar = document.createElement('nav');
    tabsBar.className = 'cp-admin-tabs';
    const tabs: Array<[AdminTab, string]> = [
      ['overview', '📊 Översikt & LiveOps'],
      ['users', '👥 Användare'],
      ['scores', '🏆 Poäng & Topplista'],
      ['audit', '📜 Logg'],
    ];

    for (const [id, label] of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = id === this.activeTab ? 'cp-admin-tab active' : 'cp-admin-tab';
      b.textContent = label;
      b.addEventListener('click', () => {
        this.activeTab = id;
        for (const [tid, btn] of this.tabBtns.entries()) {
          btn.classList.toggle('active', tid === id);
        }
        this.renderBody();
      });
      this.tabBtns.set(id, b);
      tabsBar.appendChild(b);
    }

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'cp-admin-body';

    shell.append(topbar, tabsBar, this.bodyEl);
    root.appendChild(shell);
    container.appendChild(root);
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (this.disposed) return;
    this.openState = true;
    this.root.classList.add('open');
    this.onOpenChange(true);
    void this.loadData();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.remove('open');
    this.onOpenChange(false);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('admin') || url.hash === '#admin') {
        url.searchParams.delete('admin');
        if (url.hash === '#admin') url.hash = '';
        const q = url.searchParams.toString();
        window.history.replaceState({}, '', `${url.pathname}${q ? `?${q}` : ''}${url.hash}`);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.root.parentElement === this.container) {
      this.container.removeChild(this.root);
    }
  }

  private setStatus(text: string, isError = false): void {
    this.statusEl.textContent = text;
    this.statusEl.className = isError ? 'cp-adm-status err' : 'cp-adm-status';
  }

  private async loadData(): Promise<void> {
    this.setStatus('Laddar...');
    try {
      const res = await this.social.fetchAdminOverview(this.adminKey);
      if (!res.ok) {
        this.authenticated = false;
        this.setStatus(res.error ?? 'Kräver inloggning', true);
        this.renderGate(res.error);
        return;
      }
      this.authenticated = true;
      this.overviewData = res;
      this.setStatus('Ansluten');
      this.renderBody();
    } catch {
      this.setStatus('Kunde inte nå /api/admin', true);
      this.renderGate('Nätverksfel mot /api/admin');
    }
  }

  private async runAction(payload: Record<string, unknown>, successLabel: string): Promise<void> {
    this.setStatus('Sparar...');
    try {
      const res = await this.social.performAdminAction(this.adminKey, payload);
      if (!res.ok) {
        this.setStatus(res.error ?? 'Åtgärden misslyckades', true);
        return;
      }
      this.overviewData = res;
      this.setStatus(successLabel);
      this.renderBody();
    } catch {
      this.setStatus('Nätverksfel vid sparning', true);
    }
  }

  private renderGate(errorMsg?: string): void {
    this.bodyEl.innerHTML = '';
    const gate = document.createElement('div');
    gate.className = 'cp-admin-gate';

    const title = document.createElement('div');
    title.className = 'cp-adm-section-title';
    title.textContent = '🛡️ Administratörsinloggning';

    const desc = document.createElement('div');
    desc.className = 'cp-adm-sub';
    desc.textContent = errorMsg ?? 'Ange administratörskod för att hantera användare och topplistor.';

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'cp-adm-input';
    input.placeholder = 'Admin-kod (standard: CATHEDRAL-2026)';
    input.value = this.adminKey;

    const unlockBtn = document.createElement('button');
    unlockBtn.type = 'button';
    unlockBtn.className = 'cp-adm-btn primary';
    unlockBtn.textContent = 'Logga in i Adminpanelen';
    unlockBtn.addEventListener('click', () => {
      this.adminKey = input.value.trim() || 'CATHEDRAL-2026';
      void this.loadData();
    });

    gate.append(title, desc, input, unlockBtn);
    this.bodyEl.appendChild(gate);
  }

  private renderBody(): void {
    if (!this.authenticated || !this.overviewData) {
      this.renderGate();
      return;
    }

    this.bodyEl.innerHTML = '';
    const data = this.overviewData;

    if (this.activeTab === 'overview') {
      this.renderOverviewTab(data);
    } else if (this.activeTab === 'users') {
      this.renderUsersTab(data);
    } else if (this.activeTab === 'scores') {
      this.renderScoresTab(data);
    } else {
      this.renderAuditTab(data);
    }
  }

  private renderOverviewTab(data: AdminOverviewResponse): void {
    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'cp-kpi-grid';

    const kpis: Array<[string, string, string]> = [
      ['Användare i DB', fmtNum(data.kpis.totalUsers), `${data.kpis.realPlayersCount} spelarprofiler`],
      ['Spelade omgångar', fmtNum(data.kpis.totalGames), `${data.kpis.storedScoresCount} sparade resultat`],
      ['All-Time Rekord', fmtNum(data.kpis.highestScore), data.liveConfig.doubleScoreActive ? '🔥 2x Event Aktivt' : '1x Standard'],
      ['Bannlysta / Motor', fmtNum(data.kpis.bannedCount), data.storageDriver],
    ];

    for (const [lbl, val, sub] of kpis) {
      const card = document.createElement('div');
      card.className = 'cp-kpi-card';
      const l = document.createElement('div');
      l.className = 'cp-kpi-label';
      l.textContent = lbl;
      const v = document.createElement('div');
      v.className = 'cp-kpi-val';
      v.textContent = val;
      const s = document.createElement('div');
      s.className = 'cp-kpi-sub';
      s.textContent = sub;
      card.append(l, v, s);
      kpiGrid.appendChild(card);
    }

    // LiveOps Banner & 2x Score Event Section
    const liveSec = document.createElement('section');
    liveSec.className = 'cp-adm-section';
    const liveTitle = document.createElement('div');
    liveTitle.className = 'cp-adm-section-title';
    liveTitle.textContent = '⚡ LiveOps — Meddelandebanner & Event';

    const liveRow = document.createElement('div');
    liveRow.className = 'cp-adm-form-row';

    const msgInput = document.createElement('input');
    msgInput.type = 'text';
    msgInput.className = 'cp-adm-input';
    msgInput.placeholder = 'Valfri meddelandebanner i spelet (t.ex. Helgturnering pågår!)';
    msgInput.value = data.liveConfig.announcement;

    const saveMsgBtn = document.createElement('button');
    saveMsgBtn.type = 'button';
    saveMsgBtn.className = 'cp-adm-btn primary';
    saveMsgBtn.textContent = 'Spara banner';
    saveMsgBtn.addEventListener('click', () => {
      void this.runAction(
        { action: 'updateLiveConfig', announcement: msgInput.value },
        'Banner uppdaterad',
      );
    });

    const toggle2xBtn = document.createElement('button');
    toggle2xBtn.type = 'button';
    toggle2xBtn.className = data.liveConfig.doubleScoreActive
      ? 'cp-adm-btn gold'
      : 'cp-adm-btn';
    toggle2xBtn.textContent = data.liveConfig.doubleScoreActive
      ? '🔥 2x Score Event: PÅ'
      : 'Aktivera 2x Score Event';
    toggle2xBtn.addEventListener('click', () => {
      void this.runAction(
        {
          action: 'updateLiveConfig',
          doubleScoreActive: !data.liveConfig.doubleScoreActive,
        },
        !data.liveConfig.doubleScoreActive ? '2x Event aktiverat!' : '2x Event avstängt',
      );
    });

    liveRow.append(msgInput, saveMsgBtn, toggle2xBtn);
    liveSec.append(liveTitle, liveRow);

    // Quick Create Player / Rival Section
    const createSec = document.createElement('section');
    createSec.className = 'cp-adm-section';
    const createTitle = document.createElement('div');
    createTitle.className = 'cp-adm-section-title';
    createTitle.textContent = '➕ Skapa ny spelare / utmanare i databasen';

    const createRow = document.createElement('div');
    createRow.className = 'cp-adm-form-row';

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'cp-adm-input';
    nameInp.placeholder = 'Visningsnamn (t.ex. Marcus)';

    const initInp = document.createElement('input');
    initInp.type = 'text';
    initInp.className = 'cp-adm-input';
    initInp.style.maxWidth = '96px';
    initInp.maxLength = 3;
    initInp.placeholder = 'Initialer';

    const scoreInp = document.createElement('input');
    scoreInp.type = 'number';
    scoreInp.className = 'cp-adm-input';
    scoreInp.style.maxWidth = '140px';
    scoreInp.placeholder = 'Startpoäng (valfritt)';

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'cp-adm-btn primary';
    createBtn.textContent = '+ Lägg till spelare';
    createBtn.addEventListener('click', () => {
      if (!nameInp.value.trim()) return;
      void this.runAction(
        {
          action: 'createPlayer',
          displayName: nameInp.value.trim(),
          initials: initInp.value.trim() || nameInp.value.trim().slice(0, 3),
          score: Number(scoreInp.value) || 0,
        },
        'Spelare skapad!',
      );
    });

    createRow.append(nameInp, initInp, scoreInp, createBtn);
    createSec.append(createTitle, createRow);

    this.bodyEl.append(kpiGrid, liveSec, createSec);
  }

  private renderUsersTab(data: AdminOverviewResponse): void {
    const sec = document.createElement('section');
    sec.className = 'cp-adm-section';

    const searchRow = document.createElement('div');
    searchRow.className = 'cp-adm-form-row';
    const searchInp = document.createElement('input');
    searchInp.type = 'text';
    searchInp.className = 'cp-adm-input';
    searchInp.placeholder = 'Sök på namn, initialer eller vänkod (CAT-XXXX)...';
    searchInp.value = this.userSearchQuery;
    searchInp.addEventListener('input', () => {
      this.userSearchQuery = searchInp.value;
      renderList();
    });
    searchRow.appendChild(searchInp);

    const listEl = document.createElement('div');
    listEl.className = 'cp-adm-user-list';

    const renderList = (): void => {
      listEl.innerHTML = '';
      const q = this.userSearchQuery.trim().toUpperCase();
      const filtered = data.users.filter(
        (u) =>
          !q ||
          u.displayName.toUpperCase().includes(q) ||
          u.initials.toUpperCase().includes(q) ||
          u.friendCode.toUpperCase().includes(q),
      );

      for (const u of filtered) {
        const row = document.createElement('div');
        row.className = u.banned ? 'cp-adm-user-row banned' : 'cp-adm-user-row';

        const meta = document.createElement('div');
        meta.className = 'cp-adm-user-meta';

        const avatar = document.createElement('div');
        avatar.className = 'cp-adm-avatar';
        avatar.style.background = u.avatarColor;
        avatar.textContent = u.initials;

        const textWrap = document.createElement('div');
        const nameLine = document.createElement('div');
        nameLine.className = 'cp-adm-name';
        nameLine.textContent = u.displayName;

        const codeTag = document.createElement('span');
        codeTag.className = 'cp-adm-tag';
        codeTag.textContent = u.friendCode;
        nameLine.appendChild(codeTag);

        if (u.role === 'vip') {
          const vipTag = document.createElement('span');
          vipTag.className = 'cp-adm-tag vip';
          vipTag.textContent = 'VIP';
          nameLine.appendChild(vipTag);
        }
        if (u.banned) {
          const banTag = document.createElement('span');
          banTag.className = 'cp-adm-tag banned';
          banTag.textContent = 'Banned';
          nameLine.appendChild(banTag);
        }

        const subLine = document.createElement('div');
        subLine.className = 'cp-adm-sub';
        subLine.textContent = `Bästa: ${fmtNum(u.bestScore)} (${u.bestMultiplier}x) • Matcher: ${u.gamesPlayed} • Vänner: ${u.friendIds.length}`;

        textWrap.append(nameLine, subLine);
        meta.append(avatar, textWrap);

        const actions = document.createElement('div');
        actions.className = 'cp-adm-actions';

        const vipBtn = document.createElement('button');
        vipBtn.type = 'button';
        vipBtn.className = 'cp-adm-btn small gold';
        vipBtn.textContent = u.role === 'vip' ? 'Ta bort VIP' : 'Gör VIP';
        vipBtn.addEventListener('click', () => {
          void this.runAction(
            {
              action: 'editUser',
              userId: u.userId,
              role: u.role === 'vip' ? 'player' : 'vip',
            },
            'Roll uppdaterad',
          );
        });

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'cp-adm-btn small';
        resetBtn.textContent = 'Nollställ poäng';
        resetBtn.addEventListener('click', () => {
          void this.runAction(
            { action: 'resetUserScore', userId: u.userId },
            'Poäng nollställd',
          );
        });

        const banBtn = document.createElement('button');
        banBtn.type = 'button';
        banBtn.className = u.banned ? 'cp-adm-btn small primary' : 'cp-adm-btn small danger';
        banBtn.textContent = u.banned ? 'Avbanna' : 'Banna';
        banBtn.addEventListener('click', () => {
          void this.runAction(
            { action: 'toggleBan', userId: u.userId },
            u.banned ? 'Spelare återaktiverad' : 'Spelare bannlyst',
          );
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cp-adm-btn small danger';
        delBtn.textContent = 'Radera';
        delBtn.addEventListener('click', () => {
          void this.runAction({ action: 'deleteUser', userId: u.userId }, 'Spelare raderad');
        });

        actions.append(vipBtn, resetBtn, banBtn, delBtn);
        row.append(meta, actions);
        listEl.appendChild(row);
      }
    };

    renderList();
    sec.append(searchRow, listEl);
    this.bodyEl.appendChild(sec);
  }

  private renderScoresTab(data: AdminOverviewResponse): void {
    const sec = document.createElement('section');
    sec.className = 'cp-adm-section';
    const title = document.createElement('div');
    title.className = 'cp-adm-section-title';
    title.textContent = `🏆 Registrerade poängposter (${data.recentScores.length})`;
    sec.appendChild(title);

    const listEl = document.createElement('div');
    listEl.className = 'cp-adm-user-list';

    for (const s of data.recentScores) {
      const row = document.createElement('div');
      row.className = 'cp-adm-user-row';

      const info = document.createElement('div');
      const top = document.createElement('div');
      top.className = 'cp-adm-name';
      top.textContent = `${fmtNum(s.score)} pts — ${s.displayName} (${s.initials})`;
      const sub = document.createElement('div');
      sub.className = 'cp-adm-sub';
      sub.textContent = `${s.friendCode} • Max ${s.maxMultiplier}x • ${s.createdAt.slice(0, 19).replace('T', ' ')}`;
      info.append(top, sub);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'cp-adm-btn small danger';
      delBtn.textContent = 'Ta bort poäng';
      delBtn.addEventListener('click', () => {
        void this.runAction({ action: 'deleteScore', scoreId: s.id }, 'Poängpost borttagen');
      });

      row.append(info, delBtn);
      listEl.appendChild(row);
    }

    sec.appendChild(listEl);
    this.bodyEl.appendChild(sec);
  }

  private renderAuditTab(data: AdminOverviewResponse): void {
    const sec = document.createElement('section');
    sec.className = 'cp-adm-section';
    const title = document.createElement('div');
    title.className = 'cp-adm-section-title';
    title.textContent = '📜 Senaste händelser i databasen';
    sec.appendChild(title);

    const listEl = document.createElement('div');
    listEl.className = 'cp-adm-user-list';

    for (const log of data.auditLogs) {
      const row = document.createElement('div');
      row.className = 'cp-adm-user-row';
      const info = document.createElement('div');
      const top = document.createElement('div');
      top.className = 'cp-adm-name';
      top.textContent = `${log.action} → ${log.target}`;
      const sub = document.createElement('div');
      sub.className = 'cp-adm-sub';
      sub.textContent = `${log.createdAt.slice(0, 19).replace('T', ' ')} • av ${log.actor} ${log.details ? `• ${log.details}` : ''}`;
      info.append(top, sub);
      row.appendChild(info);
      listEl.appendChild(row);
    }

    sec.appendChild(listEl);
    this.bodyEl.appendChild(sec);
  }
}
