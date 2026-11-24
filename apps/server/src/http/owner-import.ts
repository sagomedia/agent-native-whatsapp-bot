import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {z} from 'zod';
import {catalogImportGuide,previewCatalogImport,applyCatalogImportItem} from '../services/catalog-import.js';
export function registerOwnerImport(app:FastifyInstance,pool:Pool,storeId:string,actor:string){
 const principal={storeId,actor,canWrite:true,canPublish:true};
 app.get('/api/owner/catalog/import/guide',async()=>catalogImportGuide());
 const run=async(reply:any,task:()=>Promise<unknown>)=>{try{return await task();}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:e.issues.map(i=>i.path.join('.')+': '+i.message).slice(0,8).join('; ')});throw e;}};
 app.post('/api/owner/catalog/import/preview',async(req,reply)=>run(reply,()=>previewCatalogImport(pool,principal,req.body)));
 app.post('/api/owner/catalog/import/item',{bodyLimit:2904000},async(req,reply)=>run(reply,()=>applyCatalogImportItem(pool,principal,req.body)));
}
