const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Add a PostgreSQL database on Railway or set DATABASE_URL locally.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
});

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
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

function getCasePrice(caseName) {
  return CASE_PRICE_OVERRIDES[caseName] ?? DEFAULT_CASE_PRICE;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance NUMERIC(12,2) NOT NULL DEFAULT 1000,
      cases_opened INTEGER NOT NULL DEFAULT 0,
      best_pull_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      best_pull_name TEXT,
      best_pull_image TEXT,
      best_pull_rarity TEXT,
      best_rank INTEGER NOT NULL DEFAULT 0,
      last_daily TIMESTAMPTZ,
      last_job TIMESTAMPTZ,
      trade_ups INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_id TEXT,
      name TEXT NOT NULL,
      base_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      case_name TEXT NOT NULL,
      value NUMERIC(12,2) NOT NULL,
      image TEXT NOT NULL,
      is_stattrak BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS history (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      name TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      rarity TEXT,
      case_name TEXT,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS claimed_achievements (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id UUID PRIMARY KEY,
      from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_money NUMERIC(12,2) NOT NULL DEFAULT 0,
      to_money NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trade_items (
      trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      side TEXT NOT NULL CHECK (side IN ('from', 'to')),
      PRIMARY KEY (trade_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
    CREATE INDEX IF NOT EXISTS idx_trades_from_user ON trades(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_trades_to_user ON trades(to_user_id);
  `);
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
    sourceId: base.sourceId,
    name: fullName,
    baseName: base.name,
    rarity: base.rarity,
    caseName: caseData.name,
    value: generateValue(base.rarity, isStatTrak),
    image: base.image,
    isStatTrak
  };
}

async function getUserSummary(userId) {
  const { rows } = await pool.query(`
    SELECT
      u.id,
      u.username,
      u.balance,
      u.cases_opened,
      u.best_pull_value,
      u.best_pull_name,
      u.best_pull_image,
      u.best_pull_rarity,
      u.best_rank,
      u.last_daily,
      u.last_job,
      u.trade_ups,
      COALESCE(SUM(i.value), 0)::numeric(12,2) AS inventory_value,
      COUNT(i.id)::int AS inventory_count
    FROM users u
    LEFT JOIN inventory_items i ON i.user_id = u.id
    WHERE u.id = $1
    GROUP BY u.id
  `, [userId]);
  return rows[0] || null;
}

async function getInventory(userId) {
  const { rows } = await pool.query(`
    SELECT id, source_id, name, base_name, rarity, case_name, value, image, is_stattrak, created_at
    FROM inventory_items
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [userId]);
  return rows;
}

async function getClaims(userId) {
  const { rows } = await pool.query('SELECT achievement_id FROM claimed_achievements WHERE user_id = $1', [userId]);
  return new Set(rows.map(row => row.achievement_id));
}

async function addHistory(client, userId, action, item) {
  await client.query(`
    INSERT INTO history (user_id, action, name, amount, rarity, case_name, image)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [userId, action, item.name, item.amount ?? item.value ?? 0, item.rarity || 'milspec', item.caseName || item.case_name || 'System', item.image || '']);
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/register', async (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = String(req.body.password || '');
  if (!validateUsername(username)) return res.status(400).json({ error: 'Username must be 3-24 characters and only use letters, numbers, or underscores.' });
  if (password.length < 4 || password.length > 72) return res.status(400).json({ error: 'Password must be 4-72 characters.' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, balance) VALUES ($1, $2, $3) RETURNING id',
      [username, hash, START_BALANCE]
    );
    req.session.userId = rows[0].id;
    res.json({ ok: true, user: publicUser(await getUserSummary(rows[0].id)) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That username is already taken.' });
    console.error(error);
    res.status(500).json({ error: 'Could not register.' });
  }
});

app.post('/api/login', async (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE lower(username) = lower($1)', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid username or password.' });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(await getUserSummary(user.id)) });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, async (req, res) => {
  res.json({ user: publicUser(await getUserSummary(req.session.userId)), inventory: await getInventory(req.session.userId) });
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: userRows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.session.userId]);
    const user = userRows[0];
    if (!user) throw new Error('User not found.');
    if (Number(user.balance) < caseData.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough fake balance.' });
    }

    const won = rollItem(caseData);
    const rarityRank = RARITY_MAP[won.rarity].rank;
    const updateBest = Number(user.best_pull_value) < won.value;

    await client.query(`
      UPDATE users
      SET balance = balance - $2,
          cases_opened = cases_opened + 1,
          best_pull_value = CASE WHEN $3 THEN $4 ELSE best_pull_value END,
          best_pull_name = CASE WHEN $3 THEN $5 ELSE best_pull_name END,
          best_pull_image = CASE WHEN $3 THEN $6 ELSE best_pull_image END,
          best_pull_rarity = CASE WHEN $3 THEN $7 ELSE best_pull_rarity END,
          best_rank = GREATEST(best_rank, $8)
      WHERE id = $1
    `, [req.session.userId, caseData.price, updateBest, won.value, won.name, won.image, won.rarity, rarityRank]);

    await client.query(`
      INSERT INTO inventory_items (id, user_id, source_id, name, base_name, rarity, case_name, value, image, is_stattrak)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [won.id, req.session.userId, won.sourceId, won.name, won.baseName, won.rarity, won.caseName, won.value, won.image, won.isStatTrak]);
    await addHistory(client, req.session.userId, 'Opened', won);
    await client.query('COMMIT');

    res.json({ ok: true, item: won, user: publicUser(await getUserSummary(req.session.userId)), inventory: await getInventory(req.session.userId) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Could not open case.' });
  } finally {
    client.release();
  }
});

app.post('/api/sell', requireAuth, async (req, res) => {
  const itemId = String(req.body.itemId || '');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM inventory_items WHERE id = $1 AND user_id = $2 FOR UPDATE', [itemId, req.session.userId]);
    const item = rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found.' });
    }

    const { rows: tradeRows } = await client.query(`
      SELECT 1 FROM trade_items ti JOIN trades t ON t.id = ti.trade_id
      WHERE ti.item_id = $1 AND t.status = 'pending'
      LIMIT 1
    `, [itemId]);
    if (tradeRows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This item is inside a pending trade.' });
    }

    await client.query('DELETE FROM inventory_items WHERE id = $1', [itemId]);
    await client.query('UPDATE users SET balance = balance + $2 WHERE id = $1', [req.session.userId, item.value]);
    await addHistory(client, req.session.userId, 'Sold', { ...item, amount: item.value, caseName: item.case_name });
    await client.query('COMMIT');
    res.json({ ok: true, user: publicUser(await getUserSummary(req.session.userId)), inventory: await getInventory(req.session.userId) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Could not sell item.' });
  } finally {
    client.release();
  }
});

app.post('/api/sell-all', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT i.* FROM inventory_items i
      WHERE i.user_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM trade_items ti JOIN trades t ON t.id = ti.trade_id
          WHERE ti.item_id = i.id AND t.status = 'pending'
        )
      FOR UPDATE
    `, [req.session.userId]);
    const total = rows.reduce((sum, item) => sum + Number(item.value), 0);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, sold: 0, total: 0, user: publicUser(await getUserSummary(req.session.userId)), inventory: await getInventory(req.session.userId) });
    }
    await client.query('DELETE FROM inventory_items WHERE id = ANY($1::uuid[])', [rows.map(item => item.id)]);
    await client.query('UPDATE users SET balance = balance + $2 WHERE id = $1', [req.session.userId, total]);
    await addHistory(client, req.session.userId, 'Sold inventory', { name: `${rows.length} items`, amount: total, rarity: 'milspec', caseName: 'Inventory', image: '' });
    await client.query('COMMIT');
    res.json({ ok: true, sold: rows.length, total, user: publicUser(await getUserSummary(req.session.userId)), inventory: await getInventory(req.session.userId) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Could not sell inventory.' });
  } finally {
    client.release();
  }
});

app.post('/api/earn/daily', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.session.userId]);
    const user = rows[0];
    const last = user.last_daily ? new Date(user.last_daily).getTime() : 0;
    if (Date.now() - last < DAILY_COOLDOWN_MS) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Daily bonus is not ready yet.' });
    }
    await client.query('UPDATE users SET balance = balance + $2, last_daily = NOW() WHERE id = $1', [req.session.userId, DAILY_REWARD]);
    await addHistory(client, req.session.userId, 'Claimed', { name: 'Daily Supply Drop', amount: DAILY_REWARD, rarity: 'milspec', caseName: 'Earn', image: '' });
    await client.query('COMMIT');
    res.json({ ok: true, user: publicUser(await getUserSummary(req.session.userId)) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Could not claim daily.' });
  } finally {
    client.release();
  }
});

app.post('/api/earn/job', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.session.userId]);
    const user = rows[0];
    const last = user.last_job ? new Date(user.last_job).getTime() : 0;
    if (Date.now() - last < QUICK_JOB_COOLDOWN_MS) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quick job is not ready yet.' });
    }
    await client.query('UPDATE users SET balance = balance + $2, last_job = NOW() WHERE id = $1', [req.session.userId, QUICK_JOB_REWARD]);
    await addHistory(client, req.session.userId, 'Earned', { name: 'Quick Job', amount: QUICK_JOB_REWARD, rarity: 'milspec', caseName: 'Earn', image: '' });
    await client.query('COMMIT');
    res.json({ ok: true, user: publicUser(await getUserSummary(req.session.userId)) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Could not do quick job.' });
  } finally {
    client.release();
  }
});

app.get('/api/achievements', requireAuth, async (req, res) => {
  const summary = publicUser(await getUserSummary(req.session.userId));
  const claimed = await getClaims(req.session.userId);
  res.json({ achievements: ACHIEVEMENTS.map(a => ({ ...a, check: undefined, ready: a.check(summary), claimed: claimed.has(a.id) })) });
});

app.post('/api/achievements/:id/claim', requireAuth, async (req, res) => {
  const achievement = ACHIEVEMENTS.find(a => a.id === req.params.id);
  if (!achievement) return res.status(404).json({ error: 'Achievement not found.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const summary = publicUser(await getUserSummary(req.session.userId));
    if (!achievement.check(summary)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Achievement is not ready.' });
    }
    const { rowCount } = await client.query('INSERT INTO claimed_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.session.userId, achievement.id]);
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Achievement already claimed.' });
    }
    await client.query('UPDATE users SET balance = balance + $2 WHERE id = $1', [req.session.userId, achievement.reward]);
    await addHistory(client, req.session.userId, 'Achievement', { name: achievement.title, amount: achievement.reward, rarity: 'special', caseName: 'Achievements', image: '' });
    await client.query('COMMIT');
    res.json({ ok: true, user: publicUser(await getUserSummary(req.session.userId)) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Could not claim achievement.' });
  } finally {
    client.release();
  }
});

app.get('/api/history', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.session.userId]);
  res.json({ history: rows });
});

app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [] });
  const { rows } = await pool.query(`
    SELECT id, username FROM users
    WHERE id <> $1 AND lower(username) LIKE lower($2)
    ORDER BY username ASC
    LIMIT 12
  `, [req.session.userId, `%${q}%`]);
  res.json({ users: rows });
});

app.get('/api/users/:username/inventory', requireAuth, async (req, res) => {
  const username = sanitizeUsername(req.params.username);
  const { rows } = await pool.query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [username]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user, inventory: await getInventory(user.id) });
});

app.get('/api/leaderboard', async (req, res) => {
  const sort = String(req.query.sort || 'total');
  const orderBy = {
    total: 'total_value DESC',
    balance: 'u.balance DESC',
    inventory: 'inventory_value DESC',
    cases: 'u.cases_opened DESC',
    best: 'u.best_pull_value DESC'
  }[sort] || 'total_value DESC';

  const { rows } = await pool.query(`
    SELECT
      u.username,
      u.balance,
      u.cases_opened,
      u.best_pull_value,
      u.best_pull_name,
      u.best_pull_image,
      COALESCE(SUM(i.value), 0)::numeric(12,2) AS inventory_value,
      (u.balance + COALESCE(SUM(i.value), 0))::numeric(12,2) AS total_value
    FROM users u
    LEFT JOIN inventory_items i ON i.user_id = u.id
    GROUP BY u.id
    ORDER BY ${orderBy}, u.username ASC
    LIMIT 50
  `);
  res.json({ leaderboard: rows.map(row => ({ ...row, balance: Number(row.balance), inventory_value: Number(row.inventory_value), total_value: Number(row.total_value), best_pull_value: Number(row.best_pull_value) })) });
});

app.post('/api/trades', requireAuth, async (req, res) => {
  const toUsername = sanitizeUsername(req.body.toUsername);
  const fromItemIds = Array.isArray(req.body.fromItemIds) ? req.body.fromItemIds.map(String) : [];
  const toItemIds = Array.isArray(req.body.toItemIds) ? req.body.toItemIds.map(String) : [];
  const fromMoney = numberMoney(req.body.fromMoney);
  const toMoney = numberMoney(req.body.toMoney);

  if (!toUsername) return res.status(400).json({ error: 'Choose a player to trade with.' });
  if (!fromItemIds.length && !toItemIds.length && fromMoney <= 0 && toMoney <= 0) return res.status(400).json({ error: 'Trade cannot be empty.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: targetRows } = await client.query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [toUsername]);
    const target = targetRows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target user not found.' });
    }
    if (target.id === req.session.userId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You cannot trade with yourself.' });
    }

    const userIds = [req.session.userId, target.id].sort((a, b) => a - b);
    const { rows: lockedUsers } = await client.query('SELECT id, balance FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [userIds]);
    const currentUser = lockedUsers.find(u => u.id === req.session.userId);
    if (Number(currentUser.balance) < fromMoney) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You do not have enough fake balance for this offer.' });
    }

    const allItemIds = [...new Set([...fromItemIds, ...toItemIds])];
    if (allItemIds.length) {
      const { rows: activeTradeItems } = await client.query(`
        SELECT ti.item_id FROM trade_items ti JOIN trades t ON t.id = ti.trade_id
        WHERE ti.item_id = ANY($1::uuid[]) AND t.status = 'pending'
      `, [allItemIds]);
      if (activeTradeItems.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One of those items is already inside a pending trade.' });
      }

      const { rows: itemRows } = await client.query('SELECT id, user_id FROM inventory_items WHERE id = ANY($1::uuid[]) FOR UPDATE', [allItemIds]);
      const byId = new Map(itemRows.map(item => [item.id, item]));
      for (const id of fromItemIds) {
        if (!byId.has(id) || byId.get(id).user_id !== req.session.userId) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'One of your offered items is no longer yours.' });
        }
      }
      for (const id of toItemIds) {
        if (!byId.has(id) || byId.get(id).user_id !== target.id) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'One of the requested items is no longer owned by that player.' });
        }
      }
    }

    const tradeId = newId();
    await client.query(`
      INSERT INTO trades (id, from_user_id, to_user_id, from_money, to_money)
      VALUES ($1, $2, $3, $4, $5)
    `, [tradeId, req.session.userId, target.id, fromMoney, toMoney]);
    for (const itemId of fromItemIds) await client.query('INSERT INTO trade_items (trade_id, item_id, side) VALUES ($1, $2, $3)', [tradeId, itemId, 'from']);
    for (const itemId of toItemIds) await client.query('INSERT INTO trade_items (trade_id, item_id, side) VALUES ($1, $2, $3)', [tradeId, itemId, 'to']);

    await client.query('COMMIT');
    res.json({ ok: true, tradeId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Could not create trade.' });
  } finally {
    client.release();
  }
});

app.get('/api/trades', requireAuth, async (req, res) => {
  const { rows: tradeRows } = await pool.query(`
    SELECT t.*, fu.username AS from_username, tu.username AS to_username
    FROM trades t
    JOIN users fu ON fu.id = t.from_user_id
    JOIN users tu ON tu.id = t.to_user_id
    WHERE t.from_user_id = $1 OR t.to_user_id = $1
    ORDER BY t.created_at DESC
    LIMIT 100
  `, [req.session.userId]);

  const trades = [];
  for (const trade of tradeRows) {
    const { rows: itemRows } = await pool.query(`
      SELECT ti.side, i.id, i.name, i.rarity, i.case_name, i.value, i.image
      FROM trade_items ti
      JOIN inventory_items i ON i.id = ti.item_id
      WHERE ti.trade_id = $1
      ORDER BY ti.side, i.value DESC
    `, [trade.id]);
    trades.push({
      id: trade.id,
      fromUserId: trade.from_user_id,
      toUserId: trade.to_user_id,
      fromUsername: trade.from_username,
      toUsername: trade.to_username,
      fromMoney: Number(trade.from_money),
      toMoney: Number(trade.to_money),
      status: trade.status,
      createdAt: trade.created_at,
      itemsFrom: itemRows.filter(i => i.side === 'from'),
      itemsTo: itemRows.filter(i => i.side === 'to'),
      canAccept: trade.to_user_id === req.session.userId && trade.status === 'pending',
      canCancel: (trade.to_user_id === req.session.userId || trade.from_user_id === req.session.userId) && trade.status === 'pending'
    });
  }
  res.json({ trades });
});

app.post('/api/trades/:id/cancel', requireAuth, async (req, res) => {
  const tradeId = String(req.params.id || '');
  const { rowCount } = await pool.query(`
    UPDATE trades
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = $1 AND status = 'pending' AND (from_user_id = $2 OR to_user_id = $2)
  `, [tradeId, req.session.userId]);
  if (!rowCount) return res.status(404).json({ error: 'Pending trade not found.' });
  res.json({ ok: true });
});

app.post('/api/trades/:id/accept', requireAuth, async (req, res) => {
  const tradeId = String(req.params.id || '');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tradeRows } = await client.query('SELECT * FROM trades WHERE id = $1 FOR UPDATE', [tradeId]);
    const trade = tradeRows[0];
    if (!trade || trade.status !== 'pending' || trade.to_user_id !== req.session.userId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending incoming trade not found.' });
    }

    const userIds = [trade.from_user_id, trade.to_user_id].sort((a, b) => a - b);
    const { rows: lockedUsers } = await client.query('SELECT id, balance FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [userIds]);
    const fromUser = lockedUsers.find(u => u.id === trade.from_user_id);
    const toUser = lockedUsers.find(u => u.id === trade.to_user_id);
    if (Number(fromUser.balance) < Number(trade.from_money)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Sender no longer has enough fake balance.' });
    }
    if (Number(toUser.balance) < Number(trade.to_money)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You no longer have enough fake balance.' });
    }

    const { rows: tradeItems } = await client.query(`
      SELECT ti.side, i.id, i.user_id
      FROM trade_items ti
      JOIN inventory_items i ON i.id = ti.item_id
      WHERE ti.trade_id = $1
      FOR UPDATE OF i
    `, [tradeId]);

    const fromIds = [];
    const toIds = [];
    for (const item of tradeItems) {
      if (item.side === 'from') {
        if (item.user_id !== trade.from_user_id) throw new Error('Offered item ownership changed.');
        fromIds.push(item.id);
      } else {
        if (item.user_id !== trade.to_user_id) throw new Error('Requested item ownership changed.');
        toIds.push(item.id);
      }
    }

    await client.query('UPDATE users SET balance = balance - $2 + $3 WHERE id = $1', [trade.from_user_id, trade.from_money, trade.to_money]);
    await client.query('UPDATE users SET balance = balance - $2 + $3 WHERE id = $1', [trade.to_user_id, trade.to_money, trade.from_money]);
    if (fromIds.length) await client.query('UPDATE inventory_items SET user_id = $2 WHERE id = ANY($1::uuid[])', [fromIds, trade.to_user_id]);
    if (toIds.length) await client.query('UPDATE inventory_items SET user_id = $2 WHERE id = ANY($1::uuid[])', [toIds, trade.from_user_id]);
    await client.query("UPDATE trades SET status = 'accepted', updated_at = NOW() WHERE id = $1", [tradeId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(400).json({ error: error.message || 'Could not accept trade.' });
  } finally {
    client.release();
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Crate Rush running on port ${PORT}`));
  })
  .catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
