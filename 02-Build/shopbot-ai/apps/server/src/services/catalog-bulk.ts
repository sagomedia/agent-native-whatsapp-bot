import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {catalogDraftSchema,proposalProvenanceSchema,catalogWrite,createProposal,prepareProposalAsset,addProposalAsset} from './catalog-proposals.js';

const sku=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const familyId=z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const node=z.object({id:familyId,parentId:familyId.nullable(),kind:z.enum(['department','family']),label:z.string().trim().min(1).max(120),localNames:z.record(z.string(),z.string().max(160)),aliases:z.array(z.string().max(120)).max(40)}).strict();
const image=z.object({path:z.string().min(1).max(240),mimeType:z.enum(['image/jpeg','image/png','image/webp']),matchKind:z.enum(['exact','family_only','unconfirmed'])}).strict();
const product=z.object({sourceSku:sku,details:catalogDraftSchema.required({name:true}),image:image.optional(),provenance:proposalProvenanceSchema.omit({sourceHash:true})}).strict();
const productsSchema=z.object({schemaVersion:z.literal(2),currency:z.literal('INR'),products:z.array(product).min(1)}).strict();
const mappingSchema=z.object({schemaVersion:z.literal(1),skus:z.array(z.object({sourceSku:sku,canonicalSku:sku,baseVersion:z.number().int().positive().optional()}).strict()),families:z.array(z.object({sourceFamilyId:familyId,canonicalFamilyId:familyId}).strict()),exclusions:z.array(z.object({sourceSku:sku,reason:z.string().trim().min(1).max(500)}).strict())}).strict();
function stable(v:unknown):unknown{return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,stable(value)])):v;}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const fail=(message:string)=>Object.assign(new Error(message),{statusCode:409});
const unique=(values:string[],label:string)=>{if(new Set(values).size!==values.length)throw new Error(`${label} must be unique.`);};
async function jsonFile(root:string,name:string){const bytes=await readFile(resolve(root,name));if(bytes.length>64*1024*1024)throw new Error(`${name} exceeds 64 MiB; split this source into batches.`);return {bytes,value:JSON.parse(bytes.toString()) as unknown};}
export type BulkPackage=Awaited<ReturnType<typeof readBulkCatalogPackage>>;
export async function readBulkCatalogPackage(directory:string){
 const root=await realpath(directory),source=await jsonFile(root,'products.json'),mapFile=await jsonFile(root,'canonical-map.json'),taxonomyFile=await jsonFile(root,'catalog-map.json');
 const data=productsSchema.parse(source.value),mapping=mappingSchema.parse(mapFile.value),nodes=z.object({schemaVersion:z.literal(1),nodes:z.array(node)}).strict().parse(taxonomyFile.value).nodes;
 unique(data.products.map(p=>p.sourceSku),'Source SKUs');unique(mapping.skus.map(p=>p.sourceSku),'SKU mapping sources');unique(mapping.exclusions.map(p=>p.sourceSku),'Exclusion sources');unique(mapping.families.map(p=>p.sourceFamilyId),'Family mapping sources');unique(nodes.map(n=>n.id),'Canonical taxonomy IDs');
 const sources=new Set(data.products.map(p=>p.sourceSku)),skus=new Map(mapping.skus.map(m=>[m.sourceSku,m])),excluded=new Map(mapping.exclusions.map(m=>[m.sourceSku,m.reason])),families=new Map(mapping.families.map(m=>[m.sourceFamilyId,m.canonicalFamilyId])),taxonomy=new Map(nodes.map(n=>[n.id,n]));
 for(const m of [...mapping.skus,...mapping.exclusions])if(!sources.has(m.sourceSku))throw new Error(`Mapping refers to absent source ${m.sourceSku}.`);
 for(const p of data.products)if(Number(skus.has(p.sourceSku))+Number(excluded.has(p.sourceSku))!==1)throw new Error(`${p.sourceSku} needs exactly one canonical SKU mapping or explicit exclusion.`);
 unique(mapping.skus.map(m=>m.canonicalSku),'Canonical SKU targets (exclude resolved duplicate sources explicitly)');
 for(const n of nodes)if(n.kind==='department'?n.parentId!==null:!n.parentId||taxonomy.get(n.parentId)?.kind!=='department')throw new Error(`Invalid hierarchy for ${n.id}.`);
 for(const m of mapping.families)if(taxonomy.get(m.canonicalFamilyId)?.kind!=='family')throw new Error(`Unknown canonical family ${m.canonicalFamilyId}.`);
 const digest=createHash('sha256');for(const [name,file] of [['products.json',source],['canonical-map.json',mapFile],['catalog-map.json',taxonomyFile]] as const)digest.update(name).update('\0').update(file.bytes).update('\0');
 const entries=[];
 for(const p of data.products){
  const mapped=skus.get(p.sourceSku),exclusion=excluded.get(p.sourceSku),details={...p.details};
  if(details.sku&&mapped&&details.sku!==mapped.canonicalSku)throw new Error(`${p.sourceSku}: details.sku disagrees with canonical map.`);
  if(!exclusion){
   if(!details.familyId||!families.has(details.familyId))throw new Error(`${p.sourceSku} needs an explicit source family mapping.`);
   details.familyId=families.get(details.familyId)!;details.sku=mapped!.canonicalSku;
   // Source research is never merchant price/stock evidence. Existing verified
   // facts are copied from the locked current product when staging an edit.
   if(details.pricePaise!==undefined&&details.pricePaise!==0||details.priceStatus!==undefined&&details.priceStatus!=='confirm'||details.stock!==undefined&&details.stock!==null)throw new Error(`${p.sourceSku}: source drafts require unknown price and stock.`);
   details.pricePaise=0;details.priceStatus='confirm';details.stock=null;
  }
  let imageHash:string|undefined,imageError:string|undefined;
  if(p.image&&!exclusion){try{const bytes=await readBulkImage(root,p.image,false);imageHash=createHash('sha256').update(bytes).digest('hex');validateMime(bytes,p.image.mimeType);}catch(e){imageError=e instanceof Error?e.message:'Invalid image';}}
  digest.update(p.sourceSku).update('\0').update(imageHash??imageError??'no-image').update('\0');
  const pending=['identity','photo approval','selling unit','price','stock',...(p.image?.matchKind==='exact'?[]:['exact photo'])];
  const entry={sourceSku:p.sourceSku,canonicalSku:mapped?.canonicalSku,baseVersion:mapped?.baseVersion,details,image:p.image,imageHash,imageError,exclusion,provenance:p.provenance,pending};
  entries.push({...entry,inputHash:hash(entry)});
 }
 return {root,hash:digest.digest('hex'),mapping,nodes,entries};
}
async function readBulkImage(root:string,p:z.infer<typeof image>,checkMime=true){
 if(!p.path.startsWith('images/')||p.path.includes('\\')||p.path.split('/').some(s=>s==='..'||s==='.'||!s))throw new Error('Image must use a local images/ path.');
 const path=await realpath(resolve(root,p.path));if(!path.startsWith(root+sep+'images'+sep))throw new Error('Image must remain inside package images/.');
 const size=(await stat(path)).size;if(size<1||size>2097152)throw new Error(`Image must be nonempty and at most 2 MiB (found ${size} bytes).`);
 const bytes=await readFile(path);if(bytes.length!==size)throw new Error('Image changed while being read.');if(checkMime)validateMime(bytes,p.mimeType);return bytes;
}
function validateMime(bytes:Buffer,mimeType:string){
 const type=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(type!==mimeType)throw new Error('Image bytes disagree with declared raster MIME type.');
}
type Entry=BulkPackage['entries'][number];
async function existingProduct(c:Pick<PoolClient,'query'>,storeId:string,entry:Entry){return (await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[storeId,entry.canonicalSku])).rows[0];}
function productConflict(entry:Entry,prior:any){if(prior&&!entry.baseVersion)return 'Canonical SKU already exists; supply its explicit baseVersion.';if(entry.baseVersion&&(!prior||prior.version!==entry.baseVersion))return 'Canonical product version changed or is absent; review mapping again.';}
function nodeDiffers(old:any,n:BulkPackage['nodes'][number]){return old&&(old.parent_id!==n.parentId||old.kind!==n.kind||old.label!==n.label||hash(old.local_names)!==hash(n.localNames)||hash(old.aliases)!==hash(n.aliases));}
async function sourceConflict(c:Pick<PoolClient,'query'>,storeId:string,batchId:string,entry:Entry){
 const pending=(await c.query("SELECT batch_id FROM catalog_proposals WHERE store_id=$1 AND details->>'sku'=$2 AND state='draft' AND (batch_id<>$3 OR client_item_id<>$4) LIMIT 1",[storeId,entry.canonicalSku,batchId,entry.sourceSku])).rows[0];
 return pending?'Canonical SKU already has an unresolved draft in another source item.':undefined;
}
export async function dryRunBulkCatalog(pool:Pool|undefined,storeId:string|undefined,bundle:BulkPackage,batchId:string){
 const results:{sourceSku:string;canonicalSku?:string;action:string;reason?:string;pendingMerchantFacts:string[];imageHeld:boolean}[]=[],taxonomyConflicts:string[]=[];
 if(pool&&storeId){const existing=(await pool.query('SELECT id,parent_id,kind,label,local_names,aliases FROM catalog_nodes WHERE store_id=$1 AND id=ANY($2::text[])',[storeId,bundle.nodes.map(n=>n.id)])).rows;const byId=new Map(existing.map(n=>[n.id,n]));for(const n of bundle.nodes)if(nodeDiffers(byId.get(n.id),n))taxonomyConflicts.push(n.id);}
 if(pool&&storeId){const prior=(await pool.query('SELECT source_hash FROM catalog_intake_batches WHERE store_id=$1 AND batch_id=$2',[storeId,batchId])).rows[0];if(prior&&prior.source_hash!==bundle.hash)throw fail('Batch source changed. Review a new batch ID; the existing batch is immutable.');}
 for(const entry of bundle.entries){
  const family=bundle.nodes.find(n=>n.id===entry.details.familyId);
  let conflict=entry.imageError??(family&&taxonomyConflicts.some(id=>id===family.id||id===family.parentId)?'Canonical taxonomy differs from this shop; review mapping.':undefined);
  if(!entry.exclusion&&pool&&storeId)conflict??=productConflict(entry,await existingProduct(pool,storeId,entry))??await sourceConflict(pool,storeId,batchId,entry);
  results.push({sourceSku:entry.sourceSku,canonicalSku:entry.canonicalSku,action:entry.exclusion?'excluded':conflict?'conflict':entry.baseVersion?'update':'new',reason:entry.exclusion??conflict,pendingMerchantFacts:entry.exclusion?[]:entry.pending,imageHeld:!entry.exclusion&&!!entry.image&&entry.image.matchKind!=='exact'});
 }
 const count=(action:string)=>results.filter(r=>r.action===action).length;
 const currentCatalogUniqueCount=pool&&storeId?Number((await pool.query('SELECT count(*)::int AS count FROM products WHERE store_id=$1',[storeId])).rows[0].count):null;
 const expectedCatalogUniqueCount=currentCatalogUniqueCount===null||count('conflict')?null:currentCatalogUniqueCount+count('new');
 return {batchId,sourceHash:bundle.hash,count:results.length,currentCatalogUniqueCount,expectedCatalogUniqueCount,new:count('new'),updates:count('update'),excluded:count('excluded'),conflicts:count('conflict'),imagesHeld:results.filter(r=>r.imageHeld).length,taxonomyConflicts,effectiveUniqueCount:bundle.entries.filter(e=>!e.exclusion).length,databaseChecked:!!pool&&!!storeId,published:0,results};
}
function preservedDetails(entry:Entry,prior:any){
 const details={...entry.details};if(!prior)return details;
 const verified=prior.merchant_verification??{};
 if(verified.price){details.pricePaise=prior.price_paise;details.priceStatus=prior.price_status;}
 if(verified.stock){details.stock=prior.stock===null?null:Number(prior.stock);details.inventoryVersion=prior.inventory_version;}
 if(verified.sellingUnit){details.unit=prior.unit;details.quantityStep=Number(prior.quantity_step);details.sellingPolicy=prior.selling_policy;details.specifications=prior.specifications;}
 if(verified.identity){details.name=prior.name;details.localNames=prior.local_names;details.brand=prior.brand??'';details.specifications=prior.specifications;details.familyId=prior.family_id??entry.details.familyId;details.aliases=prior.aliases;details.keywords=prior.keywords;}
 return details;
}
export async function stageBulkCatalog(pool:Pool,storeId:string,actor:string,directory:string,options:{batchId:string;chunkSize?:number;maxItems?:number;onProgress?:(n:number)=>void}){
 const batchId=z.string().min(1).max(100).parse(options.batchId),chunkSize=z.number().int().min(1).max(100).parse(options.chunkSize??25),maxItems=z.number().int().positive().parse(options.maxItems??Number.MAX_SAFE_INTEGER),bundle=await readBulkCatalogPackage(directory);
 await catalogWrite(pool,storeId,actor,'catalog_bulk_register',storeId,async c=>{
  const prior=(await c.query('SELECT source_hash FROM catalog_intake_batches WHERE store_id=$1 AND batch_id=$2',[storeId,batchId])).rows[0];if(prior&&prior.source_hash!==bundle.hash)throw fail('Batch source changed. Review a new batch ID; the existing batch is immutable.');
  await c.query('INSERT INTO catalog_intake_batches(store_id,batch_id,source_hash,manifest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[storeId,batchId,bundle.hash,JSON.stringify({mapping:bundle.mapping,nodes:bundle.nodes,entries:bundle.entries})]);return {batchId,sourceHash:bundle.hash,count:bundle.entries.length};
 });
 // Registration itself is chunked, so interrupted initialization can resume too.
 for(let start=0;start<bundle.entries.length;start+=chunkSize)await catalogWrite(pool,storeId,actor,'catalog_bulk_items',storeId,async c=>{for(const e of bundle.entries.slice(start,start+chunkSize))await c.query('INSERT INTO catalog_intake_items(store_id,batch_id,source_sku,canonical_sku,input_hash,state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[storeId,batchId,e.sourceSku,e.canonicalSku??null,e.inputHash,e.exclusion?'excluded':'pending']);return {batchId,start,count:Math.min(chunkSize,bundle.entries.length-start)};});
 let processed=0;
 for(const entry of bundle.entries){
  if(entry.exclusion)continue;
  const saved=(await pool.query('SELECT state FROM catalog_intake_items WHERE store_id=$1 AND batch_id=$2 AND source_sku=$3',[storeId,batchId,entry.sourceSku])).rows[0];if(saved.state==='staged')continue;
  if(processed>=maxItems)break;
  try{
   if(entry.imageError)throw new Error(entry.imageError);
   // Decoder runs outside the store lock; only one source image is in memory.
   let prepared:Awaited<ReturnType<typeof prepareProposalAsset>>|undefined;
   if(entry.image){const bytes=await readBulkImage(bundle.root,entry.image);if(createHash('sha256').update(bytes).digest('hex')!==entry.imageHash)throw fail('Image changed after validation.');prepared=await prepareProposalAsset({proposalId:randomUUID(),version:1,photo:{id:randomUUID(),mimeType:entry.image.mimeType,data:bytes.toString('base64'),caption:''},matchKind:entry.image.matchKind});}
   await catalogWrite(pool,storeId,actor,'catalog_bulk_stage',storeId,async c=>{
    const item=(await c.query('SELECT * FROM catalog_intake_items WHERE store_id=$1 AND batch_id=$2 AND source_sku=$3 FOR UPDATE',[storeId,batchId,entry.sourceSku])).rows[0];if(item.input_hash!==entry.inputHash)throw fail('Source item changed.');if(item.state==='staged')return {replayed:true};
    const prior=await existingProduct(c,storeId,entry),conflict=productConflict(entry,prior)??await sourceConflict(c,storeId,batchId,entry);if(conflict)throw fail(conflict);
    const family=bundle.nodes.find(n=>n.id===entry.details.familyId)!;
    const department=bundle.nodes.find(n=>n.id===family.parentId)!;
    for(const n of [department,family]){
     const old=(await c.query('SELECT parent_id,kind,label,local_names,aliases FROM catalog_nodes WHERE store_id=$1 AND id=$2',[storeId,n.id])).rows[0];
     if(nodeDiffers(old,n))throw fail(`Canonical taxonomy ${n.id} differs from this shop; review its mapping.`);
     await c.query('INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,local_names,aliases) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[storeId,n.id,n.parentId,n.kind,n.label,JSON.stringify(n.localNames),JSON.stringify(n.aliases)]);
    }
    const proposal=await createProposal(c,storeId,actor,{id:randomUUID(),batchId,clientItemId:entry.sourceSku,details:preservedDetails(entry,prior),provenance:{...entry.provenance,sourceHash:bundle.hash},...(entry.baseVersion?{base:{sku:entry.canonicalSku,version:entry.baseVersion}}:{})});
    if(proposal.state!=='draft')throw fail('This proposal was already reviewed; inspect its final state.');
    let version=proposal.version;
    if(prepared){const asset=await addProposalAsset(c,storeId,{...prepared.input,proposalId:proposal.id,version},prepared.media);version=asset.version;}
    await c.query("UPDATE catalog_intake_items SET state='staged',proposal_id=$4,proposal_version=$5,error=NULL,updated_at=now() WHERE store_id=$1 AND batch_id=$2 AND source_sku=$3",[storeId,batchId,entry.sourceSku,proposal.id,version]);return {batchId,sourceSku:entry.sourceSku,proposalId:proposal.id,version};
   });
  }catch(e){const error=(e instanceof Error?e.message:'Draft staging failed').slice(0,2000),state=(e as {statusCode?:number}).statusCode===409?'conflict':'failed';await pool.query("UPDATE catalog_intake_items SET state=$4,error=$5,updated_at=now() WHERE store_id=$1 AND batch_id=$2 AND source_sku=$3 AND state<>'staged'",[storeId,batchId,entry.sourceSku,state,error]);}
  processed++;options.onProgress?.(processed);
 }
 return bulkCatalogStatus(pool,storeId,batchId);
}
export async function bulkCatalogStatus(pool:Pool,storeId:string,batchId:string,afterSourceSku='',limit=100){
 const batch=(await pool.query('SELECT batch_id,source_hash,created_at FROM catalog_intake_batches WHERE store_id=$1 AND batch_id=$2',[storeId,batchId])).rows[0];if(!batch)throw new Error('Bulk batch not found in this shop.');
 const counts=(await pool.query('SELECT state,count(*)::int AS count FROM catalog_intake_items WHERE store_id=$1 AND batch_id=$2 GROUP BY state',[storeId,batchId])).rows;
 const size=Math.max(1,Math.min(200,limit));
 const rows=(await pool.query('SELECT i.source_sku,i.canonical_sku,i.state,i.proposal_id,p.version AS proposal_version,p.state AS proposal_state,i.error,i.updated_at FROM catalog_intake_items i LEFT JOIN catalog_proposals p ON p.store_id=i.store_id AND p.id=i.proposal_id WHERE i.store_id=$1 AND i.batch_id=$2 AND i.source_sku>$3 ORDER BY i.source_sku LIMIT $4',[storeId,batchId,afterSourceSku,size+1])).rows;
 return {...batch,counts:Object.fromEntries(counts.map(r=>[r.state,r.count])),published:0,results:rows.slice(0,size),nextCursor:rows.length>size?rows[size-1].source_sku:null};
}
