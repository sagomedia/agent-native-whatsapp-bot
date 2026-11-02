import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {productColumns} from '../apps/server/src/services/catalog.js';
import {localTestDatabase,localDevelopmentDatabase} from './local-command.js';
const snapshotSchema=z.object({version:z.literal(1),capturedAt:z.string(),imageOrigin:z.string().regex(/^https:\/\/[a-zA-Z0-9.-]+$/),store:z.object({name:z.string(),type:z.string()}),nodes:z.array(z.object({id:z.string(),parent_id:z.string().nullable(),kind:z.enum(['department','family']),label:z.string(),aliases:z.array(z.string()),local_names:z.record(z.string(),z.string()).nullable()})),products:z.array(z.record(z.string(),z.unknown()))});
const photosSchema=z.array(z.object({id:z.uuid(),image:z.string(),width:z.number().int().positive(),height:z.number().int().positive(),content_hash:z.string().nullable()})).max(5000);
export const localCatalogStore='937b6ab0-7bf9-4611-89ca-20546cb2f15e';
/** Public inventory facts only; caller must use its separate local test database. */
export async function loadLocalCatalog(pool:Pool,path:string,development=false){
 (development?localDevelopmentDatabase:localTestDatabase)(process.env.DATABASE_URL);
 const snapshot=snapshotSchema.parse(JSON.parse(await readFile(path,'utf8'))),columns=productColumns.split(','),jsonColumns=new Set(['local_names','aliases','specifications','keywords','indicative_price','selling_policy']);
 const photos=development?photosSchema.parse(JSON.parse(await readFile(path,'utf8')).photos??[]):[];
 for(const p of snapshot.products)if(columns.some(c=>!(c in p))||!p.sku||!p.name||!p.unit||typeof p.active!=='boolean')throw new Error('The inventory snapshot is incomplete; export it again.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const existing=(await c.query('SELECT synthetic FROM stores WHERE id=$1 FOR UPDATE',[localCatalogStore])).rows[0];
  if(existing&&existing.synthetic!=='true')throw new Error('The local catalog identity is not synthetic.');
  if((await c.query("SELECT 1 FROM inventory_reservations WHERE store_id=$1 AND state='active' LIMIT 1",[localCatalogStore])).rowCount)throw new Error('Resolve local test order reservations before refreshing this catalog.');
  await c.query("INSERT INTO stores(id,name,synthetic) VALUES($1,$2,'true') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name",[localCatalogStore,snapshot.store.name+' · local snapshot']);
  await c.query('INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,$2) ON CONFLICT(store_id) DO UPDATE SET store_type=EXCLUDED.store_type',[localCatalogStore,snapshot.store.type]);
  await c.query('INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true) ON CONFLICT DO NOTHING',[localCatalogStore]);
  for(const photo of photos){
   const bytes=Buffer.from(photo.image,'base64'),hash=createHash('sha256').update(bytes).digest('hex');
   if(bytes.length<4||bytes.length>2097152||bytes[0]!==255||bytes[1]!==216||photo.content_hash&&hash!==photo.content_hash)throw new Error('A catalog photograph failed validation.');
   const result=await c.query('INSERT INTO catalog_photos(id,store_id,image,width,height,content_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET image=EXCLUDED.image,width=EXCLUDED.width,height=EXCLUDED.height,content_hash=EXCLUDED.content_hash WHERE catalog_photos.store_id=EXCLUDED.store_id RETURNING id',[photo.id,localCatalogStore,bytes,photo.width,photo.height,hash]);
   if(!result.rowCount)throw new Error('A photograph belongs to a different local store.');
  }
  for(const n of [...snapshot.nodes].sort((a,b)=>Number(a.kind==='family')-Number(b.kind==='family')))await c.query('INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases,local_names) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(store_id,id) DO UPDATE SET parent_id=EXCLUDED.parent_id,label=EXCLUDED.label,aliases=EXCLUDED.aliases,local_names=EXCLUDED.local_names',[localCatalogStore,n.id,n.parent_id,n.kind,n.label,JSON.stringify(n.aliases),JSON.stringify(n.local_names)]);
  await c.query('UPDATE products SET active=false WHERE store_id=$1',[localCatalogStore]);
  const copied=columns,all=['store_id',...copied,'active'];
  const sql=`INSERT INTO products(${all.join(',')}) VALUES(${all.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(store_id,sku) DO UPDATE SET ${[...copied.filter(k=>k!=='sku'),'active'].map(k=>k+'=EXCLUDED.'+k).join(',')}`;
  for(const p of snapshot.products){
   const image=!development&&typeof p.image_path==='string'&&p.image_path.startsWith('/')?snapshot.imageOrigin+p.image_path:p.image_path;
   // Live reservations belong to live orders, which are intentionally not copied.
   // Start the test shop with the snapshot's available quantity and no holds.
   const stock=p.stock===null?null:Math.max(0,Number(p.stock)-Number(p.reserved_stock??0));
   await c.query(sql,[localCatalogStore,...copied.map(k=>k==='image_path'?image:k==='reserved_stock'?0:k==='stock'?stock:jsonColumns.has(k)&&p[k]!==null?JSON.stringify(p[k]):p[k]),p.active]);
  }
  await c.query('COMMIT');return {storeId:localCatalogStore,capturedAt:snapshot.capturedAt,products:snapshot.products.length};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
