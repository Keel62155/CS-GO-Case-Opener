const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'crate-rush-data.json');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

const START_BALANCE = 1000;
const QUICK_JOB_REWARD = 85;
const QUICK_JOB_COOLDOWN_MS = 60 * 1000;
const DAILY_REWARD = 350;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const CRATE_API_URLS = [
  'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json',
  'https://bymykel.github.io/CSGO-API/api/en/crates.json'
];

const DEFAULT_CASE_PRICE = 2.50;
const CASE_PRICE_OVERRIDES = {
  'Sealed Dead Hand Terminal': 2.22,
  'Sealed Genesis Terminal': 0.21,
  'Fever Case': 0.92,
  'Gallery Case': 1.58,
  'Kilowatt Case': 0.34,
  'Anubis Collection Package': 3.28,
  'Revolution Case': 0.46,
  'Recoil Case': 0.58,
  'Dreams & Nightmares Case': 2.08,
  'Operation Riptide Case': 15.54,
  'Snakebite Case': 0.97,
  'Operation Broken Fang Case': 10.90,
  'Fracture Case': 0.96,
  'Prisma 2 Case': 2.57,
  'CS20 Case': 2.11,
  'X-Ray P250 Package': 2.60,
  'Shattered Web Case': 10.12,
  'Prisma Case': 2.35,
  'Danger Zone Case': 2.48,
  'Horizon Case': 2.90,
  'Clutch Case': 1.09,
  'Spectrum 2 Case': 4.96,
  'Operation Hydra Case': 50.38,
  'Spectrum Case': 6.18,
  'Glove Case': 16.06,
  'Gamma 2 Case': 4.91,
  'Gamma Case': 5.07,
  'Chroma 3 Case': 5.56,
  'Operation Wildfire Case': 5.45,
  'Revolver Case': 4.85,
  'Shadow Case': 3.03,
  'Falchion Case': 2.77,
  'Chroma 2 Case': 6.23,
  'Chroma Case': 8.25,
  'Operation Vanguard Weapon Case': 8.66,
  'eSports 2014 Summer Case': 29.07,
  'Operation Breakout Weapon Case': 12.65,
  'Huntsman Weapon Case': 13.80,
  'Operation Phoenix Weapon Case': 6.63,
  'CS:GO Weapon Case 3': 21.89,
  'Winter Offensive Weapon Case': 16.33,
  'eSports 2013 Winter Case': 35.94,
  'CS:GO Weapon Case 2': 33.75,
  'Operation Bravo Case': 98.45,
  'eSports 2013 Case': 78.08,
  'CS:GO Weapon Case': 210.84
};

const RARITIES = [
  { id: 'milspec', label: 'Mil-Spec Grade', short: 'Mil-Spec', color: '#4b69ff', odds: 79.92, rank: 1, value: [12, 42] },
  { id: 'restricted', label: 'Restricted', short: 'Restricted', color: '#8847ff', odds: 15.98, rank: 2, value: [45, 160] },
  { id: 'classified', label: 'Classified', short: 'Classified', color: '#d32ce6', odds: 3.2, rank: 3, value: [190, 540] },
  { id: 'covert', label: 'Covert', short: 'Covert', color: '#eb4b4b', odds: 0.64, rank: 4, value: [900, 2600] },
  { id: 'special', label: 'Exceedingly Rare', short: 'Special', color: '#ffd700', odds: 0.26, rank: 5, value: [4800, 12500] }
];
const RARITY_MAP = Object.fromEntries(RARITIES.map(r => [r.id, r]));

const ACHIEVEMENTS = [
  { id: 'first-open', icon: '🎉', title: 'First Pull', description: 'Open your first case.', reward: 100, check: s => s.cases_opened >= 1 },
  { id: 'ten-open', icon: '📦', title: 'Case Regular', description: 'Open 10 cases.', reward: 250, check: s => s.cases_opened >= 10 },
  { id: 'fifty-open', icon: '🚚', title: 'Shipment Day', description: 'Open 50 cases.', reward: 1200, check: s => s.cases_opened >= 50 },
  { id: 'classified-pull', icon: '💗', title: 'Pink Pull', description: 'Unbox a Classified or better item.', reward: 300, check: s => s.best_rank >= 3 },
  { id: 'covert-pull', icon: '🔥', title: 'Red Alert', description: 'Unbox a Covert or Special item.', reward: 1200, check: s => s.best_rank >= 4 },
  { id: 'special-pull', icon: '⭐', title: 'Gold Rush', description: 'Unbox a Special item.', reward: 3500, check: s => s.best_rank >= 5 },
  { id: 'collector', icon: '🧳', title: 'Collector', description: 'Hold 25 items at once.', reward: 600, check: s => s.inventory_count >= 25 },
  { id: 'tradeup', icon: '♻️', title: 'Recycler', description: 'Complete one trade-up contract.', reward: 450, check: s => s.trade_ups >= 1 },
  { id: 'fake-rich', icon: '💰', title: 'Fake-Money Flex', description: 'Reach a $10,000 total value.', reward: 1500, check: s => Number(s.balance) + Number(s.inventory_value) >= 10000 }
];

function defaultData() {
  return {
    meta: {
      version: 1,
      created_at: new Date().toISOString(),
      storage: 'json-file'
    },
    next_user_id: 1,
    next_history_id: 1,
    users: [],
    inventory_items: [],
    history: [],
    claimed_achievements: [],
    trades: [],
    trade_items: []
  };
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.ready = false;
    this.lock = Promise.resolve();
  }

  async init() {
    if (this.ready) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Could not read data file, creating a new one:', error.message);
      }
      this.data = defaultData();
      await this.save();
    }
    this.normalize();
    await this.save();
    this.ready = true;
  }

  normalize() {
    const base = defaultData();
    this.data = { ...base, ...(this.data || {}) };
    for (const key of ['users', 'inventory_items', 'history', 'claimed_achievements', 'trades', 'trade_items']) {
      if (!Array.isArray(this.data[key])) this.data[key] = [];
    }
    this.data.next_user_id = Math.max(Number(this.data.next_user_id) || 1, ...this.data.users.map(u => Number(u.id) + 1).filter(Boolean), 1);
    this.data.next_history_id = Math.max(Number(this.data.next_history_id) || 1, ...this.data.history.map(h => Number(h.id) + 1).filter(Boolean), 1);
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.filePath);
  }

  async read(fn) {
    await this.init();
    return fn(this.data);
  }

  async write(fn) {
    await this.init();
    const run = async () => {
      const result = await fn(this.data);
      await this.save();
      return result;
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => {});
    return result;
  }
}

const store = new JsonStore(DATA_FILE);
let caseCache = { loadedAt: 0, data: [] };

function sanitizeUsername(input) {
  return String(input || '').trim().replace(/^@/, '').slice(0, 24);
}

function validateUsername(username) {
  return /^[A-Za-z0-9_]{3,24}$/.test(username);
}

function numberMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function getCasePrice(caseName) {
  return CASE_PRICE_OVERRIDES[caseName] ?? DEFAULT_CASE_PRICE;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

async function fetchFirstJson(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      errors.push(`${url}: ${error.message || error}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function getCases() {
  const now = Date.now();
  if (caseCache.data.length && now - caseCache.loadedAt < 1000 * 60 * 60) return caseCache.data;

  const rawCrates = await fetchFirstJson(CRATE_API_URLS);
  const normalized = rawCrates
    .filter(crate => crate.type === 'Case' && Array.isArray(crate.contains) && crate.contains.length > 0)
    .map(normalizeCase)
    .filter(crate => crate.items.length > 0 && crate.specials.length > 0)
    .sort((a, b) => {
      const ad = Date.parse(a.firstSaleDate || '1970-01-01');
      const bd = Date.parse(b.firstSaleDate || '1970-01-01');
      return bd - ad || a.name.localeCompare(b.name);
    });

  caseCache = { loadedAt: now, data: normalized };
  return normalized;
}

function normalizeCase(crate) {
  const items = crate.contains
    .map(entry => normalizeItem(entry, false))
    .filter(Boolean)
    .filter(entry => ['milspec', 'restricted', 'classified', 'covert'].includes(entry.rarity));

  const specials = (crate.contains_rare || [])
    .map(entry => normalizeItem(entry, true))
    .filter(Boolean);

  return {
    id: crate.id,
    name: crate.name,
    image: crate.image,
    firstSaleDate: crate.first_sale_date,
    price: getCasePrice(crate.name),
    description: crate.loot_list?.footer || 'or an Exceedingly Rare Special Item!',
    items,
    specials,
    itemsByRarity: groupByRarity(items)
  };
}

function normalizeItem(entry, forceSpecial) {
  if (!entry || !entry.name || !entry.image) return null;
  const rarity = forceSpecial ? 'special' : mapApiRarity(entry.rarity);
  if (!rarity) return null;
  return {
    sourceId: entry.id,
    name: entry.name,
    rarity,
    apiRarityName: entry.rarity?.name || '',
    image: entry.image,
    paintIndex: entry.paint_index || null,
    phase: entry.phase || null
  };
}

function mapApiRarity(apiRarity) {
  const id = String(apiRarity?.id || '').toLowerCase();
  const name = String(apiRarity?.name || '').toLowerCase();
  if (id.includes('rare_weapon') || name.includes('mil-spec')) return 'milspec';
  if (id.includes('mythical_weapon') || id.includes('mythic_weapon') || name.includes('restricted')) return 'restricted';
  if (id.includes('legendary_weapon') || name.includes('classified')) return 'classified';
  if (id.includes('ancient_weapon') || name.includes('covert')) return 'covert';
  return null;
}

function groupByRarity(items) {
  return items.reduce((groups, item) => {
    if (!groups[item.rarity]) groups[item.rarity] = [];
    groups[item.rarity].push(item);
    return groups;
  }, {});
}

function pickRandomFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function pickRarity(caseData) {
  const available = new Set(Object.keys(caseData.itemsByRarity));
  if (caseData.specials.length) available.add('special');

  for (let attempt = 0; attempt < 20; attempt++) {
    const total = RARITIES.reduce((sum, rarity) => sum + rarity.odds, 0);
    let roll = Math.random() * total;
    for (const rarity of RARITIES) {
      roll -= rarity.odds;
      if (roll <= 0 && available.has(rarity.id)) return rarity.id;
    }
  }

  return available.has('milspec') ? 'milspec' : [...available][0];
}

function getItemPool(caseData, rarityId) {
  if (rarityId === 'special') return caseData.specials;
  return caseData.itemsByRarity[rarityId] || [];
}

function generateValue(rarityId, isStatTrak) {
  const rarity = RARITY_MAP[rarityId] || RARITY_MAP.milspec;
  const [min, max] = rarity.value;
  const raw = min + Math.random() * (max - min);
  const statTrakBonus = isStatTrak ? 1.35 : 1;
  return numberMoney(raw * statTrakBonus);
}

function rollItem(caseData) {
  const rarityId = pickRarity(caseData);
  const pool = getItemPool(caseData, rarityId);
  const base = pickRandomFrom(pool);
  const isStatTrak = rarityId !== 'special' && Math.random() < 0.1;
  const fullName = isStatTrak ? `StatTrak™ ${base.name}` : base.name;
  return {
    id: newId(),
    source_id: base.sourceId,
    sourceId: base.sourceId,
    name: fullName,
    base_name: base.name,
    baseName: base.name,
    rarity: base.rarity,
    case_name: caseData.name,
    caseName: caseData.name,
    value: generateValue(base.rarity, isStatTrak),
    image: base.image,
    is_stattrak: isStatTrak,
    isStatTrak,
    created_at: nowIso()
  };
}

function findUserById(data, userId) {
  return data.users.find(user => Number(user.id) === Number(userId)) || null;
}

function findUserByUsername(data, username) {
  const lower = String(username || '').toLowerCase();
  return data.users.find(user => String(user.username).toLowerCase() === lower) || null;
}

function getInventoryFromData(data, userId) {
  return data.inventory_items
    .filter(item => Number(item.user_id) === Number(userId))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function getClaimsFromData(data, userId) {
  return new Set(data.claimed_achievements
    .filter(claim => Number(claim.user_id) === Number(userId))
    .map(claim => claim.achievement_id));
}

function getUserSummaryFromData(data, userId) {
  const user = findUserById(data, userId);
  if (!user) return null;
  const inventory = getInventoryFromData(data, userId);
  const inventoryValue = inventory.reduce((sum, item) => sum + Number(item.value || 0), 0);
  return {
    id: user.id,
    username: user.username,
    balance: numberMoney(user.balance),
    cases_opened: Number(user.cases_opened || 0),
    best_pull_value: numberMoney(user.best_pull_value || 0),
    best_pull_name: user.best_pull_name || null,
    best_pull_image: user.best_pull_image || null,
    best_pull_rarity: user.best_pull_rarity || null,
    best_rank: Number(user.best_rank || 0),
    last_daily: user.last_daily || null,
    last_job: user.last_job || null,
    trade_ups: Number(user.trade_ups || 0),
    inventory_value: numberMoney(inventoryValue),
    inventory_count: inventory.length
  };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    balance: Number(row.balance),
    cases_opened: Number(row.cases_opened),
    best_pull_value: Number(row.best_pull_value),
    best_pull_name: row.best_pull_name,
    best_pull_image: row.best_pull_image,
    best_pull_rarity: row.best_pull_rarity,
    best_rank: Number(row.best_rank || 0),
    last_daily: row.last_daily,
    last_job: row.last_job,
    trade_ups: Number(row.trade_ups || 0),
    inventory_value: Number(row.inventory_value || 0),
    inventory_count: Number(row.inventory_count || 0)
  };
}

function addHistoryToData(data, userId, action, item) {
  data.history.unshift({
    id: data.next_history_id++,
    user_id: userId,
    action,
    name: item.name,
    amount: numberMoney(item.amount ?? item.value ?? 0),
    rarity: item.rarity || 'milspec',
    case_name: item.caseName || item.case_name || 'System',
    image: item.image || '',
    created_at: nowIso()
  });
  if (data.history.length > 5000) data.history = data.history.slice(0, 5000);
}

function isItemInPendingTrade(data, itemId) {
  const pendingIds = new Set(data.trades.filter(t => t.status === 'pending').map(t => t.id));
  return data.trade_items.some(ti => ti.item_id === itemId && pendingIds.has(ti.trade_id));
}

function trimString(value, max = 100) {
  return String(value || '').slice(0, max);
}

app.get('/api/health', (req, res) => res.json({ ok: true, storage: 'json-file', dataFile: DATA_FILE }));

app.post('/api/register', async (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = String(req.body.password || '');
  if (!validateUsername(username)) return res.status(400).json({ error: 'Username must be 3-24 characters and only use letters, numbers, or underscores.' });
  if (password.length < 4 || password.length > 72) return res.status(400).json({ error: 'Password must be 4-72 characters.' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await store.write(data => {
      if (findUserByUsername(data, username)) return { conflict: true };
      const user = {
        id: data.next_user_id++,
        username,
        password_hash: hash,
        balance: START_BALANCE,
        cases_opened: 0,
        best_pull_value: 0,
        best_pull_name: null,
        best_pull_image: null,
        best_pull_rarity: null,
        best_rank: 0,
        last_daily: null,
        last_job: null,
        trade_ups: 0,
        created_at: nowIso()
      };
      data.users.push(user);
      return { user: publicUser(getUserSummaryFromData(data, user.id)) };
    });

    if (result.conflict) return res.status(409).json({ error: 'That username is already taken.' });
    req.session.userId = result.user.id;
    res.json({ ok: true, user: result.user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not register.' });
  }
});

app.post('/api/login', async (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const user = await store.read(data => findUserByUsername(data, username));
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid username or password.' });
  req.session.userId = user.id;
  const summary = await store.read(data => publicUser(getUserSummaryFromData(data, user.id)));
  res.json({ ok: true, user: summary });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, async (req, res) => {
  const payload = await store.read(data => ({
    user: publicUser(getUserSummaryFromData(data, req.session.userId)),
    inventory: getInventoryFromData(data, req.session.userId)
  }));
  res.json(payload);
});

app.get('/api/cases', async (req, res) => {
  try {
    res.json({ cases: await getCases(), rarities: RARITIES });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load case data.' });
  }
});

app.post('/api/open', requireAuth, async (req, res) => {
  const caseId = String(req.body.caseId || '');
  const cases = await getCases();
  const caseData = cases.find(c => c.id === caseId);
  if (!caseData) return res.status(404).json({ error: 'Case not found.' });

  try {
    const result = await store.write(data => {
      const user = findUserById(data, req.session.userId);
      if (!user) return { error: 401, message: 'User not found.' };
      if (Number(user.balance) < Number(caseData.price)) return { error: 400, message: 'Not enough fake balance.' };

      const won = rollItem(caseData);
      const rarityRank = RARITY_MAP[won.rarity].rank;
      const updateBest = Number(user.best_pull_value || 0) < Number(won.value);
      user.balance = numberMoney(Number(user.balance) - Number(caseData.price));
      user.cases_opened = Number(user.cases_opened || 0) + 1;
      if (updateBest) {
        user.best_pull_value = won.value;
        user.best_pull_name = won.name;
        user.best_pull_image = won.image;
        user.best_pull_rarity = won.rarity;
      }
      user.best_rank = Math.max(Number(user.best_rank || 0), rarityRank);
      data.inventory_items.push({
        id: won.id,
        user_id: user.id,
        source_id: won.sourceId,
        name: won.name,
        base_name: won.baseName,
        rarity: won.rarity,
        case_name: won.caseName,
        value: won.value,
        image: won.image,
        is_stattrak: won.isStatTrak,
        created_at: won.created_at
      });
      addHistoryToData(data, user.id, 'Opened', won);
      return {
        item: won,
        user: publicUser(getUserSummaryFromData(data, user.id)),
        inventory: getInventoryFromData(data, user.id)
      };
    });

    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true, item: result.item, user: result.user, inventory: result.inventory });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not open case.' });
  }
});

app.post('/api/sell', requireAuth, async (req, res) => {
  const itemId = String(req.body.itemId || '');
  try {
    const result = await store.write(data => {
      const index = data.inventory_items.findIndex(item => item.id === itemId && Number(item.user_id) === Number(req.session.userId));
      if (index === -1) return { error: 404, message: 'Item not found.' };
      if (isItemInPendingTrade(data, itemId)) return { error: 400, message: 'This item is inside a pending trade.' };
      const [item] = data.inventory_items.splice(index, 1);
      const user = findUserById(data, req.session.userId);
      user.balance = numberMoney(Number(user.balance) + Number(item.value));
      addHistoryToData(data, user.id, 'Sold', { ...item, amount: item.value, caseName: item.case_name });
      return { user: publicUser(getUserSummaryFromData(data, user.id)), inventory: getInventoryFromData(data, user.id) };
    });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true, user: result.user, inventory: result.inventory });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not sell item.' });
  }
});

app.post('/api/sell-all', requireAuth, async (req, res) => {
  try {
    const result = await store.write(data => {
      const items = data.inventory_items.filter(item => Number(item.user_id) === Number(req.session.userId) && !isItemInPendingTrade(data, item.id));
      const total = numberMoney(items.reduce((sum, item) => sum + Number(item.value), 0));
      if (!items.length) return { sold: 0, total: 0, user: publicUser(getUserSummaryFromData(data, req.session.userId)), inventory: getInventoryFromData(data, req.session.userId) };
      const ids = new Set(items.map(item => item.id));
      data.inventory_items = data.inventory_items.filter(item => !ids.has(item.id));
      const user = findUserById(data, req.session.userId);
      user.balance = numberMoney(Number(user.balance) + total);
      addHistoryToData(data, user.id, 'Sold inventory', { name: `${items.length} items`, amount: total, rarity: 'milspec', caseName: 'Inventory', image: '' });
      return { sold: items.length, total, user: publicUser(getUserSummaryFromData(data, user.id)), inventory: getInventoryFromData(data, user.id) };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not sell inventory.' });
  }
});

app.post('/api/earn/daily', requireAuth, async (req, res) => {
  try {
    const result = await store.write(data => {
      const user = findUserById(data, req.session.userId);
      const last = user.last_daily ? new Date(user.last_daily).getTime() : 0;
      if (Date.now() - last < DAILY_COOLDOWN_MS) return { error: 400, message: 'Daily bonus is not ready yet.' };
      user.balance = numberMoney(Number(user.balance) + DAILY_REWARD);
      user.last_daily = nowIso();
      addHistoryToData(data, user.id, 'Claimed', { name: 'Daily Supply Drop', amount: DAILY_REWARD, rarity: 'milspec', caseName: 'Earn', image: '' });
      return { user: publicUser(getUserSummaryFromData(data, user.id)) };
    });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true, user: result.user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not claim daily.' });
  }
});

app.post('/api/earn/job', requireAuth, async (req, res) => {
  try {
    const result = await store.write(data => {
      const user = findUserById(data, req.session.userId);
      const last = user.last_job ? new Date(user.last_job).getTime() : 0;
      if (Date.now() - last < QUICK_JOB_COOLDOWN_MS) return { error: 400, message: 'Quick job is not ready yet.' };
      user.balance = numberMoney(Number(user.balance) + QUICK_JOB_REWARD);
      user.last_job = nowIso();
      addHistoryToData(data, user.id, 'Earned', { name: 'Quick Job', amount: QUICK_JOB_REWARD, rarity: 'milspec', caseName: 'Earn', image: '' });
      return { user: publicUser(getUserSummaryFromData(data, user.id)) };
    });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true, user: result.user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not do quick job.' });
  }
});

app.get('/api/achievements', requireAuth, async (req, res) => {
  const payload = await store.read(data => {
    const summary = publicUser(getUserSummaryFromData(data, req.session.userId));
    const claimed = getClaimsFromData(data, req.session.userId);
    return { achievements: ACHIEVEMENTS.map(a => ({ ...a, check: undefined, ready: a.check(summary), claimed: claimed.has(a.id) })) };
  });
  res.json(payload);
});

app.post('/api/achievements/:id/claim', requireAuth, async (req, res) => {
  const achievement = ACHIEVEMENTS.find(a => a.id === req.params.id);
  if (!achievement) return res.status(404).json({ error: 'Achievement not found.' });

  try {
    const result = await store.write(data => {
      const summary = publicUser(getUserSummaryFromData(data, req.session.userId));
      if (!achievement.check(summary)) return { error: 400, message: 'Achievement is not ready.' };
      const already = data.claimed_achievements.some(claim => Number(claim.user_id) === Number(req.session.userId) && claim.achievement_id === achievement.id);
      if (already) return { error: 400, message: 'Achievement already claimed.' };
      data.claimed_achievements.push({ user_id: req.session.userId, achievement_id: achievement.id, claimed_at: nowIso() });
      const user = findUserById(data, req.session.userId);
      user.balance = numberMoney(Number(user.balance) + achievement.reward);
      addHistoryToData(data, user.id, 'Achievement', { name: achievement.title, amount: achievement.reward, rarity: 'special', caseName: 'Achievements', image: '' });
      return { user: publicUser(getUserSummaryFromData(data, user.id)) };
    });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true, user: result.user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not claim achievement.' });
  }
});

app.get('/api/history', requireAuth, async (req, res) => {
  const history = await store.read(data => data.history
    .filter(row => Number(row.user_id) === Number(req.session.userId))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 100));
  res.json({ history });
});

app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ users: [] });
  const users = await store.read(data => data.users
    .filter(user => Number(user.id) !== Number(req.session.userId) && String(user.username).toLowerCase().includes(q))
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, 12)
    .map(user => ({ id: user.id, username: user.username })));
  res.json({ users });
});

app.get('/api/users/:username/inventory', requireAuth, async (req, res) => {
  const username = sanitizeUsername(req.params.username);
  const payload = await store.read(data => {
    const user = findUserByUsername(data, username);
    if (!user) return null;
    return { user: { id: user.id, username: user.username }, inventory: getInventoryFromData(data, user.id) };
  });
  if (!payload) return res.status(404).json({ error: 'User not found.' });
  res.json(payload);
});

app.get('/api/leaderboard', async (req, res) => {
  const sort = String(req.query.sort || 'total');
  const leaderboard = await store.read(data => data.users.map(user => {
    const summary = publicUser(getUserSummaryFromData(data, user.id));
    return {
      username: summary.username,
      balance: summary.balance,
      cases_opened: summary.cases_opened,
      best_pull_value: summary.best_pull_value,
      best_pull_name: summary.best_pull_name,
      best_pull_image: summary.best_pull_image,
      inventory_value: summary.inventory_value,
      total_value: numberMoney(Number(summary.balance) + Number(summary.inventory_value))
    };
  }).sort((a, b) => {
    const key = {
      balance: 'balance',
      inventory: 'inventory_value',
      cases: 'cases_opened',
      best: 'best_pull_value',
      total: 'total_value'
    }[sort] || 'total_value';
    return Number(b[key] || 0) - Number(a[key] || 0) || a.username.localeCompare(b.username);
  }).slice(0, 50));
  res.json({ leaderboard });
});

app.post('/api/trades', requireAuth, async (req, res) => {
  const toUsername = sanitizeUsername(req.body.toUsername);
  const fromItemIds = Array.isArray(req.body.fromItemIds) ? req.body.fromItemIds.map(String) : [];
  const toItemIds = Array.isArray(req.body.toItemIds) ? req.body.toItemIds.map(String) : [];
  const fromMoney = numberMoney(req.body.fromMoney);
  const toMoney = numberMoney(req.body.toMoney);

  if (!toUsername) return res.status(400).json({ error: 'Choose a player to trade with.' });
  if (!fromItemIds.length && !toItemIds.length && fromMoney <= 0 && toMoney <= 0) return res.status(400).json({ error: 'Trade cannot be empty.' });

  try {
    const result = await store.write(data => {
      const target = findUserByUsername(data, toUsername);
      if (!target) return { error: 404, message: 'Target user not found.' };
      if (Number(target.id) === Number(req.session.userId)) return { error: 400, message: 'You cannot trade with yourself.' };
      const currentUser = findUserById(data, req.session.userId);
      if (Number(currentUser.balance) < fromMoney) return { error: 400, message: 'You do not have enough fake balance for this offer.' };

      const allItemIds = [...new Set([...fromItemIds, ...toItemIds])];
      for (const itemId of allItemIds) {
        if (isItemInPendingTrade(data, itemId)) return { error: 400, message: 'One of those items is already inside a pending trade.' };
      }

      const byId = new Map(data.inventory_items.map(item => [item.id, item]));
      for (const itemId of fromItemIds) {
        const item = byId.get(itemId);
        if (!item || Number(item.user_id) !== Number(req.session.userId)) return { error: 400, message: 'One of your offered items is no longer yours.' };
      }
      for (const itemId of toItemIds) {
        const item = byId.get(itemId);
        if (!item || Number(item.user_id) !== Number(target.id)) return { error: 400, message: 'One of the requested items is no longer owned by that player.' };
      }

      const tradeId = newId();
      data.trades.push({
        id: tradeId,
        from_user_id: req.session.userId,
        to_user_id: target.id,
        from_money: fromMoney,
        to_money: toMoney,
        status: 'pending',
        created_at: nowIso(),
        updated_at: nowIso()
      });
      for (const itemId of fromItemIds) data.trade_items.push({ trade_id: tradeId, item_id: itemId, side: 'from' });
      for (const itemId of toItemIds) data.trade_items.push({ trade_id: tradeId, item_id: itemId, side: 'to' });
      return { tradeId };
    });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true, tradeId: result.tradeId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create trade.' });
  }
});

app.get('/api/trades', requireAuth, async (req, res) => {
  const trades = await store.read(data => data.trades
    .filter(trade => Number(trade.from_user_id) === Number(req.session.userId) || Number(trade.to_user_id) === Number(req.session.userId))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 100)
    .map(trade => {
      const fromUser = findUserById(data, trade.from_user_id);
      const toUser = findUserById(data, trade.to_user_id);
      const rows = data.trade_items
        .filter(ti => ti.trade_id === trade.id)
        .map(ti => {
          const item = data.inventory_items.find(inv => inv.id === ti.item_id);
          if (!item) return null;
          return { side: ti.side, id: item.id, name: item.name, rarity: item.rarity, case_name: item.case_name, value: item.value, image: item.image };
        })
        .filter(Boolean)
        .sort((a, b) => a.side.localeCompare(b.side) || Number(b.value) - Number(a.value));
      return {
        id: trade.id,
        fromUserId: trade.from_user_id,
        toUserId: trade.to_user_id,
        fromUsername: fromUser?.username || 'Deleted User',
        toUsername: toUser?.username || 'Deleted User',
        fromMoney: Number(trade.from_money || 0),
        toMoney: Number(trade.to_money || 0),
        status: trade.status,
        createdAt: trade.created_at,
        itemsFrom: rows.filter(i => i.side === 'from'),
        itemsTo: rows.filter(i => i.side === 'to'),
        canAccept: Number(trade.to_user_id) === Number(req.session.userId) && trade.status === 'pending',
        canCancel: (Number(trade.to_user_id) === Number(req.session.userId) || Number(trade.from_user_id) === Number(req.session.userId)) && trade.status === 'pending'
      };
    }));
  res.json({ trades });
});

app.post('/api/trades/:id/cancel', requireAuth, async (req, res) => {
  const tradeId = String(req.params.id || '');
  const result = await store.write(data => {
    const trade = data.trades.find(t => t.id === tradeId && t.status === 'pending' && (Number(t.from_user_id) === Number(req.session.userId) || Number(t.to_user_id) === Number(req.session.userId)));
    if (!trade) return { error: 404, message: 'Pending trade not found.' };
    trade.status = 'cancelled';
    trade.updated_at = nowIso();
    return { ok: true };
  });
  if (result.error) return res.status(result.error).json({ error: result.message });
  res.json({ ok: true });
});

app.post('/api/trades/:id/accept', requireAuth, async (req, res) => {
  const tradeId = String(req.params.id || '');
  try {
    const result = await store.write(data => {
      const trade = data.trades.find(t => t.id === tradeId);
      if (!trade || trade.status !== 'pending' || Number(trade.to_user_id) !== Number(req.session.userId)) return { error: 404, message: 'Pending incoming trade not found.' };
      const fromUser = findUserById(data, trade.from_user_id);
      const toUser = findUserById(data, trade.to_user_id);
      if (!fromUser || !toUser) return { error: 400, message: 'One of the users no longer exists.' };
      if (Number(fromUser.balance) < Number(trade.from_money)) return { error: 400, message: 'Sender no longer has enough fake balance.' };
      if (Number(toUser.balance) < Number(trade.to_money)) return { error: 400, message: 'You no longer have enough fake balance.' };

      const tradeItems = data.trade_items.filter(ti => ti.trade_id === tradeId);
      const byId = new Map(data.inventory_items.map(item => [item.id, item]));
      const fromIds = [];
      const toIds = [];
      for (const entry of tradeItems) {
        const item = byId.get(entry.item_id);
        if (!item) return { error: 400, message: 'A trade item no longer exists.' };
        if (entry.side === 'from') {
          if (Number(item.user_id) !== Number(trade.from_user_id)) return { error: 400, message: 'Offered item ownership changed.' };
          fromIds.push(item.id);
        } else {
          if (Number(item.user_id) !== Number(trade.to_user_id)) return { error: 400, message: 'Requested item ownership changed.' };
          toIds.push(item.id);
        }
      }

      fromUser.balance = numberMoney(Number(fromUser.balance) - Number(trade.from_money) + Number(trade.to_money));
      toUser.balance = numberMoney(Number(toUser.balance) - Number(trade.to_money) + Number(trade.from_money));
      for (const item of data.inventory_items) {
        if (fromIds.includes(item.id)) item.user_id = trade.to_user_id;
        if (toIds.includes(item.id)) item.user_id = trade.from_user_id;
      }
      trade.status = 'accepted';
      trade.updated_at = nowIso();
      addHistoryToData(data, fromUser.id, 'Trade accepted', { name: `Trade with ${toUser.username}`, amount: 0, rarity: 'milspec', caseName: 'Trades', image: '' });
      addHistoryToData(data, toUser.id, 'Trade accepted', { name: `Trade with ${fromUser.username}`, amount: 0, rarity: 'milspec', caseName: 'Trades', image: '' });
      return { ok: true };
    });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'Could not accept trade.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Crate Rush running on port ${PORT}`);
      console.log(`Using JSON data file: ${DATA_FILE}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize JSON storage:', error);
    process.exit(1);
  });
