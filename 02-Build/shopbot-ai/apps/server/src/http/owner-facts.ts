import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {factApplySchema,factPreviewSchema} from '../../../../packages/contracts/catalog-facts.js';
import {applyCatalogFacts,catalogFactsBatch,exportCatalogFacts,previewCatalogFacts} from '../services/catalog-fact-imports.js';
type Write=(action:string,target:string,run:(client:PoolClient)=>Promise<unknown>)=>Promise<unknown>;
export function registerOwnerFacts(app:FastifyInstance,pool:Pool,storeId:string,write:Write){
 async function read<T>(run:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 app.get('/api/owner/catalog/facts/export',async(req,reply)=>{
  try{const result=await read(c=>exportCatalogFacts(c,storeId,req.query));return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="shop-facts.csv"').header('X-ShopBot-Export-Rows',String(result.total)).send(result.csv);}
  catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:'Check export filters.'});throw e;}
 });
 app.post('/api/owner/catalog/facts/preview',{bodyLimit:14*1024*1024},async(req,reply)=>{
  const p=factPreviewSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Choose the exported shop-facts CSV.'});
  return write('catalog_facts_preview',storeId,c=>previewCatalogFacts(c,storeId,p.data.csv,p.data.filename));
 });
 app.get<{Params:{id:string}}>('/api/owner/catalog/facts/batches/:id',async(req,reply)=>{
  const id=z.uuid().safeParse(req.params.id),page=z.object({cursor:z.coerce.number().int().min(0).max(3000).default(0),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict().safeParse(req.query);
  if(!id.success||!page.success)return reply.code(400).send({error:'Check the batch and page.'});
  return read(c=>catalogFactsBatch(c,storeId,id.data,page.data.cursor,page.data.limit));
 });
 app.post('/api/owner/catalog/facts/apply',async(req,reply)=>{
  const p=factApplySchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Reload the current preview before applying this chunk.'});
  return write('catalog_facts_apply',p.data.batchId,c=>applyCatalogFacts(c,storeId,'owner-dashboard',p.data));
 });
}
