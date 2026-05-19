const WIN_INDEX = 88;
const REEL_LENGTH = 126;
const ROLL_DURATION_MS = 7450;
const RESULT_REVEAL_DELAY_MS = 100;

const state = {
  user: null,
  inventory: [],
  cases: [],
  rarities: [],
  rarityMap: {},
  selectedCaseId: localStorage.getItem('selectedCaseId') || '',
  rolling: false,
  selectedTradeUser: null,
  targetInventory: [],
  offerItems: new Set(),
  requestItems: new Set()
};

const $ = id => document.getElementById(id);
const els = {
  authView: $('authView'), appView: $('appView'), authForm: $('authForm'), registerButton: $('registerButton'), authUsername: $('authUsername'), authPassword: $('authPassword'),
  balanceText: $('balanceText'), inventoryValueText: $('inventoryValueText'), openedText: $('openedText'), usernameText: $('usernameText'), logoutButton: $('logoutButton'),
  caseSearchInput: $('caseSearchInput'), caseDataText: $('caseDataText'), caseList: $('caseList'), openButton: $('openButton'), stageTitle: $('stageTitle'), stageSubtext: $('stageSubtext'), ticker: $('ticker'), resultBox: $('resultBox'), soundNote: $('soundNote'),
  inventorySearch: $('inventorySearch'), rarityFilter: $('rarityFilter'), sortSelect: $('sortSelect'), sellAllButton: $('sellAllButton'), inventoryGrid: $('inventoryGrid'),
  tradeUserSearch: $('tradeUserSearch'), userSearchResults: $('userSearchResults'), selectedTradeUser: $('selectedTradeUser'), fromMoneyInput: $('fromMoneyInput'), toMoneyInput: $('toMoneyInput'), tradeOwnItems: $('tradeOwnItems'), tradeTargetItems: $('tradeTargetItems'), createTradeButton: $('createTradeButton'), refreshTradesButton: $('refreshTradesButton'), tradeList: $('tradeList'),
  leaderboardSort: $('leaderboardSort'), refreshLeaderboardButton: $('refreshLeaderboardButton'), leaderboardList: $('leaderboardList'),
  dailyButton: $('dailyButton'), jobButton: $('jobButton'), achievementList: $('achievementList'), historyList: $('historyList'),
  oddsButton: $('oddsButton'), oddsModal: $('oddsModal'), closeOddsButton: $('closeOddsButton'), oddsGrid: $('oddsGrid'), toastWrap: $('toastWrap')
};

const START_SOUND_FILE = 'Case Unlock.mp3';
const TICK_SOUND_FILE = 'csgo_ui_crate_item_scroll.wav';
const START_SOUND_FALLBACK_DURATION_MS = 3196;
const REVEAL_SOUND_FILES = {
  milspec: 'case_reveal_rare_01.wav',
  restricted: 'case_reveal_mythical_01.wav',
  classified: 'case_reveal_legendary_01.wav',
  covert: 'case_reveal_ancient_01.wav',
  special: 'case_reveal_ancient_01.wav'
};

const audio = createAudioController();

function createAudioController() {
  const startSound = new Audio(START_SOUND_FILE);
  startSound.preload = 'auto';
  startSound.volume = 0.74;

  const tickPoolSize = 16;
  const tickPool = Array.from({ length: tickPoolSize }, () => {
    const sound = new Audio(TICK_SOUND_FILE);
    sound.preload = 'auto';
    sound.volume = 0.48;
    return sound;
  });

  const revealSounds = Object.fromEntries(Object.entries(REVEAL_SOUND_FILES).map(([rarity, src]) => {
    const sound = new Audio(src);
    sound.preload = 'auto';
    sound.volume = rarity === 'special' || rarity === 'covert' ? 0.84 : 0.74;
    return [rarity, sound];
  }));

  let tickPoolIndex = 0;
  let scheduledTicks = [];

  return {
    prepare() {
      startSound.load();
      for (const sound of tickPool) sound.load();
      for (const sound of Object.values(revealSounds)) sound.load();
    },

    playStartIntro() {
      return new Promise(resolve => {
        let finished = false;
        let sound;
        let timeout;

        const finish = () => {
          if (finished) return;
          finished = true;
          if (timeout) clearTimeout(timeout);
          if (sound) {
            sound.onended = null;
            sound.onerror = null;
          }
          resolve();
        };

        try {
          sound = startSound.cloneNode(true);
          sound.volume = startSound.volume;
          sound.currentTime = 0;
          sound.onended = finish;
          sound.onerror = finish;

          const knownDuration = Number.isFinite(startSound.duration) && startSound.duration > 0
            ? startSound.duration * 1000
            : START_SOUND_FALLBACK_DURATION_MS;
          timeout = setTimeout(finish, knownDuration + 160);

          const playPromise = sound.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(finish);
          }
        } catch {
          const fallback = new Audio(START_SOUND_FILE);
          fallback.volume = 0.74;
          fallback.onended = finish;
          fallback.onerror = finish;
          timeout = setTimeout(finish, START_SOUND_FALLBACK_DURATION_MS + 160);
          fallback.play().catch(finish);
          sound = fallback;
        }
      });
    },

    clearScheduledTicks() {
      for (const timer of scheduledTicks) clearTimeout(timer);
      scheduledTicks = [];
    },

    scheduleTick(delayMs) {
      const timer = setTimeout(() => this.playTick(), Math.max(0, delayMs));
      scheduledTicks.push(timer);
    },

    scheduleReelTicks({ targetTranslate, step, wrapWidth }) {
      this.clearScheduledTicks();

      const reelDistance = -targetTranslate;
      if (reelDistance <= 0 || step <= 0) return;

      const startMarker = wrapWidth / 2;
      const endMarker = startMarker + reelDistance;
      const firstBoundaryIndex = Math.floor(startMarker / step) + 1;
      const lastBoundaryIndex = Math.min(Math.floor(endMarker / step), REEL_LENGTH - 1);

      for (let index = firstBoundaryIndex; index <= lastBoundaryIndex; index++) {
        const boundaryPosition = index * step;
        const easedProgress = (boundaryPosition - startMarker) / reelDistance;
        if (easedProgress <= 0 || easedProgress >= 1) continue;

        // Inverse of easeOutQuint: eased = 1 - (1 - progress)^5
        const rawProgress = 1 - Math.pow(1 - easedProgress, 1 / 5);
        const delay = rawProgress * ROLL_DURATION_MS;
        this.scheduleTick(delay);
      }
    },

    playTick() {
      const sound = tickPool[tickPoolIndex];
      tickPoolIndex = (tickPoolIndex + 1) % tickPool.length;

      try {
        sound.pause();
        sound.currentTime = 0;
        sound.play().catch(() => {});
      } catch {
        const fallback = new Audio(TICK_SOUND_FILE);
        fallback.volume = 0.48;
        fallback.play().catch(() => {});
      }
    },

    playReveal(rarityId) {
      const src = REVEAL_SOUND_FILES[rarityId] || REVEAL_SOUND_FILES.milspec;
      const base = revealSounds[rarityId] || revealSounds.milspec;

      try {
        const sound = base.cloneNode(true);
        sound.volume = base.volume;
        sound.play().catch(() => {});
      } catch {
        const fallback = new Audio(src);
        fallback.volume = rarityId === 'special' || rarityId === 'covert' ? 0.84 : 0.74;
        fallback.play().catch(() => {});
      }
    }
  };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function money(value) {
  const n = Number(value) || 0;
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function hexToRgba(hex, alpha) {
  const cleaned = String(hex).replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rarityVars(rarityId) {
  const rarity = state.rarityMap[rarityId] || state.rarityMap.milspec || { color: '#777' };
  return `--rarityColor:${rarity.color};--rarityGlow:${hexToRgba(rarity.color, 0.34)};`;
}

function rarityLabel(rarityId) {
  return state.rarityMap[rarityId]?.short || rarityId;
}

function showAuth() {
  els.authView.classList.remove('hidden');
  els.appView.classList.add('hidden');
}

function showApp() {
  els.authView.classList.add('hidden');
  els.appView.classList.remove('hidden');
}

async function boot() {
  bindEvents();
  try {
    const me = await api('/api/me');
    state.user = me.user;
    state.inventory = me.inventory || [];
    showApp();
    await loadCases();
    await refreshAll();
  } catch {
    showAuth();
  }
}

async function loginOrRegister(mode) {
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;
  const data = await api(`/api/${mode}`, { method: 'POST', body: JSON.stringify({ username, password }) });
  state.user = data.user;
  state.inventory = data.inventory || [];
  showApp();
  await loadCases();
  await refreshAll();
  toast(mode === 'register' ? 'Registered' : 'Logged in', `Welcome, ${state.user.username}.`);
}

async function loadCases() {
  els.caseDataText.textContent = 'Loading case data...';
  const data = await api('/api/cases');
  state.cases = data.cases || [];
  state.rarities = data.rarities || [];
  state.rarityMap = Object.fromEntries(state.rarities.map(r => [r.id, r]));
  if (!state.selectedCaseId || !state.cases.some(c => c.id === state.selectedCaseId)) {
    const fever = state.cases.find(c => c.name === 'Fever Case');
    state.selectedCaseId = (fever || state.cases[0])?.id || '';
  }
  localStorage.setItem('selectedCaseId', state.selectedCaseId);
  renderRarityFilter();
  renderCases();
  renderStage();
  renderOdds();
}

async function refreshMe() {
  const data = await api('/api/me');
  state.user = data.user;
  state.inventory = data.inventory || [];
  renderStats();
  renderInventory();
  renderTradeOwnItems();
  updateEarnButtons();
}

async function refreshAll() {
  await refreshMe();
  renderCases();
  renderStage();
  await Promise.allSettled([loadAchievements(), loadHistory(), loadLeaderboard(), loadTrades()]);
}

function getSelectedCase() {
  return state.cases.find(c => c.id === state.selectedCaseId) || state.cases[0] || null;
}

function renderStats() {
  if (!state.user) return;
  els.balanceText.textContent = money(state.user.balance);
  els.inventoryValueText.textContent = money(state.user.inventory_value);
  els.openedText.textContent = Number(state.user.cases_opened || 0).toLocaleString();
  els.usernameText.textContent = state.user.username;
}

function renderCases() {
  const search = els.caseSearchInput.value.trim().toLowerCase();
  const cases = state.cases.filter(c => !search || c.name.toLowerCase().includes(search));
  els.caseDataText.textContent = `${state.cases.length} weapon cases loaded with real item pools and icon URLs.`;
  if (!cases.length) {
    els.caseList.innerHTML = '<div class="empty-state">No cases found.</div>';
    return;
  }
  els.caseList.innerHTML = cases.map(c => `
    <article class="case-card ${c.id === state.selectedCaseId ? 'selected' : ''}" style="--caseGlow:${c.id === state.selectedCaseId ? 'rgba(255,255,255,.11)' : 'rgba(255,255,255,.055)'}">
      <div class="case-top">
        <div class="case-icon"><img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" loading="lazy"></div>
        <div class="case-info">
          <h3>${escapeHtml(c.name)}</h3>
          <p>${escapeHtml(c.description)}</p>
          <div class="price">${money(c.price)} fake balance</div>
        </div>
      </div>
      <div class="case-actions">
        <button class="ghost ${c.id === state.selectedCaseId ? 'active' : ''}" data-select-case="${escapeHtml(c.id)}">${c.id === state.selectedCaseId ? 'Selected' : 'Select'}</button>
        <button class="primary" data-open-case="${escapeHtml(c.id)}">Open</button>
      </div>
    </article>
  `).join('');
  document.querySelectorAll('[data-select-case]').forEach(btn => btn.addEventListener('click', () => {
    state.selectedCaseId = btn.dataset.selectCase;
    localStorage.setItem('selectedCaseId', state.selectedCaseId);
    renderCases();
    renderStage();
  }));
  document.querySelectorAll('[data-open-case]').forEach(btn => btn.addEventListener('click', () => {
    state.selectedCaseId = btn.dataset.openCase;
    localStorage.setItem('selectedCaseId', state.selectedCaseId);
    renderCases();
    renderStage();
    openCase();
  }));
}

function renderStage() {
  const c = getSelectedCase();
  if (!c) {
    els.stageTitle.textContent = 'Open a Case';
    els.stageSubtext.textContent = 'No case loaded.';
    els.openButton.disabled = true;
    return;
  }
  els.stageTitle.textContent = `Open ${c.name}`;
  els.stageSubtext.textContent = `${money(c.price)} per open. Server-side roll with loaded item icons.`;
  els.openButton.textContent = state.rolling ? 'Opening...' : `Open ${c.name}`;
  els.openButton.disabled = state.rolling || !state.user || Number(state.user.balance) < Number(c.price);
}

function renderRarityFilter() {
  const selected = els.rarityFilter.value || 'all';
  els.rarityFilter.innerHTML = '<option value="all">All rarities</option>' + state.rarities.map(r => `<option value="${r.id}">${r.short}</option>`).join('');
  els.rarityFilter.value = selected;
}

function renderInventory() {
  const search = els.inventorySearch.value.trim().toLowerCase();
  const rarity = els.rarityFilter.value;
  const sort = els.sortSelect.value;
  let items = [...state.inventory];
  if (search) items = items.filter(i => i.name.toLowerCase().includes(search) || i.case_name.toLowerCase().includes(search));
  if (rarity !== 'all') items = items.filter(i => i.rarity === rarity);
  items.sort((a, b) => {
    if (sort === 'valueDesc') return Number(b.value) - Number(a.value);
    if (sort === 'valueAsc') return Number(a.value) - Number(b.value);
    if (sort === 'rarityDesc') return (state.rarityMap[b.rarity]?.rank || 0) - (state.rarityMap[a.rarity]?.rank || 0) || Number(b.value) - Number(a.value);
    return new Date(b.created_at) - new Date(a.created_at);
  });
  els.sellAllButton.disabled = !state.inventory.length;
  if (!items.length) {
    els.inventoryGrid.innerHTML = '<div class="empty-state">No items found.</div>';
    return;
  }
  els.inventoryGrid.innerHTML = items.map(item => `
    <article class="skin-card" style="${rarityVars(item.rarity)}">
      <div class="skin-art"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy"></div>
      <h3>${escapeHtml(item.name)}</h3>
      <div class="skin-meta"><span>${rarityLabel(item.rarity)}</span><strong>${money(item.value)}</strong></div>
      <p class="note">${escapeHtml(item.case_name)}</p>
      <div class="skin-actions"><button class="success" data-sell-item="${item.id}">Sell</button></div>
    </article>
  `).join('');
  document.querySelectorAll('[data-sell-item]').forEach(btn => btn.addEventListener('click', () => sellItem(btn.dataset.sellItem)));
}

function pickRarity(caseData) {
  const available = new Set(Object.keys(caseData.itemsByRarity || {}));
  if (caseData.specials?.length) available.add('special');
  for (let attempt = 0; attempt < 20; attempt++) {
    const total = state.rarities.reduce((sum, r) => sum + Number(r.odds), 0);
    let roll = Math.random() * total;
    for (const r of state.rarities) {
      roll -= Number(r.odds);
      if (roll <= 0 && available.has(r.id)) return r.id;
    }
  }
  return available.has('milspec') ? 'milspec' : [...available][0];
}

function randomDisplayItem(caseData) {
  const rarity = pickRarity(caseData);
  const pool = rarity === 'special' ? caseData.specials : caseData.itemsByRarity[rarity];
  return { ...pool[Math.floor(Math.random() * pool.length)], id: crypto.randomUUID() };
}

function renderReel(caseData, wonItem) {
  const items = [];
  for (let i = 0; i < REEL_LENGTH; i++) items.push(i === WIN_INDEX ? wonItem : randomDisplayItem(caseData));
  els.ticker.style.transform = 'translateX(0px)';
  els.ticker.innerHTML = items.map((item, index) => `
    <div class="roll-card ${index === WIN_INDEX ? 'win' : ''}" style="${rarityVars(item.rarity)}">
      <img class="item-img" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="eager">
      <div class="roll-name">${escapeHtml(item.name)}</div>
      <div class="roll-rarity">${rarityLabel(item.rarity)}</div>
    </div>
  `).join('');
}

async function openCase() {
  if (state.rolling) return;
  const caseData = getSelectedCase();
  if (!caseData) return;
  try {
    state.rolling = true;
    renderStage();
    audio.prepare();

    // Play the unlock sound first, then start the item reel immediately after it ends.
    // The server roll is requested during the unlock sound so there is no extra gap.
    const rollPromise = api('/api/open', { method: 'POST', body: JSON.stringify({ caseId: caseData.id }) });
    const introPromise = audio.playStartIntro();
    const [rollResult] = await Promise.allSettled([rollPromise, introPromise]);

    if (rollResult.status === 'rejected') throw rollResult.reason;

    const data = rollResult.value;
    renderReel(caseData, data.item);
    state.user = data.user;
    state.inventory = data.inventory || state.inventory;
    renderStats();
    renderInventory();
    requestAnimationFrame(() => animateReel(caseData, data.item));
  } catch (error) {
    state.rolling = false;
    audio.clearScheduledTicks();
    renderStage();
    toast('Could not open case', error.message);
  }
}

function animateReel(caseData, item) {
  const card = els.ticker.querySelector('.roll-card');
  const wrap = els.ticker.parentElement;
  const cardWidth = card.offsetWidth;
  const step = cardWidth + 10;
  const targetCenter = WIN_INDEX * step + cardWidth / 2;
  const nudge = Math.round((Math.random() - 0.5) * (cardWidth * 0.28));
  const targetTranslate = wrap.clientWidth / 2 - targetCenter + nudge;
  const start = performance.now();
  audio.scheduleReelTicks({ targetTranslate, step, wrapWidth: wrap.clientWidth });

  function frame(now) {
    const progress = Math.min(1, (now - start) / ROLL_DURATION_MS);
    const eased = 1 - Math.pow(1 - progress, 5);
    els.ticker.style.transform = `translateX(${targetTranslate * eased}px)`;
    if (progress < 1) return requestAnimationFrame(frame);
    setTimeout(() => finishOpen(item), RESULT_REVEAL_DELAY_MS);
  }
  requestAnimationFrame(frame);
}

function finishOpen(item) {
  state.rolling = false;
  audio.clearScheduledTicks();
  renderStage();
  renderResult(item);
  refreshAll();
  audio.playReveal(item.rarity);
  showDropReveal(item);
  toast('Item unboxed', `${item.name} • ${rarityLabel(item.rarity)} • ${money(item.value)}`);
}

function showDropReveal(item) {
  const rarity = state.rarityMap[item.rarity] || {};
  const rarityRank = Number(rarity.rank || 1);
  const backdrop = document.createElement('div');
  backdrop.className = `drop-reveal rank-${rarityRank}`;
  backdrop.style.cssText = rarityVars(item.rarity);

  const sparks = Array.from({ length: rarityRank >= 4 ? 24 : 14 }, (_, i) => {
    const angle = Math.round((360 / (rarityRank >= 4 ? 24 : 14)) * i);
    const distance = 110 + Math.round(Math.random() * 90);
    const delay = Math.round(Math.random() * 180);
    return `<span class="spark" style="--angle:${angle}deg;--distance:${distance}px;--delay:${delay}ms"></span>`;
  }).join('');

  backdrop.innerHTML = `
    <div class="drop-card">
      <div class="drop-rays"></div>
      <div class="spark-layer">${sparks}</div>
      <div class="drop-art"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}"></div>
      <div class="drop-copy">
        <span class="drop-label">You unboxed</span>
        <h2>${escapeHtml(item.name)}</h2>
        <div class="rarity-pill" style="${rarityVars(item.rarity)}">${escapeHtml(rarity.label || item.rarity)}</div>
        <p>${money(item.value)} fake sell value</p>
      </div>
      <button class="ghost drop-close" type="button">Continue</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  const close = () => {
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 260);
  };

  backdrop.querySelector('.drop-close').addEventListener('click', close);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) close();
  });
  setTimeout(close, rarityRank >= 4 ? 6200 : 4700);
}

function renderResult(item) {
  const rarity = state.rarityMap[item.rarity];
  const rank = Number(rarity?.rank || 1);
  els.resultBox.className = `result-box result-rank-${rank}`;
  els.resultBox.style.cssText = rarityVars(item.rarity);
  els.resultBox.innerHTML = `
    <div class="result-art"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}"></div>
    <div class="result-details">
      <span class="result-kicker">New item added to inventory</span>
      <h2>${escapeHtml(item.name)}</h2>
      <div class="rarity-pill" style="${rarityVars(item.rarity)}">${escapeHtml(rarity?.label || item.rarity)}</div>
      <p class="value-line">Fake sell value: <strong>${money(item.value)}</strong><br>${escapeHtml(item.caseName)}</p>
    </div>
    <div class="result-actions">
      <button class="success" data-sell-item="${item.id}">Sell Now</button>
      <button class="ghost" data-keep-item>Keep</button>
    </div>
  `;
  els.resultBox.querySelector('[data-sell-item]').addEventListener('click', () => sellItem(item.id));
  els.resultBox.querySelector('[data-keep-item]').addEventListener('click', () => toast('Kept', 'Item stayed in your inventory.'));
}

async function sellItem(itemId) {
  try {
    const data = await api('/api/sell', { method: 'POST', body: JSON.stringify({ itemId }) });
    state.user = data.user;
    state.inventory = data.inventory;
    renderStats(); renderInventory(); renderTradeOwnItems();
    toast('Sold', 'Item sold for fake balance.');
  } catch (error) { toast('Could not sell', error.message); }
}

async function sellAll() {
  try {
    const data = await api('/api/sell-all', { method: 'POST' });
    state.user = data.user;
    state.inventory = data.inventory;
    renderStats(); renderInventory(); renderTradeOwnItems();
    toast('Inventory sold', `${data.sold} items sold for ${money(data.total)}.`);
  } catch (error) { toast('Could not sell inventory', error.message); }
}

async function doEarn(type) {
  try {
    const data = await api(`/api/earn/${type}`, { method: 'POST' });
    state.user = data.user;
    renderStats(); updateEarnButtons();
    toast(type === 'daily' ? 'Daily claimed' : 'Job complete', 'Fake balance added.');
  } catch (error) { toast('Not ready', error.message); }
}

function updateEarnButtons() {
  if (!state.user) return;
  const now = Date.now();
  const dailyLeft = Math.max(0, 24 * 60 * 60 * 1000 - (now - (state.user.last_daily ? new Date(state.user.last_daily).getTime() : 0)));
  const jobLeft = Math.max(0, 60 * 1000 - (now - (state.user.last_job ? new Date(state.user.last_job).getTime() : 0)));
  els.dailyButton.disabled = dailyLeft > 0;
  els.jobButton.disabled = jobLeft > 0;
  els.dailyButton.textContent = dailyLeft ? `Daily ready in ${formatTime(dailyLeft)}` : 'Claim Daily +$350';
  els.jobButton.textContent = jobLeft ? `Job ready in ${formatTime(jobLeft)}` : 'Do Job +$85';
}

function formatTime(ms) {
  const seconds = Math.ceil(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

async function loadAchievements() {
  const data = await api('/api/achievements');
  els.achievementList.innerHTML = data.achievements.map(a => `
    <article class="achievement ${a.claimed ? 'claimed' : ''}">
      <div class="badge-icon">${a.icon}</div>
      <div><h3>${escapeHtml(a.title)}</h3><p class="note">${escapeHtml(a.description)} Reward: ${money(a.reward)}</p></div>
      <button class="${a.ready && !a.claimed ? 'success' : 'ghost'}" data-claim-ach="${a.id}" ${!a.ready || a.claimed ? 'disabled' : ''}>${a.claimed ? 'Claimed' : a.ready ? 'Claim' : 'Locked'}</button>
    </article>
  `).join('');
  document.querySelectorAll('[data-claim-ach]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const data = await api(`/api/achievements/${btn.dataset.claimAch}/claim`, { method: 'POST' });
      state.user = data.user; renderStats(); await loadAchievements(); toast('Achievement claimed', 'Reward added.');
    } catch (error) { toast('Could not claim', error.message); }
  }));
}

async function loadHistory() {
  const data = await api('/api/history');
  if (!data.history.length) { els.historyList.innerHTML = '<div class="empty-state">No history yet.</div>'; return; }
  els.historyList.innerHTML = data.history.map(h => `
    <article class="history-item" style="${rarityVars(h.rarity)}">
      <div class="history-icon">${h.image ? `<img src="${escapeHtml(h.image)}" alt="">` : ''}</div>
      <div><strong>${escapeHtml(h.name)}</strong><p class="note">${escapeHtml(h.action)} • ${escapeHtml(h.case_name || 'System')}</p></div>
      <strong>${money(h.amount)}</strong>
    </article>
  `).join('');
}

async function loadLeaderboard() {
  const data = await api(`/api/leaderboard?sort=${encodeURIComponent(els.leaderboardSort.value)}`);
  els.leaderboardList.innerHTML = data.leaderboard.map((row, i) => `
    <article class="leader-row">
      <div class="rank">${i + 1}</div>
      <div><strong>${escapeHtml(row.username)}</strong><p class="note">Best: ${escapeHtml(row.best_pull_name || 'None')}</p></div>
      <strong>Total ${money(row.total_value)}</strong>
      <span>Bal ${money(row.balance)}</span>
      <span>Inv ${money(row.inventory_value)}</span>
      <span>${Number(row.cases_opened).toLocaleString()} cases</span>
    </article>
  `).join('') || '<div class="empty-state">No players yet.</div>';
}

async function searchUsers() {
  const q = els.tradeUserSearch.value.trim();
  if (!q) { els.userSearchResults.innerHTML = ''; return; }
  const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  els.userSearchResults.innerHTML = data.users.map(u => `<button class="pill" data-trade-user="${escapeHtml(u.username)}">${escapeHtml(u.username)}</button>`).join('') || '<span class="note">No users found.</span>';
  document.querySelectorAll('[data-trade-user]').forEach(btn => btn.addEventListener('click', () => selectTradeUser(btn.dataset.tradeUser)));
}

async function selectTradeUser(username) {
  try {
    const data = await api(`/api/users/${encodeURIComponent(username)}/inventory`);
    state.selectedTradeUser = data.user;
    state.targetInventory = data.inventory || [];
    state.requestItems.clear();
    els.selectedTradeUser.textContent = `Trading with ${data.user.username}`;
    renderTradeTargetItems();
  } catch (error) { toast('Could not load user', error.message); }
}

function renderTradeOwnItems() {
  els.tradeOwnItems.innerHTML = renderMiniItems(state.inventory, state.offerItems, 'offer') || '<div class="empty-state">No items.</div>';
  document.querySelectorAll('[data-offer-item]').forEach(btn => btn.addEventListener('click', () => toggleSet(state.offerItems, btn.dataset.offerItem, renderTradeOwnItems)));
}

function renderTradeTargetItems() {
  els.tradeTargetItems.innerHTML = renderMiniItems(state.targetInventory, state.requestItems, 'request') || '<div class="empty-state">No target items.</div>';
  document.querySelectorAll('[data-request-item]').forEach(btn => btn.addEventListener('click', () => toggleSet(state.requestItems, btn.dataset.requestItem, renderTradeTargetItems)));
}

function renderMiniItems(items, selectedSet, mode) {
  return items.map(item => `
    <div class="mini-item ${selectedSet.has(item.id) ? 'selected' : ''}" style="${rarityVars(item.rarity)}" data-${mode}-item="${item.id}">
      <img src="${escapeHtml(item.image)}" alt="">
      <div><strong>${escapeHtml(item.name)}</strong><small>${rarityLabel(item.rarity)} • ${money(item.value)}</small></div>
      <span>${selectedSet.has(item.id) ? '✓' : '+'}</span>
    </div>
  `).join('');
}

function toggleSet(set, id, renderFn) {
  if (set.has(id)) set.delete(id); else set.add(id);
  renderFn();
}

async function createTrade() {
  if (!state.selectedTradeUser) return toast('No player selected', 'Search and choose a player first.');
  try {
    await api('/api/trades', { method: 'POST', body: JSON.stringify({
      toUsername: state.selectedTradeUser.username,
      fromItemIds: [...state.offerItems],
      toItemIds: [...state.requestItems],
      fromMoney: Number(els.fromMoneyInput.value || 0),
      toMoney: Number(els.toMoneyInput.value || 0)
    }) });
    state.offerItems.clear(); state.requestItems.clear(); els.fromMoneyInput.value = 0; els.toMoneyInput.value = 0;
    renderTradeOwnItems(); renderTradeTargetItems(); await loadTrades();
    toast('Trade sent', `Trade request sent to ${state.selectedTradeUser.username}.`);
  } catch (error) { toast('Could not create trade', error.message); }
}

async function loadTrades() {
  const data = await api('/api/trades');
  if (!data.trades.length) { els.tradeList.innerHTML = '<div class="empty-state">No trades yet.</div>'; return; }
  els.tradeList.innerHTML = data.trades.map(t => `
    <article class="trade-card">
      <h4>${escapeHtml(t.fromUsername)} → ${escapeHtml(t.toUsername)} <span class="note">${escapeHtml(t.status)}</span></h4>
      <p class="note">Offer: ${money(t.fromMoney)} ${chips(t.itemsFrom)} </p>
      <p class="note">Request: ${money(t.toMoney)} ${chips(t.itemsTo)} </p>
      <div class="toolbar" style="margin:10px 0 0;">
        ${t.canAccept ? `<button class="success" data-accept-trade="${t.id}">Accept</button>` : ''}
        ${t.canCancel ? `<button class="ghost" data-cancel-trade="${t.id}">Cancel</button>` : ''}
      </div>
    </article>
  `).join('');
  document.querySelectorAll('[data-accept-trade]').forEach(btn => btn.addEventListener('click', () => tradeAction(btn.dataset.acceptTrade, 'accept')));
  document.querySelectorAll('[data-cancel-trade]').forEach(btn => btn.addEventListener('click', () => tradeAction(btn.dataset.cancelTrade, 'cancel')));
}

function chips(items) {
  if (!items.length) return '';
  return `<span class="trade-items">${items.map(i => `<span class="trade-chip"><img src="${escapeHtml(i.image)}" alt="">${escapeHtml(i.name)} ${money(i.value)}</span>`).join('')}</span>`;
}

async function tradeAction(id, action) {
  try {
    await api(`/api/trades/${id}/${action}`, { method: 'POST' });
    await refreshAll();
    toast(action === 'accept' ? 'Trade accepted' : 'Trade cancelled', 'Trade list updated.');
  } catch (error) { toast('Trade failed', error.message); }
}

function renderOdds() {
  els.oddsGrid.innerHTML = state.rarities.map(r => `
    <article class="odds-card" style="${rarityVars(r.id)}">
      <strong>${escapeHtml(r.short)}</strong>
      <span>${r.odds}% chance</span>
      <span>${escapeHtml(r.label)}</span>
    </article>
  `).join('');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
  document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));
  $(`${tabName}Tab`).classList.remove('hidden');
  if (tabName === 'leaderboard') loadLeaderboard();
  if (tabName === 'trading') { renderTradeOwnItems(); loadTrades(); }
  if (tabName === 'history') loadHistory();
  if (tabName === 'achievements') loadAchievements();
}

function toast(title, message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
  els.toastWrap.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); }, 3360);
}

function bindEvents() {
  els.authForm.addEventListener('submit', e => { e.preventDefault(); loginOrRegister('login').catch(err => toast('Login failed', err.message)); });
  els.registerButton.addEventListener('click', () => loginOrRegister('register').catch(err => toast('Register failed', err.message)));
  els.logoutButton.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });
  els.caseSearchInput.addEventListener('input', renderCases);
  els.openButton.addEventListener('click', openCase);
  els.inventorySearch.addEventListener('input', renderInventory);
  els.rarityFilter.addEventListener('change', renderInventory);
  els.sortSelect.addEventListener('change', renderInventory);
  els.sellAllButton.addEventListener('click', sellAll);
  els.dailyButton.addEventListener('click', () => doEarn('daily'));
  els.jobButton.addEventListener('click', () => doEarn('job'));
  els.tradeUserSearch.addEventListener('input', debounce(searchUsers, 250));
  els.createTradeButton.addEventListener('click', createTrade);
  els.refreshTradesButton.addEventListener('click', loadTrades);
  els.leaderboardSort.addEventListener('change', loadLeaderboard);
  els.refreshLeaderboardButton.addEventListener('click', loadLeaderboard);
  els.oddsButton.addEventListener('click', () => els.oddsModal.classList.remove('hidden'));
  els.closeOddsButton.addEventListener('click', () => els.oddsModal.classList.add('hidden'));
  els.oddsModal.addEventListener('click', e => { if (e.target === els.oddsModal) els.oddsModal.classList.add('hidden'); });
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  setInterval(updateEarnButtons, 1000);
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

boot();
