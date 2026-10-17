import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHmac,timingSafeEqual} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {WhatsAppChannel} from '../services/whatsapp-channel.js';
import {webhookSchema} from '../services/whatsapp-channel.js';
export const whatsappPath='/webhooks/whatsapp';
export function validSignature(body:Buffer,header:unknown,secret:string){
  if(typeof header!=='string'||!/^sha256=[a-f0-9]{64}$/.test(header))return false;
  return timingSafeEqual(createHmac('sha256',secret).update(body).digest(),Buffer.from(header.slice(7),'hex'));
}
export async function registerWhatsApp(app:FastifyInstance,channel:WhatsAppChannel){
  await channel.setup();
  const path=channel.config.path??whatsappPath;
  // Only active, store-scoped catalog photos are public. Never customer uploads.
  app.get<{Params:{filename:string}}>('/catalog-images/:filename',async(req,reply)=>{
    const file=req.params.filename;
    if(req.headers.host!==channel.config.hostname||!/^H\d{2}\.jpg$/.test(file)||!await channel.hasCatalogImage(file))return reply.code(404).send({error:'Not found'});
    try{return reply.header('Cache-Control','public, max-age=300').header('X-Content-Type-Options','nosniff').type('image/jpeg').send(await readFile(resolve('resources/catalog/ksmc-demo/images',file)));}
    catch{return reply.code(404).send({error:'Not found'});}
  });
  for(const kind of ['custom','reference'] as const)app.get<{Params:{id:string}}>(`/catalog-images/${kind}/:id`,async(req,reply)=>{
    const match=/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jpg$/.exec(req.params.id);
    if(req.headers.host!==channel.config.hostname||!match)return reply.code(404).send({error:'Not found'});
    const bytes=await channel.catalogPhoto(match[1],kind);
    return bytes?reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').type('image/jpeg').send(bytes):reply.code(404).send({error:'Not found'});
  });
  await app.register(async scope=>{
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:262144},(_req,body,done)=>done(null,body));
    scope.get<{Querystring:Record<string,unknown>}>(path,async(req,reply)=>{
      reply.header('Cache-Control','no-store');
      const q=req.query,c=channel.config;
      if(q['hub.mode']!=='subscribe'||typeof q['hub.verify_token']!=='string'||!/^\d{1,100}$/.test(String(q['hub.challenge']??'')))return reply.code(403).send({error:'Verification denied'});
      const supplied=Buffer.from(q['hub.verify_token']),expected=Buffer.from(c.verifyToken);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply.code(403).send({error:'Verification denied'});
      await channel.verified();
      return reply.type('text/plain').send(q['hub.challenge']);
    });
    scope.post(path,{bodyLimit:262144},async(req,reply)=>{
      reply.header('Cache-Control','no-store');
      if(!Buffer.isBuffer(req.body)||!validSignature(req.body,req.headers['x-hub-signature-256'],channel.config.appSecret))return reply.code(403).send({error:'Invalid webhook signature'});
      let value:unknown;
      try{value=JSON.parse(req.body.toString('utf8'));}catch{return reply.code(400).send({error:'Invalid webhook body'});}
      const parsed=webhookSchema.safeParse(value);
      if(!parsed.success)return reply.code(400).send({error:'Invalid webhook event'});
      try{await channel.receive(parsed.data);return {received:true};}
      catch{req.log.error('WhatsApp event storage failed');return reply.code(503).send({error:'Webhook storage unavailable'});}
    });
  });
}
