import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {decideCatalogReview} from '../services/catalog-review.js';
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function registerOwnerAiReview(app:FastifyInstance,pool:Pool,storeId:string,actor:string){
 app.post('/api/owner/catalog/ai-review/decision',{bodyLimit:720000},async request=>decideCatalogReview(pool,{storeId,actor,canReadOwner:true,canWrite:true,canPublish:true},request.body));
 // Only through an SSH tunnel or directly on the VPS, never through the public owner or WhatsApp hosts.
 app.get('/internal/developer/issues',async(request,reply)=>{
  const host=request.headers.host??'',ip=request.ip;
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)||request.headers['x-forwarded-for']||request.headers['cf-connecting-ip'])return reply.code(404).send({error:'Not found'});
  const rows=(await pool.query(`SELECT f.id,f.category,f.wording,f.explanation,f.evidence,f.created_at FROM catalog_audit_findings f WHERE f.store_id=$1 AND f.category IN ('flow_bug','retrieval_failure') ORDER BY f.created_at DESC LIMIT 100`,[storeId])).rows;
  const items=rows.map(r=>`<article><h2>${escape(r.category.replaceAll('_',' '))}</h2><p>${escape(r.explanation)}</p>${r.wording?`<blockquote>${escape(r.wording)}</blockquote>`:''}<p class="meta">${escape(new Date(r.created_at).toISOString())} · ${escape(r.id)}</p><pre>${escape(JSON.stringify(r.evidence,null,2))}</pre></article>`).join('');
  return reply.header('Cache-Control','no-store').header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'").type('text/html').send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Developer issues</title><style>body{font:16px/1.5 system-ui;max-width:760px;margin:40px auto;padding:0 18px;color:#193133}h1{font-size:24px}h2{font-size:17px;text-transform:capitalize}article{border-top:1px solid #dbe5e3;padding:14px 0}blockquote{margin:10px 0;padding-left:12px;border-left:3px solid #087d79}.meta,pre{color:#61777a;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Developer issues</h1><p>Suspected problems from connected AI audits. Investigate the evidence before treating them as confirmed bugs.</p>${items||'<p>No suspected issues yet.</p>'}</html>`);
 });
}
