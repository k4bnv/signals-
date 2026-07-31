import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, hasTelegram, hasOkxKeys, getEditableSettings, updateSettings } from './config.js';
import { getSignals, getStats, getState, isPaused } from './state.js';
import { getPositions } from './okx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // lightweight liveness probe for container platforms (Dokploy healthcheck)
  app.get('/health', (req, res) => res.status(200).send('ok'));

  app.get('/api/status', (req, res) => {
    const s = getState();
    res.json({
      lastCycleAt: s.lastCycleAt,
      lastCandidateCount: s.lastCandidateCount,
      paused: isPaused(),
      pauseUntil: s.pauseUntil,
      lossStreak: s.lossStreak,
      telegramConfigured: hasTelegram(),
      okxConfigured: hasOkxKeys(),
      screenIntervalSec: config.loop.screenIntervalSec,
    });
  });

  app.get('/api/settings', (req, res) => {
    res.json(getEditableSettings());
  });

  app.post('/api/settings', (req, res) => {
    try {
      const updated = updateSettings(req.body || {});
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/orders', (req, res) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    res.json(getSignals(limit));
  });

  app.get('/api/stats', (req, res) => {
    res.json(getStats());
  });

  // Live open positions straight from OKX (read-only), independent of the
  // signal journal, so the dashboard can show what's *actually* open on the
  // exchange right now vs. just signals that were sent but never acted on.
  app.get('/api/positions', async (req, res) => {
    if (!hasOkxKeys()) return res.json({ configured: false, positions: [] });
    try {
      const raw = await getPositions('SWAP');
      const positions = raw
        .filter((p) => Number(p.pos) !== 0)
        .map((p) => {
          const avgPx = Number(p.avgPx);
          const markPx = Number(p.markPx || p.last || avgPx);
          return {
            instId: p.instId,
            posSide: p.posSide,
            avgPx,
            markPx,
            pnlPct: avgPx ? ((markPx - avgPx) / avgPx) * 100 : null,
            lever: p.lever,
            liqPx: p.liqPx ? Number(p.liqPx) : null,
          };
        });
      res.json({ configured: true, positions });
    } catch (err) {
      res.status(502).json({ configured: true, error: err.message, positions: [] });
    }
  });

  const port = config.web.port;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[web] дашборд: http://localhost:${port}`);
  });
  return server;
}
