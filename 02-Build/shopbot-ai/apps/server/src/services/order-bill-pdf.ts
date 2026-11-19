import PDFDocument from 'pdfkit';
import {resolve} from 'node:path';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {unitName} from '../../../../packages/contracts/language.js';
import type {DraftLine} from '../../../../packages/contracts/index.js';
import type {ReplyLanguage} from '../../../../packages/contracts/language.js';

export type BillPdfRow={description:string;detail?:string;hsn?:string;rate:string;quantity:string;amount:string};
export type BillPdf={
 title:string;titleTamil?:string;reference:string;orderNumber?:string;issuedAt:Date;revision?:number;
 storeName:string;storeAddress?:string;storeSubtitle?:string;customerName?:string;
 supplierDetail?:string;customerDetail?:string;placeOfSupply?:string;rows:BillPdfRow[];
 totalLabel:string;total:string;amountPaise:number;summary?:{label:string;value:string}[];
 paymentInfo?:string;signatory?:boolean;footerNote?:string;notes?:string[];
};
const dateFormat=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'});
const left=48,right=547,bodyEnd=605,inkColor='#111827',muted='#6b7280',ruleColor='#e5e7eb',teal='#0f5c58';
const tamil=/[\u0b80-\u0bff]/;
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});

export function pricedBillRows(lines:DraftLine[],language:ReplyLanguage='en'):BillPdfRow[]{
 return lines.map(line=>({
  description:line.name,
  rate:formatMoney(line.pricePaise!),
  quantity:`${line.quantity} ${unitName(line.unit!,language,line.quantity!)}`,
  amount:formatMoney(lineTotal(line.pricePaise!,line.quantity!)),
 }));
}

const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const scales=[[10000000,'crore'],[100000,'lakh'],[1000,'thousand'],[100,'hundred']] as const;
function numberWords(value:number):string{
 if(value<20)return small[value];
 if(value<100)return tens[Math.floor(value/10)]+(value%10?'-'+small[value%10]:'');
 const [scale,word]=scales.find(([scale])=>value>=scale)!;
 const remainder=value%scale;
 return numberWords(Math.floor(value/scale))+' '+word+(remainder?' '+numberWords(remainder):'');
}
function moneyWords(paise:number){
 const rupees=Math.floor(paise/100),remainder=paise%100;
 const words=numberWords(rupees)+(rupees===1?' rupee':' rupees')+
  (remainder?' and '+numberWords(remainder)+(remainder===1?' paisa':' paise'):'')+' only';
 return words[0].toUpperCase()+words.slice(1);
}

export async function renderBillPdf(bill:BillPdf):Promise<Buffer>{
 const doc=new PDFDocument({size:'A4',margin:0,autoFirstPage:false,
  info:{Title:`${bill.title} ${bill.reference}`,CreationDate:bill.issuedAt}});
 doc.registerFont('latin',resolve('resources/fonts/NotoSans-Regular.ttf'));
 doc.registerFont('tamil',resolve('resources/fonts/NotoSansTamil-Regular.ttf'));
 const buffer=new Promise<Buffer>((resolve,reject)=>{
  const chunks:Buffer[]=[];
  doc.on('data',(chunk:Buffer)=>chunks.push(chunk));
  doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.on('error',reject);
 });
 function runs(value:string){return value.match(/[\u0b80-\u0bff]+|[^\u0b80-\u0bff]+/g)??[];}
 function width(value:string,size:number){
  return runs(value).reduce((sum,part)=>sum+doc.font(tamil.test(part)?'tamil':'latin').fontSize(size).widthOfString(part),0);
 }
 function draw(value:string,x:number,y:number,size=10,color=inkColor,align:'left'|'right'='left'){
  let cursor=align==='right'?x-width(value,size):x;
  for(const part of runs(value)){
   doc.font(tamil.test(part)?'tamil':'latin').fontSize(size).fillColor(color).text(part,cursor,y,{lineBreak:false});
   cursor+=width(part,size);
  }
 }
 function wrap(value:string,maxWidth:number,size:number):string[]{
  const rows:string[]=[];
  let row='';
  for(const word of value.trim().split(/\s+/).filter(Boolean)){
   const joined=row?`${row} ${word}`:word;
   if(width(joined,size)<=maxWidth){row=joined;continue;}
   if(row)rows.push(row);
   row='';
   for(const {segment} of segmenter.segment(word)){
    if(row&&width(row+segment,size)>maxWidth){rows.push(row);row='';}
    row+=segment;
   }
  }
  if(row)rows.push(row);
  return rows;
 }
 function fit(value:string,x:number,y:number,maxWidth:number,size=10,color=inkColor,align:'left'|'right'='right'){
  draw(value,x,y,Math.min(size,size*maxWidth/Math.max(1,width(value,size))),color,align);
 }
 function rule(y:number,from=left,to=right,color=ruleColor){
  doc.moveTo(from,y).lineTo(to,y).lineWidth(0.65).strokeColor(color).stroke();
 }
 function label(value:string,x:number,y:number,align:'left'|'right'='left'){draw(value.toUpperCase(),x,y,8,muted,align);}
 const identity=Array.from(segmenter.segment(bill.storeName))[0]?.segment.toUpperCase()||'S';
 const meta=[
  {label:bill.title.toLowerCase().includes('invoice')?'Invoice no.':'Bill no.',value:bill.reference},
  {label:'Date',value:dateFormat.format(bill.issuedAt)},
  {label:bill.orderNumber?'Order no.':'Revision',value:bill.orderNumber??(bill.revision?String(bill.revision):undefined)},
  {label:'Place of supply',value:bill.placeOfSupply},
 ].filter(field=>field.value);
 const blocks=[
  {label:'Sold by',name:bill.storeName,details:[bill.storeAddress,bill.supplierDetail],x:left},
  {label:'Billed to',name:bill.customerName??'Customer',details:[bill.customerDetail],x:306},
 ].map(block=>({...block,nameLines:wrap(block.name,226,11),detailLines:block.details.flatMap(detail=>detail?wrap(detail,226,9):[])}));
 const partyY=199;
 const tableY=Math.max(300,...blocks.map(block=>partyY+54+block.nameLines.length*15+block.detailLines.length*13));
 const bodyY=tableY+23;
 const hsn=bill.rows.some(row=>row.hsn);
 const columns={item:left+24,hsn:285,qty:hsn?381:374,rate:460,amount:right};
 function header(){
  doc.rect(0,0,doc.page.width,3.75).fill(teal);
  doc.roundedRect(left,43,26,26,7).fill(teal);
  fit(identity,left+13+Math.min(16,width(identity,13))/2,48,16,13,'#ffffff');
  fit(bill.storeName,84,43,463,12,inkColor,'left');
  if(bill.storeSubtitle)fit(bill.storeSubtitle,84,61,463,8,muted,'left');
  draw(bill.title,left,110,23);
  if(bill.titleTamil)draw(bill.titleTamil,left+width(bill.title,23)+10,120,9,muted);
  const columnWidth=(right-left)/meta.length;
  meta.forEach((field,index)=>{
   const x=left+index*columnWidth;
   label(field.label,x,155);
   fit(field.value!,x,169,columnWidth-12,10,inkColor,'left');
  });
  for(const block of blocks){
   label(block.label,block.x,partyY);
   block.nameLines.forEach((line,index)=>draw(line,block.x,partyY+14+index*15,11));
   block.detailLines.forEach((line,index)=>draw(line,block.x,partyY+14+block.nameLines.length*15+index*13,9,'#4b5563'));
  }
  label('#',left,tableY);
  label('Item',columns.item,tableY);
  if(hsn)label('HSN',columns.hsn,tableY);
  label('Qty',columns.qty,tableY,'right');
  label('Rate',columns.rate,tableY,'right');
  label(hsn?'Taxable':'Amount',columns.amount,tableY,'right');
  rule(bodyY,left,right,inkColor);
 }
 const rows=bill.rows.map((row,index)=>{
  const description=wrap(row.description,(hsn?columns.hsn:columns.qty-49)-columns.item-10,10);
  const details=row.detail?wrap(row.detail,(hsn?columns.hsn:columns.qty-49)-columns.item-10,8):[];
  const units=wrap(row.quantity,56,9);
  return {...row,index,description,details,units,height:Math.max(40,18+description.length*13+details.length*11,18+units.length*12)};
 });
 const pages:(typeof rows)[]=[[]];
 let used=bodyY;
 for(const row of rows){
  if(pages.at(-1)!.length&&used+row.height>bodyEnd){pages.push([]);used=bodyY;}
  pages.at(-1)!.push(row);
  used+=row.height;
 }
 for(const [index,page] of pages.entries()){
  doc.addPage();
  header();
  let y=bodyY;
  for(const row of page){
   draw(String(row.index+1),left,y+12,9,muted);
   row.description.forEach((line,i)=>draw(line,columns.item,y+11+i*13));
   row.details.forEach((line,i)=>draw(line,columns.item,y+12+row.description.length*13+i*11,8,muted));
   if(hsn&&row.hsn)fit(row.hsn,columns.hsn,y+12,42,9,muted,'left');
   row.units.forEach((line,i)=>draw(line,columns.qty,y+12+i*12,9,inkColor,'right'));
   fit(row.rate,columns.rate,y+11,71);
   fit(row.amount,columns.amount,y+11,77);
   y+=row.height;
   rule(y);
  }
  if(index===pages.length-1){
   const summaryX=322;
   let totalY=y+21;
   label('Amount in words',left,totalY);
   wrap(moneyWords(bill.amountPaise),250,10).forEach((line,i)=>draw(line,left,totalY+15+i*14));
   for(const entry of bill.summary??[]){
    draw(entry.label,summaryX,totalY,10,'#4b5563');
    fit(entry.value,right,totalY,88);
    totalY+=20;
   }
   rule(totalY+6,summaryX,right,inkColor);
   draw(bill.totalLabel,summaryX,totalY+21,11);
   fit(bill.total,right,totalY+15,125,22,teal);
   let noteY=Math.max(735,totalY+50);
   for(const note of bill.notes??[]){
    for(const line of wrap(note,right-left,8)){draw(line,left,noteY,8,muted);noteY+=10;}
   }
   if(bill.paymentInfo){
    label('Pay by UPI',left,739);
    fit(bill.paymentInfo,left,753,245,10,inkColor,'left');
   }
   if(bill.signatory){
    rule(747,407,right,inkColor);
    label('Authorised signatory',right,754,'right');
   }
  }
  const footer=doc.page.height-49;
  rule(footer);
  draw(index===pages.length-1?'நன்றி! மீண்டும் வருக.':bill.reference,left,footer+12,9,muted);
  draw(bill.footerNote??`Page ${index+1} of ${pages.length}`,right,footer+12,8,muted,'right');
 }
 doc.end();
 return buffer;
}
