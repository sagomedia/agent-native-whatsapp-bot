import {catalogEnrichmentInstructions} from '../../../../packages/contracts/catalog-enrichment.js';
import {sellingUnitSchema} from '../../../../packages/contracts/selling-units.js';
import {admitRequest,type InputAdmission} from './inference-admission.js';
import {type GenerateContentParameters,GoogleGenAI,ServiceTier,ThinkingLevel} from '@google/genai';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {ProviderResult} from '../adapters/interpreter.js';
import {geminiTextRate,usageEstimate,validateRateCard,worstCaseReservation} from './inference-budget.js';
import {tokens,oneEdit} from './catalog.js';
import type {ImageMedia} from './image-media.js';
const names=z.object({ta:z.string().max(160),'ta-Latn':z.string().max(160)}).strict();
export const catalogSuggestionSchema=z.object({description:z.string().trim().max(120).optional(),name:z.string().trim().min(2).max(160),localNames:names,aliases:z.array(z.string().trim().min(1).max(120)).max(16),keywords:z.array(z.string().trim().min(1).max(120)).max(12),unit:sellingUnitSchema.nullable(),brand:z.string().max(100).nullable(),specifications:z.array(z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),value:z.string().trim().min(1).max(120),source:z.enum(['description','photo'])}).strict()).max(12),familyId:z.string().max(80).nullable(),newType:z.object({label:z.string().min(2).max(160),localNames:names,departmentId:z.string().max(80).nullable()}).strict().nullable(),questions:z.array(z.string().min(1).max(200)).max(5)}).strict();
export type CatalogSuggestion=z.infer<typeof catalogSuggestionSchema>&{aliasSuggestions?:string[]};
export type CatalogNode={id:string;parent_id:string|null;kind:string;label:string};
export const catalogDraftDetailsSchema=z.object({variantGroup:z.boolean().optional(),name:z.string().trim().max(160),localNames:names,brand:z.string().trim().max(100),unit:sellingUnitSchema.nullable(),type:z.string().trim().max(160),specifications:z.array(z.object({key:z.string().trim().max(40),value:z.string().trim().max(120)}).strict()).max(20)}).strict();
export type CatalogDraftInput={description:string;details?:z.infer<typeof catalogDraftDetailsSchema>;image?:ImageMedia;nodes:CatalogNode[]};
export interface CatalogGenerator {readonly mode:'live'|'mock';prepareInput?(input:CatalogDraftInput):{admission:InputAdmission;generate(signal:AbortSignal):Promise<ProviderResult>};generate(input:CatalogDraftInput,signal:AbortSignal):Promise<ProviderResult>}
export const catalogGenerationRate=Object.freeze({...geminiTextRate,maxOutputTokens:2048});
export class GoogleCatalogGenerator implements CatalogGenerator {
 readonly mode='live' as const;private models;
 constructor(key:string,transport?:Pick<GoogleGenAI['models'],'generateContent'>){this.models=transport??new GoogleGenAI({apiKey:key,vertexai:false,httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1}}}).models;}
 private buildRequest(input:CatalogDraftInput):GenerateContentParameters {
  const signal=undefined;
  const text=JSON.stringify({ownerDescription:input.description,ownerFields:input.details,productTypes:input.nodes.slice(0,60).map(n=>({id:n.id,kind:n.kind,parentId:n.parent_id,label:n.label.slice(0,160)}))});
  return {model:catalogGenerationRate.model,contents:[{role:'user',parts:[{text},...(input.image?[{inlineData:{mimeType:'image/jpeg',data:input.image.image.toString('base64')}}]:[])]}],config:{systemInstruction:'Draft ONE shop product for its owner to REVIEW. Return JSON only. '+catalogEnrichmentInstructions,responseMimeType:'application/json',responseJsonSchema:z.toJSONSchema(catalogSuggestionSchema),maxOutputTokens:catalogGenerationRate.maxOutputTokens,serviceTier:ServiceTier.STANDARD,thinkingConfig:{thinkingLevel:ThinkingLevel.MINIMAL},automaticFunctionCalling:{disable:true},abortSignal:signal,httpOptions:{timeout:19000,retryOptions:{attempts:1}}}};
 }
 prepareInput(input:CatalogDraftInput){const request=this.buildRequest(input),admission=admitRequest(request);return {admission,generate:(signal:AbortSignal)=>this.generatePrepared(signal,request)};}
 async generate(input:CatalogDraftInput,signal:AbortSignal):Promise<ProviderResult>{return this.prepareInput(input).generate(signal);}
 private async generatePrepared(signal:AbortSignal,request:GenerateContentParameters):Promise<ProviderResult>{
  const r=await this.models.generateContent({...request,config:{...request.config,abortSignal:signal}});
  let output:unknown=null;try{output=r.text?JSON.parse(r.text):null;}catch{}
  const u=r.usageMetadata;const usage=u?Object.fromEntries(['promptTokenCount','candidatesTokenCount','thoughtsTokenCount','totalTokenCount','cachedContentTokenCount','toolUsePromptTokenCount'].filter(k=>u[k as keyof typeof u]!==undefined).map(k=>[k,u[k as keyof typeof u] as number])):null;
  return {output,usage,responseModel:r.modelVersion,truncated:r.candidates?.[0]?.finishReason!=='STOP'};
 }
}
// Generated search metadata must not broaden an item's identity into another tool.
// Keep translations and spelling variants, but leave new synonyms to owner review.
export function reviewableSuggestion(s:CatalogSuggestion,input:CatalogDraftInput):CatalogSuggestion {
 const names=[s.name,...Object.values(s.localNames)].filter(Boolean),vocabulary=[...new Set([...names,s.brand??''].flatMap(tokens))];
 const supported=(term:string)=>tokens(term).length>0&&tokens(term).every(t=>vocabulary.some(word=>oneEdit(t,word)));
 const minWords=Math.min(2,tokens(s.name).filter(t=>!/^\d/.test(t)).length);
 const candidates=[...s.aliases,input.details?.name??'',...Object.values(input.details?.localNames??{})];
 const aliases=[...new Set([...names.filter(n=>n.length<=120),...candidates.filter(a=>a.length<=120&&supported(a)&&tokens(a).filter(t=>!/^\d/.test(t)).length>=minWords)])].slice(0,16);
 const keywords=s.keywords.filter(supported);
 const questions=[...s.questions];
 if(s.aliases.some(a=>!aliases.includes(a))||keywords.length!==s.keywords.length)questions.push('Confirm any other names customers use for this exact product.');
 if(input.image&&(input.description||input.details?.name))questions.unshift('Check that the photo and description refer to the same product before publishing.');
 return {...s,aliasSuggestions:s.aliases.filter(a=>!aliases.includes(a)),unit:input.details?.unit??s.unit,aliases,keywords,questions:[...new Set(questions)].slice(0,5)};
}
const failure=(message:string,statusCode=409)=>Object.assign(new Error(message),{statusCode});
// Staff suggestions use their own durable ledger and the shop's shared budget.
// They never create customer conversations, shopping lists or channel messages.
export async function generateCatalogDraft(pool:Pool,storeId:string,id:string,input:CatalogDraftInput,generator:CatalogGenerator){
 const prepared=generator.prepareInput?.(input);
 const hash=createHash('sha256').update(input.description).update(input.image?.sourceHash??'').update(input.details?JSON.stringify(input.details):'').digest('hex');const rate=catalogGenerationRate;
 if(generator.mode==='live')validateRateCard(rate);
 const client=await pool.connect();let cached:CatalogSuggestion|undefined;
 try{await client.query('BEGIN');await client.query('SELECT id FROM stores WHERE id=$1 FOR SHARE',[storeId]);await client.query('SELECT store_id FROM inference_budgets WHERE store_id=$1 FOR UPDATE',[storeId]);
  const old=(await client.query('SELECT * FROM catalog_suggestions WHERE store_id=$1 AND id=$2 FOR UPDATE',[storeId,id])).rows[0];
  if(old){if(old.input_hash!==hash)throw failure('This suggestion request changed. Start a new suggestion.');if(old.state==='succeeded')cached=old.suggestion;else throw failure(old.state==='started'?'The suggestion is still processing. Retry this same request shortly.':'That suggestion did not complete. Review the details manually, or explicitly start a new suggestion.');}
  else{
   const held=generator.mode==='live'?worstCaseReservation(rate):0;
   if(held){const b=(await client.query('SELECT * FROM inference_budgets WHERE store_id=$1',[storeId])).rows[0];if(!b||b.blocked||BigInt(b.committed_microusd)+BigInt(b.held_microusd)+BigInt(held)>BigInt(b.limit_microusd))throw failure('The shop’s available AI allowance is exhausted. You can still enter the product manually.',503);await client.query('UPDATE inference_budgets SET held_microusd=held_microusd+$2 WHERE store_id=$1',[storeId,held]);}
   await client.query("INSERT INTO catalog_suggestions(id,store_id,input_hash,state,provider_mode,rate_snapshot,reserved_microusd) VALUES($1,$2,$3,'started',$4,$5,$6)",[id,storeId,hash,generator.mode,JSON.stringify(rate),held]);
   if(prepared)await client.query('UPDATE catalog_suggestions SET input_admission=$1::jsonb WHERE store_id=$2 AND id=$3',[JSON.stringify(prepared.admission),storeId,id]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 if(cached)return {suggestion:cached,cached:true};
 let result:ProviderResult|undefined,suggestion:CatalogSuggestion|undefined;
 try{const signal=AbortSignal.timeout(20000);result=await Promise.race([prepared?prepared.generate(signal):generator.generate(input,signal),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(failure('The suggestion timed out. Review the product manually.',504)),{once:true}))]);if(result.truncated)throw failure('The suggestion was incomplete. Enter the missing details manually.',422);suggestion=catalogSuggestionSchema.parse(result.output);
  if(suggestion.familyId&&!input.nodes.some(n=>n.kind==='family'&&n.id===suggestion!.familyId))throw failure('The suggested type is not in this shop. Choose a type manually.',422);
  if(suggestion.familyId&&suggestion.newType)throw failure('The suggested type was ambiguous. Choose it manually.',422);
  if(suggestion.newType?.departmentId&&!input.nodes.some(n=>n.kind==='department'&&n.id===suggestion!.newType!.departmentId))throw failure('The suggested department is unknown. Choose a type manually.',422);
  suggestion=reviewableSuggestion(suggestion,input);
 }catch{suggestion=undefined;/* Keep completed usage even when the generated JSON fails validation. */}
 const settlement=await pool.connect();try{await settlement.query('BEGIN');await settlement.query('SELECT id FROM stores WHERE id=$1 FOR SHARE',[storeId]);await settlement.query('SELECT store_id FROM inference_budgets WHERE store_id=$1 FOR UPDATE',[storeId]);
  const row=(await settlement.query('SELECT * FROM catalog_suggestions WHERE store_id=$1 AND id=$2 FOR UPDATE',[storeId,id])).rows[0];
  const quote=generator.mode==='live'&&result?usageEstimate(rate,result):{microusd:generator.mode==='mock'?0:null,violation:false};
  if(quote.microusd!==null&&!quote.violation){await settlement.query('UPDATE inference_budgets SET held_microusd=held_microusd-$2,committed_microusd=committed_microusd+$3 WHERE store_id=$1',[storeId,row.reserved_microusd,quote.microusd]);}
  else if(quote.violation)await settlement.query('UPDATE inference_budgets SET blocked=true WHERE store_id=$1',[storeId]);
  const state=suggestion&&!quote.violation?'succeeded':result?'failed':'unknown';
  await settlement.query('UPDATE catalog_suggestions SET state=$3,suggestion=$4,usage=$5,response_model=$6,estimated_cost_microusd=$7,billing_state=$8,settled_at=now() WHERE store_id=$1 AND id=$2',[storeId,id,state,state==='succeeded'?JSON.stringify(suggestion):null,JSON.stringify(result?.usage??null),result?.responseModel??null,quote.violation?null:quote.microusd,quote.microusd!==null&&!quote.violation?'estimated':'unknown']);
  await settlement.query('COMMIT');if(state!=='succeeded')throw failure('AI could not prepare reliable details. Your product was not changed; you can enter it manually.',422);
 }catch(e){await settlement.query('ROLLBACK');throw e;}finally{settlement.release();}
 return {suggestion:suggestion!,cached:false};
}
