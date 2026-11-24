import type {WhatsAppChannel} from '../services/whatsapp-channel.js';
import {defaultWhatsAppWorkers,validateWhatsAppWorkers} from '../services/whatsapp-config.js';

export type WhatsAppWorkerStage='reconcile'|'planning'|'media'|'outbound';
type Slot={stage:WhatsAppWorkerStage;startedAt?:number;firstFailureAt?:number;failures:number};

// An idle poll is progress. A worker is unhealthy only when a call has remained
// in flight too long, or its polls have failed continuously for a bounded time.
export class WhatsAppWorkerHealth {
 private slots:Slot[]=[];
 private stopped=false;
 constructor(private readonly stalledAfterMs=180_000,private readonly failingAfterMs=30_000){}
 register(stage:WhatsAppWorkerStage){const slot:Slot={stage,failures:0};this.slots.push(slot);return slot;}
 start(slot:Slot){slot.startedAt=Date.now();}
 finish(slot:Slot,failed=false){slot.startedAt=undefined;if(!failed){slot.failures=0;slot.firstFailureAt=undefined;}else{slot.failures++;slot.firstFailureAt??=Date.now();}}
 stop(){this.stopped=true;}
 status(now=Date.now()){
  const stalled=new Set<WhatsAppWorkerStage>(),failing=new Set<WhatsAppWorkerStage>();
  for(const slot of this.slots){
   if(slot.startedAt!==undefined&&now-slot.startedAt>this.stalledAfterMs)stalled.add(slot.stage);
   if(slot.failures>=3&&slot.firstFailureAt!==undefined&&now-slot.firstFailureAt>this.failingAfterMs)failing.add(slot.stage);
  }
  return {healthy:!this.stopped&&this.slots.length>0&&stalled.size===0&&failing.size===0,stalled:[...stalled],failing:[...failing]};
 }
}

export async function startWhatsAppJobs(channel:WhatsAppChannel,onError:(error:unknown,stage?:WhatsAppWorkerStage)=>void,options:{pollIntervalMs?:number;health?:WhatsAppWorkerHealth}={}){
 const workers=validateWhatsAppWorkers(channel.config?.workers??defaultWhatsAppWorkers);
 const interval=options.pollIntervalMs??1000;
 if(!Number.isInteger(interval)||interval<10||interval>60000)throw new Error('Invalid WhatsApp worker polling interval');
 let stopping=false;
 // Each slot has at most one task. Media, planning, outbound and reconciliation
 // run independently; durable claims and leases remain authoritative on restart.
 const runs:[WhatsAppWorkerStage,()=>Promise<unknown>][]=[['reconcile',()=>channel.reconcile()],
  ...Array.from({length:workers.planning},():[WhatsAppWorkerStage,()=>Promise<unknown>]=>['planning',()=>channel.processNext({skipMedia:true})]),
  ...Array.from({length:workers.media},():[WhatsAppWorkerStage,()=>Promise<unknown>]=>['media',()=>channel.processMediaNext?.()??Promise.resolve()]),
  ...Array.from({length:workers.outbound},():[WhatsAppWorkerStage,()=>Promise<unknown>]=>['outbound',()=>channel.sendNext()])];
 const stages=runs.map(([stage,run])=>{
  const slot=options.health?.register(stage);
  let running:Promise<unknown>|undefined;
  const tick=()=>{if(stopping||running)return;if(slot)options.health!.start(slot);running=Promise.resolve().then(run).then(()=>{if(slot)options.health!.finish(slot);},error=>{if(slot)options.health!.finish(slot,true);onError(error,stage);}).finally(()=>{running=undefined;});};
  tick();const timer=setInterval(tick,interval);
  return {timer,done:()=>running};
 });
 return async()=>{stopping=true;for(const stage of stages)clearInterval(stage.timer);await Promise.all(stages.map(stage=>stage.done()));options.health?.stop();};
}
