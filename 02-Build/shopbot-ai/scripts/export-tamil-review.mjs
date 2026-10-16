// Development-only inventory of Tamil literals, including inline replies that
// are not in the shared copy table. Never reads customer data or environment.
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{parse}=require('@babel/parser');
const root=process.cwd(),out=resolve(root,'../../03-Output/customer-ordering-finish'),entries=[];
try{
 const [review,manifest]=await Promise.all([stat(out+'/TAMIL-ALL-DETERMINISTIC-COPY.md'),stat(out+'/TAMIL-COPY-SOURCE.json')]);
 if(review.mtimeMs>manifest.mtimeMs+10)throw new Error('The review document has been edited. Preserve those edits before refreshing its source inventory.');
}catch(error){if(error.code!=='ENOENT')throw error;}
const tamil=/[\u0b80-\u0bff]/;
async function visit(directory){
 for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){
  const name=directory+'/'+entry.name;
  if(entry.isDirectory())await visit(name);
  else if(/\.(?:ts|tsx)$/.test(name)){
   const source=await readFile(resolve(root,name),'utf8'),ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']});
   const seen=new Map();
   function walk(node,parent){
    if(!node||typeof node!=='object')return;
    const literal=node.type==='StringLiteral'?node.value:node.type==='TemplateLiteral'&&node.quasis.some(q=>tamil.test(q.value.raw))?source.slice(node.start+1,node.end-1):undefined;
    if(typeof literal==='string'&&tamil.test(literal)){
     const inputAlias=name==='packages/contracts/catalog-text.ts'||parent?.type==='ObjectProperty'&&parent.key===node;
     const section=name.includes('/adapters/')?'Model instructions and interpretation references':inputAlias?'Customer input phrases and aliases':'Fixed replies, labels and message templates';
     const key=section+'\0'+literal;
     if(seen.has(key))seen.get(key).lines.push(node.loc.start.line);
     else{const row={id:'TA-'+createHash('sha256').update(name+'\0'+key).digest('hex').slice(0,10).toUpperCase(),section,file:name,lines:[node.loc.start.line],text:literal,raw:source.slice(node.start,node.end)};seen.set(key,row);entries.push(row);}
    }
    for(const [key,value] of Object.entries(node)){
     if(['loc','start','end','extra','comments','leadingComments','trailingComments','innerComments'].includes(key))continue;
     if(Array.isArray(value))for(const child of value)walk(child,node);
     else if(value&&typeof value==='object')walk(value,node);
    }
   }
   walk(ast,null);
  }
 }
}
await visit('apps/server/src');await visit('packages/contracts');
entries.sort((a,b)=>a.section.localeCompare(b.section)||a.file.localeCompare(b.file)||a.lines[0]-b.lines[0]);
const sections=['Fixed replies, labels and message templates','Customer input phrases and aliases','Model instructions and interpretation references'];
let doc=`# Tamil copy — complete backend review\n\nGenerated from the actual TypeScript source, including inline messages outside the central copy table. ${entries.length} unique Tamil literals/templates are listed with every source location. Customer recordings, messages and catalog rows are not read.\n\nReview the first section for customer-facing wording. Add your preferred wording beneath **Your replacement**; keep the ID and placeholders such as {amount}, {name}, and JavaScript template expressions unchanged. Repeated wording in different modules has separate IDs so all call sites can be updated.\n\nThe second section contains accepted customer phrases/aliases. The last section is model guidance and interpretation references; these are not fixed bot replies. Regular-expression patterns are code rather than fixed messages and are not in the wording list.\n\nThe deterministic checkout is: product photos → approve shown products → estimated invoice (unknown prices excluded) → send order to shop → optional demo QR offer → pay at shop OR genuine receipt verification → owner confirmation / packing / ready / collected. Human help is a separate explicit request.\n`;
for(const section of sections){
 const rows=entries.filter(e=>e.section===section);doc+=`\n## ${section} (${rows.length})\n`;
 let file='';
 for(const row of rows){
  if(file!==row.file){file=row.file;doc+=`\n### ${file}\n`;}
  const locations=row.lines.map(line=>`[line ${line}](${resolve(root,row.file)}:${line})`).join(', ');
  doc+=`\n#### ${row.id}\n\nSource: ${locations}\n\n**Current wording**\n\n\`\`\`text\n${row.text}\n\`\`\`\n\n**Your replacement**\n\n_Leave blank to keep the current wording._\n`;
 }
}
await mkdir(out,{recursive:true});
await writeFile(out+'/TAMIL-ALL-DETERMINISTIC-COPY.md',doc);
await writeFile(out+'/TAMIL-COPY-SOURCE.json',JSON.stringify({version:1,sourceRoots:['apps/server/src','packages/contracts'],entries},null,2)+'\n');
console.log(JSON.stringify({entries:entries.length,sections:Object.fromEntries(sections.map(s=>[s,entries.filter(e=>e.section===s).length])),review:out+'/TAMIL-ALL-DETERMINISTIC-COPY.md'}));
