const FIELD_META = {
  loop: {
    title: 'Цикл',
    fields: {
      screenIntervalSec: { label: 'Интервал скрининга, сек', step: 5 },
      positionCheckIntervalSec: { label: 'Проверка позиций, сек', step: 5 },
      noTradeUpdateMin: { label: 'NO TRADE апдейт, мин', step: 1 },
      signalCooldownMin: { label: 'Кулдаун сигнала, мин', step: 1 },
      lossStreakPauseMin: { label: 'Пауза после 2 убытков, мин', step: 1 },
    },
  },
  screen: {
    title: 'Скрининг',
    fields: {
      change24hMin: { label: '24h change min, %', step: 0.5 },
      change24hMax: { label: '24h change max, %', step: 0.5 },
      oiMinUsdt: { label: 'OI мин, USDT', step: 10000 },
      minVol24hUsdt: { label: 'Объём 24h мин, USDT', step: 100000 },
      fundingMax: { label: 'Funding max (доля)', step: 0.0001 },
    },
  },
  indicators: {
    title: 'Индикаторы',
    fields: {
      rsiPeriod: { label: 'RSI период', step: 1 },
      rsi15Min: { label: 'RSI 15m мин', step: 1 },
      rsi15Max: { label: 'RSI 15m макс', step: 1 },
      rsi1hMax: { label: 'RSI 1H макс', step: 1 },
      stPeriod: { label: 'Supertrend период', step: 1 },
      stMultiplier: { label: 'Supertrend множитель', step: 0.1 },
    },
  },
  risk: {
    title: 'Риск-менеджмент',
    fields: {
      defaultLeverage: { label: 'Плечо по умолчанию', step: 1 },
      maxLeverageCap: { label: 'Плечо макс.', step: 1 },
      defaultMarginUsdt: { label: 'Маржа по умолчанию, USDT', step: 1 },
      minScoreToSignal: { label: 'Мин. скор для сигнала', step: 0.5 },
    },
  },
};

const STATUS_LABELS = {
  open: 'открыт',
  tp1_hit: 'TP1 взят',
  closed_win: 'закрыт (профит)',
  closed_loss: 'закрыт (убыток)',
  expired: 'неактуален',
};

function fmtNum(n) {
  if (n === null || n === undefined) return '-';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return Number(n.toFixed(digits)).toString();
}

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildSettingsForm(settings) {
  const form = document.getElementById('settingsForm');
  form.innerHTML = '';
  for (const [group, meta] of Object.entries(FIELD_META)) {
    const fs = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = meta.title;
    fs.appendChild(legend);
    for (const [key, fmeta] of Object.entries(meta.fields)) {
      const row = document.createElement('div');
      row.className = 'field';
      const label = document.createElement('label');
      label.textContent = fmeta.label;
      label.htmlFor = `${group}.${key}`;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = fmeta.step;
      input.id = `${group}.${key}`;
      input.name = `${group}.${key}`;
      input.value = settings[group]?.[key] ?? '';
      row.appendChild(label);
      row.appendChild(input);
      fs.appendChild(row);
    }
    form.appendChild(fs);
  }
}

function readSettingsForm() {
  const form = document.getElementById('settingsForm');
  const patch = {};
  for (const input of form.querySelectorAll('input')) {
    const [group, key] = input.name.split('.');
    if (!patch[group]) patch[group] = {};
    patch[group][key] = Number(input.value);
  }
  return patch;
}

async function loadSettings() {
  const res = await fetch('/api/settings');
  const settings = await res.json();
  buildSettingsForm(settings);
}

async function saveSettings(e) {
  e.preventDefault();
  const status = document.getElementById('saveStatus');
  status.textContent = 'Сохраняю...';
  status.className = 'save-status';
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readSettingsForm()),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'ошибка сохранения');
    status.textContent = 'Сохранено ✓';
    status.className = 'save-status ok';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'save-status bad';
  }
  setTimeout(() => (status.textContent = ''), 4000);
}

function renderStatus(s) {
  const wrap = document.getElementById('statusPills');
  const pills = [];
  pills.push(
    s.paused
      ? { text: `⏸ пауза до ${fmtTime(s.pauseUntil)}`, cls: 'warn' }
      : { text: '● работает', cls: 'ok' }
  );
  pills.push({ text: `цикл: ${s.screenIntervalSec}с`, cls: '' });
  pills.push({
    text: `последний скрининг: ${s.lastCycleAt ? fmtTime(s.lastCycleAt) : '—'} (${s.lastCandidateCount} кандидатов)`,
    cls: '',
  });
  pills.push({ text: `Telegram: ${s.telegramConfigured ? 'ок' : 'не настроен'}`, cls: s.telegramConfigured ? 'ok' : 'bad' });
  pills.push({ text: `OKX ключи: ${s.okxConfigured ? 'ок' : 'нет'}`, cls: s.okxConfigured ? 'ok' : 'warn' });
  wrap.innerHTML = pills.map((p) => `<span class="pill ${p.cls}">${p.text}</span>`).join('');
}

function renderStats(stats) {
  const wrap = document.getElementById('statCards');
  const winRateStr = stats.winRate === null ? '-' : `${stats.winRate.toFixed(1)}%`;
  const avgPnlStr = stats.avgPnlPct === null ? '-' : `${stats.avgPnlPct >= 0 ? '+' : ''}${stats.avgPnlPct.toFixed(2)}%`;
  const cards = [
    { label: 'Всего сигналов', value: stats.totalSignals },
    { label: 'Открыто', value: stats.openSignals },
    { label: 'Закрыто', value: stats.closed },
    { label: 'Winrate', value: winRateStr, cls: stats.winRate >= 50 ? 'green' : stats.winRate !== null ? 'red' : '' },
    { label: 'Средний PnL', value: avgPnlStr, cls: stats.avgPnlPct > 0 ? 'green' : stats.avgPnlPct < 0 ? 'red' : '' },
    { label: 'Серия убытков', value: stats.lossStreak, cls: stats.lossStreak >= 2 ? 'red' : '' },
  ];
  wrap.innerHTML = cards
    .map(
      (c) =>
        `<div class="card"><div class="label">${c.label}</div><div class="value ${c.cls || ''}">${c.value}</div></div>`
    )
    .join('');
}

function renderOrders(orders) {
  const body = document.getElementById('ordersBody');
  if (!orders.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="11">Сигналов пока не было</td></tr>';
    return;
  }
  body.innerHTML = orders
    .map((o) => {
      const result =
        o.resultPct === undefined || o.resultPct === null
          ? '-'
          : `${o.resultPct >= 0 ? '+' : ''}${o.resultPct.toFixed(2)}%`;
      const entry =
        o.entryLow === o.entryHigh
          ? fmtNum(o.entryLow)
          : `${fmtNum(o.entryLow)}&ndash;${fmtNum(o.entryHigh)}`;
      const pair = o.source === 'manual' ? `${o.instId} <span class="hint-inline">(ручной)</span>` : o.instId;
      return `<tr>
        <td>${fmtTime(o.t)}</td>
        <td>${pair}</td>
        <td>${entry}</td>
        <td>${fmtNum(o.stop)}</td>
        <td>${fmtNum(o.tp1)}</td>
        <td>${fmtNum(o.tp2)}</td>
        <td>${o.leverage ? `${o.leverage}x` : '-'}</td>
        <td>${o.marginUsdt ? `${o.marginUsdt} USDT` : '-'}</td>
        <td>${o.score !== null && o.score !== undefined ? `${o.score}/10` : '-'}</td>
        <td><span class="badge ${o.status}">${STATUS_LABELS[o.status] || o.status}</span></td>
        <td>${result}</td>
      </tr>`;
    })
    .join('');
}

function renderPositions(data) {
  const body = document.getElementById('positionsBody');
  if (!data.configured) {
    body.innerHTML =
      '<tr class="empty-row"><td colspan="7">OKX read-only ключи не заданы — мониторинг позиций недоступен</td></tr>';
    return;
  }
  if (!data.positions.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="7">Открытых позиций на OKX сейчас нет</td></tr>';
    return;
  }
  body.innerHTML = data.positions
    .map((p) => {
      const pnlCls = p.pnlPct > 0 ? 'green' : p.pnlPct < 0 ? 'red' : '';
      const pnlStr = p.pnlPct === null ? '-' : `${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%`;
      return `<tr>
        <td>${p.instId}</td>
        <td>${p.posSide}</td>
        <td>${fmtNum(p.avgPx)}</td>
        <td>${fmtNum(p.markPx)}</td>
        <td class="${pnlCls}">${pnlStr}</td>
        <td>${p.lever}x</td>
        <td>${p.liqPx ? fmtNum(p.liqPx) : '-'}</td>
      </tr>`;
    })
    .join('');
}

async function refresh() {
  try {
    const [status, stats, orders, positions] = await Promise.all([
      fetch('/api/status').then((r) => r.json()),
      fetch('/api/stats').then((r) => r.json()),
      fetch('/api/orders?limit=200').then((r) => r.json()),
      fetch('/api/positions').then((r) => r.json()),
    ]);
    renderStatus(status);
    renderStats(stats);
    renderOrders(orders);
    renderPositions(positions);
  } catch (err) {
    console.error('refresh failed', err);
  }
}

document.getElementById('settingsForm').addEventListener('submit', saveSettings);

loadSettings();
refresh();
setInterval(refresh, 10000);
