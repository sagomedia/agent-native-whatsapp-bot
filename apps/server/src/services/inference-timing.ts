import type {InterpretationInput} from '../adapters/interpreter.js';

// One turn can include recognition, identification and one bounded repair or
// recommendation. The deadline spans all stages; the lease includes save time.
export const inferenceTiming=Object.freeze({
  turnMs:120000,
  commitMarginMs:15000,
  longCallMs:45000,
  textCallMs:12000,
  sdkMarginMs:1000,
});

export function providerCallTimeout(input:Pick<InterpretationInput,'audio'|'state'>,remainingMs:number=inferenceTiming.turnMs) {
  const limit=input.audio||input.state.visualOrdering?inferenceTiming.longCallMs:inferenceTiming.textCallMs;
  return Math.max(0,Math.min(limit,Math.floor(remainingMs)));
}

export function providerSdkTimeout(input:Pick<InterpretationInput,'audio'|'state'>) {
  return providerCallTimeout(input)-inferenceTiming.sdkMarginMs;
}

export function processingLeaseSeconds() {
  return Math.ceil((inferenceTiming.turnMs+inferenceTiming.commitMarginMs)/1000);
}
