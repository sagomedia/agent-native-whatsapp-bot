export async function redesignApi<T = any>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
 // Writes may include photo processing or AI suggestions. Never automatically
 // replay them: the server may have committed even when its response was lost.
 const controller=new AbortController();
 const cancel=()=>controller.abort(signal?.reason);
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),body===undefined?20000:120000);
 try{
  const response = await fetch('/api/owner/' + path, body === undefined ? {cache:'no-store',signal:controller.signal} : {method:'POST',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify(body),signal:controller.signal});
  if(response.status===401||response.status===403||response.redirected){await response.body?.cancel();throw Object.assign(new Error('Your sign-in may have expired. Refresh this page to sign in again.'),{status:403});}
  const json=response.headers.get('content-type')?.includes('application/json');
  if(!json){await response.body?.cancel();throw new Error('The server returned an unexpected response. Please try again.');}
  const data:unknown=await response.json();
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('The server returned an incomplete response. Please try again.');
  if(!response.ok){const {error,message}=data as Record<string,unknown>;throw Object.assign(new Error(typeof error==='string'?error:typeof message==='string'?message:'Could not complete this action. Please try again.'),{status:response.status});}
  return data as T;
 }catch(error){
  if(!signal?.aborted&&controller.signal.aborted)throw new Error(body===undefined?'The connection is taking too long. Your loaded records are kept; try again.':'The connection timed out. Check the current record before retrying; the action may already be saved.');
  throw error;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
