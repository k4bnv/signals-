import { getCandles, getFundingRate } from './okx.js';
import { rsi, macd, supertrend, last as lastOf } from './indicators.js';
import { config } from './config.js';

function round(n, d = 6) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// Analyzes a single pre-filtered candidate. Returns either:
//  { ok: true, signal: {...} }   when it clears every gate and the score threshold
//  { ok: false, reason: '...' }  when it's rejected, with a short human reason
export async function analyzeCandidate(cand) {
  const { instId, last, high24h, oiTrend } = cand;

  let candles15, candles1h, funding;
  try {
    [candles15, candles1h, funding] = await Promise.all([
      getCandles(instId, '15m', 150),
      getCandles(instId, '1H', 150),
      getFundingRate(instId),
    ]);
  } catch (err) {
    return { ok: false, reason: `ошибка данных (${err.message})` };
  }

  if (candles15.length < 40 || candles1h.length < 40) {
    return { ok: false, reason: 'недостаточно истории свечей' };
  }

  const closes15 = candles15.map((c) => c.c);
  const closes1h = candles1h.map((c) => c.c);

  const rsi15Arr = rsi(closes15, config.indicators.rsiPeriod);
  const rsi1hArr = rsi(closes1h, config.indicators.rsiPeriod);
  const macd15 = macd(closes15);
  const st15 = supertrend(candles15, config.indicators.stPeriod, config.indicators.stMultiplier);
  const st1h = supertrend(candles1h, config.indicators.stPeriod, config.indicators.stMultiplier);

  const rsi15 = lastOf(rsi15Arr);
  const rsi1h = lastOf(rsi1hArr);
  const st15Trend = lastOf(st15.trend);
  const st1hTrend = lastOf(st1h.trend);
  const st15Line = lastOf(st15.line);
  const difLast = lastOf(macd15.macdLine);
  const deaLast = lastOf(macd15.signalLine);
  const histArr = macd15.histogram;
  const histLast = lastOf(histArr);
  const histPrev = histArr.length > 1 ? histArr[histArr.length - 2] : null;

  if (rsi15 === null || st15Trend === null || difLast === null) {
    return { ok: false, reason: 'индикаторы ещё не рассчитаны (мало данных)' };
  }

  // --- hard gates ---
  if (st15Trend !== 'up') return { ok: false, reason: 'Supertrend 15m не в UP' };
  if (rsi15 > config.indicators.rsi15Max)
    return { ok: false, reason: `RSI 15m перекуплен (${round(rsi15, 1)})` };
  if (rsi15 < config.indicators.rsi15Min)
    return { ok: false, reason: `RSI 15m ещё низкий, импульса нет (${round(rsi15, 1)})` };
  if (rsi1h !== null && rsi1h > config.indicators.rsi1hMax)
    return { ok: false, reason: `RSI 1H перекуплен (${round(rsi1h, 1)})` };
  if (oiTrend !== null && oiTrend < -0.02)
    return { ok: false, reason: 'OI падает при росте цены' };

  const distFromHighPct = ((high24h - last) / high24h) * 100;
  if (distFromHighPct < 0.3)
    return { ok: false, reason: 'цена прямо у 24h хая, входить поздно' };

  if (funding && Number(funding.fundingRate) > config.screen.fundingMax)
    return { ok: false, reason: `funding перегрет (${round(Number(funding.fundingRate) * 100, 4)}%)` };

  // --- entry zone / stop / targets ---
  const recentLow = Math.min(...candles15.slice(-8).map((c) => c.l));
  const zoneHigh = last;
  const zoneLow = Math.min(zoneHigh * 0.999, Math.max(st15Line ?? recentLow, recentLow));

  const entryRef = zoneHigh;
  let rawStop = Math.min(st15Line ?? recentLow, recentLow) * 0.998;
  let stopPct = ((entryRef - rawStop) / entryRef) * 100;
  if (stopPct < 1.5) stopPct = 1.5;
  if (stopPct > 3) stopPct = 3;
  const stopPrice = entryRef * (1 - stopPct / 100);

  const tp1 = entryRef * 1.02;
  const tp2 = entryRef * 1.035;

  // --- scoring ---
  let score = 0;
  score += 2; // ST15 UP is a gate, always contributes base points
  score += st1hTrend === 'up' ? 1 : st1hTrend === 'down' ? 0 : 0.5;

  if (rsi15 >= 50 && rsi15 <= 60) score += 2;
  else score += 1;

  if (oiTrend === null) score += 0.5;
  else if (oiTrend >= 0.05) score += 2;
  else if (oiTrend > 0) score += 1;

  const macdBullish = difLast > deaLast;
  const histRising = histPrev !== null && histLast !== null && histLast > histPrev;
  if (macdBullish && histRising) score += 1.5;
  else if (macdBullish || histRising) score += 0.8;

  if (distFromHighPct >= 1 && distFromHighPct <= 3) score += 1.5;
  else if (distFromHighPct < 5) score += 1;
  else score += 0.5;

  const fundingRate = funding ? Number(funding.fundingRate) : 0;
  if (fundingRate <= config.screen.fundingMax * 0.5) score += 1;
  else score += 0.5;

  score = Math.min(10, Math.round(score * 10) / 10);

  if (score < config.risk.minScoreToSignal) {
    return { ok: false, reason: `сетап есть, но скор низкий (${score}/10)` };
  }

  // --- leverage / margin / liq ---
  const greatLiquidity = cand.oiUsd > 2_000_000 && cand.vol24hUsdt > 5_000_000;
  let leverage;
  if (score >= 8 && greatLiquidity) leverage = config.risk.maxLeverageCap;
  else if (score >= 8) leverage = 10;
  else leverage = config.risk.defaultLeverage;

  const marginUsdt = config.risk.defaultMarginUsdt;
  const liqPct = Math.max(1, 100 / leverage - 0.5);
  const liqPrice = entryRef * (1 - liqPct / 100);

  const reasons = [
    `ST 15m UP${st1hTrend ? `, 1H ${st1hTrend.toUpperCase()}` : ''}`,
    `RSI 15m ${round(rsi15, 1)}${rsi1h !== null ? `, 1H ${round(rsi1h, 1)}` : ''}`,
    oiTrend === null
      ? 'OI: недостаточно истории (только начал накапливаться)'
      : `OI ${oiTrend >= 0 ? '+' : ''}${round(oiTrend * 100, 1)}% за ~1ч`,
  ];

  return {
    ok: true,
    signal: {
      instId,
      score,
      entryLow: round(zoneLow, 6),
      entryHigh: round(zoneHigh, 6),
      stop: round(stopPrice, 6),
      tp1: round(tp1, 6),
      tp2: round(tp2, 6),
      leverage,
      marginUsdt,
      liqPct: round(liqPct, 1),
      liqPrice: round(liqPrice, 6),
      reasons,
      riskNote: 'Пробой ST 15m вниз или возврат RSI 15m ниже 45 отменяет сетап',
      st15Line,
    },
  };
}
