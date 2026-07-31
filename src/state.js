import fs from 'node:fs';
import path from 'node:path';

// DATA_DIR lets deployments (e.g. a Dokploy persistent volume) point state
// storage outside the source checkout so it survives redeploys.
const DATA_DIR = process.env.DATA_DIR || process.cwd();
fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_PATH = path.resolve(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  oiHistory: {}, // instId -> [{ t, oiUsd }]
  lastSignal: {}, // instId -> { t, entryLow, entryHigh, stop, tp1, tp2 }
  lastNoTradeAt: 0,
  lossStreak: 0,
  pauseUntil: 0,
  prevPositions: {}, // instId -> { avgPx, uplRatio, posSide }
  signals: [], // journal of sent signals for the "orders" table / winrate
  lastCycleAt: 0,
  lastCandidateCount: 0,
};

function load() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

let state = load();
let saveTimer = null;

export function getState() {
  return state;
}

export function saveState() {
  // debounce writes so a burst of updates in one cycle doesn't hit disk repeatedly
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }, 200);
}

export function pushOiSample(instId, oiUsd, ts, maxAgeMs) {
  if (!state.oiHistory[instId]) state.oiHistory[instId] = [];
  const arr = state.oiHistory[instId];
  arr.push({ t: ts, oiUsd });
  const cutoff = ts - maxAgeMs;
  while (arr.length && arr[0].t < cutoff) arr.shift();
  saveState();
}

export function getOiTrend(instId, sinceMs, nowMs) {
  const arr = state.oiHistory[instId];
  if (!arr || arr.length < 2) return null; // not enough history yet
  const cutoff = nowMs - sinceMs;
  const base = arr.find((s) => s.t >= cutoff) || arr[0];
  const latest = arr[arr.length - 1];
  if (base === latest) return null;
  return (latest.oiUsd - base.oiUsd) / base.oiUsd;
}

export function setLastSignal(instId, signal) {
  state.lastSignal[instId] = { ...signal, t: Date.now() };
  saveState();
}

export function getLastSignal(instId) {
  return state.lastSignal[instId];
}

export function isOnCooldown(instId, cooldownMs) {
  const s = state.lastSignal[instId];
  if (!s) return false;
  return Date.now() - s.t < cooldownMs;
}

export function isPaused() {
  return Date.now() < state.pauseUntil;
}

export function pauseAfterLosses(pauseMs) {
  state.pauseUntil = Date.now() + pauseMs;
  saveState();
}

export function recordTradeResult(won) {
  state.lossStreak = won ? 0 : state.lossStreak + 1;
  saveState();
  return state.lossStreak;
}

export function shouldSendNoTrade(intervalMs) {
  return Date.now() - state.lastNoTradeAt >= intervalMs;
}

export function markNoTradeSent() {
  state.lastNoTradeAt = Date.now();
  saveState();
}

export function getPrevPosition(instId) {
  return state.prevPositions[instId];
}

export function setPrevPosition(instId, data) {
  state.prevPositions[instId] = data;
  saveState();
}

export function clearPrevPosition(instId) {
  delete state.prevPositions[instId];
  saveState();
}

export function allPrevPositionKeys() {
  return Object.keys(state.prevPositions);
}

const MAX_SIGNAL_HISTORY = 500;

// rec: { instId, entryLow, entryHigh, stop, tp1, tp2, leverage, marginUsdt, score }
export function addSignalRecord(rec) {
  const entry = { id: `${rec.instId}-${Date.now()}`, t: Date.now(), status: 'open', ...rec };
  state.signals.unshift(entry);
  if (state.signals.length > MAX_SIGNAL_HISTORY) state.signals.length = MAX_SIGNAL_HISTORY;
  saveState();
  return entry;
}

// Patches the most recent still-open (or tp1_hit) journal entry for instId, if any.
export function updateSignalStatus(instId, patch) {
  const rec = state.signals.find(
    (s) => s.instId === instId && (s.status === 'open' || s.status === 'tp1_hit')
  );
  if (!rec) return null;
  Object.assign(rec, patch);
  saveState();
  return rec;
}

export function getSignals(limit = 100) {
  return state.signals.slice(0, limit);
}

export function getStats() {
  const closed = state.signals.filter(
    (s) => s.status === 'closed_win' || s.status === 'closed_loss'
  );
  const wins = closed.filter((s) => s.status === 'closed_win').length;
  const losses = closed.length - wins;
  const winRate = closed.length ? (wins / closed.length) * 100 : null;
  const avgPnlPct = closed.length
    ? closed.reduce((a, s) => a + (s.resultPct ?? 0), 0) / closed.length
    : null;

  return {
    totalSignals: state.signals.length,
    openSignals: state.signals.filter((s) => s.status === 'open' || s.status === 'tp1_hit').length,
    closed: closed.length,
    wins,
    losses,
    winRate,
    avgPnlPct,
    lossStreak: state.lossStreak,
    pauseUntil: state.pauseUntil,
  };
}

export function setLastCycle(candidateCount) {
  state.lastCycleAt = Date.now();
  state.lastCandidateCount = candidateCount;
  saveState();
}
