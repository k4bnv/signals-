import { getPositions, getCandles } from './okx.js';
import { supertrend, last as lastOf } from './indicators.js';
import { config, hasOkxKeys } from './config.js';
import {
  getLastSignal,
  getPrevPosition,
  setPrevPosition,
  clearPrevPosition,
  allPrevPositionKeys,
  recordTradeResult,
  pauseAfterLosses,
  updateSignalStatus,
} from './state.js';
import { sendTelegram } from './telegram.js';
import { formatPositionAlert } from './messages.js';

const GENERIC_TP1_PCT = 1.5;
const GENERIC_STOP_PCT = -1.2;

async function checkStFlip(instId) {
  try {
    const candles = await getCandles(instId, '15m', 60);
    const st = supertrend(candles, config.indicators.stPeriod, config.indicators.stMultiplier);
    return lastOf(st.trend);
  } catch {
    return null;
  }
}

export async function monitorPositions() {
  if (!hasOkxKeys()) return;

  let positions;
  try {
    positions = await getPositions('SWAP');
  } catch (err) {
    console.error('[positionMonitor] failed to fetch positions:', err.message);
    return;
  }

  const openLongs = positions.filter(
    (p) => Number(p.pos) !== 0 && (p.posSide === 'long' || (p.posSide === 'net' && Number(p.pos) > 0))
  );
  const openInstIds = new Set(openLongs.map((p) => p.instId));

  for (const p of openLongs) {
    const avgPx = Number(p.avgPx);
    const markPx = Number(p.markPx || p.last || avgPx);
    if (!avgPx) continue;
    const priceChangePct = ((markPx - avgPx) / avgPx) * 100;

    const prev = getPrevPosition(p.instId) || {
      alertedTp1: false,
      alertedNearStop: false,
      alertedStFlip: false,
    };

    const sig = getLastSignal(p.instId);
    const tp1Trigger = sig ? sig.tp1 : avgPx * (1 + GENERIC_TP1_PCT / 100);
    const stopTrigger = sig ? sig.stop : avgPx * (1 + GENERIC_STOP_PCT / 100);

    if (!prev.alertedTp1 && markPx >= tp1Trigger) {
      await sendTelegram(
        formatPositionAlert(p.instId, 'tp1', `Цена: ${markPx}, PnL: ${priceChangePct.toFixed(2)}% (x${p.lever})`)
      );
      prev.alertedTp1 = true;
      updateSignalStatus(p.instId, { status: 'tp1_hit' });
    }

    if (!prev.alertedNearStop && markPx <= stopTrigger * 1.003) {
      await sendTelegram(
        formatPositionAlert(p.instId, 'nearStop', `Цена: ${markPx}, стоп: ${stopTrigger.toFixed(6)}`)
      );
      prev.alertedNearStop = true;
    }

    if (!prev.alertedStFlip) {
      const trend = await checkStFlip(p.instId);
      if (trend === 'down') {
        await sendTelegram(formatPositionAlert(p.instId, 'stFlip', `Рассмотрите ранний выход`));
        prev.alertedStFlip = true;
      }
    }

    setPrevPosition(p.instId, { ...prev, avgPx, lastPnlPct: priceChangePct });
  }

  // detect closures: was tracked previously, no longer present -> settle win/loss
  for (const instId of allPrevPositionKeys()) {
    if (openInstIds.has(instId)) continue;
    const prev = getPrevPosition(instId);
    clearPrevPosition(instId);
    if (!prev) continue;

    const won = (prev.lastPnlPct ?? 0) > 0;
    await sendTelegram(
      formatPositionAlert(
        instId,
        won ? 'closedWin' : 'closedLoss',
        `Итоговый PnL: ~${(prev.lastPnlPct ?? 0).toFixed(2)}%`
      )
    );
    updateSignalStatus(instId, {
      status: won ? 'closed_win' : 'closed_loss',
      closedAt: Date.now(),
      resultPct: prev.lastPnlPct ?? 0,
    });

    const streak = recordTradeResult(won);
    if (!won && streak >= 2) {
      const pauseMs = config.loop.lossStreakPauseMin * 60 * 1000;
      pauseAfterLosses(pauseMs);
      await sendTelegram(
        formatPositionAlert(
          instId,
          'pause',
          `2 убытка подряд — пауза на ${config.loop.lossStreakPauseMin} мин`
        )
      );
    }
  }
}
