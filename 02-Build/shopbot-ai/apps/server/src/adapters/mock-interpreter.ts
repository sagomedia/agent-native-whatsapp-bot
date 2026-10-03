import {shopInquiry} from '../services/replies.js';
import type { Interpretation, Operation } from '../../../../packages/contracts/index.js';
import type { Interpreter, InterpretationInput, ProviderResult } from './interpreter.js';
const words: Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const numberPattern='(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)';
function number(value:string) {return words[value]??Number(value);}
function cleanQuery(query:string) { return query.trim().replace(/\s+(?:pieces?|units?|rolls?|bottles?|packs?|pairs?)$/i,'').trim(); }
/** Deterministic English test double, not a language model or live quality claim. */
export class MockInterpreter implements Interpreter {
  readonly name='mock-text-v1'; readonly mode='mock' as const;
  async interpret({text,state}: InterpretationInput, signal: AbortSignal): Promise<ProviderResult> {
    if(signal.aborted) throw new Error('Interpretation aborted');
    let value=text.toLowerCase().trim().replace(/[.!?]+$/,'');
    const result:Interpretation={operations:[],next:'review'};
    if(/^(?:what is (?:the )?|what(?:'s| is) (?:the )?)?(?:price|cost)(?: of| for)?\s+/.test(value)||/^how much (?:is|for) /.test(value)) {
      result.next='price';result.priceQuery=value.replace(/^(?:what is (?:the )?|what(?:'s| is) (?:the )?)?(?:price|cost)(?: of| for)?\s+|^how much (?:is|for) /,'');
      const quoted=new RegExp('^('+numberPattern+') (.+)$').exec(result.priceQuery!);if(quoted){result.priceQuantity=number(quoted[1]);result.priceQuery=cleanQuery(quoted[2]);const unit=/\b(pieces?|pcs|boxes?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)\b/.exec(quoted[2]);if(unit)result.priceUnit=unit[1];}
      return {output:result,truncated:false,usage:null};
    }
    value=value.replace(/^actually\s+/, '').replace(/\bonly\s+(?=\d|one|two|three|four|five|six|seven|eight|nine|ten)/g,'');
    const pendingQuestion=state.pending?.kind==='question'?state.pending:null;
    const question=pendingQuestion?state.draft.find(l=>l.id===pendingQuestion.lineId):undefined;
    if(question&&!/^(?:add|i need|i want|can i get|can you add|remove|change|set|make|yes)/.test(value)) {
      if(question.resolution==='needs_quantity'&&new RegExp('^'+numberPattern+'$').test(value)) result.operations=[{kind:'resolve_line',lineId:question.id,quantity:number(value)}];
      else result.operations=[{kind:'resolve_line',lineId:question.id,query:`${question.query??question.name} ${value}`}];
      return {output:result,truncated:false,usage:null};
    }
    value=value.replace(/^yes\s*[, ]*\s*but\s+/, '');
    const shopping=/^(?:i need|i want|can i get|could i get|can you add|please add|add)\s+/.test(value);
    value=value.replace(/^(?:i need|i want|can i get|could i get|can you add|please add|add)\s+/,'');
    const clauses=value.split(/,\s*|;\s*|\.\s+|\s+(?:and|plus|also)\s+/).filter(Boolean);
    if(clauses.length>20) throw new Error('Split the request into smaller batches. No partial interpretation.');
    for(let clause of clauses) {
      clause=clause.trim().replace(/^yes but /,'');
      const inquiry=shopInquiry(clause);if(inquiry){result.shopQuestions=[...new Set([...(result.shopQuestions??[]),...(inquiry.shopQuestions??[])])];continue;}
      if(/^(?:keep everything else|keep the rest)$/.test(clause)) continue;
      if(/^(?:i (?:will|shall) )?(?:collect|pick up|pickup)(?: .*|$)/.test(clause)) {result.operations.push({kind:'set_fulfillment',method:'pickup'});continue;}
      const change=new RegExp('^(?:change|set|make) (?:the )?(.+?) (?:to )?('+numberPattern+')$').exec(clause);
      if(change) {result.operations.push({kind:'set_quantity',reference:change[1],quantity:number(change[2])});continue;}
      const remove=/^remove (?:the )?(.+)$/.exec(clause);
      if(remove) {result.operations.push({kind:'remove_item',reference:remove[1]});continue;}
      clause=clause.replace(/^(?:please )?add /,'');
      const uncertain=new RegExp('^('+numberPattern+') or ('+numberPattern+') (.+)$').exec(clause);
      if(uncertain) {result.operations.push({kind:'add_item',query:cleanQuery(uncertain[3]),quantity:null});continue;}
      const add=new RegExp('^('+numberPattern+') (.+)$').exec(clause);
      if(add) {const unit=/^(pieces?|pcs|boxes?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)\s+(?:of\s+)?(.+)$/.exec(add[2]);const tail=/\b(pieces?|pcs|boxes?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)$/.exec(add[2]);result.operations.push({kind:'add_item',query:cleanQuery(unit?unit[2]+(/^box/.test(unit[1])?' box':''):add[2]),quantity:number(add[1]),...((unit||tail)?{requestedUnit:(unit??tail)![1]}:{})});}
      else if(shopping) result.operations.push({kind:'add_item',query:cleanQuery(clause),quantity:null});
      else throw new Error('The mock interpreter supports explicit shopping lists and edits. Please rephrase; your existing draft is retained.');
    }
    if(!result.operations.length) throw new Error('No supported operation found.');
    return {output:result,truncated:false,usage:null};
  }
}
