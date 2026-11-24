import {z} from 'zod';
import type {Product} from './index.js';
import {sellingUnitSchema} from './selling-units.js';
const paise=z.number().int().positive().max(2147483647);
export const indicativeGenerationSchema=z.object({model:z.string().min(1).max(100),requestedModel:z.literal('gpt-6-luna').optional(),effort:z.literal('low'),inputHash:z.string().regex(/^[a-f0-9]{64}$/),proposalHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const indicativePriceSchema=z.object({pricePaise:paise,lowPaise:paise,highPaise:paise,unit:sellingUnitSchema,currency:z.literal('INR'),asOf:z.iso.date(),source:z.literal('model-low-indicative'),basis:z.string().min(1).max(200).optional(),sourceUrls:z.array(z.url().refine(s=>s.startsWith('https://'))).max(30).optional(),note:z.string().max(2000).optional(),generation:indicativeGenerationSchema}).strict().refine(p=>p.lowPaise<=p.pricePaise&&p.pricePaise<=p.highPaise,'Indicative price must fall within its range.');
export type IndicativePrice=z.infer<typeof indicativePriceSchema>;
/** Display-only reference; never satisfies catalog quote or merchant consent. */
export function indicativePriceFor(product:Pick<Product,'pricePaise'|'priceStatus'|'unit'|'indicativePrice'>):IndicativePrice|undefined {
 if(product.pricePaise!==0||product.priceStatus!=='confirm')return;
 const result=indicativePriceSchema.safeParse(product.indicativePrice);
 if(result.success&&result.data.unit===product.unit)return result.data;
}
