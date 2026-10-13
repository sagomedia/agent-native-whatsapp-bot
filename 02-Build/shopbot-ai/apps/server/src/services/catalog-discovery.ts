import type {PoolClient} from 'pg';
import type {CatalogMap,DiscoveryPlan,DiscoveryResult,DiscoveryFacet,Product} from '../../../../packages/contracts/index.js';
import {discoveryPlanSchema} from '../../../../packages/contracts/index.js';
import {normalize,tokens,oneEdit,matches,productColumns,productFromRow} from './catalog.js';
import {ToolError,type ActorContext} from './context.js';

function bound(client:PoolClient,sql:string,parameters:unknown[]) {
 const ids=[...new Set([...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
 return client.query(sql.replace(/\$(\d+)/g,(_,n)=>'$'+(ids.indexOf(Number(n))+1)),ids.map(i=>parameters[i-1]));
}
export async function getCatalogMap(client:PoolClient,ctx:ActorContext,departmentId?:string):Promise<CatalogMap> {
 const store=(await client.query('SELECT s.name,s.catalog_revision,c.store_type FROM stores s LEFT JOIN catalog_profiles c ON c.store_id=s.id WHERE s.id=$1',[ctx.storeId])).rows[0];
 if(!store)throw new ToolError('Store is not accessible.','forbidden');
 const rows=(await client.query(`SELECT n.id,n.parent_id,n.kind,n.label,n.local_names,n.aliases,count(p.sku)::int AS count
 FROM catalog_nodes n LEFT JOIN products p ON p.store_id=n.store_id AND p.family_id=n.id AND p.active=true
 WHERE n.store_id=$1 GROUP BY n.id,n.parent_id,n.kind,n.label,n.local_names,n.aliases ORDER BY n.kind,n.label`,[ctx.storeId])).rows;
 const departments=rows.filter(n=>n.kind==='department'&&(!departmentId||n.id===departmentId)).slice(0,20).map(n=>{
   const families=rows.filter(f=>f.parent_id===n.id&&f.kind==='family').slice(0,30).map(f=>({id:f.id,label:f.label,localNames:f.local_names,aliases:f.aliases,count:f.count}));
   return {id:n.id,label:n.label,localNames:n.local_names,count:families.reduce((a,f)=>a+f.count,0),families};
 });
 const count=Number((await client.query('SELECT count(*) FROM products WHERE store_id=$1 AND active=true',[ctx.storeId])).rows[0].count);
 return {revision:store.catalog_revision,store:{name:store.name,type:store.store_type??'general retail'},productCount:count,departments,truncated:rows.length>departments.length+departments.reduce((a,d)=>a+d.families.length,0)};
}
function unique(a:string[]){return [...new Set(a.map(s=>s.trim()).filter(Boolean))];}
function namedObjectPhrase(query:string){return query.split(/\s+(?:for|with|on)\s+/i,1)[0].trim();}
// "Pipe" describes several physically different goods. A search hint or a
// broad family alias such as "water pipe" cannot decide between rigid PVC,
// flexible watering hose, and a pump delivery/suction pipe. Keep the request
// unresolved until the customer supplies a product type or an exact catalog
// identity. A stated diameter is useful evidence but does not identify type.
export function needsPipeType(query:string):boolean {
 const words=tokens(query);
 const pipe=words.some(w=>w==='pipe'||w==='பைப்'||w==='பைப்புகள்');
 const hose=words.some(w=>['hose','ஹோஸ்','ஓஸ்'].includes(w));
 const pump=words.some(w=>['pump','pumping','motor','suction','delivery','மோட்டார்','பம்ப்'].includes(w));
 if(pump&&(pipe||hose))return true;
 if(!pipe)return false;
 if(words.some(w=>['pvc','cpvc','upvc','பிவிசி','rigid','hose','ஹோஸ்','ஓஸ்','garden','watering','irrigation','irrigating','fitting','fittings','cutter','clamp','connector','elbow','coupler','கட்டர்','கட்டரு','பசை','க்ளாம்ப்'].includes(w)))return false;
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
 const words=tokens(namedObjectPhrase(query)).filter(t=>!/^\d/.test(t));
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
 const words=tokens(namedObjectPhrase(query)).filter(t=>!/^\d/.test(t)&&!['inch','inches','mm','cm','piece','pieces','box','boxes'].includes(t));
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
 return tokens(namedObjectPhrase(query)).filter(t=>!/\d/.test(t)&&!generic.has(t));
}
function supportsCustomerIdentity(query:string,product:Product,nodes:{id:string;kind:string;label:string;aliases:string[]}[],requestedFamilies:string[]) {
 const words=customerIdentityWords(query).filter(word=>!tokens(product.unit).some(unit=>word===unit||word===unit+'s'));
 const source=unique([product.name,...product.aliases,...(product.keywords??[])].flatMap(tokens));
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
function specKeys(key:string){return key==='diameter'?['diameter','size']:['capacity','volume','pack_volume'].includes(key)?[key,'pack_volume','volume','size']:['weight','pack_weight'].includes(key)?[key,'weight','pack_weight','size']:[key];}
function specMatches(product:Product,key:string,value:string){return specKeys(key).some(k=>normalizedSpec(product.specifications?.[k]??'')===normalizedSpec(value));}
function keywordScore(query:string,plan:DiscoveryPlan,product:Product) {
 const source=[product.name,...product.aliases,...(product.keywords??[])],words=unique(source.flatMap(tokens));
 const needles=tokens(query).filter(t=>!/^\d/.test(t));
 const covered=needles.filter(t=>words.some(w=>w===t||oneEdit(t,w)));
 let score=covered.length*35+(normalize(query)===normalize(product.name)?100:0);
 for(const hint of plan.keywords)for(const word of tokens(hint))if(words.some(w=>w===word||oneEdit(word,w)))score+=4;
 const hintMatches=plan.keywords.filter(h=>{const ts=tokens(h).filter(t=>!/^\d/.test(t));return ts.length>0&&ts.every(t=>words.some(w=>w===t||oneEdit(t,w)));});
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
// Scores are deterministic ordering weights, never calibrated probabilities.
// Every product fact is read from the current, scoped SQL catalog.
export async function discoverProducts(client:PoolClient,ctx:ActorContext,query:string,input?:DiscoveryPlan):Promise<DiscoveryResult> {
 query=numericDimensions(query);
 // A spoken customer request can exceed one keyword. Keep the full query for
 // identity checks while bounding only this fallback hint.
 const plan=discoveryPlanSchema.parse(input??{keywords:[query.slice(0,120)]});
 plan.keywords=plan.keywords.map(numericDimensions);
 if(plan.familyId&&plan.familyIds&&!plan.familyIds.includes(plan.familyId))throw new ToolError('The chosen family conflicts with the proposed product types.');
 if(plan.selectedSkus?.length===0)return {query,plan,products:[],rankings:[],totalCount:0,retrievedCount:0,facets:[],noExactMatch:true};
 const nodes=(await client.query('SELECT id,parent_id,kind,label,local_names,aliases FROM catalog_nodes WHERE store_id=$1',[ctx.storeId])).rows;
 const objectPhrase=namedObjectPhrase(query);
 if(plan.familyId&&!nodes.some(n=>n.id===plan.familyId&&n.kind==='family'))throw new ToolError('Choose a product family from this shop’s catalog.');
 if(plan.departmentId&&!nodes.some(n=>n.id===plan.departmentId&&n.kind==='department'))throw new ToolError('Choose a department from this shop’s catalog.');
 if(plan.familyIds?.some(id=>!nodes.some(n=>n.id===id&&n.kind==='family')))throw new ToolError('Choose product types from this shop’s catalog.');
 if(plan.familyIds&&plan.departmentId&&plan.familyIds.some(id=>!nodes.some(n=>n.id===id&&n.parent_id===plan.departmentId)))throw new ToolError('Those types do not belong to the selected department.');
 if(plan.familyId&&plan.departmentId&&!nodes.some(n=>n.id===plan.familyId&&n.parent_id===plan.departmentId))throw new ToolError('That family does not belong to the selected department.');
 const identified=(await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND active=true AND (lower(sku)=lower($2) OR lower(name)=lower($2) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(aliases) a WHERE lower(a)=lower($2))) ORDER BY sku LIMIT 2`,[ctx.storeId,query.trim()])).rows.map(productFromRow);
 const candidate=identified.length===1?identified[0]:undefined;
 const pumpName=/\b(?:pump|pumping|suction|delivery)\b|மோட்டார்|பம்ப்/iu;
 const namedPumpAlias=!!candidate&&pumpName.test(query)&&[candidate.name,...candidate.aliases].some(name=>pumpName.test(name));
 const namedCatalogProduct=!!candidate&&(normalize(candidate.sku)===normalize(query)||normalize(candidate.name)===normalize(query)||namedPumpAlias);
 const requestedFamilies=namedCatalogProduct?[]:namedFamilies(query,nodes,plan);
 if(needsPipeType(query)&&!namedCatalogProduct)return {query,plan,products:[],rankings:[],totalCount:0,retrievedCount:0,facets:[],noExactMatch:true};
 const root=candidate&&(!plan.selectedSkus||plan.selectedSkus.includes(candidate.sku))&&(!plan.familyId||candidate.familyId===plan.familyId)&&(!plan.familyIds||plan.familyIds.includes(candidate.familyId??''))&&(!plan.departmentId||nodes.some(n=>n.id===candidate.familyId&&n.parent_id===plan.departmentId))&&(!plan.brand||normalize(candidate.brand??'')===normalize(plan.brand))&&Object.entries(plan.specifications??{}).every(([key,value])=>specMatches(candidate,key,value))?candidate:undefined;
 if(requestedFamilies.length&&(plan.familyId&&!requestedFamilies.includes(plan.familyId)||plan.familyIds&&!plan.familyIds.some(id=>requestedFamilies.includes(id))))return {query,plan,products:[],rankings:[],totalCount:0,retrievedCount:0,facets:[],noExactMatch:true};
 if(!requestedFamilies.length&&!root&&unsupportedNamedObject(query,nodes)){
  const head=tokens(objectPhrase).filter(t=>!/^\d/.test(t)&&!['inch','inches','mm','cm','piece','pieces','box','boxes'].includes(t)).at(-1)!;
  const hasNamedProduct=(await client.query("SELECT 1 FROM products WHERE store_id=$1 AND active=true AND (search_vector @@ plainto_tsquery('simple',$2) OR lower(unit)=lower($2)) LIMIT 1",[ctx.storeId,head])).rowCount;
  if(!hasNamedProduct)return {query,plan,products:[],rankings:[],totalCount:0,retrievedCount:0,facets:[],noExactMatch:true};
 }
 // An identified product still gets meaningful peers, constrained to its family,
 // catalog unit and exact stored specifications. No arbitrary filler images.
 const effective:DiscoveryPlan=root?{...plan,keywords:unique([root.name,...plan.keywords]).slice(0,8),familyId:root.familyId??plan.familyId,specifications:root.specifications??plan.specifications}:objectPhrase!==query?{...plan,keywords:unique([objectPhrase,...plan.keywords]).slice(0,8)}:plan;
 const hints=unique([root?.name??query,...effective.keywords]).slice(0,9),parameters:unknown[]=[ctx.storeId];
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
  const target=add(normalizedSpec(value));
  constraints.push('('+unique(specKeys(key)).map(k=>`regexp_replace(regexp_replace(regexp_replace(lower(p.specifications->>${add(k)}),'([0-9])[[:space:]]*(inches?\\M|in\\M|["\u2033])','\\1 inch','g'),'[^[:alnum:].]+','','g'),'^([0-9]+(?:[.][0-9]+)?)(l|litres?|liters?)$','\\1litre')=${target}`).join(' OR ')+')');
 }
 if(root)constraints.push('p.unit='+add(root.unit));
 // A dimension in a job clause describes the workpiece, not the tool size.
 // Explicit product specifications above still constrain the returned SKU.
 const numeric=root?[]:unique(normalize(objectPhrase).match(/\d+(?:\.\d+)?/g)??[]);
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
 let rows=(await bound(client,`SELECT ${productColumns.split(',').map(c=>'p.'+c).join(',')},count(*) OVER()::int AS total_count FROM products p WHERE ${where} ORDER BY ts_rank_cd(p.search_vector,plainto_tsquery('simple',${add(normalize(query))})) DESC,p.sku LIMIT 120`,parameters)).rows;
 let usedWhere=where;
 // A department-level suggestion is only allowed when curated taxonomy aliases
 // support it. An unknown unrelated word never becomes a random shop-wide list.
 if(!rows.length&&!requestedFamilies.length&&!intendedFamilies.length&&!effective.familyId&&!effective.familyIds&&!effective.brand&&!numeric.length&&!Object.keys(effective.specifications??{}).length){
  const relatedDepartments=unique([...nodes.filter(n=>intendedFamilies.includes(n.id)).map(n=>n.parent_id),...(intendedFamilies.length?[]:nodes.filter(n=>n.kind==='department'&&tokens([n.label,...n.aliases].join(' ')).some((t:string)=>words.includes(t))).map(n=>n.id))].filter((s):s is string=>!!s));
  if(relatedDepartments.length){usedWhere=base+` AND p.family_id IN (SELECT id FROM catalog_nodes WHERE store_id=$1 AND parent_id=ANY(${add(relatedDepartments)}::text[]))`;rows=(await bound(client,`SELECT ${productColumns.split(',').map(c=>'p.'+c).join(',')},count(*) OVER()::int AS total_count FROM products p WHERE ${usedWhere} ORDER BY p.sku LIMIT 120`,parameters.slice(0,-1).concat([relatedDepartments]))).rows;}
 }
 // Facets aggregate the matched SQL scope, not just the returned photo sample.
 // This makes a brand with few products discoverable in a large catalog.
 const facetParams=parameters;
 const allFacets=(await bound(client,`WITH scope AS (SELECT p.family_id,p.brand,p.specifications FROM products p WHERE ${usedWhere}), facet_values AS (
 SELECT 'family' AS key,coalesce(n.label,'Product type') AS label,s.family_id AS value,count(*)::int AS count FROM scope s JOIN catalog_nodes n ON n.store_id=$1 AND n.id=s.family_id GROUP BY n.label,s.family_id
 UNION ALL SELECT 'brand','Brand',brand,count(*)::int FROM scope WHERE brand IS NOT NULL GROUP BY brand
 UNION ALL SELECT 'spec:'||kv.key,kv.key,kv.value,count(*)::int FROM scope s CROSS JOIN LATERAL jsonb_each_text(s.specifications) kv GROUP BY kv.key,kv.value)
 SELECT * FROM facet_values ORDER BY count DESC,value LIMIT 120`,facetParams.slice(0,Math.max(1,...[...usedWhere.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])))))).rows;
 const facets:DiscoveryFacet[]=[];
 for(const key of unique(allFacets.map(f=>f.key)).sort((a,b)=>a==='family'?-1:b==='family'?1:a==='brand'?-1:b==='brand'?1:a.localeCompare(b))){
  const vals=allFacets.filter(f=>f.key===key);
  if(vals.length<2||key==='family'&&effective.familyId||key==='brand'&&(effective.brand||root?.brand)||key.startsWith('spec:')&&effective.specifications?.[key.slice(5)])continue;
  facets.push({key,label:key==='family'?'product type':key==='brand'?'brand':key.slice(5).replaceAll('_',' '),values:vals.slice(0,3).map(f=>({value:f.value,localNames:key==='family'?nodes.find(n=>n.id===f.value)?.local_names:undefined,label:key==='family'?nodes.find(n=>n.id===f.value)?.label??f.value:f.value,count:f.count}))});
 }
 const candidates=rows.map(productFromRow).filter(p=>supportsCustomerIdentity(query,p,nodes,requestedFamilies)&&(usedWhere!==where||requestedFamilies.includes(p.familyId??'')||!!effective.departmentId||!!effective.familyId||!!effective.familyIds?.includes(p.familyId??'')||hintedFamilies.includes(p.familyId??'')||keywordScore(query,effective,p).match==='keyword_match')),scores=new Map(candidates.map(p=>[p.sku,keywordScore(query,effective,p)]));
 if(root){const found=candidates.find(p=>p.sku===root.sku);if(!found)candidates.unshift(root);scores.set(root.sku,{score:1000,match:'keyword_match',reason:'This catalog item matches the requested identity; check its photo'});}
 if(effective.familyId)for(const p of candidates)if(p.familyId===effective.familyId&&p.sku!==root?.sku)scores.set(p.sku,{...scores.get(p.sku)!,score:scores.get(p.sku)!.score+20,match:'keyword_match',reason:'Matches the chosen product family and filters; check the photo and name'});
 for(const p of candidates)if(intendedFamilies.length&&!intendedFamilies.includes(p.familyId))scores.set(p.sku,{...scores.get(p.sku)!,match:'related',reason:'Related option in this department; it is not an exact match for the requested product type'});
 const preferred=effective.preferredSkus??[];
 const preferredProducts=preferred.flatMap(sku=>{const p=candidates.find(p=>p.sku===sku);return p?[p]:[];});
 const products=[...preferredProducts,...choosePhotos(candidates,scores).filter(p=>!preferredProducts.includes(p))].slice(0,10);
 // Present the most relevant photo families/brands/specifications first. Counts
 // still come from the complete SQL scope; popularity must not hide a shown type.
 for(const facet of facets){const shown=unique(products.map(p=>facet.key==='family'?p.familyId:facet.key==='brand'?p.brand:p.specifications?.[facet.key.slice(5)]).filter((s):s is string=>!!s));const values=allFacets.filter(f=>f.key===facet.key);values.sort((a,b)=>{const ai=shown.indexOf(a.value),bi=shown.indexOf(b.value);return (ai<0?999:ai)-(bi<0?999:bi)||b.count-a.count||a.value.localeCompare(b.value);});facet.values=values.slice(0,3).map(f=>({value:f.value,localNames:facet.key==='family'?nodes.find(n=>n.id===f.value)?.local_names:undefined,label:facet.key==='family'?nodes.find(n=>n.id===f.value)?.label??f.value:f.value,count:f.count}));}
 return {query,plan:effective,products,rankings:products.map(p=>({sku:p.sku,...scores.get(p.sku)!})),totalCount:rows.length<120?candidates.length:rows[0]?.total_count??products.length,retrievedCount:rows.length,facets:products.length?facets:[],noExactMatch:!products.some(p=>scores.get(p.sku)!.match==='keyword_match')};
}
export function refinementPlan(result:DiscoveryResult,key:string,value:string):DiscoveryPlan {
 if(!result.facets[0]||result.facets[0].key!==key||!result.facets[0].values.some(v=>v.value===value))throw new ToolError('That filter was not offered in the current product question.','stale_question');
 return {...result.plan,...(key==='family'?{familyId:value,familyIds:undefined}:key==='brand'?{brand:value}:{specifications:{...result.plan.specifications,[key.slice(5)]:value}})};
}
