import type {ReplyLanguage} from '../../../../packages/contracts/language.js';
import {messagingRateSchema,validAccountTimezone,type MessagingRateCard} from './messaging-cost.js';
export type WhatsAppConfig = {
  visualOrdering?:boolean;maxDraftLines?:number;serviceRatePaise?:number;visualMediaDir?:string;hostname:string; path?:'/webhook'|'/webhooks/whatsapp'; privacyPublished?:boolean;storeId:string; appId:string; wabaId:string; phoneId:string;
  appSecret:string; verifyToken:string; accessToken:string; graphVersion:string;
  recipients:string[]; processEnabled:boolean; sendEnabled:boolean; aiEnabled?:boolean; mediaEnabled?:boolean; discoveryStages?:boolean; mediaRecommendations?:boolean; sequentialItems?:boolean; defaultReplyLanguage?:ReplyLanguage; paidEnabled?:boolean; budgetMicrousd?:number; typingEnabled?:boolean;
  serviceRateMicroInr?:number;accountTimezone?:string;pricingRateCard?:MessagingRateCard;businessPhoneNumber?:string;accountCurrency?:string;
};
export function readWhatsAppConfig(env:NodeJS.ProcessEnv):WhatsAppConfig|undefined {
  if(env.WHATSAPP_ENABLED!=='true') {
    if(env.WHATSAPP_PROCESS_ENABLED==='true'||env.WHATSAPP_SEND_ENABLED==='true'||env.WHATSAPP_AI_ENABLED==='true'||env.WHATSAPP_MEDIA_ENABLED==='true'||env.WHATSAPP_DISCOVERY_STAGES_ENABLED==='true'||env.WHATSAPP_MEDIA_RECOMMENDATION_ENABLED==='true')throw new Error('WhatsApp requires explicit channel enablement');
    return;
  }
  const hostname=env.WHATSAPP_HOSTNAME??'',storeId=env.WHATSAPP_STORE_ID??'',appId=env.WHATSAPP_APP_ID??'',wabaId=env.WHATSAPP_WABA_ID??'',phoneId=env.WHATSAPP_PHONE_ID??'';
  const appSecret=env.WHATSAPP_APP_SECRET??'',verifyToken=env.WHATSAPP_VERIFY_TOKEN??'',accessToken=env.WHATSAPP_ACCESS_TOKEN??'',graphVersion=env.WHATSAPP_GRAPH_VERSION??'v25.0';
  const recipients=[...new Set((env.WHATSAPP_TEST_RECIPIENTS??'').split(',').map(x=>x.trim().replace(/^\+/,'')))];
  const path=env.WHATSAPP_WEBHOOK_PATH??'/webhooks/whatsapp';
  const aiEnabled=env.WHATSAPP_AI_ENABLED==='true';
  const defaultReplyLanguage=env.WHATSAPP_DEFAULT_LANGUAGE??'ta';
  if(!['ta','ta-Latn','en'].includes(defaultReplyLanguage))throw new Error('Invalid WhatsApp default reply language');
  const mediaEnabled=env.WHATSAPP_MEDIA_ENABLED==='true',discoveryStages=env.WHATSAPP_DISCOVERY_STAGES_ENABLED==='true',mediaRecommendations=env.WHATSAPP_MEDIA_RECOMMENDATION_ENABLED==='true';
  if((mediaEnabled||discoveryStages)&&!aiEnabled)throw new Error('WhatsApp media and discovery require explicit AI enablement');
  if(mediaRecommendations&&(!mediaEnabled||!aiEnabled))throw new Error('WhatsApp media recommendations require media and AI enablement');
  const paidEnabled=env.ALLOW_PAID_INFERENCE==='true',budget=env.AI_BUDGET_USD??'0';
  const validPaid=paidEnabled&&env.ALLOW_FREE_INFERENCE!=='true'&&/^(?:[0-4](?:\.\d{1,6})?|5(?:\.0{1,6})?)$/.test(budget)&&Number(budget)>0;
  if(aiEnabled&&(env.ALLOW_LOCAL_AI_TEST==='true'||!(validPaid||env.ALLOW_FREE_INFERENCE==='true'&&!paidEnabled&&budget==='0')))throw new Error('WhatsApp AI requires free-only or explicitly bounded paid inference (maximum $5), and local AI disabled');
  if(path!=='/webhook'&&path!=='/webhooks/whatsapp')throw new Error('Invalid WhatsApp webhook path');
  if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)||!/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(storeId)||![appId,wabaId,phoneId].every(x=>/^\d{5,30}$/.test(x))||appSecret.length<16||verifyToken.length<16||accessToken.length<32||!/^v\d{2}\.0$/.test(graphVersion)||recipients.length<1||recipients.length>5||!recipients.every(x=>/^\d{7,15}$/.test(x)))throw new Error('Complete, valid WhatsApp test-channel configuration is required');
  const maxDraftLines=Number(env.WHATSAPP_MAX_DRAFT_LINES??50),serviceRatePaise=env.WHATSAPP_SERVICE_RATE_PAISE===undefined?undefined:Number(env.WHATSAPP_SERVICE_RATE_PAISE);
  if(!Number.isInteger(maxDraftLines)||maxDraftLines<1||maxDraftLines>50||serviceRatePaise!==undefined&&(!Number.isSafeInteger(serviceRatePaise)||serviceRatePaise<0))throw new Error('Invalid visual ordering limits or channel rate');
  const serviceRateMicroInr=env.WHATSAPP_SERVICE_RATE_MICRO_INR===undefined?undefined:Number(env.WHATSAPP_SERVICE_RATE_MICRO_INR);
  if(serviceRateMicroInr!==undefined&&(!/^\d+$/.test(env.WHATSAPP_SERVICE_RATE_MICRO_INR!)||!Number.isSafeInteger(serviceRateMicroInr)||serviceRateMicroInr<0||env.WHATSAPP_SERVICE_RATE_PAISE!==undefined))throw new Error('Use one nonnegative integer messaging rate in micro-INR or legacy paise.');
  const accountTimezone=env.WHATSAPP_ACCOUNT_TIMEZONE||undefined,businessPhoneNumber=env.WHATSAPP_BUSINESS_PHONE_NUMBER||undefined,accountCurrency=env.WHATSAPP_ACCOUNT_CURRENCY||undefined;
  if(accountTimezone&&!validAccountTimezone(accountTimezone)||businessPhoneNumber&&!/^\d{7,15}$/.test(businessPhoneNumber)||accountCurrency&&!/^[A-Z]{3}$/.test(accountCurrency))throw new Error('Invalid Messaging account timezone, phone number or currency.');
  const pricingRateCard=env.WHATSAPP_RATE_CARD_JSON?messagingRateSchema.parse(JSON.parse(env.WHATSAPP_RATE_CARD_JSON)):undefined;
  if(pricingRateCard&&accountCurrency&&pricingRateCard.currency!==accountCurrency)throw new Error('Messaging rate currency differs from the account currency.');
  return {visualOrdering:env.WHATSAPP_VISUAL_ORDERING_ENABLED==='true',maxDraftLines,serviceRatePaise,serviceRateMicroInr,accountTimezone,pricingRateCard,businessPhoneNumber,accountCurrency,visualMediaDir:env.VISUAL_MEDIA_DIR,hostname,path,aiEnabled,mediaEnabled,discoveryStages,mediaRecommendations,sequentialItems:env.WHATSAPP_SEQUENTIAL_ITEMS_ENABLED==='true',paidEnabled,budgetMicrousd:validPaid?Math.round(Number(budget)*1000000):undefined,typingEnabled:env.WHATSAPP_TYPING_ENABLED==='true',defaultReplyLanguage:defaultReplyLanguage as ReplyLanguage,privacyPublished:env.WHATSAPP_PRIVACY_PUBLISHED==='true',storeId,appId,wabaId,phoneId,appSecret,verifyToken,accessToken,graphVersion,recipients,processEnabled:env.WHATSAPP_PROCESS_ENABLED==='true',sendEnabled:env.WHATSAPP_SEND_ENABLED==='true'};
}
