import {readWhatsAppConfig,type WhatsAppConfig} from './services/whatsapp-config.js';
import {remoteMcpConfig,type RemoteMcpConfig} from './mcp/oauth.js';
export type OwnerConfig = { hostname:string; issuer:string; audience:string; email:string; storeId:string };
export type Config = { mode: 'mock' | 'live'; databaseUrl: string; port: number; host: string; mediaDir: string; whatsAppPlanningPaise?:number; owner?:OwnerConfig;whatsapp?:WhatsAppConfig;catalogAi?:{apiKey:string};remoteMcp?:RemoteMcpConfig };
export function readConfig(env = process.env): Config {
  const mode = env.APP_MODE ?? 'mock';
  if (mode !== 'mock' && mode !== 'live') throw new Error('APP_MODE must be mock or live');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const port = Number(env.PORT ?? 3017);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const whatsAppPlanningPaise=Number(env.WHATSAPP_PLANNING_PAISE??50);
  if(!Number.isSafeInteger(whatsAppPlanningPaise)||whatsAppPlanningPaise<0||whatsAppPlanningPaise>100000)throw new Error('Invalid owner messaging planning estimate.');
  const ownerValues=[env.OWNER_HOSTNAME,env.CF_ACCESS_ISSUER,env.CF_ACCESS_AUD,env.OWNER_EMAIL,env.OWNER_STORE_ID];
  let owner:OwnerConfig|undefined;
  if(ownerValues.some(Boolean)) {
    if(!ownerValues.every(Boolean))throw new Error('Complete owner access configuration is required');
    const [hostname,issuer,audience,email,storeId]=ownerValues as string[];
    if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!/^\S+@\S+\.\S+$/.test(email)||!/^\w[\w-]{15,255}$/.test(audience)||!/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(storeId))throw new Error('Invalid owner access configuration');
    owner={hostname,issuer,audience,email:email.toLowerCase(),storeId};
  }
  const whatsapp=readWhatsAppConfig(env);
  if(whatsapp&&(whatsapp.hostname===owner?.hostname||owner&&whatsapp.storeId!==owner.storeId))throw new Error('WhatsApp needs a separate hostname and the configured owner store');
  const remoteMcp=remoteMcpConfig(env.SHOPBOT_MCP_PUBLIC_URL,owner,env.SHOPBOT_MCP_REDIRECT_URIS);
  if(remoteMcp&&whatsapp&&new URL(remoteMcp.publicUrl).hostname!==whatsapp.hostname)throw new Error('Remote MCP must use the existing public channel hostname.');
  return { remoteMcp,catalogAi:owner&&whatsapp?.paidEnabled&&whatsapp.aiEnabled&&env.GEMINI_API_KEY?{apiKey:env.GEMINI_API_KEY}:undefined,owner,whatsapp,whatsAppPlanningPaise,mode, databaseUrl: env.DATABASE_URL, port, host: env.HOST ?? '127.0.0.1', mediaDir: env.MEDIA_DIR ?? './data/media' };
}
export function assertMock(mode: Config['mode']) {
  if (mode !== 'mock') throw new Error('Demo seed/reset/simulator is forbidden in live mode');
}
