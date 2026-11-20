import {spawn,type ChildProcess} from 'node:child_process';
import {open,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {createHmac} from 'node:crypto';
import pg from 'pg';
import {readConfig} from '../apps/server/src/config.js';
import {localDevelopmentDatabase} from './local-command.js';
import {localCatalogStore} from './local-catalog.js';

const remoteScript='/usr/local/lib/shopbot-local-route.py';
const gcloud=process.env.GCLOUD_BIN??'gcloud';
function remote(command:string){
 const values=[process.env.LOCAL_VPS_INSTANCE,process.env.LOCAL_VPS_PROJECT,process.env.LOCAL_VPS_ZONE,process.env.LOCAL_VPS_USER];
 if(values.some(value=>!value||!/^[a-zA-Z0-9_-]+$/.test(value)))throw new Error('Configure LOCAL_VPS_INSTANCE, LOCAL_VPS_PROJECT, LOCAL_VPS_ZONE and LOCAL_VPS_USER.');
 const [instance,project,zone,user]=values as string[];
 return ['compute','ssh',`${user}@${instance}`,`--project=${project}`,`--zone=${zone}`,'--ssh-key-file='+resolve('data/local-tunnel-key'),'--ssh-key-expire-after=30m','--quiet','--command='+command];
}
function runRemote(command:string){return new Promise<void>((done,reject)=>{
 const child=spawn(gcloud,remote(command),{stdio:'inherit'});child.on('error',()=>reject(new Error('Could not start gcloud.')));child.on('exit',code=>code===0?done():reject(new Error('The VPS command failed. See the command output.')));
});}
const restoreCommand=`if sudo systemctl is-active --quiet shopbot-local-route.service; then sudo systemctl stop shopbot-local-route.service; fi; sudo python3 ${remoteScript} restore`;
const delay=(ms:number)=>new Promise(done=>setTimeout(done,ms));
// Node's bundled fetch can replace a supplied Host header. Use HTTP directly
// when verifying the production hostname through the local loopback address.
function localProbe(path:string,host:string,body?:string,signature?:string){return new Promise<{status:number;text:string}>((done,reject)=>{
 const req=request({hostname:'127.0.0.1',port:3018,path,method:body?'POST':'GET',headers:{host,...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body),'x-hub-signature-256':signature!}:{})}},response=>{const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>done({status:response.statusCode??0,text:Buffer.concat(chunks).toString('utf8')}));});
 req.setTimeout(5000,()=>req.destroy(new Error('Local webhook probe timed out.')));req.on('error',reject);req.end(body);
});}

async function main(){
 const action=process.argv[2]??'check';
 if(!['check','start','restore'].includes(action))throw new Error('Use check, start or restore.');
 await mkdir('data',{recursive:true,mode:0o700});
 if(action==='restore'){await runRemote(restoreCommand);return;}
 localDevelopmentDatabase(process.env.DATABASE_URL);
 const config=readConfig(),wa=config.whatsapp;
 if(!wa||!config.owner||wa.audience!=='test'||!wa.recipients.length||wa.storeId!==localCatalogStore||config.owner.storeId!==localCatalogStore||config.host!=='127.0.0.1'||config.port!==3018||wa.advance||!wa.visualOrdering||!wa.aiEnabled||!wa.mediaEnabled||!wa.processEnabled||!wa.sendEnabled||process.env.GEMINI_UNIFIED_UNDERSTANDING_ENABLED!=='true'||process.env.ALLOW_LOCAL_AI_TEST==='true'||process.env.SHOPBOT_MCP_PUBLIC_URL)throw new Error('The local connected profile must use its local snapshot, test recipients, loopback:3018, unified visual/media AI and no payment or MCP endpoints.');
 if(!wa.paidEnabled||wa.budgetMicrousd!==500000)throw new Error('Local WhatsApp testing requires the approved cumulative $0.50 allowance.');
 if(config.owner.hostname!=='shopbot-local.sagoautomation.tech'||wa.hostname!=='shopbot-local-api.sagoautomation.tech'||wa.path!=='/webhook')throw new Error('Use the separate local dashboard/channel hostnames and the existing /webhook path. See LOCAL-DEVELOPMENT.md.');
 remote('true');
 const pool=new pg.Pool({connectionString:config.databaseUrl,max:1});
 try{
  const result=(await pool.query('SELECT s.synthetic,(SELECT count(*)::int FROM products WHERE store_id=s.id AND active) AS products FROM stores s WHERE s.id=$1',[localCatalogStore])).rows[0];
  if(result?.synthetic!=='true'||!result.products)throw new Error('Import the catalog into the local development database first.');
  console.log(JSON.stringify({localDatabase:true,products:result.products,testRecipients:wa.recipients.length,budgetMicrousd:wa.budgetMicrousd,dashboard:'https://'+config.owner.hostname+'/owner',routeChanged:false}));
 }finally{await pool.end();}
 if(action==='check')return;
 // Refuse to replace an existing local process.
 await new Promise<void>((done,reject)=>{const server=createServer();server.once('error',()=>reject(new Error('Port 3018 is occupied. Stop the other development server first.')));server.listen(3018,'127.0.0.1',()=>server.close(error=>error?reject(error):done()));});
 // Older helpers moved the VPS dashboard too. Refuse that protocol before
 // starting a backend/tunnel rather than silently using shared hostnames.
 await runRemote(`sudo python3 ${remoteScript} check-separated`);
 await mkdir('data/logs',{recursive:true,mode:0o700});
 const log=await open('data/logs/local-whatsapp.log','a',0o600);
 const backend=spawn(process.execPath,['--watch','--import','tsx','apps/server/src/index.ts'],{stdio:['ignore',log.fd,log.fd],detached:true,env:process.env});
 let tunnel:ChildProcess|undefined,stopping=false,routed=false;
 const cleanup=async()=>{
  if(stopping)return;stopping=true;
  try{if(tunnel){await runRemote(restoreCommand);console.log('WhatsApp is back on the VPS. The local test domains are offline.');}}
  catch{console.error('Could not confirm VPS restoration. The remote watchdog restores after the tunnel closes. Run npm run whatsapp:restore to verify.');process.exitCode=1;}
  finally{tunnel?.kill('SIGTERM');if(backend.pid)try{process.kill(-backend.pid,'SIGTERM');}catch{}await log.close();}
 };
 process.on('SIGINT',()=>{void cleanup();});process.on('SIGTERM',()=>{void cleanup();});
 try{
  backend.on('error',()=>{console.error('Local backend could not start.');void cleanup();});
  let ready=false;
  for(let i=0;i<60&&!stopping;i++){try{ready=(await fetch('http://127.0.0.1:3018/health/ready',{signal:AbortSignal.timeout(1500)})).ok;}catch{}if(ready)break;await delay(500);}
  if(stopping)return;
  if(!ready)throw new Error('Local backend did not become ready; inspect data/logs/local-whatsapp.log.');
  const challenge=new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':wa.verifyToken,'hub.challenge':'714092'});
  const probe=await localProbe(wa.path+'?'+challenge,wa.hostname);
  if(probe.status!==200||probe.text!=='714092')throw new Error('Local webhook verification failed.');
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[]}),signature='sha256='+createHmac('sha256',wa.appSecret).update(body).digest('hex');
  const signed=await localProbe(wa.path!,wa.hostname,body,signature);
  if(signed.status!==200)throw new Error('Local webhook signature/storage check failed.');
  const command=`sudo systemd-run --unit=shopbot-local-route --collect --wait --pipe --property=RuntimeMaxSec=21600 --property='ExecStopPost=/usr/bin/python3 ${remoteScript} restore' /usr/bin/python3 ${remoteScript} run`;
  tunnel=spawn(gcloud,[...remote(command),'--ssh-flag=-R127.0.0.1:33018:127.0.0.1:3018','--ssh-flag=-oExitOnForwardFailure=yes','--ssh-flag=-oServerAliveInterval=10','--ssh-flag=-oServerAliveCountMax=2'],{stdio:['ignore','pipe','inherit']});
  await new Promise<void>((done,reject)=>{
   tunnel!.on('error',()=>reject(new Error('Could not open the SSH tunnel.')));
   tunnel!.on('exit',code=>code===0||stopping?done():reject(new Error('The local tunnel ended.')));
   tunnel!.stdout!.on('data',(bytes:Buffer)=>{
    process.stdout.write(bytes);
    if(!routed&&bytes.toString().includes('LOCAL_ROUTE_READY:')){routed=true;console.log('Send a new WhatsApp message from the configured test phone. Open https://'+config.owner!.hostname+'/owner and sign in with the existing dashboard password. Ctrl+C restores the VPS.');}
   });
  });
 }finally{await cleanup();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Local WhatsApp mode failed.');process.exitCode=1;});
