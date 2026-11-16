const STATION_API='https://artemis.streamerr.co/api/nowplaying/nodirbest_radio';
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=15'}});
const normalize=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
async function artwork(artist,title){
 if(!artist||!title)return null;
 try{const u='https://itunes.apple.com/search?term='+encodeURIComponent(artist+' '+title)+'&entity=song&limit=20';const r=await fetch(u,{signal:AbortSignal.timeout(6500)});if(!r.ok)return null;const data=await r.json();const a=normalize(artist),t=normalize(title);const match=(data.results||[]).find(x=>{const xa=normalize(x.artistName),xt=normalize(x.trackName);return x.artworkUrl100&&xa&&xt&&(xa===a||xa.includes(a)||a.includes(xa))&&(xt===t||xt.includes(t)||t.includes(xt))});return match?match.artworkUrl100.replace(/100x100bb|100x100/g,'600x600bb'):null}catch{return null}
}
export async function onRequestGet(){try{const r=await fetch(STATION_API,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error('Station API HTTP '+r.status);const d=await r.json();const s=d.now_playing?.song||{};const artist=s.artist||'',song=s.title||'';const image=await artwork(artist,song)||s.art||null;return json({artist,song,image,playedAt:d.now_playing?.played_at||null,duration:d.now_playing?.duration||null,isOnline:d.is_online??null})}catch(e){return json({artist:null,song:null,image:null,playedAt:null,duration:null,isOnline:null},503)}}
