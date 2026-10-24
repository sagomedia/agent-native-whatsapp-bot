import {serveStdio} from '@modelcontextprotocol/server/stdio';
import pg from 'pg';
import {z} from 'zod';
import {diagnosticsMcpServer} from './diagnostics-server.js';

// Separate operator-provisioned process, credentials and discovery surface.
// No HTTP endpoint, customer OAuth scope, account impersonation or model key.
const config=z.object({SHOPBOT_DIAGNOSTICS_DATABASE_URL:z.string().url(),SHOPBOT_DIAGNOSTICS_STORE_ID:z.uuid(),SHOPBOT_DIAGNOSTICS_ACTOR:z.string().trim().min(3).max(200),SHOPBOT_DIAGNOSTICS_ALLOW_SAVE:z.enum(['true','false']).default('false')}).parse(process.env);
const pool=new pg.Pool({connectionString:config.SHOPBOT_DIAGNOSTICS_DATABASE_URL,max:2,statement_timeout:10000,lock_timeout:5000,idleTimeoutMillis:1000,allowExitOnIdle:true});
if(!(await pool.query('SELECT id FROM stores WHERE id=$1',[config.SHOPBOT_DIAGNOSTICS_STORE_ID])).rowCount){await pool.end();throw Error('Configure an existing shop for internal diagnostics.');}
const handle=serveStdio(()=>diagnosticsMcpServer(pool,{storeId:config.SHOPBOT_DIAGNOSTICS_STORE_ID,actor:config.SHOPBOT_DIAGNOSTICS_ACTOR,canSave:config.SHOPBOT_DIAGNOSTICS_ALLOW_SAVE==='true'}));
let stopping=false;async function close(){if(stopping)return;stopping=true;await handle.close();await pool.end();}
process.on('SIGINT',()=>{void close();});process.on('SIGTERM',()=>{void close();});
