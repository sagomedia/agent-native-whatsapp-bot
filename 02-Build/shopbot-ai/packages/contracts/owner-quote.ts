import {z} from 'zod';

export const quoteDraftLineSchema=z.object({
 id:z.uuid(),name:z.string().max(200),quantity:z.string().max(20),unit:z.string().max(30),
 price:z.string().max(20),free:z.boolean(),saleMode:z.enum(['','pack','measured']),
 sku:z.string().min(1).max(100).optional(),referenceSku:z.string().min(1).max(100).optional(),productVersion:z.number().int().positive().optional(),
 manualConfirmed:z.boolean().optional(),reviewed:z.boolean().optional(),estimated:z.boolean().optional()
}).strict();
export type QuoteEditorLine=z.infer<typeof quoteDraftLineSchema>;
export type SavedQuoteDraft={version:number;expectedRevision:number;amendmentId?:string;lines:QuoteEditorLine[];updatedAt:string};
export {initialQuoteLines,quoteLineIssues,quoteSubtotal} from './owner-quote-fields.js';
