import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {BlockList,isIP} from 'node:net';
import {z} from 'zod';
import {chatError} from './catalog-chat.js';
export const catalogFileSchema=z.object({download_url:z.url().max(4000),file_id:z.string().min(1).max(200),mime_type:z.string().max(100).optional(),file_name:z.string().max(200).optional()}).strict();
const block=new BlockList();
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)block.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['100::',64],['2001:db8::',32]] as const)block.addSubnet(ip,prefix,'ipv6');
export function publicFileAddress(ip:string){const kind=isIP(ip);return !!kind&&(kind!==6||/^[23]/.test(ip))&&!ip.toLowerCase().startsWith('::ffff:')&&!block.check(ip,kind===4?'ipv4':'ipv6');}
export function catalogFileUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!(u.hostname==='files.oaiusercontent.com'||u.hostname.endsWith('.oaiusercontent.com')))throw chatError('unsupported_file_handoff','The host did not provide a supported HTTPS attachment URL. Read the actual file and send photo: {id, mimeType, data: raw Base64}; a local /mnt/data path is not accessible to this server. Keep the product facts in chat and retry the same add operation.',400);return u;}
export async function downloadCatalogPhoto(value:string):Promise<{mimeType:'image/jpeg'|'image/png'|'image/webp';data:string}>{
 const url=catalogFileUrl(value),addresses=await lookup(url.hostname,{all:true});
 if(!addresses.length||addresses.some(a=>!publicFileAddress(a.address)))throw chatError('invalid_file_host','The image host must resolve to a public address.',400);
 const selected=addresses[0];
 return new Promise((resolve,reject)=>{
  const req=request(url,{lookup:((_host:any,opts:any,cb:any)=>opts?.all?cb(null,[selected]):cb(null,selected.address,selected.family)) as any},res=>{
   const mime=String(res.headers['content-type']??'').split(';')[0];
   if(res.statusCode!==200||!['image/jpeg','image/png','image/webp'].includes(mime)||Number(res.headers['content-length']??0)>2097152){res.destroy();reject(chatError('invalid_photo','Use a direct JPG, PNG or WebP file under 2 MB; redirects are not followed.',400));return;}
   const chunks:Buffer[]=[];let count=0;
   res.on('data',(b:Buffer)=>{count+=b.length;if(count>2097152){res.destroy(new Error('Photo too large'));return;}chunks.push(b);});
   res.on('end',()=>resolve({mimeType:mime as 'image/jpeg'|'image/png'|'image/webp',data:Buffer.concat(chunks).toString('base64')}));
   res.on('error',()=>reject(chatError('file_download_failed','Photo transfer failed. Obtain a fresh host download URL or send actual Base64 photo bytes, then retry the same operation.',400)));
  });
  const deadline=setTimeout(()=>req.destroy(),10000);req.on('close',()=>clearTimeout(deadline));req.on('error',()=>reject(chatError('file_download_failed','Photo transfer failed. Obtain a fresh host download URL or send actual Base64 photo bytes, then retry the same operation.',400)));req.end();
 });
}
