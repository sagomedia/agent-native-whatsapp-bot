import {z} from 'zod';
import type {Product} from './index.js';
const value=z.string().trim().min(1).max(120);
export const discoveryPlanSchema=z.object({keywords:z.array(value).min(1).max(8),departmentId:value.optional(),familyId:value.optional(),brand:value.optional(),specifications:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),value).refine(s=>Object.keys(s).length<=6).optional()}).strict();
export type DiscoveryPlan=z.infer<typeof discoveryPlanSchema>;
export type CatalogMap={store:{name:string;type:string};productCount:number;departments:{id:string;label:string;count:number;families:{id:string;label:string;aliases:string[];count:number}[]}[];truncated:boolean};
export type DiscoveryFacet={key:string;label:string;values:{value:string;label:string;count:number}[]};
export type DiscoveryResult={query:string;plan:DiscoveryPlan;products:Product[];rankings:{sku:string;score:number;match:'keyword_match'|'related';reason:string}[];totalCount:number;retrievedCount:number;facets:DiscoveryFacet[];noExactMatch:boolean};
