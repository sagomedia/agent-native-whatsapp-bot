export type ActivityChange={field:string;before:unknown;after:unknown};
export type ActivitySummaryItem={action?:string;historical?:boolean;changes?:ActivityChange[]|null;patch?:{aliases:{add:string[];remove:string[]};keywords:{add:string[];remove:string[]}}};
type Locale='en'|'ta';
const fields:Record<string,[string,string]>={name:['product name','பொருள் பெயர்'],price_paise:['price','விலை'],stock:['stock','இருப்பு'],reserved_stock:['reserved stock','ஒதுக்கிய இருப்பு'],image_path:['product photo','பொருள் படம்'],active:['shop visibility','கடையில் காண்பிக்கும் நிலை'],merchant_verification:['verification details','சரிபார்ப்பு விவரங்கள்'],selling_policy:['selling details','விற்பனை விவரங்கள்'],aliases:['customer names','வாடிக்கையாளர்கள் சொல்லும் பெயர்கள்'],keywords:['search words','தேடும் சொற்கள்']};
const list=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):[];
const quote=(v:string[])=>v.slice(0,2).map(x=>'“'+x+'”').join(', ')+(v.length>2?` +${v.length-2}`:'');
export function activitySummary(item:ActivitySummaryItem,locale:Locale,review=false):string[]{
 const ta=locale==='ta';
 if(item.historical){if(item.action==='add_product')return [ta?'இந்தப் பொருளைச் சேர்த்தேன். முந்தைய விவரங்கள் இல்லை.':'I added this product. Earlier details are unavailable.'];return [ta?'ஒரு பழைய செயல் பதிவாகியுள்ளது; மாற்ற விவரங்கள் இல்லை.':'An earlier action was recorded; its change details are unavailable.'];}
 if(!review&&item.action==='add_product')return [ta?'இந்தப் பொருளைச் சேர்த்தேன்.':'I added this product.'];
 const lines:string[]=[];
 const delta=(field:'aliases'|'keywords',add:string[],remove:string[])=>{
  if(add.length)lines.push(review?(ta?(field==='aliases'?`இந்தப் பொருளுக்கு ${quote(add)}ன்னு இன்னொரு பெயர் சேர்க்கலாம்.`:`தேடும் சொற்களில் ${quote(add)} சேர்க்கலாம்.`):(field==='aliases'?`Add ${quote(add)} as another name for this product.`:`Add ${quote(add)} to the search words.`)):(ta?(field==='aliases'?`இந்தப் பொருளுக்கு ${quote(add)}ன்னு இன்னொரு பெயர் சேர்த்தேன்.`:`தேடும் சொற்களில் ${quote(add)} சேர்த்தேன்.`):(field==='aliases'?`I added ${quote(add)} as another name for this product.`:`I added ${quote(add)} to the search words.`)));
  if(remove.length)lines.push(review?(ta?(field==='aliases'?`பொருளின் பெயர்களில் ${quote(remove)} நீக்கலாம்.`:`தேடும் சொற்களில் ${quote(remove)} நீக்கலாம்.`):(field==='aliases'?`Remove ${quote(remove)} from this product's names.`:`Remove ${quote(remove)} from the search words.`)):(ta?(field==='aliases'?`இந்தப் பொருளின் பெயர்களில் ${quote(remove)} நீக்கினேன்.`:`தேடும் சொற்களில் ${quote(remove)} நீக்கினேன்.`):(field==='aliases'?`I removed ${quote(remove)} from this product's names.`:`I removed ${quote(remove)} from the search words.`)));
 };
 if(review&&item.patch){for(const f of ['aliases','keywords'] as const){const p=item.patch[f];if(p)delta(f,p.add??[],p.remove??[]);}}
 else for(const change of item.changes??[]){
  if(change.field==='aliases'||change.field==='keywords'){
   if(Array.isArray(change.before)&&Array.isArray(change.after)){const before=list(change.before),after=list(change.after);delta(change.field,after.filter(x=>!before.includes(x)),before.filter(x=>!after.includes(x)));}else lines.push(ta?'தேடல் விவரங்களை மாற்றினேன். முழு விவரங்களைப் பாருங்கள்.':'I updated search details. See the full details.');continue;
  }
  if(change.field==='active'&&typeof change.after==='boolean'){lines.push(ta?(change.after?'கடையில் இந்தப் பொருளைக் காட்டினேன்.':'கடையில் இந்தப் பொருளை மறைத்தேன்.'):(change.after?'Made this product visible in the shop.':'Hid this product from the shop.'));continue;}
  if(['name','price_paise','stock'].includes(change.field) && change.before!==null && change.before!==undefined && change.after!==null && change.after!==undefined && ['string','number'].includes(typeof change.before) && ['string','number'].includes(typeof change.after)){
   const format=(v:unknown)=>change.field==='price_paise'&&typeof v==='number'?new Intl.NumberFormat(ta?'ta-IN':'en-IN',{style:'currency',currency:'INR'}).format(v/100):typeof v==='number'?new Intl.NumberFormat(ta?'ta-IN':'en-IN').format(v):String(v);
   const label=fields[change.field][ta?1:0];lines.push(ta?`${label}: ${format(change.before)} → ${format(change.after)} என மாற்றினேன்.`:`I changed the ${label} from ${format(change.before)} to ${format(change.after)}.`);continue;
  }
  const label=fields[change.field];if(label)lines.push(ta?`${label[1]} மாற்றினேன்.`:`I changed the ${label[0]}.`);
 }
 if(review&&!lines.length)return [ta?'பொருளைப் பற்றி ஒரு பரிந்துரை உள்ளது. முழு விவரங்களைப் பாருங்கள்.':'There is a suggestion about this product. See the full details.'];
 if(!lines.length){const action=({stock:['I updated the stock.','இருப்பை மாற்றினேன்.'],visibility:['I changed shop visibility.','கடையில் காண்பிக்கும் நிலையை மாற்றினேன்.'],commit:['I updated product details. See the full details.','பொருள் விவரங்களை மாற்றினேன். முழு விவரங்களைப் பாருங்கள்.'],audit_undo:['I restored earlier search details.','முந்தைய தேடல் விவரங்களை மீட்டேன்.']} as Record<string,[string,string]>)[item.action??''];lines.push(action? action[ta?1:0]:(ta?'பொருள் விவரத்தில் ஒரு மாற்றம் பதிவாகியுள்ளது.':'A product change was recorded.'));}
 if(review)lines[0]=(ta?'பரிந்துரை: ':'Suggested: ')+lines[0];
 if(lines.length>2)return [lines[0],ta?`மேலும் ${lines.length-1} மாற்றங்கள் உள்ளன. விவரங்களைப் பாருங்கள்.`:`${lines.length-1} more change${lines.length===2?'':'s'}; see details.`];
 return lines;
}
