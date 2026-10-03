export type Config = { mode: 'mock' | 'live'; databaseUrl: string; port: number; host: string; mediaDir: string; whatsAppPlanningPaise?:number };
export function readConfig(env = process.env): Config {
  const mode = env.APP_MODE ?? 'mock';
  if (mode !== 'mock' && mode !== 'live') throw new Error('APP_MODE must be mock or live');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const port = Number(env.PORT ?? 3017);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const whatsAppPlanningPaise=Number(env.WHATSAPP_PLANNING_PAISE??50);
  if(!Number.isSafeInteger(whatsAppPlanningPaise)||whatsAppPlanningPaise<0||whatsAppPlanningPaise>100000)throw new Error('Invalid owner messaging planning estimate.');
  return { whatsAppPlanningPaise,mode, databaseUrl: env.DATABASE_URL, port, host: env.HOST ?? '127.0.0.1', mediaDir: env.MEDIA_DIR ?? './data/media' };
}
export function assertMock(mode: Config['mode']) {
  if (mode !== 'mock') throw new Error('Demo seed/reset/simulator is forbidden in live mode');
}
