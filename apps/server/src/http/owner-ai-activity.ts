import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {catalogAiActivity} from '../services/catalog-ai-activity.js';

export function registerOwnerAiActivity(app:FastifyInstance,pool:Pool,storeId:string){
 app.get('/api/owner/catalog/ai-activity',async request=>catalogAiActivity(pool,{storeId,actor:'authenticated-owner-dashboard',canReadOwner:true,canWrite:false,canPublish:false},request.query));
}
