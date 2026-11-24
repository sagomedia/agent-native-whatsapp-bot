/** Complete, read-only controls only. General paraphrases use view_list in the
 * understanding contract; a mixed edit must still pass normal write validation. */
export function listViewRequest(value:string):boolean {
 let text=value.normalize('NFKC').toLowerCase().replace(/[.,!?;:，।]/gu,' ').replace(/\s+/g,' ').trim();
 text=text.replace(/^(?:no|illa|illai|இல்ல|இல்லை)\s+/u,'');
 text=text.replace(/^(?:(?:don't|do not) (?:change|edit|remove) (?:anything|my list|the list)|(?:ஒன்னும்|எதுவும்) (?:மாத்த|மாற்ற) (?:வேணாம்|வேண்டாம்)|(?:onnum|ethuvum) (?:maatha|maaththa|maatra) (?:venam|venaam|vendam|vendaam))\s+/u,'');
 if(/^(?:(?:please|can you|could you|i want to|i would like to|let me|just|first)\s+)*(?:(?:show|display|view|see|look at)(?:\s+me)?|bring up)\s+(?:(?:my|the|our|current|saved|shopping|product)\s+)*(?:list|cart|products|items|photos|pictures)(?:\s+(?:first|please|again|now))?$/u.test(text))return true;
 if(/^(?:(?:முதலில்|முதல்ல|பர்ஸ்ட்|இப்போ|சும்மா)\s+)*(?:(?:என்|எனது|இந்த|இப்போதைய|உள்ள)\s+)*(?:பட்டியல்|பட்டியலை|பட்டியலைக்|லிஸ்ட்|லிஸ்ட்ட|லிஸ்ட்டை|பொருள்|பொருளை|பொருளைக்|பொருட்கள்|பொருட்களை|பொருட்களைக்|படங்கள்|படங்களை|போட்டோ)(?:\s+(?:முதலில்|முதல்ல))?\s+(?:காட்டு|காட்டுங்க|காட்டுங்கள்|காமி|காமிங்க|காமிங்கண்ணா|பார்க்கணும்|பார்க்க வேண்டும்)$/u.test(text))return true;
 return /^(?:(?:first|mudhala|muthalla|ippo|just)\s+)*(?:(?:en|enna|current|saved)\s+)*(?:list(?:-?[at])?|cart|porul(?:ai)?|porutkal(?:ai)?|products|photos)(?:\s+(?:first|mudhala))?\s+(?:kaatu|kaattu|kaami|kami|kaamiga|kaaminga|kaatunga|kaattunga|paaru|paakanum|paarkkanum)$/u.test(text);
}
