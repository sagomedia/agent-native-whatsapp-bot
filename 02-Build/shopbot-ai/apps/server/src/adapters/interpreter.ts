import type { ConversationState, Product,Interpretation } from '../../../../packages/contracts/index.js';
import type { RateCard } from '../services/inference-budget.js';
import type {AssistantMemory,CatalogObservation} from '../services/agent-assistance.js';
import type {KeepSelection} from '../services/shopping-corrections.js';
export type InterpretationInput = {cartTargetSelections?:{kind:'edit'|'item';index:number;lineId:string}[];keepSelections?:KeepSelection[];stage?:'recognize'|'identify'|'recommend';proposal?:Interpretation; planningFeedback?:string;repairSourceKind?:'text'|'audio'; text: string; image?:{mimeType:'image/jpeg';data:string}; audio?:{mimeType:'audio/wav';data:string;durationSeconds:number}; state: ConversationState; catalog?: Product[];history?:{direction:string;text:string}[]; assistantMemory?:AssistantMemory|null;catalogMap?:import('../../../../packages/contracts/index.js').CatalogMap;observations?:CatalogObservation[] };
export type EvidenceRepair = {understanding:import('../../../../packages/contracts/understanding.js').TurnUnderstanding;feedback:string};
export type ProviderResult = { evidenceRepair?:EvidenceRepair; output: unknown; truncated: boolean; usage: Record<string,number> | null; validationIssues?:{path:string;code:string}[]; responseModel?: string;observation?:import('../services/perception-observation.js').PerceptionObservation };
export interface Interpreter {
  readonly name: string;
  readonly unifiedUnderstanding?:boolean;
  readonly supportsImageLists?:boolean;
  readonly recognitionProvider?: Interpreter;
  recognitionProviderFor?(input:InterpretationInput):Interpreter;
  readonly supportsAudio?:boolean;
  readonly supportsImages?:boolean;
  readonly mode: 'mock' | 'live';
  readonly billing?: RateCard;
  readonly freeQuota?: {scope:string;model:string};
  validateInput?(input: InterpretationInput): void;
  prepareInput?(input:InterpretationInput):{admission:import('../services/inference-admission.js').InputAdmission;interpret(signal:AbortSignal):Promise<ProviderResult>};
  interpret(input: InterpretationInput, signal: AbortSignal): Promise<ProviderResult>;
}
// The local simulator stays mock-only. Explicit native evaluation uses the
// shared runtime with its own authorization, dated rates and durable budget.
export function assertMockProvider(provider: Interpreter) {
  if(provider.mode!=='mock') throw new Error('Live interpretation is disabled on the mock simulator. Use an explicitly configured metered native runtime.');
}
