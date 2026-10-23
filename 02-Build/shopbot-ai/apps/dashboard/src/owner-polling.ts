/** Completion-based polling. A rejected load backs off; views keep their records. */
export function visiblePoll(load:(signal:AbortSignal)=>Promise<void>,options:{intervalMs:number;enabled?:boolean;doc?:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;win?:Pick<Window,'addEventListener'|'removeEventListener'>;nav?:Pick<Navigator,'onLine'>}){
 const doc=options.doc??document,win=options.win??window,nav=options.nav??(typeof navigator==='undefined'?undefined:navigator);let stopped=false,running=false,wake=false,failures=0,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 const available=()=>!doc.hidden&&nav?.onLine!==false&&options.enabled!==false;
 function clear(){if(timer!==undefined)clearTimeout(timer);timer=undefined;}
 async function run(){clear();if(stopped||!available())return;if(running){wake=true;return;}running=true;controller=new AbortController();const active=controller;
  try{await load(active.signal);if(!active.signal.aborted)failures=0;}catch{if(!active.signal.aborted)failures=Math.min(failures+1,6);}finally{running=false;controller=undefined;if(!stopped&&available()){const delay=wake?0:Math.min(options.intervalMs*2**failures,Math.max(options.intervalMs,60000));wake=false;timer=setTimeout(()=>void run(),delay);}}
 }
 function changed(){clear();if(!available()){wake=false;controller?.abort();}else void run();}
 function focus(){if(available())void run();}
 function online(){failures=0;focus();}
 doc.addEventListener('visibilitychange',changed);win.addEventListener('focus',focus);win.addEventListener('online',online);win.addEventListener('offline',changed);void run();
 return ()=>{stopped=true;clear();controller?.abort();doc.removeEventListener('visibilitychange',changed);win.removeEventListener('focus',focus);win.removeEventListener('online',online);win.removeEventListener('offline',changed);};
}
