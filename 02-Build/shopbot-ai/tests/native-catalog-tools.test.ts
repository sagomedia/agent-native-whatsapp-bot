import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';

const repository=resolve(import.meta.dirname,'..');
const bulkCli=join(repository,'dist/scripts/import-bulk-catalog.js');
const capacityCli=join(repository,'dist/scripts/catalog-capacity.js');
const minimalEnv={PATH:process.env.PATH??''};

function runCompiled(script:string,args:string[]){
  return spawnSync(process.execPath,[script,...args],{cwd:repository,env:minimalEnv,encoding:'utf8',timeout:15000});
}

test('compiled offline catalog dry-run loads its deployed imports and reports one unpublished row without database settings',async()=>{
  assert.ok(existsSync(bulkCli),'Run npm run build before the compiled catalog CLI tests.');
  const root=await mkdtemp(join(tmpdir(),'shopbot-bulk-cli-'));
  try{
    const pkg=join(root,'package');await mkdir(pkg);
    await writeFile(join(pkg,'products.json'),JSON.stringify({schemaVersion:2,currency:'INR',products:[{
      sourceSku:'SRC-FIXTURE-001',
      details:{sku:'CANON-FIXTURE-001',name:'Fixture hand tool',familyId:'source-tools',brand:'',unit:'piece',quantityStep:1,pricePaise:0,priceStatus:'confirm',stock:null,specifications:{},aliases:[],keywords:[]},
      provenance:{source:'disposable offline CLI fixture',issues:[]},
    }]}));
    await writeFile(join(pkg,'canonical-map.json'),JSON.stringify({schemaVersion:1,skus:[{sourceSku:'SRC-FIXTURE-001',canonicalSku:'CANON-FIXTURE-001'}],families:[{sourceFamilyId:'source-tools',canonicalFamilyId:'hand-tools'}],exclusions:[]}));
    await writeFile(join(pkg,'catalog-map.json'),JSON.stringify({schemaVersion:1,nodes:[
      {id:'tools',parentId:null,kind:'department',label:'Tools',localNames:{},aliases:[]},
      {id:'hand-tools',parentId:'tools',kind:'family',label:'Hand Tools',localNames:{},aliases:['tool']},
    ]}));

    const result=runCompiled(bulkCli,[pkg,'--batch=offline-fixture','--offline']);
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout) as {published:number;databaseChecked:boolean;new:number;count:number;conflicts:number};
    assert.equal(report.published,0);
    assert.equal(report.databaseChecked,false);
    assert.equal(report.new,1);
    assert.equal(report.count,1);
    assert.equal(report.conflicts,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('compiled capacity CLI fails closed with a sanitized message when explicit settings are absent',()=>{
  assert.ok(existsSync(capacityCli),'Run npm run build before the compiled catalog CLI tests.');
  const result=runCompiled(capacityCli,[]);
  assert.ifError(result.error);
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  const error=JSON.parse(result.stderr) as {error:string;message:string};
  assert.equal(error.error,'catalog_capacity_failed');
  assert.match(error.message,/explicit DATABASE_URL, STORE_ID, CAPACITY_PATH/);
  assert.equal(Object.hasOwn(minimalEnv,'DATABASE_URL'),false);
});

test('compiled review-later CLI loads without development tools, documents preview, and requires explicit settings/authorization',()=>{
  const cli=join(repository,'dist/scripts/promote-catalog-review-later.js');
  assert.ok(existsSync(cli),'Run npm run build before the compiled review-later CLI tests.');
  const help=runCompiled(cli,['--help']);assert.ifError(help.error);assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Preview is read-only/);assert.match(help.stdout,/--owner-authorized/);
  const noSettings=runCompiled(cli,['--snapshot=/tmp/no-write-fixture.json']);assert.ifError(noSettings.error);assert.equal(noSettings.status,1);assert.equal(noSettings.stdout,'');assert.match(JSON.parse(noSettings.stderr).message,/Explicit DATABASE_URL and SHOPBOT_CATALOG_STORE_ID/);
  const noAuthority=runCompiled(cli,['--snapshot=/tmp/no-write-fixture.json','--apply']);assert.equal(noAuthority.status,1);assert.match(JSON.parse(noAuthority.stderr).message,/requires both --apply and --owner-authorized/);
});
