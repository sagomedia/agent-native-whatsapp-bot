import {statfs} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Pool} from 'pg';

export type CapacityFilesystem={path:string;totalBytes:number;availableBytes:number};
export type CapacitySample={bytes:number;count:number};
export type CatalogCapacityOptions={storeId:string;filesystem:CapacityFilesystem;targetProducts?:number;sample?:CapacitySample;reserveBytes?:number};
const integer=(value:number,label:string,min=0)=>{if(!Number.isSafeInteger(value)||value<min)throw Error(`Invalid ${label}`);return value;};
function count(value:unknown){return integer(Number(value),'capacity measurement');}
export async function capacityFilesystem(path:string):Promise<CapacityFilesystem>{
 if(!path.trim())throw Error('A capacity volume path is required');
 const info=await statfs(path,{bigint:true});
 return {path:resolve(path),totalBytes:count(info.blocks*info.bsize),availableBytes:count(info.bavail*info.bsize)};
}

/** Read-only inventory of logical payloads; never fetches media bytes or credentials. */
export async function catalogCapacity(pool:Pool,options:CatalogCapacityOptions){
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(options.storeId))throw Error('A valid STORE_ID is required');
 const targetProducts=integer(options.targetProducts??3000,'target product count',1);
 const fs=options.filesystem;integer(fs.totalBytes,'filesystem total bytes');integer(fs.availableBytes,'filesystem available bytes');
 if(fs.availableBytes>fs.totalBytes)throw Error('Invalid filesystem available bytes');
 if(options.sample){integer(options.sample.bytes,'sample bytes',1);integer(options.sample.count,'sample count',1);}
 const reserveBytes=integer(options.reserveBytes??Math.max(2*1024**3,Math.ceil(fs.totalBytes*.1)),'reserve bytes');
 const client=await pool.connect();
 let products:{total:number;active:number;withoutPhoto:number},proposals:{rows:number;originalBytes:number;normalizedBytes:number;distinctOriginalHashes:number},photos:{rows:number;bytes:number;hashedRows:number;distinctHashes:number}|undefined;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='15s'");
  if(!(await client.query('SELECT 1 FROM stores WHERE id=$1',[options.storeId])).rowCount)throw Error('Store not found');
  const p=(await client.query('SELECT count(*) AS total,count(*) FILTER(WHERE active) AS active,count(*) FILTER(WHERE image_path IS NULL OR image_path=\'\') AS without_photo FROM products WHERE store_id=$1',[options.storeId])).rows[0];
  products={total:count(p.total),active:count(p.active),withoutPhoto:count(p.without_photo)};
  const a=(await client.query('SELECT count(*) AS rows,coalesce(sum(octet_length(original)),0) AS original_bytes,coalesce(sum(octet_length(image)),0) AS normalized_bytes,count(DISTINCT sha256) AS distinct_hashes FROM catalog_proposal_assets WHERE store_id=$1',[options.storeId])).rows[0];
  proposals={rows:count(a.rows),originalBytes:count(a.original_bytes),normalizedBytes:count(a.normalized_bytes),distinctOriginalHashes:count(a.distinct_hashes)};
  const hashColumn=!!(await client.query("SELECT 1 FROM pg_attribute WHERE attrelid='catalog_photos'::regclass AND attname='content_hash' AND NOT attisdropped")).rowCount;
  const f=(await client.query(`SELECT count(*) AS rows,coalesce(sum(octet_length(image)),0) AS bytes,${hashColumn?'count(content_hash) AS hashed_rows,count(DISTINCT content_hash) AS distinct_hashes':'0 AS hashed_rows,0 AS distinct_hashes'} FROM catalog_photos WHERE store_id=$1`,[options.storeId])).rows[0];
  photos={rows:count(f.rows),bytes:count(f.bytes),hashedRows:count(f.hashed_rows),distinctHashes:count(f.distinct_hashes)};
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 const suppliedMean=options.sample?options.sample.bytes/options.sample.count:undefined;
 const finalMean=suppliedMean??(photos.rows?photos.bytes/photos.rows:proposals.rows?proposals.normalizedBytes/proposals.rows:undefined);
 const additionalProducts=Math.max(0,targetProducts-products.total);
 const originalMean=proposals.rows?proposals.originalBytes/proposals.rows:finalMean===undefined?undefined:finalMean*3;
 const normalizedMean=proposals.rows?proposals.normalizedBytes/proposals.rows:finalMean;
 const logicalAdditionalBytes=additionalProducts===0?0:finalMean===undefined||originalMean===undefined||normalizedMean===undefined?null:Math.ceil(additionalProducts*(originalMean+normalizedMean+finalMean));
 // Planning envelopes, not measured compression, WAL amplification or retention.
 const databaseOverheadFactor=1.25,walCopies=1,backupCopies=2;
 const databaseAdditionalBytes=logicalAdditionalBytes===null?null:Math.ceil(logicalAdditionalBytes*databaseOverheadFactor);
 const projectedAdditionalBytes=databaseAdditionalBytes===null?null:integer(databaseAdditionalBytes*(1+walCopies+backupCopies),'projected additional bytes');
 const availableAfterReserveBytes=Math.max(0,fs.availableBytes-reserveBytes);
 const status=projectedAdditionalBytes===null?'capacity_unknown':fs.availableBytes<reserveBytes+projectedAdditionalBytes?'insufficient_space':'projected_space_available';
 const warnings:string[]=[];
 if(status==='insufficient_space')warnings.push('Available filesystem space is below projected additional growth plus reserved headroom.');
 if(status==='capacity_unknown')warnings.push('No observed or supplied photo sample exists; supply sample bytes and count to estimate growth.');
 if(products.withoutPhoto)warnings.push('Existing products without photo paths are excluded from additional-product growth; budget their photo backfill separately.');
 if(photos.hashedRows<photos.rows)warnings.push('Published photo hash coverage is incomplete; unique/reuse counts cover hashed rows only.');
 warnings.push('Filesystem space describes the supplied path only; verify database, WAL and backup locations and retention separately.');
 return {
  reportVersion:1,storeId:options.storeId,readOnly:true,targetProducts,
  products,proposalAssets:{...proposals,reusedOriginalHashRows:proposals.rows-proposals.distinctOriginalHashes},
  publishedPhotos:{...photos,reusedHashRows:photos.hashedRows-photos.distinctHashes,unhashedRows:photos.rows-photos.hashedRows},
  logicalStoredPayloadBytes:proposals.originalBytes+proposals.normalizedBytes+photos.bytes,
  filesystem:{...fs,reserveBytes,availableAfterReserveBytes},
  projection:{additionalProducts,sampleSource:options.sample?'supplied_final_photo_sample':photos.rows?'observed_published_photos':proposals.rows?'observed_normalized_proposals':'none',sample:options.sample??null,meanOriginalBytes:originalMean??null,meanNormalizedBytes:normalizedMean??null,meanPublishedBytes:finalMean??null,logicalAdditionalBytes,databaseAdditionalBytes,projectedAdditionalBytes,status},
  assumptions:{photosPerAdditionalProduct:1,retainOriginalAndNormalized:true,fallbackOriginalToFinalRatio:3,databaseOverheadFactor,walCopies,backupCopies,defaultReserve:'maximum of 2 GiB or 10% of filesystem total bytes',countsIncludeRetainedDraftsAndInactiveProducts:true,existingPhotoBackfillIncluded:false,deduplicationSavingsAssumed:false},
  warnings,
  unknowns:['BYTEA lengths are logical payload bytes, not measured PostgreSQL/TOAST/index disk usage.','WAL, backups, caches, filesystem copies and rollback retention are not measured by these store-scoped SQL totals.','Final-photo averages may differ across future source batches; one photo per additional product is a planning assumption.','Hash reuse is measured within each available hash domain; original and normalized/published hashes are not assumed comparable.','A projected space fit does not establish restore health, memory/CPU/connection headroom, real-provider latency or production readiness.'],
 };
}
