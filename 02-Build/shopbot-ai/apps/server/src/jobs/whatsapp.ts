import type {WhatsAppChannel} from '../services/whatsapp-channel.js';
export async function startWhatsAppJobs(channel:WhatsAppChannel,onError:(error:unknown)=>void){
 let stopping=false;
 // Each durable stage has one bounded worker. A slow planning request cannot
 // block outbound delivery or status reconciliation. Claims and conversation
 // leases remain authoritative; ticks never overlap within a stage.
 const stages=[()=>channel.reconcile(),()=>channel.processNext(),()=>channel.sendNext()].map(run=>{
  let running:Promise<unknown>|undefined;
  const tick=()=>{if(stopping||running)return;running=Promise.resolve().then(async()=>{await run();}).catch(onError).finally(()=>{running=undefined;});};
  tick();const timer=setInterval(tick,1000);
  return {timer,done:()=>running};
 });
 return async()=>{stopping=true;for(const stage of stages)clearInterval(stage.timer);await Promise.all(stages.map(stage=>stage.done()));};
}
