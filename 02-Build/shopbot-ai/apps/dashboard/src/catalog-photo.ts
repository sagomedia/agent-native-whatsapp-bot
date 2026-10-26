/** Product photos only: customer handwriting/list images use their own pipeline. */
export const CATALOG_PHOTO_INPUT_BYTES=10*1024*1024;
export const CATALOG_PHOTO_SAVED_BYTES=500*1024;
export const CATALOG_PHOTO_HELP='JPG, PNG or WebP up to 10 MB. Photos are automatically optimized.';
export type PreparedCatalogPhoto={mimeType:'image/jpeg';data:string;preview:string;bytes:number;width:number;height:number};
// Read dimensions before allocating a decoded camera bitmap. MIME/extension are hints only.
export function catalogPhotoDimensions(bytes:Uint8Array):{width:number;height:number}|undefined{
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(a:number,b:number)=>String.fromCharCode(...bytes.slice(a,b));
 if(bytes.length>=24&&bytes[0]===137&&ascii(1,4)==='PNG')return {width:v.getUint32(16),height:v.getUint32(20)};
 if(bytes[0]===255&&bytes[1]===216){
  let i=2;while(i+8<bytes.length){if(bytes[i++]!==255)break;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===0xda||marker===0xd9)break;if(marker===1||marker>=0xd0&&marker<=0xd7)continue;const length=v.getUint16(i);if(length<2||i+length>bytes.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:v.getUint16(i+3),width:v.getUint16(i+5)};i+=length;}
 }
 if(bytes.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'){
  const kind=ascii(12,16),le24=(i:number)=>bytes[i]+bytes[i+1]*256+bytes[i+2]*65536;
  if(kind==='VP8X')return {width:1+le24(24),height:1+le24(27)};
  if(kind==='VP8 '&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a)return {width:v.getUint16(26,true)&0x3fff,height:v.getUint16(28,true)&0x3fff};
  if(kind==='VP8L'&&bytes[20]===0x2f)return {width:1+((bytes[21]|bytes[22]<<8)&0x3fff),height:1+((bytes[22]>>6|bytes[23]<<2|bytes[24]<<10)&0x3fff)};
 }
}
function rotatedJpeg(bytes:Uint8Array):boolean{
 if(bytes[0]!==255||bytes[1]!==216)return false;
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let i=2;
 while(i+4<bytes.length){if(bytes[i++]!==255)break;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===0xda||marker===0xd9)break;const length=v.getUint16(i);if(length<2||i+length>bytes.length)break;
  if(marker===0xe1&&length>=16&&String.fromCharCode(...bytes.slice(i+2,i+8))==='Exif\0\0'){
   const base=i+8,little=v.getUint16(base)===0x4949;if(!little&&v.getUint16(base)!==0x4d4d)return false;const end=i+length,dir=base+v.getUint32(base+4,little);if(dir<base||dir+2>end)return false;
   const count=v.getUint16(dir,little);for(let j=0;j<count;j++){const entry=dir+2+j*12;if(entry+12>end)break;if(v.getUint16(entry,little)===0x112&&v.getUint16(entry+2,little)===3&&v.getUint32(entry+4,little)===1)return v.getUint16(entry+8,little)>=5&&v.getUint16(entry+8,little)<=8;}
  }i+=length;
 }return false;
}
function checkDimensions(width:number,height:number){if(!width||!height||width>16384||height>16384||width*height>64000000)throw new Error('This photo has too many pixels. Choose normal camera mode or export a smaller copy (up to 64 megapixels).');}
export async function prepareCatalogPhoto(file:File):Promise<PreparedCatalogPhoto>{
 if(!file.size)throw new Error('This photo is empty. Choose the original image again.');
 if(file.size>CATALOG_PHOTO_INPUT_BYTES)throw new Error('Choose a photo up to 10 MB. Use normal camera mode instead of RAW or full resolution.');
 const head=new Uint8Array(await file.slice(0,256*1024).arrayBuffer());
 const ascii=(start:number,end:number)=>String.fromCharCode(...head.slice(start,end));
 const mime=head[0]===255&&head[1]===216&&head[2]===255?'image/jpeg':head[0]===137&&ascii(1,4)==='PNG'?'image/png':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'image/webp':null;
 if(!mime){const heif=ascii(4,8)==='ftyp'||/\.(heic|heif|avif|dng|raw)$/i.test(file.name);throw new Error(heif?'This photo format cannot be optimized here. Export it as JPG, or set the camera to JPG/Most compatible, then choose it again.':'Choose an actual JPG, PNG or WebP photo. Renaming another file does not convert it.');}
 // Supply the detected type: Android file pickers sometimes omit/mislabel it.
 const dimensions=catalogPhotoDimensions(head);if(dimensions)checkDimensions(dimensions.width,dimensions.height);
 const source=new Blob([file],{type:mime}),url=URL.createObjectURL(source),img=new Image();
 let canvas:HTMLCanvasElement|undefined,bitmap:ImageBitmap|undefined;
 try{
  // Decode at a smaller size when supported, reducing phone memory pressure.
  if(dimensions&&typeof createImageBitmap==='function')try{bitmap=await createImageBitmap(source,{imageOrientation:'from-image',resizeWidth:Math.min(1280,rotatedJpeg(head)?dimensions.height:dimensions.width),resizeQuality:'high'});}catch{/* Older browsers fall back to the oriented image decoder below. */}
  if(!bitmap)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{img.src='';reject(new Error('The phone could not open this photo in time. Try a smaller JPG or normal camera mode.'));},20000);img.onload=()=>{clearTimeout(timer);resolve();};img.onerror=()=>{clearTimeout(timer);reject(new Error('This photo could not be opened. Download the original to your phone, or export it as JPG and retry.'));};img.src=url;});
  const drawable=bitmap??img,width=bitmap?.width??img.naturalWidth,height=bitmap?.height??img.naturalHeight;checkDimensions(width,height);
  canvas=document.createElement('canvas');const context=canvas.getContext('2d');if(!context)throw new Error('Photo optimization is unavailable in this browser. Try Chrome or export a smaller JPG.');
  let side=1280,encoded:Blob|null=null;
  // Bound quality/dimensions together, preserving proportions without cropping/upscaling.
  for(let step=0;step<4;step++){
   const ratio=Math.min(1,side/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
   context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(drawable,0,0,canvas.width,canvas.height);
   for(const quality of [.84,.76,.68]){encoded=await new Promise<Blob|null>(resolve=>canvas!.toBlob(resolve,'image/jpeg',quality));if(!encoded||encoded.type!=='image/jpeg')throw new Error('The browser could not create a JPG photo. Try another browser.');if(encoded.size<=CATALOG_PHOTO_SAVED_BYTES)break;}
   if(encoded!.size<=CATALOG_PHOTO_SAVED_BYTES)break;side=Math.round(side*.8);
  }
  if(!encoded||encoded.size>CATALOG_PHOTO_SAVED_BYTES)throw new Error('This photo could not be made small enough. Export a smaller JPG and retry.');
  const preview=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read the optimized photo. Choose it again.'));reader.readAsDataURL(encoded!);});
  return {mimeType:'image/jpeg',data:preview.split(',')[1],preview,bytes:encoded.size,width:canvas.width,height:canvas.height};
 }finally{bitmap?.close();URL.revokeObjectURL(url);img.onload=null;img.onerror=null;img.src='';if(canvas){canvas.width=1;canvas.height=1;}}
}
