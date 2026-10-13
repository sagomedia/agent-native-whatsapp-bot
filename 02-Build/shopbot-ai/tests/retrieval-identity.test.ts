import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import type {DiscoveryPlan} from '../packages/contracts/index.js';

test('customer named product type survives broad and adversarial search plans',async()=>{
 const schema='identity_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const client=await pool.connect();
  try{
   const ctx={storeId:demoCatalogStore,conversationId:randomUUID(),actor:'identity-test',role:'customer' as const};
   const solvent=await discoverProducts(client,ctx,'PVC solvent cement 100ml bottle',{keywords:['PVC solvent cement','solvent gum','100ml'],familyId:'solvent-cement'});
   assert.deepEqual(solvent.products.map(p=>p.sku),['H07']);
   await client.query("UPDATE products SET keywords='[\"saw blade\",\"metal cutting\"]'::jsonb WHERE store_id=$1 AND sku='H16'",[demoCatalogStore]);
   const cuttingBlade=await discoverProducts(client,ctx,'cutting blade',{keywords:['cutting blade','cutting disc','hacksaw']});
   assert.ok(cuttingBlade.products.some(p=>p.sku==='H16'));
   for(const [query,plan] of [
    ['paint',{keywords:['paint','paint scraper','wall stencil'],departmentId:'surfaces'}],
    ['Asian Paints wall paint',{keywords:['paint scraper','wall stencil'],familyIds:['scrapers','wall-stencils']}],
    ['cutting plier',{keywords:['cutting wheel','hacksaw blade','PVC pipe cutter'],familyIds:['cutting-discs','saw-blades','pipe-cutters']}],
    ['wire cutting pliers',{keywords:['cutting wheel'],departmentId:'tools'}],
    ['plier',{keywords:['pipe cutter'],familyId:'pipe-cutters'}],
    ['Stanley plier',{keywords:['pipe cutter'],familyId:'pipe-cutters'}],
    ['pipe cutter for PVC',{keywords:['PVC pipe'],familyId:'pvc-pipes'}],
    ['paint scraper with handle',{keywords:['wall paint'],familyId:'paint'}],
    ['cutting plier tool',{keywords:['cutting wheel'],familyId:'cutting-discs'}],
    ['wire cutting plier tool',{keywords:['cutting wheel'],familyId:'cutting-discs'}],
    ['Asian Paints wall',{keywords:['wall stencil'],familyId:'wall-stencils'}],
    ['Stanley pipe cutter',{keywords:['pipe cutter'],familyId:'pipe-cutters'}],
    ['pipe',{keywords:['pipe cutter'],familyId:'pipe-cutters'}],
    ['pipe',{keywords:['pipe fittings'],familyIds:['pipe-fittings','pipe-cutters']}],
    ['pipe',{keywords:['pipe fittings','pipe cutter'],familyIds:['pipe-fittings','pipe-cutters'],useCase:'unspecified work'}],
   ] as Array<[string,DiscoveryPlan]>){
    const found=await discoverProducts(client,ctx,query,plan);
    assert.deepEqual(found.products.map(p=>p.sku),[],query);
   }
   for(const [query,expected] of [
    ['wall stencil',['H23','H24','H25']],
    ['paint scraper',['H22']],
    ['PVC pipe cutter',['H19']],
    ['pipe cutter for PVC',['H19']],
    ['pipe cutter for 25mm PVC pipe',['H19']],
    ['PVC pipe for bathroom',['H01','H02','H03','H04']],
    ['paint scraper with handle',['H22']],
    ['wall stencil for bedroom',['H23','H24','H25']],
   ] as const){
    const found=await discoverProducts(client,ctx,query);
    assert.deepEqual(found.products.map(p=>p.sku).sort(),[...expected].sort(),query);
   }
   const longVoiceQuery='வீட்டுக்காக '.repeat(12)+'Asian Paints wall paint';
   assert.ok(longVoiceQuery.length>120&&longVoiceQuery.length<=200);
   const longVoice=await discoverProducts(client,ctx,longVoiceQuery);
   assert.deepEqual(longVoice.products,[]);
   assert.equal(longVoice.query,longVoiceQuery);
   const blade=await discoverProducts(client,ctx,'blade',{keywords:['blade','saw blade','cutting disc','putty scraper']});
   assert.ok(blade.products.some(p=>p.sku==='H16'));
   assert.ok(blade.products.some(p=>p.sku==='H22'));
   const cuttingJob=await discoverProducts(client,ctx,'cutter',{keywords:['pipe cutter','hacksaw blade','cutting wheel','garden shear'],familyIds:['pipe-cutters','saw-blades','cutting-discs','garden-cutters'],useCase:'customer has not specified what to cut',preferredSkus:['H19','H16','H14','H15','H17','H18']});
   assert.deepEqual(cuttingJob.products.map(p=>p.sku),['H19','H16','H14','H15','H17','H18']);
   for(const plan of [undefined,{keywords:['pipe','pipe glue','pipe clamp','pipe cutter'],departmentId:'plumbing'}]){
    const pipe=await discoverProducts(client,ctx,'pipe',plan);
    assert.deepEqual(pipe.products,[]);
    assert.equal(pipe.noExactMatch,true);
   }
   for(const [query,family] of [['PVC pipe','pvc-pipes'],['pipe fitting','pipe-fittings'],['garden hose','hose']] as const){
    const result=await discoverProducts(client,ctx,query);
    assert.ok(result.products.length>0,query);
    assert.ok(result.products.every(p=>p.familyId===family),query);
   }
   const plumbing=await discoverProducts(client,ctx,'plumbing',{keywords:['plumbing'],departmentId:'plumbing'});
   assert.ok(new Set(plumbing.products.map(p=>p.familyId)).size>1);
  }finally{client.release();}
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
