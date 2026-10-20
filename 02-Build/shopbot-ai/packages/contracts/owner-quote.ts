import {z} from 'zod';
import type {DraftLine} from './index.js';
import {lineTotal} from './money.js';

export const quoteDraftLineSchema=z.object({
 id:z.uuid(),name:z.string().max(200),quantity:z.string().max(20),unit:z.string().max(30),
 price:z.string().max(20),free:z.boolean(),saleMode:z.enum(['','pack','measured']),
 sku:z.string().min(1).max(100).optional(),productVersion:z.number().int().positive().optional(),
 manualConfirmed:z.boolean().optional(),reviewed:z.boolean().optional()
}).strict();
export type QuoteEditorLine=z.infer<typeof quoteDraftLineSchema>;
export type SavedQuoteDraft={version:number;expectedRevision:number;amendmentId?:string;lines:QuoteEditorLine[];updatedAt:string};
export function initialQuoteLines(lines:DraftLine[]):QuoteEditorLine[]{
 return lines.map(line=>({id:line.id,name:line.name,quantity:line.quantity===null?'':String(line.quantity),unit:line.unit??line.requestedUnit??'',price:line.pricePaise===undefined||line.catalogIssue==='price_unverified'?'':(line.pricePaise/100).toFixed(2),free:line.merchantConfirmed?.free??false,saleMode:line.merchantConfirmed?.saleMode??line.candidates?.find(p=>p.sku===line.sku)?.sellingPolicy?.saleMode??'',...(line.sku?{sku:line.sku,productVersion:line.productVersion??line.candidates?.find(p=>p.sku===line.sku)?.version}:{}),manualConfirmed:!!line.merchantConfirmed}));
}
export function quoteLineIssues(line:QuoteEditorLine,original:DraftLine,all:DraftLine[]):string[]{
 const issues:string[]=[];
 if(!line.name.trim())issues.push('Enter a product name');
 if(!line.sku&&!line.manualConfirmed)issues.push('Match a product or confirm a manual item');
 const quantity=Number(line.quantity);
 if(!Number.isFinite(quantity)||quantity<=0||quantity>100||Math.abs(quantity*1000-Math.round(quantity*1000))>1e-7)issues.push('Enter a quantity from 0.001 to 100');
 if(!line.unit.trim())issues.push('Choose the selling unit');
 if(!/^\d+(?:\.\d{1,2})?$/.test(line.price)||Number(line.price)>1000000||Number(line.price)===0&&!line.free)issues.push('Enter a price or mark the item free');
 if(!line.reviewed&&(original.sourceUncertainty?.length||original.sku&&all.filter(l=>l.sku===original.sku).length>1||original.catalogIssue&&original.catalogIssue!=='price_unverified'))issues.push('Check the original request and confirm this line');
 return issues;
}
export function quoteSubtotal(lines:QuoteEditorLine[]){return lines.reduce((sum,l)=>sum+(/^\d+(?:\.\d{1,2})?$/.test(l.price)&&Number(l.quantity)>0?lineTotal(Math.round(Number(l.price)*100),Number(l.quantity)):0),0);}
