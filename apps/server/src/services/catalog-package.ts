import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {catalogDraftSchema,catalogWrite,createProposal,prepareProposalAsset,addProposalAsset} from './catalog-proposals.js';

const sourceProduct=catalogDraftSchema.required({sku:true,name:true}).extend({imagePath:z.string().regex(/^images\/CAT100-\d{3}\.jpg$/),active:z.literal(false),verified:z.literal(false)}).strict();
const nodeSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),parentId:z.string().nullable(),kind:z.enum(['department','family']),label:z.string().min(1).max(120),localNames:z.record(z.string(),z.string().max(160)),aliases:z.array(z.string().max(120)).max(40)}).strict();
async function json(path:string){const bytes=await readFile(path);if(bytes.length>2097152)throw new Error('Catalog JSON exceeds 2 MB.');return {bytes,value:JSON.parse(bytes.toString()) as unknown};}
export async function readCatalogPackage(directory:string){
 const root=await realpath(directory),source=await json(resolve(root,'products.json'));
 const data=z.object({schemaVersion:z.number().int(),currency:z.literal('INR'),targetCount:z.literal(100),products:z.array(sourceProduct).length(100)}).strict().parse(source.value);
 if(new Set(data.products.map(p=>p.sku)).size!==100)throw new Error('Catalog SKUs must be unique.');
 if(data.products.some(p=>p.pricePaise!==0||p.priceStatus!=='confirm'||p.stock!==null))throw new Error('This onboarding importer accepts only unverified, unpriced source drafts.');
 const map=await json(resolve(root,'catalog-map.json')),researchSource=await json(resolve(root,'research.json')),exceptionSource=await json(resolve(root,'exceptions.json'));
 const nodes=z.object({schemaVersion:z.number().int(),storeType:z.string().max(200),nodes:z.array(nodeSchema).max(100)}).strict().parse(map.value).nodes;
 const research=z.object({schemaVersion:z.number(),records:z.array(z.object({sku:z.string(),missingFields:z.array(z.string()).default([]),reviewNotes:z.string().optional(),image:z.object({variantMatch:z.enum(['exact','family_only','unconfirmed'])}).passthrough()}).passthrough()).length(100)}).passthrough().parse(researchSource.value);
 const records=new Map(research.records.map(r=>[r.sku,r]));
 const exceptions=z.array(z.object({sku:z.string(),kind:z.string(),issue:z.string(),needed:z.string()}).strict()).max(500).parse(exceptionSource.value);
 if(new Set(nodes.map(n=>n.id)).size!==nodes.length||data.products.some(p=>!nodes.some(n=>n.kind==='family'&&n.id===p.familyId)))throw new Error('Product families must map uniquely to the source hierarchy.');
 const packageHash=createHash('sha256');for(const [name,file] of [['products.json',source],['catalog-map.json',map],['research.json',researchSource],['exceptions.json',exceptionSource]] as const)packageHash.update(name).update('\0').update(file.bytes).update('\0');
 const entries=[];
 for(const p of data.products){
  const record=records.get(p.sku);if(!record)throw new Error('Each product needs its provenance record.');
  const path=await realpath(resolve(root,p.imagePath));if(!path.startsWith(root+sep+'images'+sep))throw new Error('Product image must remain inside this package.');
  const bytes=await readFile(path);if(bytes.length>2097152)throw new Error('Product image exceeds 2 MB.');
  packageHash.update(p.imagePath).update('\0').update(bytes).update('\0');
  const {imagePath,active,verified,...details}=p;
  entries.push({details,photo:{id:randomUUID(),mimeType:'image/jpeg' as const,data:bytes.toString('base64'),caption:''},matchKind:record.image.variantMatch,provenance:{source:'corrected 100-product source; merchant approval pending',issues:[...record.missingFields,...(record.reviewNotes?[record.reviewNotes]:[]),...exceptions.filter(e=>e.sku===p.sku).flatMap(e=>[e.issue,e.needed])].flatMap(s=>s.match(/[\s\S]{1,500}/g)??[])}});
 }
 const hash=packageHash.digest('hex'),batchId='catalog100-'+hash.slice(0,24);
 return {hash,batchId,nodes,entries:entries.map(e=>({...e,provenance:{...e.provenance,sourceHash:hash}}))};
}
export async function importCatalogPackage(pool:Pool,storeId:string,actor:string,directory:string,onProgress?:(count:number)=>void){
 const bundle=await readCatalogPackage(directory),results:{sku:string;id?:string;error?:string;replayed?:boolean}[]=[];
 const nodeId=(id:string)=>'c100-'+bundle.hash.slice(0,8)+'-'+id;
 await catalogWrite(pool,storeId,actor,'catalog_batch_categories',storeId,async c=>{
  for(const n of [...bundle.nodes.filter(n=>n.kind==='department'),...bundle.nodes.filter(n=>n.kind==='family')]){
   if(n.kind==='department'&&n.parentId||n.kind==='family'&&!bundle.nodes.some(p=>p.kind==='department'&&p.id===n.parentId))throw new Error('Invalid catalog hierarchy.');
   await c.query('INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,local_names,aliases) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(store_id,id) DO NOTHING',[storeId,nodeId(n.id),n.parentId?nodeId(n.parentId):null,n.kind,n.label,JSON.stringify(n.localNames),JSON.stringify(n.aliases)]);
  }return {batchId:bundle.batchId,nodes:bundle.nodes.length};
 });
 for(const entry of bundle.entries){
  try{
   const p={id:randomUUID(),batchId:bundle.batchId,clientItemId:entry.details.sku,details:{...entry.details,...(entry.details.familyId?{familyId:nodeId(entry.details.familyId)}:{})},provenance:entry.provenance};
   // The original package is immutable source data. Retries reuse its stable
   // source/item key; no entry is made active or given an internet sale price.
   const proposal=await catalogWrite(pool,storeId,actor,'catalog_batch_draft',p.id,c=>createProposal(c,storeId,actor,p));
   const staged=await prepareProposalAsset({proposalId:proposal.id,version:proposal.version,photo:entry.photo,matchKind:entry.matchKind});
   await catalogWrite(pool,storeId,actor,'catalog_batch_photo',proposal.id,c=>addProposalAsset(c,storeId,staged.input,staged.media));
   results.push({sku:entry.details.sku!,id:proposal.id,replayed:proposal.replayed});
  }catch(e){results.push({sku:entry.details.sku!,error:e instanceof Error?e.message:'Draft import failed'});}
  onProgress?.(results.length);
 }
 return {batchId:bundle.batchId,sourceHash:bundle.hash,staged:results.filter(r=>!r.error).length,replayed:results.filter(r=>r.replayed&&!r.error).length,failed:results.filter(r=>r.error).length,published:0,results};
}

// Bulk v2 intake is separate so the original strict 100-item contract stays compatible.
export {readBulkCatalogPackage,dryRunBulkCatalog,stageBulkCatalog,bulkCatalogStatus} from './catalog-bulk.js';
