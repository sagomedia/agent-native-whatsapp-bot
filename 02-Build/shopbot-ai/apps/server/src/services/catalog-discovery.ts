import {naturalCatalogQuery,queryColour,removeTerm,specificationKeys,specificationValue,specificationTextMatch} from './catalog-request.js';
import type {PoolClient} from 'pg';
import type {CatalogMap,DiscoveryPlan,DiscoveryResult,DiscoveryFacet,Product} from '../../../../packages/contracts/index.js';
import {discoveryPlanSchema} from '../../../../packages/contracts/index.js';
import {normalize,tokens,oneEdit,matches,productColumns,productForContext} from './catalog.js';
import {ToolError,type ActorContext} from './context.js';
import {canonicalMeasurementUnit} from '../../../../packages/contracts/measurements.js';
import {catalogMeasurements,withoutCatalogMeasurements,sameCatalogMeasurement,measurementSpecEqual,catalogMeasurementSqlPattern} from '../../../../packages/contracts/catalog-measurements.js';
import {discoveryMoreValue} from '../../../../packages/contracts/discovery.js';

function bound(client:PoolClient,sql:string,parameters:unknown[]) {
 const ids=[...new Set([...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
 return client.query(sql.replace(/\$(\d+)/g,(_,n)=>'$'+(ids.indexOf(Number(n))+1)),ids.map(i=>parameters[i-1]));
}
export type CatalogMapOptions={search?:string;departmentAfter?:string;familyAfter?:string};
export async function getCatalogMap(client:PoolClient,ctx:ActorContext,departmentId?:string,options:CatalogMapOptions={}):Promise<CatalogMap> {
 if(options.familyAfter&&!departmentId)throw new ToolError('Choose a department before continuing its product types.');
 const store=(await client.query('SELECT s.name,s.catalog_revision,c.store_type FROM stores s LEFT JOIN catalog_profiles c ON c.store_id=s.id WHERE s.id=$1',[ctx.storeId])).rows[0];
 if(!store)throw new ToolError('Store is not accessible.','forbidden');
 const search=options.search?.trim().slice(0,120),searchParameter=search?'%'+search.replace(/[\\%_]/g,'\\$&')+'%':null;
 // Count every family before applying page boundaries. Every node remains
 // reachable through stable IDs; customer context receives at most 20 x 30.
 const rows=(await client.query(`WITH family_counts AS (
 SELECT n.id,n.parent_id,n.kind,n.label,n.local_names,n.aliases,count(p.sku)::int AS count
 FROM catalog_nodes n LEFT JOIN products p ON p.store_id=n.store_id AND p.family_id=n.id AND p.active=true
 WHERE n.store_id=$1 GROUP BY n.id,n.parent_id,n.kind,n.label,n.local_names,n.aliases)
 SELECT *,($2::text IS NULL OR label ILIKE $2 ESCAPE '\\' OR aliases::text ILIKE $2 ESCAPE '\\') AS search_match FROM family_counts ORDER BY id`,[ctx.storeId,searchParameter])).rows;
 const available=rows.filter(n=>n.kind==='department'&&(!departmentId||n.id===departmentId)&&(n.search_match||rows.some(f=>f.parent_id===n.id&&f.kind==='family'&&f.search_match))&&(!options.departmentAfter||n.id>options.departmentAfter));
 const departments=available.slice(0,20).map(n=>{
  const all=rows.filter(f=>f.parent_id===n.id&&f.kind==='family'),matching=all.filter(f=>(!search||n.search_match||f.search_match)&&(!options.familyAfter||f.id>options.familyAfter)),families=matching.slice(0,30).map(f=>({id:f.id,label:f.label,localNames:f.local_names,aliases:f.aliases,count:f.count}));
  return {id:n.id,label:n.label,localNames:n.local_names,count:all.reduce((a,f)=>a+f.count,0),families,...(matching.length>30?{nextFamilyAfter:families.at(-1)!.id}:{})};
 });
 const count=Number((await client.query('SELECT count(*) FROM products WHERE store_id=$1 AND active=true',[ctx.storeId])).rows[0].count);
 return {revision:store.catalog_revision,store:{name:store.name,type:store.store_type??'general retail'},productCount:count,departments,truncated:available.length>20||departments.some(d=>d.nextFamilyAfter!==undefined),...(available.length>20?{nextDepartmentAfter:departments.at(-1)!.id}:{}),...(departmentId&&departments[0]?.nextFamilyAfter?{nextFamilyAfter:departments[0].nextFamilyAfter}:{})};
}
function unique(a:string[]){return [...new Set(a.map(s=>s.trim()).filter(Boolean))];}
function namedObjectPhrase(query:string){return query.split(/\s+(?:for|with|on)\s+/i,1)[0].trim();}
// Pack spellings are search evidence, not different product nouns. Keep the
// value/unit pair for eligibility while searching the remaining identity words.
const withoutPackMeasures=withoutCatalogMeasurements;
function matchesPackMeasures(query:string,product:Product){
 const requested=catalogMeasurements(namedObjectPhrase(query));
 if(!requested.length)return true;
 const actual=catalogMeasurements([product.name,...Object.entries(product.specifications??{}).filter(([key])=>['size','diameter','length','width','height','thickness','pack_size','pack_volume','volume','capacity','weight','pack_weight'].includes(key)).map(([,value])=>value)].join('; '));
 const contents=product.sellingPolicy?.packContents;
 if(contents)actual.push({value:contents.value,unit:canonicalMeasurementUnit(contents.unit)});
 return requested.every(r=>actual.some(a=>sameCatalogMeasurement(a,r)));
}
// "Pipe" describes several physically different goods. A search hint or a
// broad family alias such as "water pipe" cannot decide between rigid PVC,
// flexible watering hose, and a pump delivery/suction pipe. Keep the request
// unresolved until the customer supplies a product type or an exact catalog
// identity. A stated diameter is useful evidence but does not identify type.
export function needsSolventUse(query:string):boolean {
 const words=tokens(naturalCatalogQuery(query));
 return words.length===1&&['solvent','சால்வென்ட்'].includes(words[0]);
}
export function needsPipeType(query:string):boolean {
 const words=tokens(query);
 const pipe=words.some(w=>w==='pipe'||w==='பைப்'||w==='பைப்புகள்');
 const hose=words.some(w=>['hose','ஹோஸ்','ஓஸ்'].includes(w));
 const pump=words.some(w=>['pump','pumping','motor','suction','delivery','மோட்டார்','பம்ப்'].includes(w));
 if(pump&&(pipe||hose))return true;
 if(!pipe)return false;
 if(words.some(w=>['pvc','cpvc','upvc','பிவிசி','rigid','hose','ஹோஸ்','ஓஸ்','garden','watering','irrigation','irrigating','fitting','fittings','cutter','clamp','connector','elbow','coupler','solvent','cement','adhesive','glue','paste','சால்வென்ட்','கட்டர்','கட்டரு','பசை','க்ளாம்ப்'].includes(w)))return false;
 return true;
}
function sameObjectHead(a:string,b:string):boolean {
 if(a===b)return true;
 if(!/^[a-z]+$/.test(a+b)||Math.min(a.length,b.length)<4)return false;
 // Recover a swapped pair or a repeated-letter typo (cuter/cutter). General
 // edit distance cannot distinguish real different objects such as brush/bush.
 if(a.length===b.length){const changed=[...a].flatMap((c,i)=>c===b[i]?[]:[i]);return changed.length===2&&changed[1]===changed[0]+1&&a[changed[0]]===b[changed[1]]&&a[changed[1]]===b[changed[0]];}
 const longer=a.length>b.length?a:b,shorter=a.length>b.length?b:a;
 return longer.length===shorter.length+1&&[...longer].some((c,i)=>i>0&&c===longer[i-1]&&longer.slice(0,i)+longer.slice(i+1)===shorter);
}
// The customer's named object is an eligibility constraint. Search expansions
// may find that object, but cannot change it into a related tool or accessory.
function namedFamilies(query:string,nodes:{id:string;kind:string;label:string;aliases:string[]}[],plan:DiscoveryPlan) {
 const words=tokens(withoutPackMeasures(namedObjectPhrase(query))).filter(t=>!/^\d/.test(t));
 const families=nodes.filter(n=>n.kind==='family');
 const phrases=families.flatMap(n=>[n.label,...n.aliases].map(alias=>({id:n.id,words:tokens(alias).filter(t=>!/^\d/.test(t))})));
 // The product head must match a curated noun, including its normalized plural.
 // Fuzzy heads turn real different objects (brush/bush) into false matches.
 const found=phrases.filter(p=>p.words.length&&p.words.length<=words.length&&p.words.every((w,j)=>j===p.words.length-1?sameObjectHead(words.at(-1)!,w):oneEdit(words[words.length-p.words.length+j],w)));
 const longest=Math.max(0,...found.map(p=>p.words.length));
 const explicit=unique(found.filter(p=>p.words.length===longest).map(p=>p.id));
 if(longest>1||words.length!==1)return explicit;
 // A single named object such as "pipe" can be the head noun of a more
 // specific family label. Keep all families sharing that head ("blade" remains
 // ambiguous), but never expand to families where it is only the workpiece.
 const head=words[0];
 const byHead=families.filter(n=>[n.label,n.id.replaceAll('-',' '),...n.aliases].some(name=>{
  const parts=tokens(name);return parts.length>0&&sameObjectHead(head,parts.at(-1)!);
 })).map(n=>n.id);
 // A word shared by several product families can describe an unfinished job.
 // A multi-family job plan may compare alternatives, but a head with only one
 // matching family (for example, "pipe") remains a strict product identity.
 // Plan family IDs are checked against the store's actual catalog below.
 if(byHead.length>1&&plan.useCase&&plan.familyIds&&plan.familyIds.length>1)return [];
 return unique([...explicit,...byHead]);
}
function unsupportedNamedObject(query:string,nodes:{kind:string;label:string;aliases:string[]}[]) {
 const words=tokens(withoutPackMeasures(namedObjectPhrase(query))).filter(t=>!/^\d/.test(t)&&!['inch','inches','mm','cm','piece','pieces','box','boxes'].includes(t));
 if(!words.length)return false;
 const head=words.at(-1)!;
 // An unknown product head is not permission to show tools from an AI-suggested
 // family. Check actual catalog text below before suppressing a name.
 const known=unique(nodes.flatMap(n=>[n.label,...n.aliases]).flatMap(tokens));
 return !known.some(word=>sameObjectHead(head,word));
}
function customerIdentityWords(query:string) {
 // Clauses after these prepositions describe a job or accessory. They do not
 // change the item being requested. Generic nouns do not identify a SKU.
 const generic=new Set(['tool','tools','item','items','product','products','some','need','want','a','an','the','and','or','one','two','x','of','my','me','show','please','inch','inches','mm','cm']);
 return tokens(withoutPackMeasures(namedObjectPhrase(query))).filter(t=>!/\d/.test(t)&&!generic.has(t));
}
function supportsCustomerIdentity(query:string,product:Product,nodes:{id:string;kind:string;label:string;aliases:string[]}[],requestedFamilies:string[]) {
 const words=customerIdentityWords(query).filter(word=>!tokens(product.unit).some(unit=>word===unit||word===unit+'s'));
 const source=unique([product.name,...Object.values(product.localNames??{}),product.brand??'',...Object.values(product.specifications??{}),...product.aliases,...(product.keywords??[])].flatMap(tokens));
 if(words.length&&!requestedFamilies.length&&unsupportedNamedObject(query,nodes)&&!source.some(word=>sameObjectHead(words.at(-1)!,word)))return false;
 if(words.length<2)return true; // Vague single-word jobs still offer alternatives.
 let uncovered=[...words];
 if(product.familyId){
  const family=nodes.find(n=>n.kind==='family'&&n.id===product.familyId);
  const phrases=[family?.label??'',...(family?.aliases??[])].map(customerIdentityWords).sort((a,b)=>b.length-a.length);
  for(const phrase of phrases)if(phrase.length&&phrase.length<=words.length){
   const start=words.findIndex((_,i)=>phrase.every((word,j)=>oneEdit(words[i+j]??'',word)));
   if(start>=0){uncovered=words.filter((_,i)=>i<start||i>=start+phrase.length);break;}
  }
 }
 return uncovered.every(word=>source.some(candidate=>oneEdit(word,candidate)));
}
function numericDimensions(text:string){
 const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
 return text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?=inch(?:es)?\b|in\b|mm\b|cm\b)/gi,word=>String(numbers[word.trim().toLowerCase()])+' ');
}
function normalizedSpec(s:string){return normalize(numericDimensions(s.toLowerCase()).replace(/(\d)\s*(?:["\u2033]|inches?\b|in\b)/g,'$1 inch')).replace(/\s+/g,'').replace(/^(\d+(?:\.\d+)?)(?:l|litres?|liters?)$/,'$1litre');}
function specMatches(product:Product,key:string,value:string){if(['colour','color','material'].includes(key)){const actual=specificationKeys(key).map(k=>product.specifications?.[k]).filter((v):v is string=>!!v);return actual.length?actual.every(v=>specificationTextMatch(v,value)):specificationTextMatch(product.name,value);}return specificationKeys(key).some(k=>(measurementSpecEqual(product.specifications?.[k]??'',value)??(normalizedSpec(product.specifications?.[k]??'')===normalizedSpec(value))));}
function keywordScore(query:string,plan:DiscoveryPlan,product:Product) {
 const source=[product.name,...Object.values(product.localNames??{}),product.brand??'',...Object.values(product.specifications??{}),...product.aliases,...(product.keywords??[])],words=unique(source.flatMap(tokens));
 const needles=tokens(withoutPackMeasures(query)).filter(t=>!/^\d/.test(t));
 const covered=needles.filter(t=>words.some(w=>w===t||oneEdit(t,w)));
 let score=covered.length*35+(normalize(query)===normalize(product.name)?100:0);
 for(const hint of plan.keywords)for(const word of tokens(withoutPackMeasures(hint)))if(words.some(w=>w===word||oneEdit(word,w)))score+=4;
 const hintMatches=plan.keywords.filter(h=>{const ts=tokens(withoutPackMeasures(h)).filter(t=>!/^\d/.test(t));return ts.length>0&&ts.every(t=>words.some(w=>w===t||oneEdit(t,w)));});
 score+=hintMatches.length*45;
 const matched=needles.length>0&&covered.length===needles.length||hintMatches.length>0;
 return {score,match:matched?'keyword_match' as const:'related' as const,reason:matched?'Matches your search words':'Related to the category or job; check that this is what you meant'};
}
function choosePhotos(products:Product[],rank:Map<string,ReturnType<typeof keywordScore>>) {
 const ordered=[...products].sort((a,b)=>rank.get(b.sku)!.score-rank.get(a.sku)!.score||a.sku.localeCompare(b.sku));
 const selected:Product[]=[];
 for(const p of ordered)if(!selected.some(s=>s.familyId===p.familyId&&s.brand===p.brand)){selected.push(p);if(selected.length===10)break;}
 for(const p of ordered)if(selected.length<10&&!selected.some(s=>s.sku===p.sku))selected.push(p);
 return selected;
}
function emptyDiscovery(query:string,plan:DiscoveryPlan,reason:string):DiscoveryResult {
 return {query,plan,products:[],rankings:[],totalCount:0,retrievedCount:0,facets:[],noExactMatch:true,diagnostics:{canonicalQuery:normalize(query),appliedConstraints:{familyIds:plan.familyId?[plan.familyId]:plan.familyIds??[],brand:plan.brand,specifications:plan.specifications??{},measurements:catalogMeasurements(namedObjectPhrase(query))},sqlMatchCount:0,scannedCount:0,rejectedCount:0,candidateLimited:false,identity:'none',uncertainty:[reason]}};
}
// Bare solvent is a use question, not permission to choose paint thinner.
// Group actual shop families; the photograph is only a category example.
async function solventGroups(client:PoolClient,ctx:ActorContext,query:string,plan:DiscoveryPlan,nodes:{id:string;kind:string;label:string;local_names?:Record<string,string>;aliases:string[]}[]):Promise<DiscoveryResult>{
 const eligible=nodes.filter(n=>n.kind==='family'&&/solvent|thinner|சால்வென்ட்|தின்னர்/i.test([n.id,n.label,...n.aliases].join(' ')));
 const result=emptyDiscovery(query,plan,'solvent_use_required');
 if(!eligible.length)return result;
 const rows=(await client.query(`SELECT * FROM (SELECT ${productColumns}, count(*) OVER(PARTITION BY family_id)::int AS matching_count,row_number() OVER(PARTITION BY family_id ORDER BY (image_path IS NULL),sku) AS sample FROM products WHERE store_id=$1 AND active=true AND family_id=ANY($2::text[])) ranked WHERE sample=1 ORDER BY family_id`,[ctx.storeId,eligible.map(n=>n.id)])).rows;
 const offset=plan.facetPage?.key==='family'?plan.facetPage.offset:0;
 const groups=rows.map(row=>{const node=eligible.find(n=>n.id===row.family_id)!;return {key:'family',value:node.id,label:node.label,localNames:node.local_names,query:node.label,count:Number(row.matching_count),product:productForContext(row,ctx)};});
 const page=groups.slice(offset,offset+9);
 result.groups=page;result.totalCount=groups.reduce((sum,g)=>sum+g.count,0);
 result.facets=[{key:'family',label:'product type',totalValues:groups.length,...(offset+page.length<groups.length?{nextOffset:offset+page.length}:{}),values:page.map(({value,label,localNames,count})=>({value,label,localNames,count}))}];
 return result;
}
// Scores are deterministic ordering weights, never calibrated probabilities.
// Every product fact is read from the current, scoped SQL catalog.
async function discoverExactProducts(client:PoolClient,ctx:ActorContext,query:string,input?:DiscoveryPlan):Promise<DiscoveryResult> {
 query=numericDimensions(query);
 // A spoken customer request can exceed one keyword. Keep the full query for
 // identity checks while bounding only this fallback hint.
 const plan=discoveryPlanSchema.parse(input??{keywords:[query.slice(0,120)]});
 plan.keywords=plan.keywords.map(numericDimensions);
 if(plan.familyId&&plan.familyIds&&!plan.familyIds.includes(plan.familyId))throw new ToolError('The chosen family conflicts with the proposed product types.');
 if(plan.selectedSkus?.length===0)return emptyDiscovery(query,plan,'selection_empty');
 const nodes=(await client.query('SELECT id,parent_id,kind,label,local_names,aliases FROM catalog_nodes WHERE store_id=$1',[ctx.storeId])).rows;
 const objectPhrase=namedObjectPhrase(query);
 if(plan.familyId&&!nodes.some(n=>n.id===plan.familyId&&n.kind==='family'))throw new ToolError('Choose a product family from this shop’s catalog.');
 if(plan.departmentId&&!nodes.some(n=>n.id===plan.departmentId&&n.kind==='department'))throw new ToolError('Choose a department from this shop’s catalog.');
 if(plan.familyIds?.some(id=>!nodes.some(n=>n.id===id&&n.kind==='family')))throw new ToolError('Choose product types from this shop’s catalog.');
 if(plan.familyIds&&plan.departmentId&&plan.familyIds.some(id=>!nodes.some(n=>n.id===id&&n.parent_id===plan.departmentId)))throw new ToolError('Those types do not belong to the selected department.');
 if(plan.familyId&&plan.departmentId&&!nodes.some(n=>n.id===plan.familyId&&n.parent_id===plan.departmentId))throw new ToolError('That family does not belong to the selected department.');
 // Aliases may be shared by many variants. Only the strongest matching tier
 // participates in uniqueness: exact SKU, then exact name, then exact alias.
 const identified=(await client.query(`SELECT ${productColumns} FROM (
  SELECT ${productColumns},dense_rank() OVER(ORDER BY CASE WHEN lower(sku)=lower($2) THEN 0 WHEN lower(name)=lower($2) THEN 1 ELSE 2 END) AS identity_rank
  FROM products WHERE store_id=$1 AND active=true AND (lower(sku)=lower($2) OR lower(name)=lower($2) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(aliases) a WHERE lower(a)=lower($2)))
 ) identified WHERE identity_rank=1 ORDER BY sku LIMIT 2`,[ctx.storeId,query.trim()])).rows.map(p=>productForContext(p,ctx));
 const candidate=identified.length===1?identified[0]:undefined;
 const pumpName=/\b(?:pump|pumping|suction|delivery)\b|மோட்டார்|பம்ப்/iu;
 const namedPumpAlias=!!candidate&&pumpName.test(query)&&[candidate.name,...candidate.aliases].some(name=>pumpName.test(name));
 const namedCatalogProduct=!!candidate&&(normalize(candidate.sku)===normalize(query)||normalize(candidate.name)===normalize(query)||namedPumpAlias);
 let requestedFamilies=namedCatalogProduct?[]:namedFamilies(query,nodes,plan);
 const genericPaint=/\bpaints?\b/.test(query)&&! /\b(?:primer|putty|scraper|brush|roller|thinner|polish|stencil)\b/.test(query);
 if(genericPaint&&(!requestedFamilies.length||requestedFamilies.every(id=>nodes.find(n=>n.id===id)?.label.toLowerCase()==='paints'))){
  requestedFamilies=nodes.filter(n=>n.kind==='family'&&(/\bpaints?\b/.test(n.label.toLowerCase())||n.aliases.some((a:string)=>/^(?:interior|exterior|wall|enamel) paint$/.test(a)))&&!/primer|putty|scraper|brush|roller|thinner|polish|stencil/i.test(n.label)).map(n=>n.id);
 }
 if(needsSolventUse(query)&&!namedCatalogProduct)return solventGroups(client,ctx,query,plan,nodes);
 if(needsPipeType(query)&&!namedCatalogProduct)return emptyDiscovery(query,plan,'pipe_type_required');
 const root=candidate&&matchesPackMeasures(query,candidate)&&(!plan.selectedSkus||plan.selectedSkus.includes(candidate.sku))&&(!plan.familyId||candidate.familyId===plan.familyId)&&(!plan.familyIds||plan.familyIds.includes(candidate.familyId??''))&&(!plan.departmentId||nodes.some(n=>n.id===candidate.familyId&&n.parent_id===plan.departmentId))&&(!plan.brand||normalize(candidate.brand??'')===normalize(plan.brand))&&Object.entries(plan.specifications??{}).every(([key,value])=>specMatches(candidate,key,value))?candidate:undefined;
 if(requestedFamilies.length&&(plan.familyId&&!requestedFamilies.includes(plan.familyId)||plan.familyIds&&!plan.familyIds.some(id=>requestedFamilies.includes(id))))return emptyDiscovery(query,plan,'no_supported_match');
 if(!requestedFamilies.length&&!root&&unsupportedNamedObject(query,nodes)){
  const head=tokens(withoutPackMeasures(objectPhrase)).filter(t=>!/^\d/.test(t)&&!['inch','inches','mm','cm','piece','pieces','box','boxes'].includes(t)).at(-1)!;
  const hasNamedProduct=(await client.query("SELECT 1 FROM products WHERE store_id=$1 AND active=true AND (search_vector @@ plainto_tsquery('simple',$2) OR lower(unit)=lower($2)) LIMIT 1",[ctx.storeId,head])).rowCount;
  if(!hasNamedProduct&&!plan.brand&&!Object.keys(plan.specifications??{}).length)return emptyDiscovery(query,plan,'no_supported_match');
 }
 // An identified product still gets meaningful peers, constrained to its family,
 // catalog unit and exact stored specifications. No arbitrary filler images.
 const effective:DiscoveryPlan=root?{...plan,keywords:unique([root.name,...plan.keywords].map(naturalCatalogQuery)).slice(0,8),familyId:root.familyId??plan.familyId,specifications:root.specifications??plan.specifications}:objectPhrase!==query?{...plan,keywords:unique([objectPhrase,...plan.keywords]).slice(0,8)}:plan;
 const hints=unique([root?.name??query,...effective.keywords].flatMap(h=>[h,withoutPackMeasures(h)])).slice(0,12),parameters:unknown[]=[ctx.storeId];
 const add=(v:unknown)=>{parameters.push(v);return '$'+parameters.length;};
 const constraints=['p.store_id=$1','p.active=true'];
 // The recommendation stage's explicit selection is a display boundary. An
 // empty selection is preserved above; the ranker cannot refill rejected cards.
 if(effective.selectedSkus)constraints.push('p.sku=ANY('+add(effective.selectedSkus)+'::text[])');
 if(requestedFamilies.length)constraints.push('p.family_id=ANY('+add(requestedFamilies)+'::text[])');
 if(effective.familyId)constraints.push('p.family_id='+add(effective.familyId));
 else if(effective.familyIds)constraints.push('p.family_id=ANY('+add(effective.familyIds)+'::text[])');
 else if(effective.departmentId)constraints.push(`p.family_id IN (SELECT id FROM catalog_nodes WHERE store_id=$1 AND parent_id=${add(effective.departmentId)})`);
 if(effective.brand)constraints.push('lower(p.brand)=lower('+add(effective.brand)+')');
 for(const [key,value] of Object.entries(effective.specifications??{})){
  if(['colour','color','material'].includes(key)){
   const pattern=add('(^|[^[:alnum:]])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^[:alnum:]]|$)');
   const fields=specificationKeys(key).map(k=>`nullif(p.specifications->>${add(k)},'')`);
   constraints.push(`(coalesce(${fields.join(',')},p.name) ~* ${pattern} AND ${fields.map(f=>`(${f} IS NULL OR ${f} ~* ${pattern})`).join(' AND ')})`);continue;
  }
  const measures=catalogMeasurements(value);
  if(measures.length===1&&!withoutCatalogMeasurements(value)){constraints.push('('+unique(specificationKeys(key)).map(k=>`coalesce(p.specifications->>${add(k)},'') ~* ${add(catalogMeasurementSqlPattern(measures[0]))}`).join(' OR ')+')');continue;}
  const target=add(normalizedSpec(value));
  constraints.push('('+unique(specificationKeys(key)).map(k=>`regexp_replace(regexp_replace(regexp_replace(lower(p.specifications->>${add(k)}),'([0-9])[[:space:]]*(inches?\\M|in\\M|["\u2033])','\\1 inch','g'),'[^[:alnum:].]+','','g'),'^([0-9]+(?:[.][0-9]+)?)(l|litres?|liters?)$','\\1litre')=${target}`).join(' OR ')+')');
 }
 if(root)constraints.push('p.unit='+add(root.unit));
 // A dimension in a job clause describes the workpiece, not the tool size.
 // Explicit product specifications above still constrain the returned SKU.
 const requestedMeasures=catalogMeasurements(objectPhrase);
 // Apply typed dimensions before LIMIT: a long run of 4 kg packs cannot hide
 // the late-sorted 4 litre pack. Aliases never establish physical pack facts.
 const measurementSource=`concat_ws('; ',p.name,(SELECT string_agg(value,'; ') FROM jsonb_each_text(p.specifications) WHERE key IN ('size','diameter','length','width','height','thickness','pack_size','pack_volume','volume','capacity','weight','pack_weight')),concat_ws(' ',p.selling_policy->'packContents'->>'value',p.selling_policy->'packContents'->>'unit'))`;
 for(const measure of requestedMeasures)constraints.push(`${measurementSource} ~* ${add(catalogMeasurementSqlPattern(measure))}`);
 const numeric=root?[]:unique(normalize(withoutCatalogMeasurements(objectPhrase)).match(/\d+(?:\.\d+)?/g)??[]);
 for(const n of numeric)constraints.push(`p.search_text ~ ${add('(^|[^0-9.])'+n.replaceAll('.','\\.')+'([^0-9.]|$)')}`);
 const clauses=hints.map(h=>{const key=add(normalize(h));return `(p.search_vector @@ plainto_tsquery('simple',${key}) OR ${key} OPERATOR(public.<%) p.search_text)`;});
 // Whole keyword phrases, not a shared word such as PVC, determine retrieval.
 // Word similarity covers spelling mistakes; explicit AI family alternatives are
 // validated against the real shop taxonomy before this query.
 const words=unique(hints.flatMap(tokens)).filter(t=>t.length>=3&&!/^\d/.test(t)).slice(0,20);
 for(const hint of hints){const phrase=tokens(hint).filter(t=>t.length>=3&&!/^\d/.test(t));if(phrase.length)clauses.push('('+phrase.map(word=>`p.search_text ILIKE ${add('%'+word.replace(/[\\%_]/g,'\\$&')+'%')} ESCAPE '\\'`).join(' AND ')+')');}
 const hintedFamilies=nodes.filter(n=>n.kind==='family'&&hints.some(h=>{
   const ts=tokens(h).filter(t=>!/^\d/.test(t)),known=tokens([n.label,...n.aliases].join(' '));
   return ts.length>0&&ts.every(w=>known.some(t=>w===t||oneEdit(w,t)));
 })).map(n=>n.id);
 if(hintedFamilies.length)clauses.push('p.family_id=ANY('+add(hintedFamilies)+'::text[])');
 // A catalog-validated object phrase (such as wall paint) is itself a
 // retrieval hint. Brand words and dimensions still pass identity checks below.
 if(requestedFamilies.length)clauses.push('p.family_id=ANY('+add(requestedFamilies)+'::text[])');
 if(effective.familyId||effective.familyIds||effective.departmentId)clauses.push('true');
 const core=tokens(query).filter(t=>!/^\d/.test(t)).join(' ');
 const exactFamily=nodes.filter(n=>n.kind==='family'&&n.aliases.some((a:string)=>normalize(a).replaceAll(' ','')===normalize(core).replaceAll(' ',''))).map(n=>n.id);
 const coveredFamily=nodes.filter(n=>n.kind==='family'&&matches(core,[n.label,...n.aliases])).map(n=>n.id);
 const intendedFamilies=effective.familyId?[effective.familyId]:effective.familyIds??(exactFamily.length?exactFamily:coveredFamily);
 const base=constraints.join(' AND ');
 const automaticFamilies=requestedFamilies.length?requestedFamilies:intendedFamilies.length===1?intendedFamilies:hintedFamilies;
 const automaticFamily=!effective.familyId&&!effective.familyIds&&automaticFamilies.length?` AND p.family_id=ANY(${add(automaticFamilies)}::text[])`:'';
 const where=base+automaticFamily+' AND ('+(clauses.join(' OR ')||'false')+')';
 const rankQuery=add(normalize(query)),identityQuery=add(query.trim()),preferredOrder=effective.preferredSkus?.length?`(p.sku=ANY(${add(effective.preferredSkus)}::text[])) DESC,`:"";
 const queryRows=async(scope:string,offset=0)=>(await bound(client,`SELECT ${productColumns.split(',').map(c=>'p.'+c).join(',')},count(*) OVER()::int AS total_count FROM products p WHERE ${scope} ORDER BY (lower(p.sku)=lower(${identityQuery})) DESC,(lower(p.name)=lower(${identityQuery})) DESC,${preferredOrder}ts_rank_cd(p.search_vector,plainto_tsquery('simple',${rankQuery})) DESC,p.sku LIMIT 120 OFFSET ${offset}`,parameters)).rows;
 let rows=await queryRows(where),usedWhere=where;
 // A department-level suggestion is only allowed when curated taxonomy aliases
 // support it. An unknown unrelated word never becomes a random shop-wide list.
 if(!rows.length&&!requestedFamilies.length&&!intendedFamilies.length&&!effective.familyId&&!effective.familyIds&&!effective.brand&&!numeric.length&&!requestedMeasures.length&&!Object.keys(effective.specifications??{}).length){
  const relatedDepartments=unique(nodes.filter(n=>n.kind==='department'&&tokens([n.label,...n.aliases].join(' ')).some((t:string)=>words.includes(t))).map(n=>n.id));
  if(relatedDepartments.length){usedWhere=base+` AND p.family_id IN (SELECT id FROM catalog_nodes WHERE store_id=$1 AND parent_id=ANY(${add(relatedDepartments)}::text[]))`;rows=await queryRows(usedWhere);}
 }
 const eligible=(p:Product)=>matchesPackMeasures(query,p)&&supportsCustomerIdentity(query,p,nodes,requestedFamilies)&&(usedWhere!==where||requestedFamilies.includes(p.familyId??'')||!!effective.departmentId||!!effective.familyId||!!effective.familyIds?.includes(p.familyId??'')||hintedFamilies.includes(p.familyId??'')||keywordScore(query,effective,p).match==='keyword_match');
 const sqlMatchCount=Number(rows[0]?.total_count??0),candidates:Product[]=[];
 const rejections:Record<string,number>={identity:0,measurement:0,relevance:0,category:0,brand:0,specifications:0};
 let rejectionSampleCount=0;
 if(!sqlMatchCount&&!root){
  const sample=await bound(client,`SELECT ${productColumns.split(',').map(c=>'p.'+c).join(',')} FROM products p WHERE p.store_id=$1 AND p.active=true AND (${clauses.join(' OR ')||'false'}) ORDER BY p.sku LIMIT 120`,parameters);
  rejectionSampleCount=sample.rows.length;
  for(const row of sample.rows){const p=productForContext(row,ctx);
   const category=(requestedFamilies.length&&!requestedFamilies.includes(p.familyId??''))||(effective.familyId&&p.familyId!==effective.familyId)||(effective.familyIds&&!effective.familyIds.includes(p.familyId??''));
   const reason=category?'category':effective.brand&&normalize(p.brand??'')!==normalize(effective.brand)?'brand':!Object.entries(effective.specifications??{}).every(([k,v])=>specMatches(p,k,v))?'specifications':!matchesPackMeasures(query,p)?'measurement':'identity';
   rejections[reason]++;
  }
 }
 let scannedCount=0,rejectedCount=0;
 // LIMIT applies to eligible candidates, not the first lexical page. Each SQL
 // batch and the retained reranking set stay bounded, even when earlier aliases
 // describe an accessory or another brand. No catalog dump reaches the model.
 while(rows.length){
  for(const row of rows){scannedCount++;const p=productForContext(row,ctx);if(eligible(p)){candidates.push(p);if(candidates.length===120)break;}else {rejectedCount++;const reason=!matchesPackMeasures(query,p)?'measurement':!supportsCustomerIdentity(query,p,nodes,requestedFamilies)?'identity':'relevance';rejections[reason]++;}}
  if(candidates.length===120||scannedCount>=sqlMatchCount)break;
  rows=await queryRows(usedWhere,scannedCount);
 }
 // Facets aggregate the matched SQL scope, not just the returned photo sample.
 // This makes a brand with few products discoverable in a large catalog.
 const facetKey=add(effective.facetPage?.key??''),facetSearch=add('%'+(effective.facetPage?.search??'').replace(/[\\%_]/g,'\\$&')+'%'),facetOffset=add(effective.facetPage?.offset??0);
 const allFacets=(await bound(client,`WITH scope AS (SELECT p.family_id,p.brand,p.specifications FROM products p WHERE ${usedWhere}), facet_values AS (
 SELECT 'family' AS key,coalesce(n.label,'Product type') AS label,s.family_id AS value,count(*)::int AS count FROM scope s JOIN catalog_nodes n ON n.store_id=$1 AND n.id=s.family_id GROUP BY n.label,s.family_id
 UNION ALL SELECT 'brand','Brand',brand,count(*)::int FROM scope WHERE brand IS NOT NULL GROUP BY brand
 UNION ALL SELECT 'spec:'||kv.key,kv.key,kv.value,count(*)::int FROM scope s CROSS JOIN LATERAL jsonb_each_text(s.specifications) kv GROUP BY kv.key,kv.value), facet_keys AS (SELECT key,count(*) OVER()::int AS total_keys FROM facet_values GROUP BY key ORDER BY CASE WHEN key=${facetKey} THEN 0 WHEN key='family' THEN 1 WHEN key='brand' THEN 2 ELSE 3 END,key LIMIT 12)
 SELECT * FROM (SELECT *,row_number() OVER(PARTITION BY key ORDER BY count DESC,value) AS position,count(*) OVER(PARTITION BY key)::int AS total_values FROM facet_values JOIN facet_keys USING(key) WHERE (${facetKey}='' OR key<>${facetKey} OR value ILIKE ${facetSearch} ESCAPE '\\')) paged
 WHERE position>CASE WHEN key=${facetKey} THEN ${facetOffset}::int ELSE 0 END AND position<=CASE WHEN key=${facetKey} THEN ${facetOffset}::int ELSE 0 END+4 ORDER BY key,position`,parameters)).rows;
 const facets:DiscoveryFacet[]=[];
 for(const key of unique(allFacets.map(f=>f.key)).sort((a,b)=>a===effective.facetPage?.key?-1:b===effective.facetPage?.key?1:a==='family'?-1:b==='family'?1:a==='brand'?-1:b==='brand'?1:a.localeCompare(b))){
  const vals=allFacets.filter(f=>f.key===key),offset=effective.facetPage?.key===key?effective.facetPage.offset:0,totalValues=Number(vals[0]?.total_values??0);
  if(totalValues<2&&effective.facetPage?.key!==key||key==='family'&&effective.familyId||key==='brand'&&(effective.brand||root?.brand)||key.startsWith('spec:')&&effective.specifications?.[key.slice(5)])continue;
  const pageSize=totalValues-offset>3?2:3;
  facets.push({key,label:key==='family'?'product type':key==='brand'?'brand':key.slice(5).replaceAll('_',' '),totalValues,...(offset+pageSize<totalValues?{nextOffset:offset+pageSize}:{}),values:vals.slice(0,pageSize).map(f=>({value:f.value,localNames:key==='family'?nodes.find(n=>n.id===f.value)?.local_names:undefined,label:key==='family'?nodes.find(n=>n.id===f.value)?.label??f.value:f.value,count:f.count}))});
 }
 const scores=new Map(candidates.map(p=>[p.sku,keywordScore(query,effective,p)]));
 if(root){const found=candidates.find(p=>p.sku===root.sku);if(!found){if(candidates.length===120)candidates.pop();candidates.unshift(root);}scores.set(root.sku,{score:1000,match:'keyword_match',reason:'This catalog item matches the requested identity; check its photo'});}
 if(effective.familyId)for(const p of candidates)if(p.familyId===effective.familyId&&p.sku!==root?.sku)scores.set(p.sku,{...scores.get(p.sku)!,score:scores.get(p.sku)!.score+20,match:'keyword_match',reason:'Matches the chosen product family and filters; check the photo and name'});
 for(const p of candidates)if(intendedFamilies.length&&!intendedFamilies.includes(p.familyId))scores.set(p.sku,{...scores.get(p.sku)!,match:'related',reason:'Related option in this department; it is not an exact match for the requested product type'});
 const preferred=effective.preferredSkus??[];
 const preferredProducts=preferred.flatMap(sku=>{const p=candidates.find(p=>p.sku===sku);return p?[p]:[];});
 const products=[...(root?[root]:[]),...preferredProducts,...choosePhotos(candidates,scores)].filter((p,index,all)=>all.findIndex(other=>other.sku===p.sku)===index).slice(0,10);
 const candidateLimited=scannedCount<sqlMatchCount,facetKeysLimited=Number(allFacets[0]?.total_keys??0)>12;
 const identity=identified.length>1?'ambiguous':!root?'none':root.sku.toLowerCase()===query.trim().toLowerCase()?'sku':root.name.toLowerCase()===query.trim().toLowerCase()?'name':'alias';
 return {query,plan:effective,products,rankings:products.map(p=>({sku:p.sku,...scores.get(p.sku)!})),totalCount:!candidateLimited?candidates.length:sqlMatchCount,retrievedCount:candidates.length,facets:products.length?facets:[],noExactMatch:!products.some(p=>scores.get(p.sku)!.match==='keyword_match'),diagnostics:{rejections,rejectionSampleCount,canonicalQuery:normalize(query),appliedConstraints:{familyIds:effective.familyId?[effective.familyId]:effective.familyIds??requestedFamilies,brand:effective.brand,specifications:effective.specifications??{},measurements:requestedMeasures},sqlMatchCount,scannedCount,rejectedCount,candidateLimited,identity,uncertainty:[...(identity==='ambiguous'?['ambiguous_identity']:[]),...(candidateLimited?['candidate_limit']:[]),...(facetKeysLimited?['facet_key_limit']:[]),...(!products.length?['no_supported_match']:[])]}};
}
/** Shared customer resolver. Exact matching remains available without alternatives
 * for callers enforcing explicit filters; customer flows opt into labelled peers. */
export async function discoverProducts(client:PoolClient,ctx:ActorContext,customerQuery:string,input?:DiscoveryPlan):Promise<DiscoveryResult> {
 const query=naturalCatalogQuery(customerQuery)||customerQuery;
 const colour=queryColour(query);
 const inferredBrands=(await client.query("SELECT DISTINCT brand FROM products WHERE store_id=$1 AND active=true AND brand IS NOT NULL AND (position(lower(brand) in lower($2))>0 OR position(regexp_replace(lower(brand),'paints$','paint') in lower($2))>0) ORDER BY brand",[ctx.storeId,query])).rows.map(r=>r.brand as string);
 const plan:DiscoveryPlan={...(input??{keywords:[query.slice(0,120)]}),...(input?.brand?{}:inferredBrands.length===1?{brand:inferredBrands[0]}:{}),specifications:{...(colour?{colour}:{}),...(input?.specifications??{})}};
 plan.keywords=plan.keywords.map(naturalCatalogQuery).filter(Boolean);
 if(!plan.keywords.length)plan.keywords=[query.slice(0,120)];
 const result=await discoverExactProducts(client,ctx,query,plan);
 result.query=customerQuery;
 result.matchStatus=result.products.length?(result.products.length===1&&!result.noExactMatch?'exact':'ambiguous'):result.diagnostics?.uncertainty.some(reason=>['pipe_type_required','solvent_use_required'].includes(reason))?'needs_detail':'not_found';
 if(result.products.length||!plan.allowAlternatives||plan.selectedSkus||result.matchStatus==='needs_detail')return result;
 // Relax only explicit customer-selectable attributes, never product type,
 // rating, material, diameter, or a conflicting physical measurement unit.
 const measures=catalogMeasurements(query),specs={...plan.specifications};
 const relaxable=Object.keys(specs).filter(k=>['colour','color','pack_size','pack_volume','volume','capacity'].includes(k)||k==='size'&&catalogMeasurements(specs[k]).some(m=>['litre','kg'].includes(m.unit)));
 if(!plan.brand&&!relaxable.length&&!measures.some(m=>['litre','kg'].includes(m.unit)))return result;
 let relatedQuery=query;
 if(/^(?:[npr]\d{2,3}|ffp[123])$/i.test(plan.brand??''))return result;
 if(plan.brand){relatedQuery=removeTerm(relatedQuery,plan.brand);relatedQuery=removeTerm(relatedQuery,plan.brand.replace(/paints$/i,'paint'));}
 for(const key of relaxable){relatedQuery=removeTerm(relatedQuery,specs[key]);delete specs[key];}
 if(measures.some(m=>['litre','kg'].includes(m.unit)))relatedQuery=withoutCatalogMeasurements(relatedQuery);
 // A brand-only paint request still searches paints, never the whole shop.
 if(!relatedQuery.trim()&&/paints?$/i.test(plan.brand??''))relatedQuery='paint';
 if(!tokens(relatedQuery).some(t=>!/^\d/.test(t)))return result;
 const supportedFamilies=result.diagnostics?.appliedConstraints.familyIds??[];
 const related=await discoverExactProducts(client,ctx,relatedQuery,{...plan,...(!plan.familyId&&!plan.familyIds&&supportedFamilies.length?{familyIds:supportedFamilies}:{}),brand:undefined,specifications:specs,allowAlternatives:false,keywords:[relatedQuery.slice(0,120)]});
 const alternatives=related.products.flatMap(product=>{
  const differences:{field:string;requested:string;actual?:string}[]=[];
  if(plan.brand&&normalize(product.brand??'')!==normalize(plan.brand))differences.push({field:'brand',requested:plan.brand,actual:product.brand});
  for(const key of relaxable){const requested=plan.specifications![key],actual=specificationValue(product,key),requestedMeasures=catalogMeasurements(requested);if(requestedMeasures.length){const actualMeasures=catalogMeasurements([product.name,...Object.values(product.specifications??{})].join('; '));if(requestedMeasures.some(m=>!actualMeasures.some(a=>a.unit===m.unit)))return [];}if(!actual||!specMatches(product,key,requested))differences.push({field:key,requested,actual});}
  for(const measure of measures){
   if(!['litre','kg'].includes(measure.unit))continue;
   const actual=catalogMeasurements([product.name,...Object.values(product.specifications??{})].join('; '));
   if(!actual.some(m=>m.unit===measure.unit))return []; // Never offer kg as litres.
   if(!actual.some(m=>sameCatalogMeasurement(m,measure)))differences.push({field:'pack',requested:`${measure.value} ${measure.unit}`,actual:actual.filter(m=>m.unit===measure.unit).map(m=>`${m.value} ${m.unit}`).join(', ')});
  }
  return differences.length?[{product,differences}]:[];
 }).sort((a,b)=>a.differences.length-b.differences.length||a.product.sku.localeCompare(b.product.sku)).slice(0,3);
 if(!alternatives.length)return result;
 return {...result,matchStatus:'alternatives',products:alternatives.map(a=>a.product),rankings:alternatives.map(a=>({sku:a.product.sku,score:0,match:'related',reason:'Different requested attributes; explicit selection required',differences:a.differences})),facets:[],retrievedCount:alternatives.length,totalCount:alternatives.length,noExactMatch:true};
}
export function refinementPlan(result:DiscoveryResult,key:string,value:string):DiscoveryPlan {
 const facet=result.facets.find(f=>f.key===key);
 if(facet?.key===key&&value===discoveryMoreValue&&facet.nextOffset!==undefined)return {...result.plan,facetPage:{key,offset:facet.nextOffset,...(result.plan.facetPage?.search?{search:result.plan.facetPage.search}:{})}};
 if(!facet||!facet.values.some(v=>v.value===value))throw new ToolError('That filter was not offered in the current product question.','stale_question');
 return {...result.plan,facetPage:undefined,...(key==='family'?{familyId:value,familyIds:undefined}:key==='brand'?{brand:value}:{specifications:{...result.plan.specifications,[key.slice(5)]:value}})};
}

export function refinementQuery(result:DiscoveryResult,key:string,value:string):string {
 return result.groups?.find(group=>group.key===key&&group.value===value)?.query??result.query;
}
