import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
export const demoCatalogStore='55555555-5555-4555-8555-555555555555';
export async function setupImageDemo(pool:Pool) {
  const pack=JSON.parse(await readFile('resources/catalog/ksmc-demo/catalog.json','utf8'));
  if(pack.demoOnly!==true||pack.productCount!==30)throw new Error('Expected the preserved public demo catalog.');
  const client=await pool.connect();try{
    await client.query('BEGIN');
    await client.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'KSMC image demo — unverified merchant data','true') ON CONFLICT DO NOTHING",[demoCatalogStore]);
    const store=(await client.query('SELECT synthetic FROM stores WHERE id=$1 FOR UPDATE',[demoCatalogStore])).rows[0];if(store.synthetic!=='true')throw new Error('Demo catalog store is not synthetic.');
    await client.query('INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true) ON CONFLICT(store_id) DO UPDATE SET require_product_confirmation=true',[demoCatalogStore]);
    for(const p of pack.products){
      if(!/^H\d\d$/.test(p.sku)||!Number.isInteger(p.pricePaise)||p.pricePaise<0)throw new Error('Invalid public demo product.');
      const aliases=[...p.aliases,...(p.unit==='box'&&/screw/i.test(p.name)?['screw box','screw boxes']:[])];
      await client.query('INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,category,image_path) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT DO NOTHING',[demoCatalogStore,p.sku,p.name,p.unit,p.pricePaise,p.stock,JSON.stringify(aliases),p.category,`/demo-images/${p.sku}.jpg`]);
    }
    await client.query('COMMIT');return demoCatalogStore;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
