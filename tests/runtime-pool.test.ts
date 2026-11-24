import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import type {PoolClient} from 'pg';
import pg from 'pg';
import {createRuntimePool} from '../apps/server/src/db/pool.js';

test('database overload times out waiting work and returns to service when connections are released',async()=>{
 const pool=createRuntimePool(process.env.DATABASE_URL!,()=>{}),held:PoolClient[]=[];
 try{
  for(let i=0;i<10;i++)held.push(await pool.connect());
  await assert.rejects(pool.query('SELECT 1'),/timeout exceeded when trying to connect/);
  assert.equal(pool.waitingCount,0);held.pop()!.release();assert.equal((await pool.query('SELECT 1 AS healthy')).rows[0].healthy,1);
 }finally{for(const client of held)client.release();await pool.end();}
});
test('a dropped idle database connection is handled and the next request opens a working connection',async()=>{
 let handled=0;const pool=createRuntimePool(process.env.DATABASE_URL!,()=>{handled++;}),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 try{
  const pid=(await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const failure=once(pool,'error');await admin.query('SELECT pg_terminate_backend($1)',[pid]);await failure;
  assert.equal(handled,1);assert.equal((await pool.query('SELECT 1 AS healthy')).rows[0].healthy,1);
 }finally{await pool.end();await admin.end();}
});
