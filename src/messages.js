function fmt(n) {
  if (n === null || n === undefined) return '-';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatSignalMessage(signal) {
  const s = signal;
  return [
    `🚀 SIGNAL LONG`,
    `Пара: ${s.instId}`,
    `Таймфрейм: 15m/1H`,
    `Вход: ${fmt(s.entryLow)} – ${fmt(s.entryHigh)}`,
    `Стоп: ${fmt(s.stop)}`,
    `Тейк1: ${fmt(s.tp1)} | Тейк2: ${fmt(s.tp2)}`,
    `Плечо: ${s.leverage}x isolated`,
    `Маржа: ${s.marginUsdt} USDT`,
    `Оценка: ${s.score}/10`,
    `Почему:`,
    ...s.reasons.map((r) => `• ${r}`),
    `Риск: ${s.riskNote}`,
    `Ликвидация (прибл., ${s.leverage}x): ~${fmt(s.liqPrice)} (-${s.liqPct}%)`,
  ].join('\n');
}

export function formatNoTradeMessage(topObservations) {
  const lines = [`⏸ NO TRADE`, `Кратко: подходящих сетапов сейчас нет`, `Топ-3 наблюдения:`];
  const obs = topObservations.slice(0, 3);
  if (obs.length === 0) {
    lines.push('• рынок тихий, кандидатов после фильтра по объёму/OI/change24h нет');
  } else {
    for (const o of obs) lines.push(`• ${o.instId}: ${o.reason}`);
  }
  return lines.join('\n');
}

export function formatPositionAlert(instId, kind, details) {
  const headers = {
    tp1: '✅ TP1 достигнут',
    nearStop: '⚠️ Цена у стопа',
    stFlip: '🔻 Supertrend 15m развернулся вниз',
    closedWin: '✅ Позиция закрыта в плюс',
    closedLoss: '❌ Позиция закрыта в минус',
    pause: '⏸ Пауза после 2 убытков подряд',
  };
  const lines = [headers[kind] || kind, `Пара: ${instId}`];
  if (details) lines.push(details);
  return lines.join('\n');
}
