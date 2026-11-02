import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function localTestDatabase(value:string|undefined):string {
 const error='Set TEST_DATABASE_URL to a separate loopback PostgreSQL database whose name ends in _test.';
 if(!value)throw new Error(error);
 let url:URL;try{url=new URL(value);}catch{throw new Error(error);}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname))throw new Error(error);
 return value;
}
export function localDevelopmentDatabase(value:string|undefined):string {
 const error='Use a separate loopback PostgreSQL development database whose name ends in _dev.';
 if(!value)throw new Error(error);
 let url:URL;try{url=new URL(value);}catch{throw new Error(error);}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/[a-zA-Z0-9_]+_dev$/.test(url.pathname))throw new Error(error);
 return value;
}
async function main(){
 const [command,...args]=process.argv.slice(2);
 if(!['test','eval'].includes(command))throw new Error('Use test or eval.');
 const databaseUrl=localTestDatabase(process.env.TEST_DATABASE_URL),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const tests=command==='test'?(await readdir(resolve(root,'tests'))).filter(name=>name.endsWith('.test.ts')).sort().map(name=>'tests/'+name):[];
 const child=spawn(process.execPath,['--import','tsx',...(command==='test'?['--test','--test-concurrency=4',...tests,...args]:['scripts/evaluate-unified.ts',...args])],{cwd:root,stdio:'inherit',env:{...process.env,APP_MODE:'mock',DATABASE_URL:databaseUrl,WHATSAPP_ENABLED:'false',WHATSAPP_PROCESS_ENABLED:'false',WHATSAPP_SEND_ENABLED:'false'}});
 child.on('error',()=>{console.error('Could not start the local command.');process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof Error?error.message:'Local command failed.');process.exitCode=1;});
