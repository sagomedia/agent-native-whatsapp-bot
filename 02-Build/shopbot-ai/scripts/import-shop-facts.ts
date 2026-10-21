import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {z} from 'zod';
import {factApplySchema} from '../packages/contracts/catalog-facts.js';
import {previewCatalogFacts,applyCatalogFacts,exportCatalogFacts} from '../apps/server/src/services/catalog-fact-imports.js';
const args=process.argv.slice(2),option=(name:string)=>args.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3);
if(args.includes('--help')){console.log('Shop facts: --file=/absolute/input.csv --receipt=/private/receipt.json previews supplied facts; --export=/private/sheet.csv exports blank editable fields. Apply exactly one chunk with --apply --owner-authorized --batch=UUID --hash=SHA256 --chunk=0 --receipt=/private/receipt.json. Repeat the SAME chunk after an uncertain result. Preview never changes product facts. Explicit DATABASE_URL, OWNER_STORE_ID and SHOPBOT_CATALOG_ACTOR required.');process.exit(0);}
const env=z.object({DATABASE_URL:z.url(),OWNER_STORE_ID:z.uuid(),SHOPBOT_CATALOG_ACTOR:z.string().min(3).max(200)}).parse(process.env);
if(args.includes('--apply')&&!args.includes('--owner-authorized'))throw Error('Applying shop facts requires --owner-authorized.');
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:1,statement_timeout:15000,lock_timeout:5000});
try{
 const c=await pool.connect();try{
  await c.query(args.some(x=>x.startsWith('--export='))?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
  let result:unknown,receiptPath:string|undefined;
  if(option('export')){const exported=await exportCatalogFacts(c,env.OWNER_STORE_ID,{});await writeFile(option('export')!,exported.csv,{flag:'wx',mode:0o600});result={exported:exported.total};}
  else{
   const receipt=option('receipt');if(!receipt)throw Error('Choose an explicit private --receipt path.');
   await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[env.OWNER_STORE_ID]);
   if(args.includes('--apply'))result=await applyCatalogFacts(c,env.OWNER_STORE_ID,env.SHOPBOT_CATALOG_ACTOR,factApplySchema.parse({batchId:option('batch'),fileHash:option('hash'),expectedChunk:Number(option('chunk'))}));
   else{const file=option('file');if(!file)throw Error('Choose --file to preview or --export to export.');result=await previewCatalogFacts(c,env.OWNER_STORE_ID,await readFile(file,'utf8'));}
   await c.query("INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,$3,$1,$4)",[env.OWNER_STORE_ID,env.SHOPBOT_CATALOG_ACTOR,args.includes('--apply')?'catalog_facts_apply':'catalog_facts_preview',JSON.stringify(result)]);
   // Confirmed operations remain queryable by batch even if a local receipt cannot be saved.
   receiptPath=receipt;
  }
  await c.query('COMMIT');if(receiptPath)await writeFile(receiptPath,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}finally{await pool.end();}
