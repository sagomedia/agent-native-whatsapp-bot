import pg from 'pg';

/** Bound pool acquisition; a broken idle socket must not terminate the worker. */
export function createRuntimePool(connectionString:string,onIdleError:(error:Error)=>void){
 const pool=new pg.Pool({connectionString,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
 pool.on('error',onIdleError);
 return pool;
}
