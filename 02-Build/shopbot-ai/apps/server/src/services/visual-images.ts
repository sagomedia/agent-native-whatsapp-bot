import {create as createFont} from 'fontkit';
import {Resvg} from '@resvg/resvg-js';
import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import type {VisualCard,RichReply} from '../../../../packages/contracts/index.js';

export const visualMediaDir=()=>resolve(process.env.VISUAL_MEDIA_DIR??'data/visual-images');
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
let fonts:ReturnType<typeof createFont>[]|undefined;
function layoutRuns(value:string){
 fonts??=['NotoSansTamil-Regular.ttf','NotoSans-Regular.ttf'].map(name=>createFont(readFileSync(resolve('resources/fonts',name))));
 return (value.match(/[\u0b80-\u0bff]+|[^\u0b80-\u0bff]+/g)??[]).map(run=>{const font=fonts![/[\u0b80-\u0bff]/.test(run)?0:1];return {font,layout:font.layout(run)};});
}
function textWidth(value:string,size:number){return layoutRuns(value).reduce((sum,r)=>sum+r.layout.positions.reduce((s,p)=>s+p.xAdvance,0)*size/r.font.unitsPerEm,0);}
function wrapPixels(value:string,width:number,size:number):string[]{
 const lines:string[]=[];let row='';
 for(const word of value.split(/\s+/).filter(Boolean)){
  if(row&&textWidth(row+' '+word,size)>width){lines.push(row);row='';}
  if(textWidth(word,size)<=width){row+=(row?' ':'')+word;continue;}
  for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word)){
   if(row&&textWidth(row+segment,size)>width){lines.push(row);row='';}row+=segment;
  }
 }
 if(row)lines.push(row);return lines;
}
function shapedText(value:string,x:number,y:number,size:number,color:string,anchor='start'){
 const runs=layoutRuns(value);
 const width=runs.reduce((sum,r)=>sum+r.layout.positions.reduce((s,p)=>s+p.xAdvance,0)*size/r.font.unitsPerEm,0);
 let cursor=anchor==='end'?x-width:x;
 let paths='';
 for(const {font,layout} of runs){const scale=size/font.unitsPerEm;for(let i=0;i<layout.glyphs.length;i++){const p=layout.positions[i],d=layout.glyphs[i].path.toSVG();paths+=`<path d="${d}" transform="translate(${cursor+p.xOffset*scale} ${y-p.yOffset*scale}) scale(${scale} ${-scale})" fill="${color}"/>`;cursor+=p.xAdvance*scale;}}
 return `<g aria-label="${escape(value)}">${paths}</g>`;
}
function text(value:string,x:number,y:number,size=36,color='#172b22') {return shapedText(value,x,y,size,color);}
export const INVOICE_ROWS_PER_PAGE=8;
function invoiceSvg(card:Exclude<VisualCard,{kind:'product'}>):string {
 const width=1080,ink='#202b30',muted='#647177',rule='#dce2e3',accent='#16665b';
 let y=64,content='';
 const draw=(value:string,x:number,baseline:number,size=24,color=ink,anchor='start')=>shapedText(value,x,baseline,size,color,anchor);
 for(const name of wrapPixels(card.storeName??'Shop',640,32)){content+=draw(name,56,y,32);y+=42;}
 content+=draw('Estimate',1024,64,30,accent,'end');
 content+=draw('INR',1024,102,20,muted,'end');
 if(card.reference){content+=draw(card.reference,56,y+10,20,muted);y+=40;}
 y=Math.max(y+24,156);content+=`<path d="M56 ${y}H1024" stroke="${ink}" stroke-width="2"/>`;y+=42;
 content+=draw('Item / pack',72,y,22,muted)+draw('Qty',724,y,22,muted,'end')+draw('Rate',868,y,22,muted,'end')+draw('Amount',1008,y,22,muted,'end');
 y+=18;content+=`<path d="M56 ${y}H1024" stroke="${rule}"/>`;
 for(const row of card.billRows??[]){
  const top=y+38,name=wrapPixels(row.name,530,25),pack=wrapPixels(row.packSize,530,20),quantity=wrapPixels(row.count,122,22);
  let baseline=top;
  for(const line of name){content+=draw(line,72,baseline,25);baseline+=35;}
  for(const line of pack){content+=draw(line,72,baseline,20,muted);baseline+=29;}
  for(const [index,line] of quantity.entries())content+=draw(line,724,top+index*31,22,ink,'end');
  content+=draw(row.unitPrice,868,top,22,row.unitPrice==='—'?muted:ink,'end');
  const amount=row.unitPrice==='—'?'—':row.total;
  // Keep narrow money columns clear even for the largest supported quantities.
  const moneySize=textWidth(amount,24)>128?Math.max(15,24*128/textWidth(amount,24)):24;
  content+=draw(amount,1008,top,moneySize,amount==='—'?muted:ink,'end');
  y=Math.max(baseline,top+quantity.length*31)+20;content+=`<path d="M56 ${y}H1024" stroke="${rule}"/>`;
 }
 y+=38;
 for(const paragraph of card.lines){for(const line of wrapPixels(paragraph,920,20)){content+=draw(line,72,y,20,muted);y+=29;}}
 if(card.total){
  y+=24;content+=`<path d="M56 ${y}H1024" stroke="${ink}" stroke-width="2"/>`;y+=42;
  const money=/^(.*):\s*(₹[\d,.]+)$/.exec(card.total);
  if(money){for(const line of wrapPixels(money[1],Math.max(240,920-textWidth(money[2],34)-28),24)){content+=draw(line,72,y,24,accent);y+=34;}content+=draw(money[2],1008,y-34,34,ink,'end');}
  else for(const line of wrapPixels(card.total,920,26)){content+=draw(line,72,y,26,accent);y+=36;}
 }
 y+=24;content+=draw('Estimate only · final stock and prices confirmed by the shop',72,y,20,muted);y+=38;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y+32}" viewBox="0 0 ${width} ${y+32}" role="img" aria-label="${escape(card.title)}"><rect width="${width}" height="${y+32}" fill="#fff"/>${content}</svg>`;
}
export function visualSvg(card:Exclude<VisualCard,{kind:'product'}>):string {
 const rows=card.billRows??[];
 if(rows.length>INVOICE_ROWS_PER_PAGE)throw new Error('An invoice image holds at most eight rows');
 if(card.billRows)return invoiceSvg(card);
 let y=card.storeName?156:76,content='<rect x="28" y="28" width="10" height="52" rx="4" fill="#167846"/>';
 if(card.storeName){content+='<path d="M40 44h36l-4-16H44zM44 48v24h28V48M55 72V56h10v16" fill="none" stroke="#167846" stroke-width="3"/>';for(const [i,line] of wrapPixels(card.storeName,488,28).slice(0,2).entries())content+=text(line,96,48+i*34,28,'#506358');content+='<path d="M40 94h560" stroke="#ccd8cd"/>'; }
 for(const line of wrapPixels(card.title,532,54)){content+=text(line,56,y,54);y+=68;}
 if(card.reference){for(const line of wrapPixels(card.reference,536,40)){content+=text(line,40,y,40,'#167846');y+=50;}}
 const bodySize=rows.length?36:44;
 for(const paragraph of card.lines){content+=`<g aria-label="${escape(paragraph)}">`;for(const line of wrapPixels(paragraph,560,bodySize)){content+=text(line,40,y,bodySize);y+=bodySize+18;}content+='</g>';}
 if(rows.length)y+=12;
 for(const row of rows){
  let body='',rowY=y+44;
  for(const line of wrapPixels(row.name,536,42)){body+=text(line,52,rowY,42);rowY+=54;}
  for(const line of wrapPixels(row.packSize,536,36)){body+=text(line,52,rowY,36,'#506358');rowY+=46;}
  const count=`${row.count} × ${row.unitPrice}`;
  for(const line of wrapPixels(count,536,36)){body+=text(line,52,rowY,36);rowY+=46;}
  // A separate total line prevents large quantities/prices from overlapping.
  body+=shapedText(row.total,588,rowY,42,'#172b22','end');rowY+=20;
  content+=`<rect x="28" y="${y}" width="584" height="${rowY-y}" rx="6" fill="#fff" stroke="#ccd8cd" stroke-width="2"/>`+body;
  y=rowY+16;
 }
 if(card.total){const lines=wrapPixels(card.total,536,46);content+=`<rect x="28" y="${y}" width="584" height="${lines.length*60+28}" rx="6" fill="#e8f3e9"/>`;for(const line of lines){content+=text(line,52,y+54,46);y+=60;}y+=28;}
 const height=Math.max(200,y+24);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}"><rect width="640" height="${height}" fill="#fbfcf8"/>${content}</svg>`;
}
const renderCache=new Map<string,string>();
export function renderVisualImage(card:Exclude<VisualCard,{kind:'product'}>,directory=visualMediaDir()):string {
 const key=createHash('sha256').update(JSON.stringify({title:card.title,lines:card.lines,billRows:card.billRows,total:card.total,reference:card.reference,storeName:card.storeName})).digest('hex');
 const cached=renderCache.get(directory+'|'+key);if(cached&&existsSync(join(directory,cached.split('/').at(-1)!)))return cached;
 const svg=visualSvg(card),hash=createHash('sha256').update('visual-v5\0'+svg).digest('hex'),filename=hash+'.png';
 mkdirSync(directory,{recursive:true});const path=join(directory,filename);
 if(!existsSync(path)){
  const fontFiles=['NotoSansTamil-Regular.ttf','NotoSans-Regular.ttf'].map(name=>resolve('resources/fonts',name));
  if(!fontFiles.every(existsSync))throw new Error('Bundled message fonts unavailable');
  const png=new Resvg(svg,{font:{fontFiles,loadSystemFonts:false,defaultFontFamily:'Noto Sans Tamil'}}).render().asPng();
  writeFileSync(path,png,{flag:'wx'});
 }
 const url='/catalog-images/messages/'+filename;
 if(renderCache.size>=512)renderCache.delete(renderCache.keys().next().value!);renderCache.set(directory+'|'+key,url);
 return url;
}
export function materializeVisualReply(reply:RichReply,directory=visualMediaDir()):RichReply {
 if(!reply.parts)return reply;
 return {...reply,parts:reply.parts.map(part=>({...part,cards:part.cards.map(card=>card.kind==='product'?(card.product.imageUrl?card:{...card,product:{...card.product,imageUrl:renderVisualImage({kind:'instruction',title:card.product.name,lines:['Catalog photo unavailable',card.product.specifications?.size??''],caption:card.caption},directory)}}):{...card,imageUrl:card.imageUrl??renderVisualImage({...card,storeName:reply.storeName},directory)})}))};
}
export function readVisualImage(hash:string):Buffer|undefined {
 if(!/^[a-f0-9]{64}\.png$/.test(hash))return;
 const path=join(visualMediaDir(),hash);return existsSync(path)?readFileSync(path):undefined;
}
