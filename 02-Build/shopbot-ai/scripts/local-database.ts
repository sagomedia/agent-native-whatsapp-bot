import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const action=process.argv[2]??'status';
if(!['start','stop','status'].includes(action))throw new Error('Use start, stop or status.');
const binary=process.env.POSTGRES_BIN_DIR,data=process.env.POSTGRES_DATA_DIR,socket=process.env.POSTGRES_SOCKET_DIR,port=Number(process.env.POSTGRES_PORT??55440);
if(!binary||!data||!socket||!existsSync(resolve(data,'PG_VERSION'))||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Configure an initialized local PostgreSQL cluster using POSTGRES_BIN_DIR, POSTGRES_DATA_DIR, POSTGRES_SOCKET_DIR and POSTGRES_PORT. See LOCAL-DEVELOPMENT.md.');
const pgctl=resolve(binary,'pg_ctl');
if(action==='start'){
 let active=false;try{execFileSync(pgctl,['-D',data,'status'],{stdio:'ignore'});active=true;}catch{}
 if(active)console.log('Local PostgreSQL is already running.');
 else{mkdirSync(socket,{recursive:true,mode:0o700});const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";execFileSync(pgctl,['-D',data,'-l',resolve(data,'../postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${quote(socket)}`,'start'],{stdio:'inherit'});}
}else execFileSync(pgctl,['-D',data,...(action==='stop'?['-m','fast','stop']:['status'])],{stdio:'inherit'});
