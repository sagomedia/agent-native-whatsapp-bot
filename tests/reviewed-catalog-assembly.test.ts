import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readBulkCatalogPackage} from '../apps/server/src/services/catalog-bulk.js';
import {assembleReviewedCatalog} from '../scripts/assemble-reviewed-catalog.js';

const JPEG=Buffer.from([0xff,0xd8,0xff,0x01,0x02,0x03,0x04,0x05]);
const splitOverride={batchId:'batch-two',sourceSku:'SKU-005',canonicalSku:'CANON-SPLIT-005',reason:'Pack size evidence is unresolved; preserve a separate review item.'};

function product(sku:string,name:string,imagePath?:string){
  return {sku,name,localNames:{ta:`${name} தமிழ்`,'ta-Latn':`${name} porul`},familyId:'source-tools',brand:'Fixture Brand',specifications:{size:'10 mm'},unit:'piece',quantityStep:1,pricePaise:0,priceStatus:'confirm',stock:null,aliases:[name],keywords:['fixture'],...(imagePath?{imagePath}:{}),active:false,verified:false,sellingPolicy:{cutAllowed:false,continuousLengthAvailable:null}};
}

async function makeFixture(){
  const base=await mkdtemp(join(tmpdir(),'reviewed-catalog-'));
  const sourceRoot=join(base,'mega_folder');
  const batches=[
    {id:'batch-one',products:[
      product('SKU-001','Unique item','images/a.jpg'),
      product('SKU-002','Duplicate copy','images/b.jpg'),
      product('SKU-003','Unresolved item','images/c.jpg'),
    ]},
    {id:'batch-two',products:[
      product('SKU-001','Same raw SKU from another batch'),
      product('SKU-004','Duplicate representative'),
      product('SKU-005','Potentially same variant'),
    ]},
  ];
  for(const batch of batches){
    const dir=join(sourceRoot,batch.id);
    await mkdir(join(dir,'images'),{recursive:true});
    const data={schemaVersion:1,currency:'INR',targetCount:batch.products.length,products:batch.products};
    await writeFile(join(dir,'products.json'),`${JSON.stringify(data,null,2)}\n`);
    await writeFile(join(dir,'catalog-map.json'),JSON.stringify({schemaVersion:1,nodes:[]}));
    await writeFile(join(dir,'research.json'),JSON.stringify({schemaVersion:1,records:[]}));
    await writeFile(join(dir,'exceptions.json'),JSON.stringify([]));
  }
  await writeFile(join(sourceRoot,'batch-one','images/a.jpg'),JPEG);
  await writeFile(join(sourceRoot,'batch-one','images/b.jpg'),Buffer.from([0xff,0xd8,0xff,9,8,7]));
  await writeFile(join(sourceRoot,'batch-one','images/c.jpg'),JPEG);
  const map=[
    {batchId:'batch-one',sourceSku:'SKU-001',canonicalSku:'CANON-A',decision:'unique',evidence:'Distinct test model A.',unresolvedFields:['pricePaise','stock']},
    {batchId:'batch-one',sourceSku:'SKU-002',canonicalSku:'CANON-A',decision:'confirmed_duplicate',evidence:'Exact same model and pack.',unresolvedFields:['pricePaise','stock']},
    {batchId:'batch-one',sourceSku:'SKU-003',canonicalSku:'CANON-C',decision:'needs_review',evidence:'Colour variant is unresolved.',unresolvedFields:['colour']},
    {batchId:'batch-two',sourceSku:'SKU-001',canonicalSku:'CANON-B',decision:'unique',evidence:'Different model from batch one.',unresolvedFields:['pricePaise','stock']},
    {batchId:'batch-two',sourceSku:'SKU-004',canonicalSku:'CANON-D',decision:'unique',evidence:'Representative for SKU-005.',unresolvedFields:['pricePaise','stock']},
    {batchId:'batch-two',sourceSku:'SKU-005',canonicalSku:'CANON-D',decision:'confirmed_duplicate',evidence:'Source map groups these models.',unresolvedFields:['pack count']},
  ];
  await writeFile(join(sourceRoot,'canonical-sku-map.json'),`${JSON.stringify(map,null,2)}\n`);
  const categories=[{id:'hand-tools',department:'tools',label:'Hand Tools',genericAliases:['tool','hand tool']}];
  const sourceFamilyMappings=batches.map(batch=>({batchId:batch.id,sourceFamilyId:'source-tools',sourceDepartmentId:'tools',sourceLabel:'Tools',sourceAliases:['tools'],canonicalCategoryId:'hand-tools',canonicalDepartmentId:'tools',canonicalCategoryLabel:'Hand Tools'}));
  await writeFile(join(sourceRoot,'taxonomy-map.json'),`${JSON.stringify({version:'1.0',canonicalCategories:categories,sourceFamilyMappings},null,2)}\n`);
  await writeFile(join(sourceRoot,'demo-exclusions.json'),JSON.stringify([{sku:'SKU-002',batchId:'batch-one',excludeProduct:false,excludeImage:true,reason:'The product photo shows a conflicting colour.'}]));
  return {base,sourceRoot,outputDirectory:join(base,'assembled-v2')};
}

async function treeHash(path:string):Promise<string>{
  const digest=createHash('sha256');
  for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const child=join(path,entry.name);digest.update(entry.name).update('\0');
    if(entry.isDirectory())digest.update(await treeHash(child));
    else digest.update(await readFile(child));
  }
  return digest.digest('hex');
}

test('assembles every source once, keeps needs-review distinct, excludes only confirmed duplicates, and is accepted by the v2 reader',async()=>{
  const f=await makeFixture();
  try{
    const sourceBefore=await treeHash(f.sourceRoot);
    const result=await assembleReviewedCatalog({sourceRoot:f.sourceRoot,outputDirectory:f.outputDirectory,splitOverrides:[splitOverride]});
    assert.equal(result.sourceRows,6);
    assert.equal(result.includedRows,5);
    assert.equal(result.excludedDuplicates,1);
    assert.equal(result.imagesCopied,1,'identical image bytes should be copied once');
    const bundle=await readBulkCatalogPackage(f.outputDirectory);
    assert.equal(bundle.entries.length,6);
    assert.equal(bundle.mapping.skus.length,5);
    assert.equal(bundle.mapping.exclusions.length,1);
    const rowOne=bundle.entries.find(e=>e.details.name==='Unique item')!;
    const sameRawSkuOtherBatch=bundle.entries.find(e=>e.details.name==='Same raw SKU from another batch')!;
    assert.notEqual(rowOne.sourceSku,sameRawSkuOtherBatch.sourceSku,'raw SKU collisions must be namespaced by batch');
    const unresolved=bundle.entries.find(e=>e.details.name==='Unresolved item')!;
    assert.equal(unresolved.canonicalSku,'CANON-C');
    assert.equal(unresolved.details.sku,'CANON-C');
    assert.ok(unresolved.provenance.issues.some(issue=>issue.includes('Colour variant is unresolved')));
    const excluded=bundle.entries.find(e=>e.details.name==='Duplicate copy')!;
    assert.ok(excluded.exclusion?.includes('Confirmed duplicate of'));
    assert.equal(excluded.image,undefined,'excludeImage hold must omit the photo');
    assert.ok(excluded.provenance.issues.some(issue=>issue.includes('conflicting colour')));
    const split=bundle.entries.find(e=>e.details.name==='Potentially same variant')!;
    assert.equal(split.canonicalSku,'CANON-SPLIT-005');
    assert.equal(split.details.sku,'CANON-SPLIT-005');
    assert.equal(split.exclusion,undefined,'the explicitly split duplicate is a separate mapped draft');
    assert.equal(rowOne.image?.path,unresolved.image?.path,'duplicate photo bytes should share one packaged copy');
    for(const entry of bundle.entries){
      assert.equal(entry.details.pricePaise,0);
      assert.equal(entry.details.priceStatus,'confirm');
      assert.equal(entry.details.stock,null);
      assert.equal('active' in entry.details,false);
      assert.equal('verified' in entry.details,false);
    }
    const audit=JSON.parse(await readFile(join(f.outputDirectory,'assembly-audit.json'),'utf8')) as {rows:Array<{batchId:string;sourceSku:string;effectiveDecision:string;sourceRowHash:string}>;sourceFiles:Record<string,string>};
    assert.equal(audit.rows.length,6);
    assert.ok(audit.rows.every(row=>/^[a-f0-9]{64}$/.test(row.sourceRowHash)));
    assert.ok(audit.sourceFiles['canonical-sku-map.json']);
    assert.ok(audit.rows.some(row=>row.effectiveDecision==='split_for_review'));
    assert.equal(await treeHash(f.sourceRoot),sourceBefore,'assembly must not modify the source handoff');
  }finally{await rm(f.base,{recursive:true,force:true});}
});

test('refuses overwrite, path escape, unsafe image path, malformed maps, and merchant-confirmed values',async()=>{
  const f=await makeFixture();
  try{
    await assembleReviewedCatalog({sourceRoot:f.sourceRoot,outputDirectory:f.outputDirectory,splitOverrides:[splitOverride]});
    const outputBefore=await treeHash(f.outputDirectory);
    await assert.rejects(assembleReviewedCatalog({sourceRoot:f.sourceRoot,outputDirectory:f.outputDirectory,splitOverrides:[splitOverride]}),/overwrite/);
    assert.equal(await treeHash(f.outputDirectory),outputBefore);
    await assert.rejects(assembleReviewedCatalog({sourceRoot:f.sourceRoot,outputDirectory:join(f.sourceRoot,'bad')}),/outside the source root/);
    const sourceFile=join(f.sourceRoot,'batch-one','products.json');
    const original=JSON.parse(await readFile(sourceFile,'utf8')) as {products:Array<Record<string,unknown>>};
    const unsafe=structuredClone(original);unsafe.products[0]!.imagePath='images/../../outside.jpg';
    await writeFile(sourceFile,JSON.stringify(unsafe));
    await assert.rejects(assembleReviewedCatalog({sourceRoot:f.sourceRoot,outputDirectory:join(f.base,'unsafe-out')}),/Unsafe image path/);
    await writeFile(sourceFile,JSON.stringify(original));
    const badPrice=structuredClone(original);badPrice.products[0]!.pricePaise=100;
    await writeFile(sourceFile,JSON.stringify(badPrice));
    await assert.rejects(assembleReviewedCatalog({sourceRoot:f.sourceRoot,outputDirectory:join(f.base,'price-out')}),/pricePaise at 0/);
    await writeFile(sourceFile,JSON.stringify(original));
    const mapPath=join(f.sourceRoot,'canonical-sku-map.json');
    const map=JSON.parse(await readFile(mapPath,'utf8')) as Array<Record<string,unknown>>;
    const badMap=structuredClone(map);badMap[1]!.canonicalSku='CANON-ORPHAN';
    await writeFile(mapPath,JSON.stringify(badMap));
    await assert.rejects(assembleReviewedCatalog({sourceRoot:f.sourceRoot,outputDirectory:join(f.base,'map-out'),splitOverrides:[splitOverride]}),/representative/);
  }finally{await rm(f.base,{recursive:true,force:true});}
});
