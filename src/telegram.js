import { config, hasTelegram } from './config.js';

export async function sendTelegram(text) {
  if (!hasTelegram()) {
    console.log('[telegram:skip - no token/chat_id configured]\n' + text);
    return;
  }
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      console.error('[telegram] send failed:', json.description);
    }
  } catch (err) {
    console.error('[telegram] send error:', err.message);
  }
}
