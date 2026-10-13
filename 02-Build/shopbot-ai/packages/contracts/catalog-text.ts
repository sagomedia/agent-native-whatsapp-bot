import {normalizeFractionNumbers} from './measurements.js';
export function normalize(text: string): string {
  return normalizeFractionNumbers(text.toLowerCase()).replace(/half[- ]inch/g, '0.5 inch').replace(/one[- ]inch/g, '1 inch').replace(/ten[- ]inch/g, '10 inch').normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}.]+/gu,' ').trim()
    .replace(/தண்ணீர்\s+(?:ஊற்ற|ஊத்துற|ஊற்றும்)\s+(?:ஓஸ்|ஹோஸ்)/gu,'garden hose')
    .replace(/பெயிண்ட்\s+(?:எடுக்கிற\s+|சுரண்டும்\s+)?கத்தி/gu,'scraper')
    .replace(/உப்பு(?:த்)?\s+(?:தாள்|தாளு)(?=\s|$)/gu,'sandpaper')
    .replace(/\b(?:water|watering) hose\b/g,'garden hose').replace(/\bpaint scraper\b/g,'scraper').replace(/\b(?:teflon|teplon) tape\b/g,'ptfe tape');
}
export function tokens(text: string) { return normalize(text).split(/\s+/).filter(t => t && !['the','a','an','of','inch','inches','some'].includes(t)).map(t => t==='boxes'?'box':/^[a-z]+s$/.test(t) ? t.slice(0,-1) : t); }
export function oneEdit(a:string,b:string) {
  if(a===b)return true;if(a.length<4||b.length<4||!/^[a-z]+$/.test(a+b)||Math.abs(a.length-b.length)>1)return false;
  // A single edit or adjacent transposition. Numeric specifications are never fuzzy.
  if(a.length===b.length){const d=[...a].map((c,i)=>c===b[i]?-1:i).filter(i=>i>=0);return d.length===1||(d.length===2&&d[1]===d[0]+1&&a[d[0]]===b[d[1]]&&a[d[1]]===b[d[0]]);}
  const longer=a.length>b.length?a:b,shorter=a.length>b.length?b:a;let i=0;while(i<shorter.length&&longer[i]===shorter[i])i++;return longer.slice(i+1)===shorter.slice(i);
}
