import type { ConversationState, Product } from '../../../../packages/contracts/index.js';
import type { RateCard } from '../services/inference-budget.js';
import type {AssistantMemory,CatalogObservation} from '../services/agent-assistance.js';
export type InterpretationInput = { text: string; audio?:{mimeType:'audio/wav';data:string;durationSeconds:number}; state: ConversationState; catalog?: Product[];history?:{direction:string;text:string}[]; assistantMemory?:AssistantMemory|null;catalogMap?:import('../../../../packages/contracts/index.js').CatalogMap;observations?:CatalogObservation[] };
export type ProviderResult = { output: unknown; truncated: boolean; usage: Record<string,number> | null; responseModel?: string };
export interface Interpreter {
  readonly name: string;
  readonly supportsAudio?:boolean;
  readonly mode: 'mock' | 'live';
  readonly billing?: RateCard;
  readonly freeQuota?: {scope:string;model:string};
  validateInput?(input: InterpretationInput): void;
  interpret(input: InterpretationInput, signal: AbortSignal): Promise<ProviderResult>;
}
// The local simulator stays mock-only. Explicit native evaluation uses the
// shared runtime with its own authorization, dated rates and durable budget.
export function assertMockProvider(provider: Interpreter) {
  if(provider.mode!=='mock') throw new Error('Live interpretation is disabled on the mock simulator. Use an explicitly configured metered native runtime.');
}
