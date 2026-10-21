import type {WhatsAppChannel} from '../services/whatsapp-channel.js';
import {defaultWhatsAppWorkers,validateWhatsAppWorkers} from '../services/whatsapp-config.js';

export async function startWhatsAppJobs(channel:WhatsAppChannel,onError:(error:unknown)=>void,options:{pollIntervalMs?:number}={}){
 const workers=validateWhatsAppWorkers(channel.config?.workers??defaultWhatsAppWorkers);
 const interval=options.pollIntervalMs??1000;
 if(!Number.isInteger(interval)||interval<10||interval>60000)throw new Error('Invalid WhatsApp worker polling interval');
 let stopping=false;
 // Each slot has at most one task. Media, planning, outbound and reconciliation
 // run independently; durable claims and leases remain authoritative on restart.
 const runs=[()=>channel.reconcile(),
  ...Array.from({length:workers.planning},()=>()=>channel.processNext({skipMedia:true})),
  ...Array.from({length:workers.media},()=>()=>channel.processMediaNext?.()),
  ...Array.from({length:workers.outbound},()=>()=>channel.sendNext())];
 const stages=runs.map(run=>{
  let running:Promise<unknown>|undefined;
  const tick=()=>{if(stopping||running)return;running=Promise.resolve().then(async()=>{await run();}).catch(onError).finally(()=>{running=undefined;});};
  tick();const timer=setInterval(tick,interval);
  return {timer,done:()=>running};
 });
 return async()=>{stopping=true;for(const stage of stages)clearInterval(stage.timer);await Promise.all(stages.map(stage=>stage.done()));};
}
