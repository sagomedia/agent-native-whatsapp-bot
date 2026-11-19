import PDFDocument from 'pdfkit';
import {resolve} from 'node:path';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {unitName} from '../../../../packages/contracts/language.js';
import type {DraftLine} from '../../../../packages/contracts/index.js';
import type {ReplyLanguage} from '../../../../packages/contracts/language.js';

export type BillPdfRow={description:string;detail?:string;rate:string;quantity:string;amount:string};
export type BillPdf={
 title:string;reference:string;issuedAt:Date;revision?:number;
 storeName:string;storeAddress?:string;customerName?:string;
 supplierDetail?:string;customerDetail?:string;rows:BillPdfRow[];
 totalLabel:string;total:string;summary?:{label:string;value:string}[];notes?:string[];
};
const dateFormat=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
const margin=42,right=553,bodyEnd=620;
const tamil=/[\u0b80-\u0bff]/;

export function pricedBillRows(lines:DraftLine[],language:ReplyLanguage='en'):BillPdfRow[]{
 return lines.map(line=>({
  description:line.name,
  rate:formatMoney(line.pricePaise!),
  quantity:`${line.quantity} ${unitName(line.unit!,language,line.quantity!)}`,
  amount:formatMoney(lineTotal(line.pricePaise!,line.quantity!)),
 }));
}

export async function renderBillPdf(bill:BillPdf):Promise<Buffer>{
 const doc=new PDFDocument({size:'A4',margin:0,autoFirstPage:false,
  info:{Title:`${bill.title} ${bill.reference}`,CreationDate:bill.issuedAt}});
 doc.registerFont('latin',resolve('resources/fonts/NotoSans-Regular.ttf'));
 doc.registerFont('tamil',resolve('resources/fonts/NotoSansTamil-Regular.ttf'));
 const buffer=new Promise<Buffer>((resolve,reject)=>{
  const chunks:Buffer[]=[];
  doc.on('data',(chunk:Buffer)=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 });
 function runs(value:string){return value.match(/[\u0b80-\u0bff]+|[^\u0b80-\u0bff]+/g)??[];}
 function width(value:string,size:number){
  return runs(value).reduce((sum,part)=>sum+doc.font(tamil.test(part)?'tamil':'latin').fontSize(size).widthOfString(part),0);
 }
 function ink(value:string,x:number,y:number,size=10,color='#141414',align:'left'|'right'='left'){
  let cursor=align==='right'?x-width(value,size):x;
  for(const part of runs(value)){
   const font=tamil.test(part)?'tamil':'latin';
   doc.font(font).fontSize(size).fillColor(color).text(part,cursor,y,{lineBreak:false});
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
   for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word)){
    if(row&&width(row+segment,size)>maxWidth){rows.push(row);row='';}
    row+=segment;
   }
  }
  if(row)rows.push(row);
  return rows;
 }
 function fitted(value:string,x:number,y:number,maxWidth:number,size=10){
  ink(value,x,y,Math.min(size,size*maxWidth/Math.max(1,width(value,size))),'#141414','right');
 }
 function rule(y:number,color='#c3c3c3'){doc.moveTo(margin,y).lineTo(right,y).lineWidth(0.55).strokeColor(color).stroke();}
 const blocks=[
  {label:'BILL FROM',name:bill.storeName,detail:[bill.storeAddress,bill.supplierDetail],x:margin+9},
  {label:'BILL TO',name:bill.customerName??'Customer',detail:[bill.customerDetail],x:221},
  {label:'ISSUE DATE',name:dateFormat.format(bill.issuedAt),detail:[bill.revision?`Bill revision ${bill.revision}`:undefined],x:391},
 ].map(block=>({...block,nameLines:wrap(block.name,145,11),detailLines:block.detail.flatMap(detail=>detail?wrap(detail,147,9):[])}));
 const blockEnd=Math.max(222,...blocks.map(block=>169+block.nameLines.length*14+block.detailLines.length*11));
 const tableTop=blockEnd+16,bodyTop=blockEnd+43;
 function header(){
  ink(bill.title,margin,44,25);
  ink(bill.reference,margin,80,10);
  doc.rect(401,43,152,49).fill('#f4f4f4');
  fitted(bill.storeName,right-12,59,128,12);
  rule(124);rule(blockEnd);
  for(const x of [212,382])doc.moveTo(x,124).lineTo(x,blockEnd).lineWidth(0.55).strokeColor('#c3c3c3').stroke();
  for(const block of blocks){
   ink(block.label,block.x,141,8,'#565656');
   block.nameLines.forEach((line,i)=>ink(line,block.x,156+i*14,11));
   block.detailLines.forEach((line,i)=>ink(line,block.x,158+block.nameLines.length*14+i*11,9,'#424242'));
  }
  ink('Description',margin+9,tableTop,9);
  ink('Price each',411,tableTop,9,'#141414','right');
  ink('Qty',476,tableTop,9,'#141414','right');
  ink('Amount',right-9,tableTop,9,'#141414','right');
  rule(bodyTop,'#9b9b9b');
 }
 const rows=bill.rows.map(row=>{
  const title=wrap(row.description,270,10);
  const details=row.detail?wrap(row.detail,270,8):[];
  const units=wrap(row.quantity,54,9);
  return {...row,title,details,units,height:Math.max(31,15+title.length*13+details.length*11,15+units.length*12)};
 });
 const pages:[typeof rows,number][]=[[[],bodyTop]];
 for(const row of rows){
  let page=pages.at(-1)!;
  if(page[0].length&&page[1]+row.height>bodyEnd){
   page=[[],bodyTop];pages.push(page);
  }
  page[0].push(row);page[1]+=row.height;
 }
 for(const [index,[page]] of pages.entries()){
  doc.addPage();
  header();
  let y=bodyTop;
  for(const row of page){
   row.title.forEach((line,i)=>ink(line,margin+9,y+8+i*13));
   row.details.forEach((line,i)=>ink(line,margin+9,y+9+row.title.length*13+i*11,8,'#555555'));
   fitted(row.rate,411,y+8,78);
   row.units.forEach((line,i)=>ink(line,476,y+8+i*12,9,'#141414','right'));
   fitted(row.amount,right-9,y+8,65);
   y+=row.height;rule(y);
  }
  if(index===pages.length-1){
   let totalY=y+20;
   for(const entry of bill.summary??[]){
    ink(entry.label,361,totalY,9);fitted(entry.value,right-9,totalY,76,9);totalY+=19;
   }
   if(bill.total){
    doc.moveTo(354,totalY).lineTo(right,totalY).lineWidth(0.8).strokeColor('#171717').stroke();
    ink(bill.totalLabel,361,totalY+12,11);
    fitted(bill.total,right-9,totalY+11,90,14);
   }
   let noteY=Math.max(685,totalY+44);
   for(const note of bill.notes??[]){
    for(const line of wrap(note,right-margin-18,8)){ink(line,margin+9,noteY,8,'#444444');noteY+=11;}
   }
  }
  doc.rect(0,doc.page.height-44,doc.page.width,44).fill('#f1f1f1');
  ink(bill.reference,margin,doc.page.height-29,8,'#444444');
  ink(`Page ${index+1} of ${pages.length}`,right,doc.page.height-29,8,'#444444','right');
 }
 doc.end();
 return buffer;
}
