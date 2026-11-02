/** A successful later turn cannot hide an earlier rejected customer message.
 * A failed attempt repaired successfully for the same message is acceptable. */
export function rejectedProviderTurns(attempts:{message_id:string;stage:string;state:string}[]):string[]{
 const byMessage=new Map<string,boolean>();
 for(const attempt of attempts){
  if(attempt.stage==='recognize')continue;
  byMessage.set(attempt.message_id,(byMessage.get(attempt.message_id)??false)||attempt.state==='succeeded');
 }
 return [...byMessage].filter(([,accepted])=>!accepted).map(([id])=>id);
}
