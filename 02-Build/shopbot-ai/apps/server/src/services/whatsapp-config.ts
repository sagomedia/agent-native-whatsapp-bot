import type {ReplyLanguage} from '../../../../packages/contracts/language.js';
export type WhatsAppConfig = {
  hostname:string; path?:'/webhook'|'/webhooks/whatsapp'; privacyPublished?:boolean;storeId:string; appId:string; wabaId:string; phoneId:string;
  appSecret:string; verifyToken:string; accessToken:string; graphVersion:string;
  recipients:string[]; processEnabled:boolean; sendEnabled:boolean; aiEnabled?:boolean; mediaEnabled?:boolean; discoveryStages?:boolean; mediaRecommendations?:boolean; sequentialItems?:boolean; defaultReplyLanguage?:ReplyLanguage; paidEnabled?:boolean; budgetMicrousd?:number; typingEnabled?:boolean;
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
  return {hostname,path,aiEnabled,mediaEnabled,discoveryStages,mediaRecommendations,sequentialItems:env.WHATSAPP_SEQUENTIAL_ITEMS_ENABLED==='true',paidEnabled,budgetMicrousd:validPaid?Math.round(Number(budget)*1000000):undefined,typingEnabled:env.WHATSAPP_TYPING_ENABLED==='true',defaultReplyLanguage:defaultReplyLanguage as ReplyLanguage,privacyPublished:env.WHATSAPP_PRIVACY_PUBLISHED==='true',storeId,appId,wabaId,phoneId,appSecret,verifyToken,accessToken,graphVersion,recipients,processEnabled:env.WHATSAPP_PROCESS_ENABLED==='true',sendEnabled:env.WHATSAPP_SEND_ENABLED==='true'};
}
