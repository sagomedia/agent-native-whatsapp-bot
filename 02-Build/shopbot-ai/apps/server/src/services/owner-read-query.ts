import {z} from 'zod';

// These parameters only change the authenticated owner's read window. They
// never supply store identity or relax a commerce mutation's guards.
export const ownerSnapshotQuery=z.object({
  conversation:z.uuid().optional(), order:z.uuid().optional(),
  details:z.enum(['0','1']).default('1'),
  orderStage:z.enum(['review','customer','ready','history']).optional(),
  orderSearch:z.string().trim().max(200).default(''),
  orderPage:z.coerce.number().int().min(1).max(10000).default(1),
  inboxSearch:z.string().trim().max(200).default(''),
  inboxHelp:z.enum(['0','1']).default('0'),
  inboxPage:z.coerce.number().int().min(1).max(10000).optional()
});
export const ownerReadPageSize=25;
export const ownerActiveSql="(r.acceptance='awaiting_approval' OR r.acceptance='accepted' AND r.fulfillment NOT IN ('collected','cancelled'))";
export const ownerStageSql=`CASE
 WHEN NOT ${ownerActiveSql} THEN 'history'
 WHEN EXISTS(SELECT 1 FROM order_amendments am WHERE am.store_id=r.store_id AND am.request_id=r.id AND am.state IN ('owner_pending','proposed')) THEN 'review'
 WHEN EXISTS(SELECT 1 FROM order_quotes oq WHERE oq.store_id=r.store_id AND oq.request_id=r.id AND oq.state='offered' AND oq.created_at>now()-interval '24 hours') THEN 'customer'
 WHEN r.fulfillment='ready_for_pickup' THEN 'ready'
 ELSE 'review' END`;
export function ownerSearchPattern(value:string){
  return '%'+value.replace(/[\\%_]/g,character=>'\\'+character)+'%';
}
