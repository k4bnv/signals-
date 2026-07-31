import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, hasTelegram, hasOkxKeys, getEditableSettings, updateSettings } from './config.js';
import { getSignals, getStats, getState, isPaused } from './state.js';

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

  const port = config.web.port;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[web] дашборд: http://localhost:${port}`);
  });
  return server;
}
