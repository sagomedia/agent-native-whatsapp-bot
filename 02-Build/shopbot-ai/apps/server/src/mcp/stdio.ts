import {serveStdio} from '@modelcontextprotocol/server/stdio';
import pg from 'pg';
import {z} from 'zod';
import {catalogMcpServer} from './catalog-server.js';

// Local process credentials are the stdio trust boundary. Use a private env
// file and a shop-specific DB role; this process does not listen on a network.
const config=z.object({SHOPBOT_MCP_DATABASE_URL:z.string().url(),SHOPBOT_MCP_STORE_ID:z.uuid(),SHOPBOT_MCP_ACTOR:z.string().min(3).max(200)}).parse(process.env);
const pool=new pg.Pool({connectionString:config.SHOPBOT_MCP_DATABASE_URL,max:2,statement_timeout:15000,lock_timeout:5000,idleTimeoutMillis:1000,allowExitOnIdle:true});
if(!(await pool.query('SELECT id FROM stores WHERE id=$1',[config.SHOPBOT_MCP_STORE_ID])).rowCount){await pool.end();throw new Error('The configured MCP shop must already exist.');}
const handle=serveStdio(()=>catalogMcpServer(pool,{storeId:config.SHOPBOT_MCP_STORE_ID,actor:config.SHOPBOT_MCP_ACTOR}));
let stopping=false;async function close(){if(stopping)return;stopping=true;await handle.close();await pool.end();}
process.on('SIGINT',()=>{void close();});process.on('SIGTERM',()=>{void close();});
