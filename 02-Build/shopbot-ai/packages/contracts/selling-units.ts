import {z} from 'zod';
import {SELLING_UNITS} from './selling-unit-values.js';
export {SELLING_UNITS} from './selling-unit-values.js';
export const sellingUnitSchema=z.enum(SELLING_UNITS);
export const merchantVerificationSchema=z.object({identity:z.boolean(),photo:z.boolean(),sellingUnit:z.boolean(),price:z.boolean(),stock:z.boolean()}).strict();
export const sellingPolicySchema=z.object({saleMode:z.enum(['pack','measured']).optional(),packContents:z.object({value:z.number().positive().max(100000),unit:z.enum(['piece','litre','ml','kg','g','metre','foot'])}).strict().optional(),cutAllowed:z.boolean().default(false),continuousLengthAvailable:z.number().positive().max(100000).nullable().default(null)}).strict();
