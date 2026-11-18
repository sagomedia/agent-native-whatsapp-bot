import type {CatalogObservation} from '../services/agent-assistance.js';

// Match the request's JSON encoding so quotes, backslashes and UTF-8 text
// take the same space here as they do inside the transmitted prompt.
const wireBytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(JSON.stringify(value)));
const observationBudget=8000;

function compactObservation(observation:CatalogObservation,productLimit:number){
 const discovery=observation.discovery;
 const diagnostics=discovery?.diagnostics;
 const products=observation.products.slice(0,productLimit);
 const facets=discovery?.facets.slice(0,12);
 const groups=discovery?.groups?.slice(0,9);
 const requestedSpecs=new Set(Object.keys(diagnostics?.appliedConstraints.specifications??discovery?.plan.specifications??{}));
 const varyingSpecs=facets?.filter(facet=>facet.key.startsWith('spec:')).map(facet=>facet.key.slice(5))??[];
 const project=(facetValues:number,specBytes:number,includeLocalNames:boolean,includeGroupExamples:boolean)=>({
  tool:observation.tool,
  query:observation.query,
  totalCount:observation.totalCount,
  noExactMatch:discovery?.noExactMatch,
  matchStatus:discovery?.matchStatus,
  facets:facets?.map(facet=>({
   key:facet.key,label:facet.label,totalValues:facet.totalValues,
   values:facet.values.slice(0,facetValues).map(({value,label,count})=>({value,...(label!==value?{label}:{}),count})),
  })),
  groups:groups?.map(({key,value,label,count,product})=>({
   key,value,label,count,...(includeGroupExamples&&product?{exampleSku:product.sku,exampleName:product.name}:{}),
  })),
  products:products.map(({sku,name,unit,brand,familyId,specifications,localNames})=>{
   const specs:Record<string,string>={};
   for(const key of new Set([...requestedSpecs,...varyingSpecs,...Object.keys(specifications??{})])){
    const value=specifications?.[key];
    if(value!==undefined&&(requestedSpecs.has(key)||wireBytes({...specs,[key]:value})<=specBytes))specs[key]=value;
   }
   return {sku,name,unit,brand,familyId,
    specifications:Object.keys(specs).length?specs:undefined,
    localNames:includeLocalNames?localNames:undefined,
   };
  }),
  diagnostics:diagnostics?{
   appliedConstraints:diagnostics.appliedConstraints,
   identity:diagnostics.identity,
   candidateLimited:diagnostics.candidateLimited,
   uncertainty:diagnostics.uncertainty,
  }:undefined,
 });

 // Keep every result group, query and candidate ID when detail is reduced.
 // An observation's detail budget is independent of other queries' results.
 for(const [values,specBytes,localNames,groupExamples] of [
  [9,500,true,true],[4,350,false,true],[2,200,false,false],
 ] as const){
  const compact=project(values,specBytes,localNames,groupExamples);
  if(wireBytes(compact)<=observationBudget)return compact;
 }
 // The wire admission guard still checks the entire request. Some valid
 // inputs have large hard constraints, which must travel intact.
 return project(0,0,false,false);
}

export function catalogPromptObservations(observations:CatalogObservation[]|undefined,productLimit:number){
 return (observations??[]).slice(0,3).map(observation=>compactObservation(observation,productLimit));
}
