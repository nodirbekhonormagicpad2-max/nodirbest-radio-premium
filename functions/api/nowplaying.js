
const STATION_API =
  'https://artemis.streamerr.co/api/nowplaying/nodirbest_radio';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=15'
    }
  });

const normalize = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

async function artwork(artist, title) {
  if (!artist || !title) return null;

  try {
    const url =
      'https://itunes.apple.com/search?term=' +
      encodeURIComponent(artist + ' ' + title) +
      '&entity=song&limit=20';

    const r = await fetch(url, {
      signal: AbortSignal.timeout(6500)
    });

    if (!r.ok) return null;

    const data = await r.json();
    const a = normalize(artist);
    const t = normalize(title);

    const match = (data.results || []).find(x => {
      const xa = normalize(x.artistName);
      const xt = normalize(x.trackName);

      return x.artworkUrl100 &&
        xa && xt &&
        (xa === a || xa.includes(a) || a.includes(xa)) &&
        (xt === t || xt.includes(t) || t.includes(xt));
    });

    return match
      ? match.artworkUrl100.replace(
          /100x100bb|100x100/g,
          '600x600bb'
        )
      : null;

  } catch {
    return null;
  }
}

export async function onRequestGet() {
  try {
    const r = await fetch(STATION_API, {
      headers: {
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(9000)
    });

    if (!r.ok) {
      throw Error('Station API HTTP ' + r.status);
    }

    const d = await r.json();

    // NOW PLAYING
    const current = d.now_playing?.song || {};

    const artist = current.artist || '';
    const song = current.title || '';

    // UP NEXT
    const next = d.playing_next?.song || null;

    const nextArtist = next?.artist || '';
    const nextTitle = next?.title || '';

    // Fetch artwork for both tracks
    const [currentImage, nextImage] =
      await Promise.all([
        artwork(artist, song),
        next
          ? artwork(nextArtist, nextTitle)
          : Promise.resolve(null)
      ]);

    return json({
      artist,
      song,

      image: currentImage || current.art || null,

      playedAt:
        d.now_playing?.played_at || null,

      duration:
        d.now_playing?.duration || null,

      isOnline:
        d.is_online ?? null,

      // NEXT SONG INFORMATION
      next_song: next
        ? {
            title: nextTitle,
            artist: nextArtist,
            image: nextImage || next.art || null
          }
        : null
    });

  } catch (e) {
    return json({
      artist: null,
      song: null,
      image: null,
      playedAt: null,
      duration: null,
      isOnline: null,
      next_song: null
    }, 503);
  }
}
