/* =====================================================================
   worker.js — Cloudflare Worker (free) — Free Fire UID Check Proxy
   ---------------------------------------------------------------------
   Kya karta hai:
   • Website -> Worker -> Free Fire API  (API key website me expose nahi hoti)
   • CORS headers add karta hai (browser block nahi karega)
   • Region na do to IND, BD, SG, ... sab try karke sahi region dhundh leta hai
   • Result 5 min cache karta hai

   Settings (Cloudflare dashboard -> Worker -> Settings -> Variables):
     UPSTREAM_URL   = jo API use kar rahe ho, e.g.
                      https://free-ff-api-src-5plp.onrender.com/api/v1/account
     UPSTREAM_KEY   = (optional) API key, "Secret" type me daalo
     KEY_PARAM      = (optional) key ka param naam, default "key"
     ALLOWED_ORIGIN = apni site, e.g. https://username.github.io  (default: *)

   Call: GET https://<worker>.workers.dev/?uid=1947805969[&region=IND]
   Response: { ok:true, nickname, level, region, guild, uid }
===================================================================== */

const REGIONS = ['IND', 'BD', 'SG', 'ID', 'BR', 'ME', 'PK', 'TH', 'VN', 'TW', 'US', 'RU', 'CIS'];

// nested JSON me key dhundho (alag APIs ke alag field names)
function find(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const r = find(v, keys); if (r !== undefined) return r; }
  }
  return undefined;
}

function extract(data, uid, region) {
  const nickname = find(data, ['nickname', 'nickName', 'name', 'playerName']);
  if (!nickname) return null;
  const g = data.guild || data.clan || data.guildInfo || data.clanBasicInfo;
  const guild = find(data, ['clanName', 'guildName', 'guild_name', 'clan_name']) ||
    (g && typeof g === 'object' ? find(g, ['name', 'clanName', 'guildName']) : (typeof g === 'string' ? g : undefined));
  return {
    ok: true,
    nickname,
    level: find(data, ['level', 'Level', 'accountLevel']) ?? null,
    region: find(data, ['region', 'Region', 'server']) || region,
    guild: guild || null,
    uid
  };
}

async function lookup(env, uid, region) {
  const u = new URL(env.UPSTREAM_URL);
  u.searchParams.set('uid', uid);
  u.searchParams.set('region', region);
  if (env.UPSTREAM_KEY) u.searchParams.set(env.KEY_PARAM || 'key', env.UPSTREAM_KEY);
  const res = await fetch(u.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error('upstream ' + res.status);
  const out = extract(await res.json(), uid, region);
  if (!out) throw new Error('not found in ' + region);
  return out;
}

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8'
    };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.UPSTREAM_URL) return reply({ ok: false, error: 'UPSTREAM_URL set nahi hai' }, 500);

    const url = new URL(request.url);
    const uid = (url.searchParams.get('uid') || '').trim();
    const region = (url.searchParams.get('region') || '').trim().toUpperCase();
    if (!/^\d{6,14}$/.test(uid)) return reply({ ok: false, error: 'Invalid UID' }, 400);

    try {
      // region diya hai to wahi, warna sab regions parallel me try karo
      const result = region
        ? await lookup(env, uid, region)
        : await Promise.any(REGIONS.map(r => lookup(env, uid, r)));
      return reply(result);
    } catch (e) {
      return reply({ ok: false, error: 'Player nahi mila ya API down hai' }, 404);
    }
  }
};
