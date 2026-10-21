import type {DraftLine} from '../../../packages/contracts/index.js';
import {quoteLineIssues,type QuoteEditorLine} from '../../../packages/contracts/owner-quote.js';
import {sellingBasisIssues} from '../../../packages/contracts/selling-basis.js';
export type QuoteProblem={field:'name'|'quantity'|'unit'|'price'|'free'|'saleMode';message:string};
/** Focus the actual invalid fact; a nonzero number can still be an invalid quantity. */
export function quoteGuidance(line:QuoteEditorLine,original:DraftLine,all:DraftLine[]):QuoteProblem[]{
 const problems=quoteLineIssues(line,original,all).map(message=>({field:message.startsWith('Enter a product')?'name':message.startsWith('Enter a quantity')?'quantity':message.startsWith('Choose the selling')?'unit':Number(line.price)===0&&line.price!==''&&!line.free?'free':'price',message}) as QuoteProblem);
 const product=original.candidates?.find(p=>p.sku===line.sku);
 const basis=sellingBasisIssues({name:line.name,unit:line.unit,specifications:product?.specifications,sellingPolicy:{...(product?.sellingPolicy??{cutAllowed:false,continuousLengthAvailable:null}),...(line.saleMode?{saleMode:line.saleMode}:{})}});
 for(const message of basis)problems.push({field:message.startsWith('A sealed pack')||message.startsWith('Measured sale')||message.startsWith('Pack weight')?'unit':message.startsWith('Product label')?'name':'saleMode',message});
 return problems;
}
