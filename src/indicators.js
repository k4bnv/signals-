// All indicator functions take arrays aligned with candles in chronological order
// (oldest first) and return arrays of the same length, front-padded with null
// where the value cannot yet be computed.

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    if (prev === undefined) {
      // seed with SMA of first `period` values once we have enough
      if (i >= period - 1) {
        const slice = values.slice(i - period + 1, i + 1);
        prev = slice.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = closes.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null ? macdLine[i] - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

export function atr(candles, period = 10) {
  const out = new Array(candles.length).fill(null);
  const trs = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prevClose = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
  });
  let prevAtr;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue;
    if (prevAtr === undefined) {
      prevAtr = trs.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    } else {
      prevAtr = (prevAtr * (period - 1) + trs[i]) / period;
    }
    out[i] = prevAtr;
  }
  return out;
}

// Classic Supertrend. Returns { trend: 'up'|'down'|null per bar, line: number|null per bar }
export function supertrend(candles, period = 10, multiplier = 3) {
  const atrVals = atr(candles, period);
  const n = candles.length;
  const trend = new Array(n).fill(null);
  const line = new Array(n).fill(null);

  let finalUpper, finalLower, curTrend;

  for (let i = 0; i < n; i++) {
    if (atrVals[i] === null) continue;
    const hl2 = (candles[i].h + candles[i].l) / 2;
    const basicUpper = hl2 + multiplier * atrVals[i];
    const basicLower = hl2 - multiplier * atrVals[i];

    if (finalUpper === undefined) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      curTrend = candles[i].c >= (finalUpper + finalLower) / 2 ? 'up' : 'down';
    } else {
      const prevClose = candles[i - 1].c;
      finalUpper =
        basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower =
        basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

      if (curTrend === 'up') {
        curTrend = candles[i].c < finalLower ? 'down' : 'up';
      } else {
        curTrend = candles[i].c > finalUpper ? 'up' : 'down';
      }
    }

    trend[i] = curTrend;
    line[i] = curTrend === 'up' ? finalLower : finalUpper;
  }

  return { trend, line };
}

export const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);
