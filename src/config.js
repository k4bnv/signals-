import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const str = (v, d = '') => (v === undefined ? d : v);
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');

// DATA_DIR lets deployments (e.g. a Dokploy persistent volume) point state
// storage outside the source checkout so it survives redeploys/rebuilds.
const DATA_DIR = process.env.DATA_DIR || process.cwd();
fs.mkdirSync(DATA_DIR, { recursive: true });
const SETTINGS_PATH = path.resolve(DATA_DIR, 'settings.json');
// Groups whose values may be changed at runtime from the web dashboard and
// persisted to settings.json (overrides .env defaults on next boot).
const EDITABLE_GROUPS = ['loop', 'screen', 'indicators', 'risk'];

export const config = {
  okx: {
    apiKey: str(process.env.OKX_API_KEY),
    apiSecret: str(process.env.OKX_API_SECRET),
    passphrase: str(process.env.OKX_API_PASSPHRASE),
    demo: bool(process.env.OKX_DEMO, false),
    baseUrl: 'https://www.okx.com',
  },
  telegram: {
    botToken: str(process.env.TELEGRAM_BOT_TOKEN),
    chatId: str(process.env.TELEGRAM_CHAT_ID),
  },
  web: {
    // PaaS platforms (Dokploy included) commonly inject PORT; prefer it over WEB_PORT.
    port: num(process.env.PORT, num(process.env.WEB_PORT, 3000)),
  },
  loop: {
    screenIntervalSec: num(process.env.SCREEN_INTERVAL_SEC, 120),
    noTradeUpdateMin: num(process.env.NO_TRADE_UPDATE_MIN, 20),
    signalCooldownMin: num(process.env.SIGNAL_COOLDOWN_MIN, 30),
    lossStreakPauseMin: num(process.env.LOSS_STREAK_PAUSE_MIN, 45),
  },
  screen: {
    change24hMin: num(process.env.CHANGE24H_MIN, 3),
    change24hMax: num(process.env.CHANGE24H_MAX, 15),
    oiMinUsdt: num(process.env.OI_MIN_USDT, 500000),
    minVol24hUsdt: num(process.env.MIN_VOL24H_USDT, 1000000),
    fundingMax: num(process.env.FUNDING_MAX, 0.0005),
  },
  indicators: {
    rsiPeriod: num(process.env.RSI_PERIOD, 14),
    rsi15Min: num(process.env.RSI15_MIN, 45),
    rsi15Max: num(process.env.RSI15_MAX, 65),
    rsi1hMax: num(process.env.RSI1H_MAX, 70),
    stPeriod: num(process.env.SUPERTREND_PERIOD, 10),
    stMultiplier: num(process.env.SUPERTREND_MULTIPLIER, 3),
  },
  risk: {
    defaultLeverage: num(process.env.DEFAULT_LEVERAGE, 7),
    maxLeverageCap: num(process.env.MAX_LEVERAGE_CAP, 20),
    defaultMarginUsdt: num(process.env.DEFAULT_MARGIN_USDT, 5),
    minScoreToSignal: num(process.env.MIN_SCORE_TO_SIGNAL, 7),
  },
};

export const hasOkxKeys = () =>
  Boolean(config.okx.apiKey && config.okx.apiSecret && config.okx.passphrase);

export const hasTelegram = () =>
  Boolean(config.telegram.botToken && config.telegram.chatId);

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function applyOverrides(overrides) {
  for (const group of EDITABLE_GROUPS) {
    if (!overrides[group]) continue;
    for (const [k, v] of Object.entries(overrides[group])) {
      if (config[group][k] === undefined) continue;
      const n = Number(v);
      if (Number.isFinite(n)) config[group][k] = n;
    }
  }
}

applyOverrides(loadOverrides());

function persistOverrides() {
  const data = {};
  for (const g of EDITABLE_GROUPS) data[g] = { ...config[g] };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}

// Snapshot of the settings the web dashboard is allowed to read/edit
// (excludes secrets: OKX keys, Telegram token/chat id).
export function getEditableSettings() {
  const out = {};
  for (const g of EDITABLE_GROUPS) out[g] = { ...config[g] };
  return out;
}

// patch: { loop?: {...}, screen?: {...}, indicators?: {...}, risk?: {...} }
// Unknown keys are ignored; non-numeric values are ignored. Persists to settings.json.
export function updateSettings(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('invalid settings payload');
  applyOverrides(patch);
  persistOverrides();
  return getEditableSettings();
}
