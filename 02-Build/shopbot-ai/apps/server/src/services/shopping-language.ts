// Small explicit language shortcuts save model calls and bind read-only intent.
// They do not infer SKU, size, packaging conversions, or compound shopping edits.
const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,twenty:20,half:0.5,'ஒன்று':1,'ஒரு':1,'ஒன்னு':1,'இரண்டு':2,'ரெண்டு':2,'மூன்று':3,'நான்கு':4,'நாலு':4,'ஐந்து':5,'அஞ்சு':5,'ஆறு':6,'ஏழு':7,'எட்டு':8,'ஒன்பது':9,'பத்து':10,'அரை':0.5,onnu:1,oru:1,ondru:1,rendu:2,irandu:2,moonu:3,moondru:3,naalu:4,naangu:4,anju:5,ainthu:5,aaru:6,ezhu:7,ettu:8,onbathu:9,paththu:10,pathu:10,arai:0.5};
export function quantityReply(text:string):{quantity:number;unit?:string}|undefined {
  const m=/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|half|ஒன்று|ஒரு|ஒன்னு|இரண்டு|ரெண்டு|மூன்று|நான்கு|நாலு|ஐந்து|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து|அரை|onnu|oru|ondru|rendu|irandu|moonu|moondru|naalu|naangu|anju|ainthu|aaru|ezhu|ettu|onbathu|paththu|pathu|arai)(?:\s+(pieces?|pcs|boxes?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?|bottles?|litres?|liters?|units?|nos|எண்ணம்|பீஸ்|பெட்டி|பெட்டிகள்|பாக்ஸ்|பாட்டில்|பாட்டில்கள்|ரோல்|ரோல்கள்|அடி|மீட்டர்|கிலோ|ஜோடி|பேக்|லிட்டர்|ennam|petti|pettigal|adi|jodi|kilo))?(?:\s+(?:please|வேண்டும்|வேணும்|venum))?[.!?]*$/i.exec(text.trim());
  return m?{quantity:numbers[m[1].toLowerCase()]??Number(m[1]),...(m[2]?{unit:m[2].toLowerCase()}:{})}:undefined;
}
export function priceInquiry(text:string):{query:string;quantity?:number;requestedUnit?:string}|undefined {
  const s=text.toLowerCase().trim().replace(/[.!?]+$/,'');
  if(/வேண்டும்|வேணும்|சேர்|நீக்கு|மாற்று|\b(?:venum|seru|neekku|maathu)\b/.test(s))return;
  const native=/^(.+?)\s+(?:விலை(?: என்ன| எவ்வளவு)?|என்ன விலை|எவ்வளவு|vilai(?: enna)?|evlo|price enna)$/.exec(s);
  if(native)return {query:native[1]};
  if(/\b(?:add|remove|change|set|place order|i need|i want|i will take|i'll take)\b/.test(s)||/delivery|shipping|discount|trade (?:price|rate)|plumber rate|best price/.test(s))return;
  const lead=/^(?:(?:what is the |what's the |what is |what's )?(?:price|cost)(?: of| for)?\s+|how much (?:is |are |for |does )?)/.exec(s);
  if(!lead)return;
  let query=s.slice(lead[0].length).trim();if(!query)return;
  let quantity:number|undefined,requestedUnit:string|undefined;
  const amount=/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|half|ஒன்று|ஒரு|ஒன்னு|இரண்டு|ரெண்டு|மூன்று|நான்கு|நாலு|ஐந்து|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து|அரை|onnu|oru|ondru|rendu|irandu|moonu|moondru|naalu|naangu|anju|ainthu|aaru|ezhu|ettu|onbathu|paththu|pathu|arai)\s+(.+)$/.exec(query);
  // A leading size such as 1 inch/25 mm is part of the specification.
  if(amount&&!/^(?:inch(?:es)?|in\b|mm\b|cm\b)/.test(amount[2])) {quantity=numbers[amount[1]]??Number(amount[1]);query=amount[2];}
  const unit=/^(pieces?|pcs|boxes?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)\s+(?:of\s+)?(.+)$/.exec(query);
  if(unit){requestedUnit=unit[1];query=unit[2]+(/^box/.test(unit[1])?' box':'');}
  else {const tail=/\s+(pieces?|pcs|boxes?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)$/.exec(query);if(tail){requestedUnit=tail[1];if(!/^box/.test(tail[1]))query=query.slice(0,-tail[0].length);}}
  return {query,...(quantity!==undefined?{quantity}:{}),...(requestedUnit?{requestedUnit}:{})};
}
