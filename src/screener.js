import { getTickers, getOpenInterest } from './okx.js';
import { config } from './config.js';
import { pushOiSample, getOiTrend } from './state.js';

const OI_HISTORY_MAX_AGE_MS = 4 * 60 * 60 * 1000; // keep 4h of OI samples
const OI_TREND_WINDOW_MS = 60 * 60 * 1000; // compare against ~1h ago

// Returns candidates that pass the hard pre-filters (change24h, volume, OI size,
// OI not falling while price rises). Indicator-based checks happen later in analyzer.js.
export async function screenCandidates() {
  const [tickers, oiList] = await Promise.all([getTickers('SWAP'), getOpenInterest('SWAP')]);

  const oiByInst = new Map(oiList.map((o) => [o.instId, o]));
  const now = Date.now();
  const candidates = [];

  for (const t of tickers) {
    if (!t.instId.endsWith('-USDT-SWAP')) continue;
    const last = Number(t.last);
    const open24h = Number(t.open24h);
    if (!last || !open24h) continue;

    const change24hPct = ((last - open24h) / open24h) * 100;
    const vol24hUsdt = Number(t.volCcy24h) * last;

    const oiEntry = oiByInst.get(t.instId);
    const oiUsd = oiEntry ? Number(oiEntry.oiCcy) * last : 0;

    // record OI sample regardless of whether it currently passes filters,
    // so trend history builds up for pairs that may qualify later
    if (oiUsd > 0) pushOiSample(t.instId, oiUsd, now, OI_HISTORY_MAX_AGE_MS);

    if (change24hPct < config.screen.change24hMin || change24hPct > config.screen.change24hMax)
      continue;
    if (vol24hUsdt < config.screen.minVol24hUsdt) continue;
    if (oiUsd < config.screen.oiMinUsdt) continue;

    const oiTrend = getOiTrend(t.instId, OI_TREND_WINDOW_MS, now); // null | fraction change
    if (oiTrend !== null && oiTrend < -0.02) continue; // OI clearly falling while price up -> skip

    candidates.push({
      instId: t.instId,
      last,
      open24h,
      high24h: Number(t.high24h),
      low24h: Number(t.low24h),
      change24hPct,
      vol24hUsdt,
      oiUsd,
      oiTrend, // null if not enough history yet
    });
  }

  candidates.sort((a, b) => b.change24hPct - a.change24hPct);
  return candidates;
}
