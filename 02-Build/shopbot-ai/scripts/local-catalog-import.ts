import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {localDevelopmentDatabase} from './local-command.js';
import {loadLocalCatalog} from './local-catalog.js';
if(!process.argv.includes('--import-catalog'))throw new Error('Use --import-catalog to replace the local snapshot catalog; local stock/price edits will be overwritten.');
const connectionString=localDevelopmentDatabase(process.env.DATABASE_URL);
if(!process.env.LOCAL_CATALOG_SNAPSHOT)throw new Error('Set LOCAL_CATALOG_SNAPSHOT.');
const pool=new pg.Pool({connectionString});
try{await setupDatabase(pool,'mock');console.log(JSON.stringify(await loadLocalCatalog(pool,process.env.LOCAL_CATALOG_SNAPSHOT,true)));}finally{await pool.end();}
