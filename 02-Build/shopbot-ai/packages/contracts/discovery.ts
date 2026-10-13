import {z} from 'zod';
import type {Product} from './index.js';
const value=z.string().trim().min(1).max(120);
export const discoveryPlanSchema=z.object({keywords:z.array(value).min(1).max(8),departmentId:value.optional(),familyId:value.optional(),brand:value.optional(),familyIds:z.array(value).min(1).max(6).refine(a=>new Set(a).size===a.length).optional(),preferredSkus:z.array(value).max(6).refine(a=>new Set(a).size===a.length).optional(),selectedSkus:z.array(value).max(6).refine(a=>new Set(a).size===a.length).optional(),useCase:z.string().trim().min(1).max(200).optional(),specifications:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),value).refine(s=>Object.keys(s).length<=6).optional()}).strict();
export type DiscoveryPlan=z.infer<typeof discoveryPlanSchema>;
export type CatalogMap={store:{name:string;type:string};revision?:number;productCount:number;departments:{id:string;label:string;localNames?:import('./language.js').LocalNames;count:number;families:{id:string;label:string;localNames?:import('./language.js').LocalNames;aliases:string[];count:number}[]}[];truncated:boolean};
export type DiscoveryFacet={key:string;label:string;values:{value:string;label:string;localNames?:import('./language.js').LocalNames;count:number}[]};
export type DiscoveryResult={query:string;plan:DiscoveryPlan;products:Product[];rankings:{sku:string;score:number;match:'keyword_match'|'related';reason:string}[];totalCount:number;retrievedCount:number;facets:DiscoveryFacet[];noExactMatch:boolean};
