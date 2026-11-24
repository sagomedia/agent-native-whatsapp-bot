import {randomUUID} from 'node:crypto';
import type {RichReply,ReplyPart} from '../../../../packages/contracts/index.js';

/** Keep the complete review. The final action belongs to the whole delivered
 * group; earlier pages have no confirmation buttons. Never truncate a bill. */
export function textPresentation(text:string,buttons:NonNullable<RichReply['buttons']>=[],stage:RichReply['stage']='status'):RichReply {
 const blocks=text.replace(/\r\n?/g,'\n').split('\n\n');
 const tail:string[]=[];
 while(blocks.length&&Array.from([blocks.at(-1),...tail].join('\n\n')).length<=950)tail.unshift(blocks.pop()!);
 const pages:string[]=[];let page='';
 for(const block of blocks){
  if(Array.from(block).length>3900)throw new Error('A message block is too long; split it before presentation');
  if(Array.from([page,block].filter(Boolean).join('\n\n')).length>3900){pages.push(page);page='';}
  page=[page,block].filter(Boolean).join('\n\n');
 }
 if(page)pages.push(page);
 if(tail.length)pages.push(tail.join('\n\n'));
 if(!pages.length)pages.push(text);
 const parts:ReplyPart[]=pages.map((body,index)=>({id:randomUUID(),cards:[],text:body,buttons:index===pages.length-1?buttons:[]}));
 return {version:1,kind:stage==='bill'?'order_review':'text',readOnly:true,text,presentation:'text',outboundMessages:parts.length,parts,buttons,stage};
}
