export type WhatsAppConfig = {
  hostname:string; path?:'/webhook'|'/webhooks/whatsapp'; privacyPublished?:boolean;storeId:string; appId:string; wabaId:string; phoneId:string;
  appSecret:string; verifyToken:string; accessToken:string; graphVersion:string;
  recipients:string[]; processEnabled:boolean; sendEnabled:boolean; aiEnabled?:boolean;
};
export function readWhatsAppConfig(env:NodeJS.ProcessEnv):WhatsAppConfig|undefined {
  if(env.WHATSAPP_ENABLED!=='true') {
    if(env.WHATSAPP_PROCESS_ENABLED==='true'||env.WHATSAPP_SEND_ENABLED==='true'||env.WHATSAPP_AI_ENABLED==='true')throw new Error('WhatsApp requires explicit channel enablement');
    return;
  }
  const hostname=env.WHATSAPP_HOSTNAME??'',storeId=env.WHATSAPP_STORE_ID??'',appId=env.WHATSAPP_APP_ID??'',wabaId=env.WHATSAPP_WABA_ID??'',phoneId=env.WHATSAPP_PHONE_ID??'';
  const appSecret=env.WHATSAPP_APP_SECRET??'',verifyToken=env.WHATSAPP_VERIFY_TOKEN??'',accessToken=env.WHATSAPP_ACCESS_TOKEN??'',graphVersion=env.WHATSAPP_GRAPH_VERSION??'v25.0';
  const recipients=[...new Set((env.WHATSAPP_TEST_RECIPIENTS??'').split(',').map(x=>x.trim().replace(/^\+/,'')))];
  const path=env.WHATSAPP_WEBHOOK_PATH??'/webhooks/whatsapp';
  const aiEnabled=env.WHATSAPP_AI_ENABLED==='true';
  if(aiEnabled&&(env.ALLOW_FREE_INFERENCE!=='true'||env.ALLOW_PAID_INFERENCE==='true'||(env.AI_BUDGET_USD??'0')!=='0'||env.ALLOW_LOCAL_AI_TEST==='true'))throw new Error('WhatsApp AI requires free-only inference, zero budget and local AI disabled');
  if(path!=='/webhook'&&path!=='/webhooks/whatsapp')throw new Error('Invalid WhatsApp webhook path');
  if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)||!/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(storeId)||![appId,wabaId,phoneId].every(x=>/^\d{5,30}$/.test(x))||appSecret.length<16||verifyToken.length<16||accessToken.length<32||!/^v\d{2}\.0$/.test(graphVersion)||recipients.length<1||recipients.length>5||!recipients.every(x=>/^\d{7,15}$/.test(x)))throw new Error('Complete, valid WhatsApp test-channel configuration is required');
  return {hostname,path,aiEnabled,privacyPublished:env.WHATSAPP_PRIVACY_PUBLISHED==='true',storeId,appId,wabaId,phoneId,appSecret,verifyToken,accessToken,graphVersion,recipients,processEnabled:env.WHATSAPP_PROCESS_ENABLED==='true',sendEnabled:env.WHATSAPP_SEND_ENABLED==='true'};
}
