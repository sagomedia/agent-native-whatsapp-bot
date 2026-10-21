import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,realpath,rename,rm,stat,writeFile} from 'node:fs/promises';
import {basename,dirname,join,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBulkCatalogPackage} from '../apps/server/src/services/catalog-bulk.js';

const MAX_IMAGE_BYTES=2*1024*1024;
const SKU=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FAMILY=/^[a-z][a-z0-9-]{0,79}$/;
const BATCH=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type JsonRecord=Record<string,unknown>;
type SourceRow={batchId:string;sourceSku:string;canonicalSku:string;decision:'unique'|'needs_review'|'confirmed_duplicate';evidence:string;unresolvedFields:string[]};
export type ReviewedCatalogSplitOverride={batchId:string;sourceSku:string;canonicalSku:string;reason:string};
export type AssembleReviewedCatalogOptions={sourceRoot:string;outputDirectory:string;splitOverrides?:ReviewedCatalogSplitOverride[]};
export type AssembleReviewedCatalogResult={outputDirectory:string;sourceRows:number;includedRows:number;excludedDuplicates:number;imagesCopied:number;sourceHash:string};

function fail(message:string):never{throw new Error(message);}
function isRecord(value:unknown):value is JsonRecord{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function hashBytes(bytes:Buffer|string){return createHash('sha256').update(bytes).digest('hex');}
function within(root:string,path:string){const rel=relative(root,path);return rel===''||(rel!=='..'&&!rel.startsWith(`..${sep}`)&&!rel.startsWith(sep));}
function stable(value:unknown):unknown{
  if(Array.isArray(value))return value.map(stable);
  if(isRecord(value))return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
function stableHash(value:unknown){return hashBytes(JSON.stringify(stable(value)));}
function assertText(value:unknown,label:string,max=1000):asserts value is string{
  if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label} must be nonempty text of at most ${max} characters.`);
}
async function readContained(root:string,relativePath:string){
  const path=resolve(root,relativePath);
  if(!within(root,path))fail(`Unsafe source path: ${relativePath}`);
  const actual=await realpath(path);
  if(!within(root,actual))fail(`Source path escapes its root: ${relativePath}`);
  const info=await stat(actual);
  if(!info.isFile())fail(`Expected a regular file: ${relativePath}`);
  if(info.size>64*1024*1024)fail(`${relativePath} exceeds the 64 MiB input limit.`);
  const bytes=await readFile(actual);
  if(bytes.length!==info.size)fail(`${relativePath} changed while being read.`);
  return {bytes,path:actual};
}
async function readJsonContained(root:string,relativePath:string){
  const file=await readContained(root,relativePath);
  let value:unknown;
  try{value=JSON.parse(file.bytes.toString('utf8')) as unknown;}catch{fail(`${relativePath} is not valid JSON.`);}
  return {...file,value};
}
function namespacedSourceSku(batchId:string,sourceSku:string){
  const value=`SRC-${hashBytes(`${batchId}\0${sourceSku}`).slice(0,24)}`;
  if(!SKU.test(value))fail(`Could not create a valid namespaced source SKU for ${batchId}/${sourceSku}.`);
  return value;
}
function namespacedSourceFamily(batchId:string,sourceFamilyId:string){
  const value=`fam-${hashBytes(`${batchId}\0${sourceFamilyId}`).slice(0,32)}`;
  if(!FAMILY.test(value))fail(`Could not create a valid namespaced source family for ${batchId}/${sourceFamilyId}.`);
  return value;
}
function departmentNodeId(department:string){
  const value=`dept-${department.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`;
  if(!FAMILY.test(value))fail(`Invalid canonical department ID: ${department}`);
  return value;
}
function titleFromSlug(value:string){return value.split('-').filter(Boolean).map(s=>s[0]!.toUpperCase()+s.slice(1)).join(' ');}
function detectMime(bytes:Buffer):{mimeType:'image/jpeg'|'image/png'|'image/webp';extension:string}|null{
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return {mimeType:'image/jpeg',extension:'jpg'};
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mimeType:'image/png',extension:'png'};
  if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {mimeType:'image/webp',extension:'webp'};
  return null;
}
function emptyOrUnknown(value:unknown){
  if(value===undefined||value===null||value===false||value==='')return true;
  if(Array.isArray(value))return value.length===0;
  if(isRecord(value))return Object.keys(value).length===0;
  return false;
}
function assertNoMerchantClaims(row:JsonRecord,label:string){
  if(row.active===true||row.verified===true)fail(`${label} contains an active or verified claim; the offline assembler cannot grant either flag.`);
  for(const key of ['merchant_sku','merchantSku','merchant_verification','merchantVerification','merchant_confirmation','merchantConfirmation','verification','priceVerified','stockVerified']){
    if(Object.hasOwn(row,key)&&!emptyOrUnknown(row[key]))fail(`${label} contains unsupported merchant-confirmed field ${key}.`);
  }
  if(row.pricePaise!==undefined&&row.pricePaise!==0)fail(`${label} must keep pricePaise at 0 until merchant confirmation.`);
  if(row.priceStatus!==undefined&&row.priceStatus!=='confirm')fail(`${label} must keep priceStatus at confirm.`);
  if(row.stock!==undefined&&row.stock!==null)fail(`${label} must keep stock unknown (null).`);
}
function asArray(value:unknown,label:string):unknown[]{if(!Array.isArray(value))fail(`${label} must be an array.`);return value;}
function scopedKey(batchId:string,sourceSku:string){return `${batchId}\0${sourceSku}`;}
function safeIssue(value:string){return value.slice(0,500);}
function pushIssue(issues:string[],value:unknown){if(typeof value==='string'&&value.trim()){const item=safeIssue(value.trim());if(!issues.includes(item)&&issues.length<100)issues.push(item);}}
function validateOverride(value:unknown,index:number):ReviewedCatalogSplitOverride{
  if(!isRecord(value))fail(`splitOverrides[${index}] must be an object.`);
  const {batchId,sourceSku,canonicalSku,reason}=value;
  if(typeof batchId!=='string'||!BATCH.test(batchId))fail(`splitOverrides[${index}].batchId is invalid.`);
  if(typeof sourceSku!=='string'||!SKU.test(sourceSku))fail(`splitOverrides[${index}].sourceSku is invalid.`);
  if(typeof canonicalSku!=='string'||!SKU.test(canonicalSku))fail(`splitOverrides[${index}].canonicalSku is invalid.`);
  assertText(reason,`splitOverrides[${index}].reason`,500);
  return {batchId,sourceSku,canonicalSku,reason:reason.trim()};
}
function validateProduct(row:unknown,label:string):JsonRecord{
  if(!isRecord(row))fail(`${label} must be an object.`);
  if(typeof row.sku!=='string'||!SKU.test(row.sku))fail(`${label}.sku is invalid.`);
  if(typeof row.familyId!=='string'||!row.familyId)fail(`${label}.familyId is required.`);
  assertText(row.name,`${label}.name`,300);
  assertNoMerchantClaims(row,label);
  return row;
}
function jsonHashOfRow(value:unknown){return stableHash(value);}

async function resolveOutputPath(sourceRoot:string,requested:string){
  if(!requested||!resolve(requested))fail('outputDirectory must be an absolute or resolvable path.');
  const absolute=resolve(requested),parent=await realpath(dirname(absolute)),target=join(parent,basename(absolute));
  if(!within(parent,target)||target===parent)fail('Invalid output directory path.');
  if(within(sourceRoot,target)||within(target,sourceRoot))fail('Output must be outside the source root and must not contain it.');
  try{await lstat(target);fail(`Refusing to overwrite existing output: ${target}`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return target;
}

async function imageForProduct(options:{batchRoot:string;imagePath:unknown;heldReason?:string;tempRoot:string;copiedByHash:Map<string,string>}):Promise<{image?:{path:string;mimeType:'image/jpeg'|'image/png'|'image/webp';matchKind:'unconfirmed'};hash?:string;issue?:string;status:'held'|'copied'|'deduplicated'|'omitted'|'none'}>{
  const {batchRoot,imagePath,heldReason,tempRoot,copiedByHash}=options;
  if(typeof imagePath!=='string'||!imagePath){return {status:'none'};}
  if(!imagePath.startsWith('images/')||imagePath.includes('\\')||imagePath.split('/').some(part=>!part||part==='.'||part==='..'))fail(`Unsafe image path: ${imagePath}`);
  let source:string;
  try{
    source=await realpath(resolve(batchRoot,imagePath));
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return heldReason?{status:'held',issue:`Image held: ${heldReason}`}:{status:'omitted',issue:`Image omitted: local file ${imagePath} is missing.`};
    throw error;
  }
  const imageRoot=await realpath(join(batchRoot,'images'));
  if(!within(batchRoot,imageRoot))fail(`Image directory escapes its batch: ${imagePath}`);
  if(!within(imageRoot,source))fail(`Image path escapes its batch images folder: ${imagePath}`);
  if(heldReason)return {status:'held',issue:`Image held: ${heldReason}`};
  const info=await stat(source);
  if(!info.isFile())return {status:'omitted',issue:`Image omitted: ${imagePath} is not a regular file.`};
  if(info.size<1)return {status:'omitted',issue:`Image omitted: ${imagePath} is empty.`};
  if(info.size>MAX_IMAGE_BYTES)return {status:'omitted',issue:`Image omitted: ${imagePath} exceeds 2 MiB.`};
  const bytes=await readFile(source);
  if(bytes.length!==info.size)fail(`Image changed while being read: ${imagePath}`);
  const detected=detectMime(bytes);
  if(!detected)return {status:'omitted',issue:`Image omitted: ${imagePath} is not a supported JPEG, PNG, or WebP.`};
  const digest=hashBytes(bytes),prior=copiedByHash.get(digest);
  if(prior)return {image:{path:prior,mimeType:detected.mimeType,matchKind:'unconfirmed'},hash:digest,status:'deduplicated'};
  const packagePath=`images/${digest}.${detected.extension}`;
  await mkdir(join(tempRoot,'images'),{recursive:true});
  await writeFile(join(tempRoot,packagePath),bytes,{flag:'wx'});
  copiedByHash.set(digest,packagePath);
  return {image:{path:packagePath,mimeType:detected.mimeType,matchKind:'unconfirmed'},hash:digest,status:'copied'};
}

/** Assemble the reviewed local source handoff into a new v2 bulk-catalog package. */
export async function assembleReviewedCatalog(options:AssembleReviewedCatalogOptions):Promise<AssembleReviewedCatalogResult>{
  const sourceRoot=await realpath(resolve(options.sourceRoot));
  if(!(await stat(sourceRoot)).isDirectory())fail('sourceRoot must be a directory.');
  const outputDirectory=await resolveOutputPath(sourceRoot,options.outputDirectory);
  const mapFile=await readJsonContained(sourceRoot,'canonical-sku-map.json');
  const taxonomyFile=await readJsonContained(sourceRoot,'taxonomy-map.json');
  const exclusionsFile=await readJsonContained(sourceRoot,'demo-exclusions.json');
  const mapRows=asArray(mapFile.value,'canonical-sku-map.json');
  if(!isRecord(taxonomyFile.value))fail('taxonomy-map.json must be an object.');
  const taxonomyData=taxonomyFile.value;
  const categories=asArray(taxonomyData.canonicalCategories,'taxonomy-map.json canonicalCategories');
  const familyRows=asArray(taxonomyData.sourceFamilyMappings,'taxonomy-map.json sourceFamilyMappings');
  const demoExclusions=asArray(exclusionsFile.value,'demo-exclusions.json');

  const sourceMap=new Map<string,SourceRow>();
  for(const [index,value] of mapRows.entries()){
    if(!isRecord(value))fail(`canonical-sku-map.json[${index}] must be an object.`);
    const {batchId,sourceSku,canonicalSku,decision,evidence,unresolvedFields}=value;
    if(typeof batchId!=='string'||!BATCH.test(batchId))fail(`canonical-sku-map.json[${index}].batchId is invalid.`);
    if(typeof sourceSku!=='string'||!SKU.test(sourceSku))fail(`canonical-sku-map.json[${index}].sourceSku is invalid.`);
    if(typeof canonicalSku!=='string'||!SKU.test(canonicalSku))fail(`canonical-sku-map.json[${index}].canonicalSku is invalid.`);
    if(!['unique','needs_review','confirmed_duplicate'].includes(String(decision)))fail(`canonical-sku-map.json[${index}].decision is invalid.`);
    assertText(evidence,`canonical-sku-map.json[${index}].evidence`,5000);
    if(!Array.isArray(unresolvedFields)||unresolvedFields.some(x=>typeof x!=='string'))fail(`canonical-sku-map.json[${index}].unresolvedFields must be a string array.`);
    const key=scopedKey(batchId,sourceSku);
    if(sourceMap.has(key))fail(`Duplicate canonical map entry for ${batchId}/${sourceSku}.`);
    sourceMap.set(key,{batchId,sourceSku,canonicalSku,decision:decision as SourceRow['decision'],evidence,unresolvedFields:[...unresolvedFields] as string[]});
  }

  const categoryById=new Map<string,{id:string;department:string;label:string;genericAliases:string[]}>();
  for(const [index,value] of categories.entries()){
    if(!isRecord(value)||typeof value.id!=='string'||!FAMILY.test(value.id)||typeof value.department!=='string'||!FAMILY.test(value.department))fail(`Invalid canonical category at index ${index}.`);
    assertText(value.label,`canonicalCategories[${index}].label`,120);
    const genericAliases=value.genericAliases===undefined?[]:asArray(value.genericAliases,`canonicalCategories[${index}].genericAliases`);
    if(genericAliases.length>40||genericAliases.some(alias=>typeof alias!=='string'||alias.length>120))fail(`Invalid generic aliases for canonical category ${value.id}.`);
    if(categoryById.has(value.id))fail(`Duplicate canonical category ID ${value.id}.`);
    categoryById.set(value.id,{id:value.id,department:value.department,label:value.label,genericAliases:genericAliases as string[]});
  }
  const familyMap=new Map<string,string>();
  for(const [index,value] of familyRows.entries()){
    if(!isRecord(value)||typeof value.batchId!=='string'||typeof value.sourceFamilyId!=='string'||typeof value.canonicalCategoryId!=='string')fail(`Invalid sourceFamilyMappings[${index}].`);
    if(!BATCH.test(value.batchId)||!value.sourceFamilyId||value.sourceFamilyId.length>100)fail(`Invalid source family key at taxonomy index ${index}.`);
    const category=categoryById.get(value.canonicalCategoryId);
    if(!category)fail(`Taxonomy family ${value.canonicalCategoryId} is missing from canonicalCategories.`);
    if(value.canonicalDepartmentId!==category.department)fail(`Taxonomy family mapping ${value.batchId}/${value.sourceFamilyId} conflicts with its canonical department.`);
    const key=scopedKey(value.batchId,value.sourceFamilyId);
    if(familyMap.has(key))fail(`Duplicate source family mapping for ${value.batchId}/${value.sourceFamilyId}.`);
    familyMap.set(key,value.canonicalCategoryId);
  }

  const batches=[...new Set([...sourceMap.values()].map(row=>row.batchId))].sort();
  if(!batches.length)fail('The canonical SKU map contains no source rows.');
  const productsBySource=new Map<string,{row:JsonRecord;batchRoot:string;sourceRowHash:string;sourceFamilyId:string;exceptions:JsonRecord[]}>();
  const sourceFiles:Record<string,string>={
    'canonical-sku-map.json':hashBytes(mapFile.bytes),
    'taxonomy-map.json':hashBytes(taxonomyFile.bytes),
    'demo-exclusions.json':hashBytes(exclusionsFile.bytes),
  };
  const batchRoots=new Map<string,string>();
  for(const batchId of batches){
    const batchRootPath=resolve(sourceRoot,batchId);
    if(!within(sourceRoot,batchRootPath))fail(`Unsafe batch directory: ${batchId}`);
    const batchRoot=await realpath(batchRootPath);
    if(!within(sourceRoot,batchRoot)||(await stat(batchRoot)).isDirectory()===false)fail(`Batch directory is not a local directory: ${batchId}`);
    batchRoots.set(batchId,batchRoot);
    for(const name of ['products.json','catalog-map.json','research.json','exceptions.json']){
      try{
        const file=await readJsonContained(batchRoot, name);
        sourceFiles[`${batchId}/${name}`]=hashBytes(file.bytes);
        if(name==='products.json'){
          if(!isRecord(file.value)||!Array.isArray(file.value.products))fail(`${batchId}/products.json must contain a products array.`);
          const rows=file.value.products;
          const exceptionsFileForBatch=await readJsonContained(batchRoot,'exceptions.json');
          if(!Array.isArray(exceptionsFileForBatch.value))fail(`${batchId}/exceptions.json must be an array.`);
          const exceptionsBySku=new Map<string,JsonRecord[]>();
          for(const rawException of exceptionsFileForBatch.value){
            if(!isRecord(rawException)||typeof rawException.sku!=='string')continue;
            const list=exceptionsBySku.get(rawException.sku)??[];list.push(rawException);exceptionsBySku.set(rawException.sku,list);
          }
          const seen=new Set<string>();
          for(const [rowIndex,rawRow] of rows.entries()){
            const row=validateProduct(rawRow,`${batchId}/products.json[${rowIndex}]`),sourceSku=row.sku as string,key=scopedKey(batchId,sourceSku);
            if(seen.has(sourceSku))fail(`${batchId}/products.json contains duplicate SKU ${sourceSku}.`);
            seen.add(sourceSku);
            if(!sourceMap.has(key))fail(`Source row ${batchId}/${sourceSku} is absent from canonical-sku-map.json.`);
            productsBySource.set(key,{row,batchRoot,sourceRowHash:jsonHashOfRow(row),sourceFamilyId:row.familyId as string,exceptions:exceptionsBySku.get(sourceSku)??[]});
          }
          for(const sourceSku of [...sourceMap.values()].filter(x=>x.batchId===batchId).map(x=>x.sourceSku))if(!seen.has(sourceSku))fail(`Canonical map row ${batchId}/${sourceSku} has no source product.`);
        }
      }catch(error){
        if((error as NodeJS.ErrnoException).code==='ENOENT'&&name!=='products.json'&&name!=='exceptions.json')continue;
        if((error as NodeJS.ErrnoException).code==='ENOENT'&&name==='exceptions.json')continue;
        throw error;
      }
    }
  }
  if(productsBySource.size!==sourceMap.size)fail(`Source accounting mismatch: ${productsBySource.size} products for ${sourceMap.size} canonical map rows.`);

  const demoByKey=new Map<string,{excludeImage:boolean;reason:string}>();
  for(const [index,value] of demoExclusions.entries()){
    if(!isRecord(value)||typeof value.batchId!=='string'||typeof value.sku!=='string'||typeof value.excludeImage!=='boolean'||typeof value.excludeProduct!=='boolean')fail(`demo-exclusions.json[${index}] is malformed.`);
    if(!BATCH.test(value.batchId)||!SKU.test(value.sku))fail(`demo-exclusions.json[${index}] has an invalid source key.`);
    assertText(value.reason,`demo-exclusions.json[${index}].reason`,5000);
    const key=scopedKey(value.batchId,value.sku);
    if(demoByKey.has(key))fail(`Duplicate demo exclusion for ${value.batchId}/${value.sku}.`);
    if(!productsBySource.has(key))fail(`demo-exclusions.json refers to absent product ${value.batchId}/${value.sku}.`);
    if(value.excludeProduct)fail(`Product exclusion for ${value.batchId}/${value.sku} cannot be represented without dropping a source row.`);
    demoByKey.set(key,{excludeImage:value.excludeImage,reason:value.reason});
  }

  const overrides=(options.splitOverrides??[]).map(validateOverride);
  const overrideByKey=new Map<string,ReviewedCatalogSplitOverride>();
  const originalTargets=new Set([...sourceMap.values()].map(row=>row.canonicalSku));
  for(const override of overrides){
    const key=scopedKey(override.batchId,override.sourceSku),source=sourceMap.get(key);
    if(!source)fail(`Split override refers to absent source ${override.batchId}/${override.sourceSku}.`);
    if(source.decision!=='confirmed_duplicate')fail(`Split override may only split a confirmed duplicate: ${override.batchId}/${override.sourceSku}.`);
    if(overrideByKey.has(key))fail(`Duplicate split override for ${override.batchId}/${override.sourceSku}.`);
    if(originalTargets.has(override.canonicalSku))fail(`Split target ${override.canonicalSku} already exists in the source canonical map.`);
    overrideByKey.set(key,override);
  }

  const effectiveTargetByKey=new Map<string,string>();
  for(const [key,row] of sourceMap){effectiveTargetByKey.set(key,overrideByKey.get(key)?.canonicalSku??row.canonicalSku);}
  const representatives=new Map<string,SourceRow[]>();
  for(const [key,row] of sourceMap){
    if(row.decision==='confirmed_duplicate'&&overrideByKey.has(key))continue;
    if(row.decision==='confirmed_duplicate')continue;
    const list=representatives.get(row.canonicalSku)??[];list.push(row);representatives.set(row.canonicalSku,list);
  }
  for(const [target,rows] of representatives)if(rows.length!==1)fail(`Canonical SKU ${target} has ${rows.length} nonduplicate source rows; nonduplicate targets must be unique.`);
  for(const [key,row] of sourceMap){
    if(row.decision==='confirmed_duplicate'&&!overrideByKey.has(key)){
      const reps=representatives.get(row.canonicalSku)??[];
      if(reps.length!==1)fail(`Confirmed duplicate ${row.batchId}/${row.sourceSku} lacks one explicit nonduplicate representative for ${row.canonicalSku}.`);
    }
  }
  const effectiveNonDuplicateTargets=[...sourceMap].filter(([key,row])=>row.decision!=='confirmed_duplicate'||overrideByKey.has(key)).map(([key,row])=>effectiveTargetByKey.get(key)!);
  if(new Set(effectiveNonDuplicateTargets).size!==effectiveNonDuplicateTargets.length)fail('Effective canonical SKU targets must be unique after reviewed split overrides.');

  const outputSourceSkuByKey=new Map<string,string>(),outputSourceFamilyByKey=new Map<string,string>();
  for(const [key,product] of productsBySource){
    const map=sourceMap.get(key)!;
    outputSourceSkuByKey.set(key,namespacedSourceSku(map.batchId,map.sourceSku));
    const familyKey=scopedKey(map.batchId,product.sourceFamilyId);
    if(!familyMap.has(familyKey))fail(`No taxonomy mapping for source family ${map.batchId}/${product.sourceFamilyId}.`);
    outputSourceFamilyByKey.set(familyKey,namespacedSourceFamily(map.batchId,product.sourceFamilyId));
  }
  if(new Set(outputSourceSkuByKey.values()).size!==outputSourceSkuByKey.size)fail('Namespaced source SKUs collided.');
  if(new Set(outputSourceFamilyByKey.values()).size!==outputSourceFamilyByKey.size)fail('Namespaced source family IDs collided.');

  const taxonomyNodes:JsonRecord[]=[];
  const departments=new Map<string,string>();
  for(const category of categoryById.values()){
    const depId=departmentNodeId(category.department);
    departments.set(depId,category.department);
  }
  for(const [id,department] of departments){taxonomyNodes.push({id,parentId:null,kind:'department',label:titleFromSlug(department),localNames:{},aliases:[]});}
  for(const category of categoryById.values())taxonomyNodes.push({id:category.id,parentId:departmentNodeId(category.department),kind:'family',label:category.label,localNames:{},aliases:category.genericAliases});

  const tempRoot=await mkdtemp(join(dirname(outputDirectory),`.${basename(outputDirectory)}.assemble-`));
  let success=false;
  try{
    const outProducts:JsonRecord[]=[],skuMappings:JsonRecord[]=[],familyMappings:JsonRecord[]=[],canonicalExclusions:JsonRecord[]=[],auditRows:JsonRecord[]=[];
    const copiedByHash=new Map<string,string>();
    const familyPairSeen=new Set<string>();
    for(const [key,source] of sourceMap){
      const product=productsBySource.get(key)!,outputSourceSku=outputSourceSkuByKey.get(key)!,effectiveCanonicalSku=effectiveTargetByKey.get(key)!;
      const outputSourceFamilyId=outputSourceFamilyByKey.get(scopedKey(source.batchId,product.sourceFamilyId))!;
      const canonicalFamilyId=familyMap.get(scopedKey(source.batchId,product.sourceFamilyId))!;
      const familyPair=`${outputSourceFamilyId}\0${canonicalFamilyId}`;
      if(!familyPairSeen.has(familyPair)){familyMappings.push({sourceFamilyId:outputSourceFamilyId,canonicalFamilyId});familyPairSeen.add(familyPair);}
      const override=overrideByKey.get(key);
      const demo=demoByKey.get(key);
      const imageResult=await imageForProduct({batchRoot:product.batchRoot,imagePath:product.row.imagePath,heldReason:demo?.excludeImage?demo.reason:undefined,tempRoot,copiedByHash});
      const issues:string[]=[];
      if(source.decision==='needs_review'){
        pushIssue(issues,`Needs review: ${source.evidence}`);
        if(source.unresolvedFields.length)pushIssue(issues,`Unresolved fields: ${source.unresolvedFields.join(', ')}`);
      }
      if(override)pushIssue(issues,`Conservative split override: ${override.reason}`);
      if(imageResult.issue)pushIssue(issues,imageResult.issue);
      for(const exception of product.exceptions){
        if(typeof exception.issue==='string')pushIssue(issues,exception.issue);
        if(typeof exception.needed==='string')pushIssue(issues,`Follow-up: ${exception.needed}`);
      }
      const details={...product.row};
      delete details.imagePath;delete details.active;delete details.verified;
      delete details.verification;delete details.merchant_verification;delete details.merchantVerification;
      delete details.merchant_sku;delete details.merchantSku;delete details.priceVerified;delete details.stockVerified;
      details.sku=effectiveCanonicalSku;
      details.familyId=outputSourceFamilyId;
      details.pricePaise=0;details.priceStatus='confirm';details.stock=null;
      outProducts.push({sourceSku:outputSourceSku,details,...(imageResult.image?{image:imageResult.image}:{}),provenance:{source:`Reviewed local handoff ${source.batchId}; merchant approval pending`,issues}});
      if(source.decision==='confirmed_duplicate'&&!override){
        const representative=representatives.get(source.canonicalSku)![0]!;
        const representativeSourceSku=outputSourceSkuByKey.get(scopedKey(representative.batchId,representative.sourceSku))!;
        const reason=safeIssue(`Confirmed duplicate of ${representativeSourceSku} (${source.canonicalSku}): ${source.evidence}`);
        canonicalExclusions.push({sourceSku:outputSourceSku,reason});
      }else skuMappings.push({sourceSku:outputSourceSku,canonicalSku:effectiveCanonicalSku});
      auditRows.push({batchId:source.batchId,sourceSku:source.sourceSku,outputSourceSku,sourceFamilyId:product.sourceFamilyId,outputSourceFamilyId,canonicalFamilyId,sourceRowHash:product.sourceRowHash,originalCanonicalSku:source.canonicalSku,effectiveCanonicalSku,originalDecision:source.decision,effectiveDecision:override?'split_for_review':source.decision,evidence:source.evidence,unresolvedFields:source.unresolvedFields,...(override?{splitOverride:override}:{}),...(source.decision==='confirmed_duplicate'&&!override?{exclusion:canonicalExclusions[canonicalExclusions.length-1]}:{}),image:{sourcePath:product.row.imagePath??null,status:imageResult.status,...(imageResult.hash?{sha256:imageResult.hash}:{}),...(imageResult.issue?{issue:imageResult.issue}:{}),...(imageResult.image?{packagePath:imageResult.image.path,mimeType:imageResult.image.mimeType}:{}),...(demo?.excludeImage?{holdReason:demo.reason}:{})}});
    }
    const productDocument={schemaVersion:2,currency:'INR',products:outProducts};
    const mapDocument={schemaVersion:1,skus:skuMappings,families:familyMappings,exclusions:canonicalExclusions};
    const taxonomyDocument={schemaVersion:1,nodes:taxonomyNodes};
    await writeFile(join(tempRoot,'products.json'),`${JSON.stringify(productDocument,null,2)}\n`,{flag:'wx'});
    await writeFile(join(tempRoot,'canonical-map.json'),`${JSON.stringify(mapDocument,null,2)}\n`,{flag:'wx'});
    await writeFile(join(tempRoot,'catalog-map.json'),`${JSON.stringify(taxonomyDocument,null,2)}\n`,{flag:'wx'});
    const assembledHash=hashBytes(JSON.stringify({sourceFiles,rows:auditRows}));
    const audit={schemaVersion:1,createdBy:'assemble-reviewed-catalog',sourceRoot,sourceFiles,sourceRowCount:sourceMap.size,packageProductCount:outProducts.length,excludedDuplicateCount:canonicalExclusions.length,splitOverrideCount:overrides.length,sourceHash:assembledHash,rows:auditRows};
    await writeFile(join(tempRoot,'assembly-audit.json'),`${JSON.stringify(audit,null,2)}\n`,{flag:'wx'});
    await readBulkCatalogPackage(tempRoot);
    try{await lstat(outputDirectory);fail(`Refusing to overwrite existing output: ${outputDirectory}`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await rename(tempRoot,outputDirectory);
    success=true;
    return {outputDirectory,sourceRows:sourceMap.size,includedRows:skuMappings.length,excludedDuplicates:canonicalExclusions.length,imagesCopied:copiedByHash.size,sourceHash:assembledHash};
  }finally{
    if(!success)await rm(tempRoot,{recursive:true,force:true});
  }
}

function parseArgs(args:string[]){
  const parsed:{sourceRoot?:string;outputDirectory?:string;overridesFile?:string}={};
  for(let i=0;i<args.length;i++){
    const flag=args[i],value=args[i+1];
    if(!value||value.startsWith('--'))fail(`Expected a value after ${flag}.`);
    if(flag==='--source-root')parsed.sourceRoot=value;
    else if(flag==='--out')parsed.outputDirectory=value;
    else if(flag==='--split-overrides')parsed.overridesFile=value;
    else fail(`Unknown argument: ${flag}`);
    i++;
  }
  if(!parsed.sourceRoot||!parsed.outputDirectory)fail('Usage: tsx scripts/assemble-reviewed-catalog.ts --source-root <source-root> --out <new-output-dir> [--split-overrides <json-file>]');
  return parsed as Required<Pick<typeof parsed,'sourceRoot'|'outputDirectory'>>&typeof parsed;
}

async function cli(){
  const args=parseArgs(process.argv.slice(2));
  let splitOverrides:ReviewedCatalogSplitOverride[]=[];
  if(args.overridesFile){
    const file=await readFile(resolve(args.overridesFile),'utf8'),parsed:unknown=JSON.parse(file);
    if(!Array.isArray(parsed))fail('Split override file must contain a JSON array.');
    splitOverrides=parsed.map(validateOverride);
  }
  const result=await assembleReviewedCatalog({sourceRoot:args.sourceRoot,outputDirectory:args.outputDirectory,splitOverrides});
  process.stdout.write(`${JSON.stringify({assembled:true,...result},null,2)}\n`);
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  cli().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
}
