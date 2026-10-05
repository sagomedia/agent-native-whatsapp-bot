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
