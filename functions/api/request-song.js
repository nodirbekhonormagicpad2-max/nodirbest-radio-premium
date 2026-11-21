export async function onRequestPost({ request, env }) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.REQUEST_HASH_SECRET) return reply({ error: 'Server configuration incomplete.' }, 503);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 4096) return reply({ error: 'Request too large.' }, 413);
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON.' }, 400); }
  const artist = typeof body.artist === 'string' ? body.artist.trim().replace(/\s+/g, ' ') : '';
  const song = typeof body.song === 'string' ? body.song.trim().replace(/\s+/g, ' ') : '';
  if (!artist || !song || artist.length > 100 || song.length > 150) return reply({ error: 'Please enter artist and song title (max 100/150 characters).' }, 400);
  // Honeypot field: ordinary visitors leave it empty.
  if (body.website) return reply({ ok: true });
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return reply({ error: 'Unable to verify request.' }, 400);
  const ua = (request.headers.get('User-Agent') || '').slice(0, 180);
  const raw = new TextEncoder().encode(`${env.REQUEST_HASH_SECRET}|${ip}|${ua}`);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  const listener = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  const now = Math.floor(Date.now() / 1000);
  try {
    // Atomic claim: only one request per listener in a rolling 3600-second window.
    const claimed = await env.DB.prepare(`INSERT INTO request_cooldowns (listener_key, last_request)
      VALUES (?, ?) ON CONFLICT(listener_key) DO UPDATE SET last_request = excluded.last_request
      WHERE request_cooldowns.last_request <= excluded.last_request - 3600
      RETURNING last_request`).bind(listener, now).first();
    if (!claimed) {
      const previous = await env.DB.prepare('SELECT last_request FROM request_cooldowns WHERE listener_key = ?').bind(listener).first();
      const retry = Math.max(1, 3600 - (now - Number(previous?.last_request || now)));
      return reply({ error: 'Please wait before requesting another song.', retryAfter: retry }, 429);
    }
    const text = `🎵 New Song Request!\n🎤 Artist: ${artist}\n🎶 Song: ${song}\n📻 NodirBest Radio`;
    const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
    });
    const result = await tg.json().catch(() => ({}));
    if (!tg.ok || !result.ok) {
      await env.DB.prepare('DELETE FROM request_cooldowns WHERE listener_key = ? AND last_request = ?').bind(listener, now).run();
      return reply({ error: 'Could not deliver request. Please try again later.' }, 502);
    }
    await env.DB.prepare('INSERT INTO song_requests (listener_key, artist, song_title, created_at) VALUES (?, ?, ?, ?)').bind(listener, artist, song, now).run();
    return reply({ ok: true, message: 'Request sent! Thank you.' });
  } catch (e) {
    console.error('Request song error:', e);
    return reply({ error: 'Temporary server error. Please try again later.' }, 500);
  }
}

export function onRequestGet() {
  return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
}
