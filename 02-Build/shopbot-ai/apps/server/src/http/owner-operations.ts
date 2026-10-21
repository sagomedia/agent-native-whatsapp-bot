import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {ownerOperationsSummary} from '../services/owner-operations.js';

/** Register inside the existing owner authentication/origin scope. */
export function registerOwnerOperations(app:FastifyInstance,pool:Pool,storeId:string){
 app.get('/api/owner/operations/summary',async(_request,reply)=>{
  reply.header('Cache-Control','private, no-store');
  return ownerOperationsSummary(pool,storeId);
 });
}
