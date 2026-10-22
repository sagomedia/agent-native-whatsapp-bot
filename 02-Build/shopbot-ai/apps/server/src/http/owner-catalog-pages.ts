import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {productColumns,productFromRow} from '../services/catalog.js';

const pageFields={q:z.string().trim().max(200).default(''),limit:z.coerce.number().int().min(1).max(100).default(25),cursor:z.string().max(4000).optional()};
export const productPageSchema=z.object({...pageFields,visibility:z.enum(['','visible','draft']).default(''),stock:z.enum(['','out','unknown','low']).default(''),family:z.string().max(80).default(''),brand:z.string().max(120).default(''),exception:z.enum(['','missing_photo','pending_price','pending_review','review_conflicts']).default(''),sort:z.enum(['name','sku','updated']).default('name')}).strict();
export const proposalPageSchema=z.object({...pageFields,batch:z.string().max(100).default(''),exception:z.enum(['','conflicts','issues','missing_photo','pending_price','unknown_stock']).default('')}).strict();
const invalid=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const signature=(input:Record<string,unknown>)=>createHash('sha256').update(JSON.stringify({...input,cursor:undefined})).digest('hex');
const cursorSchema=z.object({v:z.literal(1),scope:z.string(),query:z.string(),revision:z.number().int(),key:z.string().max(500),id:z.string().min(1).max(100)}).strict();
function readCursor(cursor:string|undefined,scope:string,query:string,revision:number){
 if(!cursor)return null;
 try{const result=cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));if(result.scope!==scope||result.query!==query)throw invalid('This page belongs to another search. Start from the first page.');if(result.revision!==revision)throw invalid('The catalog changed. Start from the first page to see current products.',409);return result;}catch(e){if((e as {statusCode?:number}).statusCode)throw e;throw invalid('Invalid catalog page. Start from the first page.');}
}
function nextCursor(scope:string,query:string,revision:number,key:string,id:string){return Buffer.from(JSON.stringify({v:1,scope,query,revision,key,id})).toString('base64url');}
const ownerRow=(p:any)=>({...productFromRow(p),active:p.active,verification:p.merchant_verification,origin:p.catalog_origin,inventoryUpdatedAt:p.inventory_updated_at});
export async function selectedOwnerProduct(c:PoolClient,storeId:string,sku:string){
 const row=(await c.query(`SELECT ${productColumns},active,catalog_origin,inventory_updated_at,merchant_verification FROM products WHERE store_id=$1 AND sku=$2`,[storeId,sku])).rows[0];if(!row)throw invalid('Product not found in this shop.',404);
 // Source photos remain private review evidence and never become a customer image URL.
 const referencePhotos=(await c.query(`SELECT a.id,p.id AS "proposalId",a.match_kind AS "matchKind" FROM catalog_proposals p JOIN catalog_proposal_assets a ON a.store_id=p.store_id AND a.proposal_id=p.id WHERE p.store_id=$1 AND p.published_sku=$2 AND p.state='published' ORDER BY p.updated_at DESC,p.id,a.created_at,a.id LIMIT 5`,[storeId,sku])).rows;
 return {...ownerRow(row),referencePhotos};
}
export async function ownerProductPage(c:PoolClient,storeId:string,input:z.infer<typeof productPageSchema>){
 const revision=(await c.query('SELECT catalog_revision FROM stores WHERE id=$1',[storeId])).rows[0].catalog_revision;
 const scope=storeId+':products',query=signature(input),cursor=readCursor(input.cursor,scope,query,revision);
 if(cursor&&input.sort==='updated'&&!Number.isFinite(Date.parse(cursor.key)))throw invalid('Invalid catalog date cursor.');
 const values:unknown[]=[storeId],where=['store_id=$1'];const bind=(value:unknown)=>{values.push(value);return '$'+values.length;};
 // Literal substring matching works for Tamil names and SKUs without treating % or _ as wildcards.
 if(input.q){const p=bind('%'+input.q.replace(/[\\%_]/g,'\\$&')+'%');where.push(`(sku ILIKE ${p} OR name ILIKE ${p} OR local_names::text ILIKE ${p} OR brand ILIKE ${p} OR aliases::text ILIKE ${p} OR keywords::text ILIKE ${p})`);}
 if(input.visibility)where.push(`active=${bind(input.visibility==='visible')}`);
 if(input.stock==='unknown')where.push('stock IS NULL');
 if(input.stock==='out')where.push('stock IS NOT NULL AND stock-reserved_stock<=0');
 if(input.stock==='low')where.push('stock IS NOT NULL AND stock-reserved_stock>0 AND stock-reserved_stock<=5');
 if(input.family)where.push(`family_id=${bind(input.family)}`);
 if(input.brand)where.push(`brand=${bind(input.brand)}`);
 const pendingReview=`NOT merchant_verification @> '{"identity":true,"photo":true,"sellingUnit":true,"price":true,"stock":true}'::jsonb`;
 const conflicts=`EXISTS(SELECT 1 FROM catalog_proposals cp WHERE cp.store_id=products.store_id AND cp.state='draft' AND cp.base_sku=products.sku AND cp.base_version<>products.version)`;
 if(input.exception==='missing_photo')where.push("(image_path IS NULL OR image_path='')");
 if(input.exception==='pending_price')where.push("price_status='confirm'");
 if(input.exception==='pending_review')where.push(pendingReview);
 if(input.exception==='review_conflicts')where.push(conflicts);
 const condition=where.join(' AND ');
 const summary=(await c.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE image_path IS NULL OR image_path='')::int AS "missingPhoto",count(*) FILTER(WHERE price_status='confirm')::int AS "pendingPrice",count(*) FILTER(WHERE stock IS NULL)::int AS "unknownStock",count(*) FILTER(WHERE ${pendingReview})::int AS "pendingReview",count(*) FILTER(WHERE ${conflicts})::int AS "reviewConflicts" FROM products WHERE ${condition}`,values)).rows[0];
 const totalStore=(await c.query('SELECT count(*)::int AS total FROM products WHERE store_id=$1',[storeId])).rows[0].total;
 const key=input.sort==='updated'?"coalesce(inventory_updated_at,'epoch'::timestamptz)":input.sort==='sku'?'sku':'name';const direction=input.sort==='updated'?'DESC':'ASC',comparison=input.sort==='updated'?'<':'>';
 if(cursor){const p=bind(cursor.key),id=bind(cursor.id);where.push(`(${key} ${comparison} ${p}${input.sort==='updated'?'::timestamptz':''} OR (${key}=${p}${input.sort==='updated'?'::timestamptz':''} AND sku>${id}))`);}
 const rows=(await c.query(`SELECT ${productColumns},active,catalog_origin,inventory_updated_at,merchant_verification,(${key})::text AS cursor_key FROM products WHERE ${where.join(' AND ')} ORDER BY ${key} ${direction},sku ASC LIMIT ${bind(input.limit+1)}`,values)).rows;
 const more=rows.length>input.limit,loaded=rows.slice(0,input.limit),last=loaded.at(-1);
 // Brands are separate metadata, never inferred from the loaded page.
 const brands=(await c.query("SELECT DISTINCT brand FROM products WHERE store_id=$1 AND brand IS NOT NULL AND brand<>'' ORDER BY brand LIMIT 1000",[storeId])).rows.map(r=>r.brand);
 return {revision,products:loaded.map(ownerRow),total:summary.total,totalStore,summary,brands,limit:input.limit,nextCursor:more&&last?nextCursor(scope,query,revision,last.cursor_key,last.sku):null};
}
const proposalAssets=`coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'matchKind',a.match_kind,'width',a.width,'height',a.height) ORDER BY a.created_at,a.id) FROM catalog_proposal_assets a WHERE a.store_id=p.store_id AND a.proposal_id=p.id),'[]'::jsonb) AS assets`;
const draftConflicts=`(p.base_sku IS NOT NULL AND NOT EXISTS(SELECT 1 FROM products b WHERE b.store_id=p.store_id AND b.sku=p.base_sku AND b.version=p.base_version))`;
const draftPhoto=`(NOT EXISTS(SELECT 1 FROM catalog_proposal_assets a WHERE a.store_id=p.store_id AND a.proposal_id=p.id AND a.match_kind='exact') AND NOT EXISTS(SELECT 1 FROM products b WHERE b.store_id=p.store_id AND b.sku=p.base_sku AND b.image_path IS NOT NULL))`;
const draftPrice=`(coalesce(p.details->>'priceStatus','confirm')='confirm' OR NOT p.details ? 'pricePaise')`;
const draftStock=`(p.details->>'stock' IS NULL)`;
const draftIssues=`jsonb_array_length(coalesce(p.provenance->'issues','[]'))>0`;
export async function selectedOwnerProposal(c:PoolClient,storeId:string,id:string){const row=(await c.query(`SELECT p.*,${proposalAssets},${draftConflicts} AS conflict FROM catalog_proposals p WHERE p.store_id=$1 AND p.id=$2`,[storeId,id])).rows[0];if(!row)throw invalid('Draft not found in this shop.',404);delete row.input_hash;if(row.base_sku){const current=(await c.query('SELECT sku,name,version,image_path FROM products WHERE store_id=$1 AND sku=$2',[storeId,row.base_sku])).rows[0];if(current)row.currentProduct={sku:current.sku,name:current.name,version:current.version,hasImage:!!current.image_path};}return row;}
export async function ownerProposalPage(c:PoolClient,storeId:string,input:z.infer<typeof proposalPageSchema>){
 const scope=storeId+':proposals',query=signature(input),cursor=readCursor(input.cursor,scope,query,0),values:unknown[]=[storeId],where=["p.store_id=$1 AND p.state='draft'"];const bind=(v:unknown)=>{values.push(v);return '$'+values.length;};
 if(cursor&&(!z.uuid().safeParse(cursor.id).success||!Number.isFinite(Date.parse(cursor.key))))throw invalid('Invalid draft cursor.');
 if(input.batch)where.push(`p.batch_id=${bind(input.batch)}`);
 if(input.q){const p=bind('%'+input.q.replace(/[\\%_]/g,'\\$&')+'%');where.push(`(p.details->>'name' ILIKE ${p} OR p.details->>'sku' ILIKE ${p} OR p.client_item_id ILIKE ${p} OR p.batch_id ILIKE ${p})`);}
 const groups={conflicts:draftConflicts,issues:draftIssues,missing_photo:draftPhoto,pending_price:draftPrice,unknown_stock:draftStock};
 const summary=(await c.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE ${draftConflicts})::int AS conflicts,count(*) FILTER(WHERE ${draftIssues})::int AS issues,count(*) FILTER(WHERE ${draftPhoto})::int AS "missingPhoto",count(*) FILTER(WHERE ${draftPrice})::int AS "pendingPrice",count(*) FILTER(WHERE ${draftStock})::int AS "unknownStock" FROM catalog_proposals p WHERE ${where.join(' AND ')}`,values)).rows[0];
 if(input.exception)where.push(groups[input.exception]);
 const total=(await c.query(`SELECT count(*)::int AS total FROM catalog_proposals p WHERE ${where.join(' AND ')}`,values)).rows[0].total;
 if(cursor)where.push(`(p.created_at,p.id)>(${bind(cursor.key)}::timestamptz,${bind(cursor.id)}::uuid)`);
 const rows=(await c.query(`SELECT p.id,p.version,p.batch_id,p.client_item_id,p.details->>'name' AS name,p.details->>'sku' AS sku,p.base_sku,p.base_version,p.created_at::text AS cursor_key,${draftConflicts} AS conflict,jsonb_array_length(coalesce(p.provenance->'issues','[]')) AS "issueCount" FROM catalog_proposals p WHERE ${where.join(' AND ')} ORDER BY p.created_at,p.id LIMIT ${bind(input.limit+1)}`,values)).rows;
 const loaded=rows.slice(0,input.limit),last=loaded.at(-1);return {proposals:loaded.map(({cursor_key,...row})=>row),total,summary,limit:input.limit,nextCursor:rows.length>input.limit&&last?nextCursor(scope,query,0,last.cursor_key,last.id):null};
}
