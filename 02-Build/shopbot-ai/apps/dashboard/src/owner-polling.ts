/** Completion-based polling: never overlap requests and stop work in hidden tabs. */
export function visiblePoll(load:(signal:AbortSignal)=>Promise<void>,options:{intervalMs:number;enabled?:boolean;doc?:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;win?:Pick<Window,'addEventListener'|'removeEventListener'>}){
 const doc=options.doc??document,win=options.win??window;let stopped=false,running=false,wake=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 function clear(){if(timer!==undefined)clearTimeout(timer);timer=undefined;}
 async function run(){clear();if(stopped||doc.hidden||options.enabled===false)return;if(running){wake=true;return;}running=true;controller=new AbortController();
  try{await load(controller.signal);}catch{/* The view owns its error state; later polls recover. */}finally{running=false;controller=undefined;if(!stopped&&!doc.hidden){const delay=wake?0:options.intervalMs;wake=false;timer=setTimeout(()=>void run(),delay);}}
 }
 function changed(){clear();if(doc.hidden){wake=false;controller?.abort();}else void run();}
 function focus(){if(!doc.hidden)void run();}
 doc.addEventListener('visibilitychange',changed);win.addEventListener('focus',focus);win.addEventListener('online',focus);void run();
 return ()=>{stopped=true;clear();controller?.abort();doc.removeEventListener('visibilitychange',changed);win.removeEventListener('focus',focus);win.removeEventListener('online',focus);};
}
