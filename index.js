import { config, hasOkxKeys, hasTelegram } from './src/config.js';
import { screenCandidates } from './src/screener.js';
import { analyzeCandidate } from './src/analyzer.js';
import { formatSignalMessage, formatNoTradeMessage } from './src/messages.js';
import { sendTelegram } from './src/telegram.js';
import { monitorPositions } from './src/positionMonitor.js';
import { startServer } from './src/server.js';
import {
  isOnCooldown,
  setLastSignal,
  isPaused,
  shouldSendNoTrade,
  markNoTradeSent,
  addSignalRecord,
  setLastCycle,
} from './src/state.js';

const MAX_CANDIDATES_PER_CYCLE = 20;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

async function runCycle() {
  if (isPaused()) {
    log('пауза после серии убытков — пропускаю поиск новых сигналов, мониторинг позиций продолжается');
    await monitorPositions();
    return;
  }

  const candidates = await screenCandidates();
  log(`скрининг: ${candidates.length} кандидатов после фильтров`);
  setLastCycle(candidates.length);

  const shortlist = candidates.slice(0, MAX_CANDIDATES_PER_CYCLE);
  const rejections = [];
  let sentAny = false;

  for (const cand of shortlist) {
    if (isOnCooldown(cand.instId, config.loop.signalCooldownMin * 60 * 1000)) continue;

    let result;
    try {
      result = await analyzeCandidate(cand);
    } catch (err) {
      log(`ошибка анализа ${cand.instId}:`, err.message);
      continue;
    }

    if (result.ok) {
      const { signal } = result;
      log(`СИГНАЛ ${signal.instId} score=${signal.score}`);
      await sendTelegram(formatSignalMessage(signal));
      setLastSignal(signal.instId, signal);
      addSignalRecord(signal);
      sentAny = true;
    } else {
      rejections.push({ instId: cand.instId, reason: result.reason });
    }
  }

  if (!sentAny && shouldSendNoTrade(config.loop.noTradeUpdateMin * 60 * 1000)) {
    await sendTelegram(formatNoTradeMessage(rejections));
    markNoTradeSent();
  }

  await monitorPositions();
}

let running = false;
async function tick() {
  if (running) {
    log('предыдущий цикл ещё выполняется, пропускаю тик');
    return;
  }
  running = true;
  try {
    await runCycle();
  } catch (err) {
    log('ошибка цикла:', err.stack || err.message);
  } finally {
    running = false;
  }
}

async function loop() {
  await tick();
  // re-read the interval each time so changes made from the web dashboard
  // take effect on the next cycle without restarting the process
  setTimeout(loop, config.loop.screenIntervalSec * 1000);
}

async function main() {
  log('OKX scalp signal bot запущен (signals-only, без автоторговли)');
  log(`Telegram: ${hasTelegram() ? 'настроен' : 'НЕ настроен (сообщения только в консоль)'}`);
  log(`OKX ключи: ${hasOkxKeys() ? 'есть (мониторинг позиций включен)' : 'нет (только скрининг/сигналы)'}`);

  startServer();
  loop();
}

main().catch((err) => {
  console.error('Фатальная ошибка запуска:', err);
  process.exit(1);
});
