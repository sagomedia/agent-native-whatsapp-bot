// Only failures that establish no HTTP connection are safe to retry. A reset,
// aborted deadline, or missing response can follow provider acceptance.
const connectCodes=new Set(['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH']);
const dnsCodes=new Set(['ENOTFOUND','EAI_AGAIN']);
type ErrorLike={name?:unknown;code?:unknown;syscall?:unknown;cause?:unknown;errors?:unknown};
function beforeConnection(error:unknown,depth=0):boolean {
 if(!error||typeof error!=='object'||depth>3)return false;
 const value=error as ErrorLike;
 if(value.code==='UND_ERR_CONNECT_TIMEOUT')return true;
 if(typeof value.code==='string'&&(value.syscall==='connect'&&connectCodes.has(value.code)||value.syscall==='getaddrinfo'&&dnsCodes.has(value.code)))return true;
 if(Array.isArray(value.errors)&&value.errors.length)return value.errors.every(item=>beforeConnection(item,depth+1));
 return beforeConnection(value.cause,depth+1);
}
export function whatsappSendError(error:unknown):{retryable:boolean;code:string}{
 if(beforeConnection(error))return {retryable:true,code:'network_connection_failed'};
 const value=error&&typeof error==='object'?error as ErrorLike:{};
 const cause=value.cause&&typeof value.cause==='object'?value.cause as ErrorLike:{};
 const detail=value.name==='TimeoutError'||value.name==='AbortError'?'timeout':cause.code==='ECONNRESET'||cause.code==='UND_ERR_SOCKET'?'connection_reset':'transport';
 return {retryable:false,code:'network_outcome_unknown_'+detail};
}
