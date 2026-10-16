import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {messageGallery} from '../apps/server/src/services/message-gallery.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
test('Tamil, Tanglish and English gallery uses actual renderer payloads with synthetic payment recipients',async()=>{
 for(const language of ['ta','ta-Latn','en'] as const){
  const entries=await messageGallery(language);assert.ok(entries.length>=18);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
  for(const entry of entries){
   assert.equal(entry.reply.replyLanguage,language);assert.equal(entry.reply.readOnly,true);assert.ok(entry.reply.text.length);
   for(const part of entry.reply.parts??[]){assert.doesNotThrow(()=>renderWhatsAppReply({...entry.reply,parts:[part],outboundMessages:1},randomUUID(),'preview.example.test'),entry.id);}
  }
  const quantity=entries.find(e=>e.id==='quantity')!.reply;assert.equal(quantity.stage,'quantity');assert.equal(quantity.parts,undefined);assert.equal(quantity.buttons?.length,3);
  const compact=entries.find(e=>e.id==='compact-cart')!.reply;assert.equal(compact.parts?.flatMap(p=>p.cards).length,0);
  const demo=entries.find(e=>e.id==='demo-qr')!.reply,production=entries.find(e=>e.id==='advance-qr')!.reply;
  assert.match(demo.text,/preview.only@invalid/);assert.ok(demo.buttons?.some(b=>b.event.type==='pay_at_shop'));assert.ok(!production.buttons?.some(b=>b.event.type==='pay_at_shop'));
  assert.match(entries.find(e=>e.id==='final-quote')!.reply.accessibleText!,/825|₹825/);
 }
});
