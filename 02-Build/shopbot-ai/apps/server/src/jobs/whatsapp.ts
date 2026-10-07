import type {WhatsAppChannel} from '../services/whatsapp-channel.js';
export async function startWhatsAppJobs(channel:WhatsAppChannel,onError:(error:unknown)=>void){
  let stopping=false,running:Promise<void>|undefined;
  const tick=()=>{
    if(stopping||running)return;
    running=(async()=>{await channel.reconcile();await channel.processNext();await channel.sendNext();})().catch(onError).finally(()=>{running=undefined;});
  };
  tick();
  const timer=setInterval(tick,1000);
  return async()=>{stopping=true;clearInterval(timer);await running;};
}
