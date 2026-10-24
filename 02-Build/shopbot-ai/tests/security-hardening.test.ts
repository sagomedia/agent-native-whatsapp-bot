import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import type {Pool} from 'pg';
import {createAccessVerifier} from '../apps/server/src/http/access.js';
import {createApp} from '../apps/server/src/http/app.js';

const owner={hostname:'shopbot-preview.example.test',issuer:'https://shopbot-test.cloudflareaccess.com',audience:'test_application_audience_123',email:'owner@example.test',storeId:'12345678-0000-4000-8000-000000000001'};
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'audit-key',alg:'RS256',use:'sig'};
function jwt(){const now=Math.floor(Date.now()/1000),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url'),content=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:owner.issuer,aud:[owner.audience],email:owner.email,sub:'owner',iat:now,exp:now+600});return content+'.'+sign('RSA-SHA256',Buffer.from(content),pair.privateKey).toString('base64url');}

test('a signing-key outage fails closed, shares one request, and throttles repeated fetches until recovery',async t=>{
 let now=Date.now(),calls=0,fail=true;t.mock.method(Date,'now',()=>now);
 const verify=createAccessVerifier(owner,async()=>{calls++;if(fail)throw new Error('Provider outage');return [jwk];}),token=jwt();
 const attempts=await Promise.allSettled(Array.from({length:20},()=>verify(token)));
 assert.ok(attempts.every(attempt=>attempt.status==='rejected'));assert.equal(calls,1);
 await assert.rejects(verify(token),/Access keys unavailable/);assert.equal(calls,1);
 now+=5001;fail=false;assert.equal((await verify(token)).email,owner.email);assert.equal(calls,2);
 await verify(token);assert.equal(calls,2);
});
test('unexpected server errors do not disclose database or provider details and client errors remain actionable',async()=>{
 const app=await createApp({mode:'mock',host:'127.0.0.1',port:3017,databaseUrl:'postgres://unused',mediaDir:'/tmp/shopbot-security-unused'},{} as Pool);
 app.get('/audit-failure',async()=>{throw new Error('private_database_password_or_customer_data');});
 app.get('/audit-conflict',async()=>{throw Object.assign(new Error('This record changed. Refresh before saving.'),{statusCode:409});});
 try{
  const failure=await app.inject('/audit-failure');assert.equal(failure.statusCode,500);assert.doesNotMatch(failure.body,/private_database|stack/);assert.match(failure.json().error,/try again/);
  const conflict=await app.inject('/audit-conflict');assert.equal(conflict.statusCode,409);assert.match(conflict.json().error,/record changed/);
 }finally{await app.close();}
});
