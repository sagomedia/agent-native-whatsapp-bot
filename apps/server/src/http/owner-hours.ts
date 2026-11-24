import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {readStoreHours,storeHoursSchema} from '../services/store-hours.js';
type Write=(action:string,target:string,run:(c:PoolClient)=>Promise<unknown>)=>Promise<unknown>;
export function registerOwnerHours(app:FastifyInstance,pool:Pool,storeId:string,write:Write){
 app.get('/api/owner/store/hours',async()=>{const c=await pool.connect();try{return await readStoreHours(c,storeId);}finally{c.release();}});
 app.post('/api/owner/store/hours',async(req,reply)=>{
  const parsed=z.object({expectedRevision:z.number().int().nonnegative(),schedule:storeHoursSchema.nullable()}).strict().safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'Choose opening days, different opening and closing times, and a valid timezone.'});
  return write('store_hours',storeId,async c=>{
   const r=await c.query('UPDATE stores SET opening_hours=$3::jsonb,hours_revision=hours_revision+1 WHERE id=$1 AND hours_revision=$2 RETURNING hours_revision',[storeId,parsed.data.expectedRevision,parsed.data.schedule?JSON.stringify(parsed.data.schedule):null]);
   if(!r.rowCount)throw Object.assign(new Error('Shop hours changed. Reload before saving.'),{statusCode:409});
   return readStoreHours(c,storeId);
  });
 });
}
