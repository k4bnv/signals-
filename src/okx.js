import crypto from 'node:crypto';
import { config } from './config.js';

const BASE = config.okx.baseUrl;

function buildQuery(params) {
  if (!params || Object.keys(params).length === 0) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

async function rawRequest(method, path, { params, signed = false } = {}) {
  const query = buildQuery(params);
  const requestPath = `${path}${query}`;
  const url = `${BASE}${requestPath}`;

  const headers = { 'Content-Type': 'application/json' };

  if (signed) {
    const timestamp = new Date().toISOString();
    const prehash = `${timestamp}${method}${requestPath}`;
    const sign = crypto
      .createHmac('sha256', config.okx.apiSecret)
      .update(prehash)
      .digest('base64');
    headers['OK-ACCESS-KEY'] = config.okx.apiKey;
    headers['OK-ACCESS-SIGN'] = sign;
    headers['OK-ACCESS-TIMESTAMP'] = timestamp;
    headers['OK-ACCESS-PASSPHRASE'] = config.okx.passphrase;
    if (config.okx.demo) headers['x-simulated-trading'] = '1';
  }

  const res = await fetch(url, { method, headers });
  const json = await res.json();
  if (json.code !== '0') {
    const err = new Error(`OKX API error [${path}]: ${json.code} ${json.msg}`);
    err.okxCode = json.code;
    throw err;
  }
  return json.data;
}

export const okxPublic = (path, params) => rawRequest('GET', path, { params, signed: false });
export const okxPrivate = (path, params) => rawRequest('GET', path, { params, signed: true });

export async function getInstruments(instType = 'SWAP') {
  return okxPublic('/api/v5/public/instruments', { instType });
}

export async function getTickers(instType = 'SWAP') {
  return okxPublic('/api/v5/market/tickers', { instType });
}

export async function getOpenInterest(instType = 'SWAP') {
  return okxPublic('/api/v5/public/open-interest', { instType });
}

export async function getCandles(instId, bar, limit = 150) {
  const data = await okxPublic('/api/v5/market/candles', { instId, bar, limit });
  // OKX returns newest-first; reverse to chronological order.
  return data
    .map((c) => ({
      ts: Number(c[0]),
      o: Number(c[1]),
      h: Number(c[2]),
      l: Number(c[3]),
      c: Number(c[4]),
      vol: Number(c[5]),
    }))
    .reverse();
}

export async function getFundingRate(instId) {
  const data = await okxPublic('/api/v5/public/funding-rate', { instId });
  return data[0];
}

export async function getPositions(instType = 'SWAP') {
  return okxPrivate('/api/v5/account/positions', { instType });
}
