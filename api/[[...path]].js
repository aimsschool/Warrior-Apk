import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

const redis = Redis.fromEnv();
const TTL = 15 * 60;
const OTP_TTL = 120;
const json = (res, status, body) => { res.status(status).setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'content-type'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS'); res.end(JSON.stringify(body)); };
const fail = (res, status, error) => json(res, status, {ok:false, error});
const token = () => crypto.randomBytes(32).toString('hex');
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const digits = () => String(crypto.randomInt(100000000000000, 999999999999999));
const now = () => Date.now();
const read = req => new Promise(resolve => { let s=''; req.on('data', c => { s += c; if (s.length > 20000) req.destroy(); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } }); });
const pairKey = id => `warrior:pair:${id}`;
async function findByBrowser(browserToken) { const id = await redis.get(`warrior:browser:${browserToken}`); return id ? {id, data: await redis.get(pairKey(id))} : null; }
async function findByPhone(pairId, phoneToken) { const data = await redis.get(pairKey(pairId)); if (!data || data.phoneHash !== hash(phoneToken)) return null; return {id:pairId, data}; }
async function save(id, data) { await redis.set(pairKey(id), data, {ex: TTL}); }
function browserView(data) { return {ok:true, approved:!!data.approved, browserOnline:true, pairId:data.pairId, pendingRequest:data.pending && !data.pending.otp ? {id:data.pending.id, createdAt:data.pending.createdAt/1000, expiresAt:data.pending.expiresAt/1000} : null, otp:data.pending?.otp || data.latestOtp || undefined}; }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const path = '/' + (Array.isArray(req.query?.path) ? req.query.path.join('/') : String(req.query?.path || '').replace(/^\//,''));
  try {
    if (req.method === 'GET' && path === '/health') return json(res, 200, {ok:true, service:'warrior-otp-pairing', protocolVersion:3});
    if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');
    const body = await read(req); if (!body) return fail(res, 400, 'invalid_json');

    if (path === '/v1/browser/invite') {
      let code; for (let i=0;i<5;i++){ code=digits(); if (!(await redis.exists(`warrior:code:${code}`))) break; }
      const id = crypto.randomUUID(), browserToken = token(), createdAt=now(), expiresAt=createdAt+10*60*1000;
      const data={pairId:id, code, browserToken, createdAt, expiresAt, approved:false, browserAt:createdAt, pending:null, latestOtp:null};
      await save(id,data); await redis.set(`warrior:code:${code}`, id, {ex:600}); await redis.set(`warrior:browser:${browserToken}`, id, {ex:TTL});
      return json(res,200,{ok:true, code, browserToken, expiresAt});
    }
    if (path === '/v1/browser/approve') {
      const found=await findByBrowser(body.browserToken); if(!found) return fail(res,404,'browser_not_found');
      found.data.approved=true; found.data.browserAt=now(); await save(found.id,found.data); return json(res,200,{ok:true,pairId:found.id,approved:true});
    }
    if (path === '/v1/browser/status') {
      const found=await findByBrowser(body.browserToken); if(!found) return fail(res,404,'browser_not_found');
      found.data.browserAt=now(); await save(found.id,found.data); return json(res,200,browserView(found.data));
    }
    if (path === '/v1/browser/request') {
      const found=await findByBrowser(body.browserToken); if(!found) return fail(res,404,'browser_not_found');
      if(!found.data.approved) return fail(res,409,'phone_not_approved');
      const t=now(), pending={id:crypto.randomUUID(),createdAt:t,expiresAt:t+60000,otp:null}; found.data.pending=pending; found.data.latestOtp=null; found.data.browserAt=t; await save(found.id,found.data); return json(res,200,{ok:true,requestId:pending.id,expiresAt:pending.expiresAt});
    }
    if (path === '/v1/phone/claim') {
      const id=await redis.get(`warrior:code:${body.code}`); if(!id) return fail(res,404,'code_not_found');
      const data=await redis.get(pairKey(id)); if(!data || data.expiresAt<now()) return fail(res,410,'pairing_code_expired');
      if(data.phoneHash) return fail(res,409,'phone_already_claimed');
      data.phoneHash=hash(body.phoneToken); data.phoneLabel=String(body.phoneLabel||'Android').slice(0,80); data.phoneAt=now(); await save(id,data); return json(res,200,{ok:true,pairId:id,approvalRequired:!data.approved});
    }
    if (path === '/v1/phone/status' || path === '/v1/phone/submit' || path === '/v1/phone/disconnect') {
      const found=await findByPhone(body.pairId,body.phoneToken); if(!found) return fail(res,401,'not_paired');
      const data=found.data;
      if(path==='/v1/phone/status'){ data.phoneAt=now(); await save(found.id,data); const online=!!data.browserAt && now()-data.browserAt<30000; return json(res,200,{ok:true,approved:!!data.approved,browserOnline:online,pendingRequest:data.pending && !data.pending.otp ? {id:data.pending.id,createdAt:data.pending.createdAt/1000,expiresAt:data.pending.expiresAt/1000}:null}); }
      if(path==='/v1/phone/submit'){
        if(!data.pending || data.pending.id!==body.requestId || data.pending.expiresAt<now()) return fail(res,409,'request_expired');
        const otp=String(body.otp||'').replace(/\D/g,''); if(!/^\d{4,8}$/.test(otp)) return fail(res,400,'invalid_otp'); data.pending.otp=otp; data.latestOtp=otp; data.otpAt=now(); data.phoneAt=now(); await save(found.id,data); return json(res,200,{ok:true});
      }
      data.revoked=true; await redis.del(pairKey(found.id)); await redis.del(`warrior:code:${data.code}`); await redis.del(`warrior:browser:${data.browserToken}`); return json(res,200,{ok:true});
    }
    return fail(res,404,'not_found');
  } catch (e) { console.error(e); return fail(res,500, 'server_error'); }
}
