import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const origin=process.env.SHOPBOT_SMOKE_ORIGIN??'http://127.0.0.1:3017';
assert.match(origin,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const ready=await fetch(`${origin}/health/ready`);
assert.equal(ready.status,200);
assert.equal((await ready.json()).mode,'mock');
const ui=await fetch(origin);
assert.equal(ui.status,200);
assert.match(await ui.text(),/\/assets\//);
const tools=await fetch(`${origin}/api/simulator/tools`).then(r=>r.json());
assert.equal(tools.liveInference,false);
const before=await fetch(`${origin}/api/simulator`).then(r=>r.json());
const text='I need a hammer';
const messageId=randomUUID();
const response=await fetch(`${origin}/api/simulator/events`,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({id:messageId,type:'text',text})
});
assert.equal(response.status,202);
let processed;
for(let i=0;i<20;i++){
  const snapshot=await fetch(`${origin}/api/simulator`).then(r=>r.json());
  if(snapshot.messages.slice(before.messages.length).some(m=>m.direction==='outbound'&&m.text)){
    processed=snapshot;break;
  }
  await new Promise(resolve=>setTimeout(resolve,500));
}
assert.ok(processed,'Durable simulator job did not produce a reply');
console.log(JSON.stringify({ready:true,dashboard:true,durableMockReply:true,messageId,liveInference:false,whatsAppConnected:false}));
