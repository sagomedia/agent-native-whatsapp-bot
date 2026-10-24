import {createPublicKey,verify} from 'node:crypto';
import type {OwnerConfig} from '../config.js';

export type AccessIdentity={email:string;subject:string};
export type AccessVerifier=(token:string)=>Promise<AccessIdentity>;
type SigningKey={kty?:string;n?:string;e?:string;kid?:string;alg?:string;use?:string};

// The issuer is validated configuration, never a URL from an untrusted JWT.
export function createAccessVerifier(config:OwnerConfig,loadKeys=async():Promise<SigningKey[]>=>{
  const response=await fetch(config.issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!response.ok)throw new Error('Access keys unavailable');
  const body=await response.text();
  if(body.length>100000)throw new Error('Invalid Access keys');
  const data=JSON.parse(body);
  if(!Array.isArray(data.keys)||data.keys.length>32)throw new Error('Invalid Access keys');
  return data.keys;
}):AccessVerifier {
  let keys:SigningKey[]=[],fetched=0,retryAfter=0,inFlight:Promise<void>|undefined;
  async function refresh(){
    if(!inFlight&&Date.now()<retryAfter)throw new Error('Access keys unavailable');
    if(!inFlight)inFlight=loadKeys().then(result=>{keys=result;fetched=Date.now();retryAfter=0;}).catch(()=>{retryAfter=Date.now()+5000;throw new Error('Access keys unavailable');}).finally(()=>{inFlight=undefined;});
    await inFlight;
  }
  return async token=>{
    if(token.length>12000)throw new Error('Invalid Access token');
    const parts=token.split('.');
    if(parts.length!==3||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))throw new Error('Invalid Access token');
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||header.crit)throw new Error('Invalid Access algorithm');
    if(!fetched||Date.now()-fetched>3600000)await refresh();
    let key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
    if(!key&&Date.now()-fetched>10000){await refresh();key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));}
    if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new Error('Invalid Access signature');
    const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString()),now=Math.floor(Date.now()/1000);
    if(claims.iss!==config.issuer||!Array.isArray(claims.aud)||!claims.aud.includes(config.audience)||typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+30||claims.nbf!==undefined&&(typeof claims.nbf!=='number'||claims.nbf>now)||typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string'||claims.email.toLowerCase()!==config.email)throw new Error('Access identity is not authorized');
    return {email:config.email,subject:claims.sub};
  };
}
