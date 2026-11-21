
 // Cloudflare Pages Function: /api/request-song
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }
});

export function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.REQUEST_HASH_SECRET) {
      console.error('Request Song: missing DB binding or required secret');
      return json({ error: 'Server configuration incomplete.' }, 503);
    }

    if (Number(request.headers.get('content-length') || 0) > 4096) {
      return json({ error: 'Request too large.' }, 413);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON.' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Invalid request.' }, 400);
    }

    const artist = typeof body.artist === 'string' ? body.artist.trim().replace(/\s+/g, ' ') : '';
    const song = typeof body.song === 'string' ? body.song.trim().replace(/\s+/g, ' ') : '';
    if (!artist || !song || artist.length > 100 || song.length > 150) {
      return json({ error: 'Enter artist and song title (max 100/150 characters).' }, 400);
    }

    // Spam trap: real visitors do not fill this field.
    if (body.website) return json({ ok: true });

    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return json({ error: 'Unable to verify request.' }, 400);

    const ua = (request.headers.get('User-Agent') || '').slice(0, 180);
    const input = new TextEncoder().encode(`${env.REQUEST_HASH_SECRET}|${ip}|${ua}`);
    const digest = await crypto.subtle.digest('SHA-256', input);
    const listener = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const now = Math.floor(Date.now() / 1000);

    // Atomic one-request-per-hour claim.
    let claimed;
    try {
      claimed = await env.DB.prepare(`
        INSERT INTO request_cooldowns (listener_key, last_request)
        VALUES (?, ?)
        ON CONFLICT(listener_key) DO UPDATE SET last_request = excluded.last_request
        WHERE request_cooldowns.last_request <= excluded.last_request - 3600
        RETURNING last_request
      `).bind(listener, now).first();
    } catch (e) {
      console.error('Request Song D1 cooldown failed:', String(e));
      return json({ error: 'Database temporarily unavailable.' }, 503);
    }

    if (!claimed) {
      let retryAfter = 3600;
      try {
        const previous = await env.DB.prepare('SELECT last_request FROM request_cooldowns WHERE listener_key = ?')
          .bind(listener).first();
        if (previous) retryAfter = Math.max(1, 3600 - (now - Number(previous.last_request)));
      } catch (e) {
        console.error('Request Song D1 retry lookup failed:', String(e));
      }
      return json({ error: 'Please wait before requesting another song.', retryAfter }, 429);
    }

    const message = `🎵 New Song Request!\n🎤 Artist: ${artist}\n🎶 Song: ${song}\n📻 NodirBest Radio`;
    let telegramOk = false;
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
        signal: AbortSignal.timeout(10000)
      });
      const result = await response.json().catch(() => null);
      telegramOk = response.ok && result?.ok === true;
      if (!telegramOk) {
        // Never log the token or the Telegram URL.
        console.error('Request Song Telegram failed:', response.status, result?.description || 'unknown error');
      }
    } catch (e) {
      console.error('Request Song Telegram connection failed:', e?.name || 'Error');
    }

    if (!telegramOk) {
      // Allow retry if delivery failed; only release this exact claim.
      try {
        await env.DB.prepare('DELETE FROM request_cooldowns WHERE listener_key = ? AND last_request = ?')
          .bind(listener, now).run();
      } catch (e) {
        console.error('Request Song D1 cooldown release failed:', String(e));
      }
      return json({ error: 'Telegram delivery failed. Please try again later.' }, 502);
    }

    try {
      await env.DB.prepare('INSERT INTO song_requests (listener_key, artist, song_title, created_at) VALUES (?, ?, ?, ?)')
        .bind(listener, artist, song, now).run();
    } catch (e) {
      // Telegram was already sent; do not tell the visitor to resend.
      console.error('Request Song D1 history insert failed:', String(e));
    }

    return json({ ok: true, message: 'Request sent! Thank you.' });
  } catch (e) {
    console.error('Request Song unexpected error:', e?.name || 'Error', e?.message || 'unknown');
    return json({ error: 'Temporary server error. Please try again later.' }, 500);
  }
}
