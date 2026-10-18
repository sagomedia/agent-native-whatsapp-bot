import {z} from 'zod';

export const factColumns=['sku','product_version','inventory_version','product_name','selling_unit','shop_price_inr','price_status','confirm_price','on_hand_quantity','confirm_stock','note'] as const;
export const factLimits={rows:3000,bytes:2*1024*1024,page:25,chunk:50,expiresHours:24} as const;
export const factPreviewSchema=z.object({csv:z.string().min(1),filename:z.string().trim().max(160).optional()}).strict();
export const factApplySchema=z.object({batchId:z.uuid(),fileHash:z.string().regex(/^[a-f0-9]{64}$/),expectedChunk:z.number().int().nonnegative().max(60)}).strict();
export type FactRow={rowNumber:number;sku:string;name:string;unit:string;before:null|{pricePaise:number;priceStatus:string;onHand:string|null;productVersion:number;inventoryVersion:number};after:{pricePaise?:number;priceStatus?:'priced'|'free';onHand?:string};errors:string[];state:'pending'|'committed'|'unchanged'|'error';note:string;changes:{price:boolean;stock:boolean}};
export type FactChunk={index:number;fromRow:number;toRow:number;committed:number;unchanged:number;at:string};
export type FactBatch={batchId:string;fileHash:string;filename:string|null;expiresAt:string;status:'preview'|'invalid'|'applying'|'complete'|'blocked';counts:{total:number;changed:number;unchanged:number;errors:number;committed:number;remaining:number};rows:FactRow[];nextCursor:string|null;nextChunk:number;replayed:boolean;receipt:{chunks:FactChunk[]};error?:string};
