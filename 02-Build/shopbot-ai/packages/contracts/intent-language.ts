// Shared evidence vocabulary. These patterns recognize wording; they do not
// authorize a cart mutation, pick a target, or bypass a current confirmation.
export const additionalMention = /(?:மேலும்|இன்னும்|இன்னம்|கூடுதலா|எக்ஸ்ட்ரா|\b(?:extra|additional|more|innum|innam|kooduthal(?:a)?|melum)\b)/i;
export const currentItemMention = /(?:இந்த|அந்த|இதை|அதை|\b(?:this|that|indha|intha|andha|antha)\b)/i;
export const negativeProductMention = /(?:வேண்டாம்|வெண்டாம்|வேணாம்|வேணாங்க|வெனாம்|\b(?:venda(?:m)?|vendam|vena(?:am)?|venam|don't want|do not want|not needed|not\s+(?:the\s+)?(?:pvc|this|that))\b)/i;
export const repeatMention = /(?:ஆல்ரெடி|ஏற்கனவே|சொல்லிட்டேன்|அதே|\b(?:already|same|as i said|told you|sonnen|sollitten|adhe)\b)/i;
export const correctionMention = /(?:இல்லை|இல்ல|மாத்து|மாற்று|மாத்தணும்|மாற்றணும்|பதிலா|மொத்தம்|\b(?:actually|sorry|correction|instead|no|maathu|maathanum|badhila|moththam|total|change|replace)\b)/i;
export const removalMention = /(?:நீக்கு|நீக்கிடு|எடுத்துடு|எடுத்துரு|ரிமூவ்|ரிமூவ|டெலீட்|டிலீட்|வேண்டாம்|வேணாம்|வேணாங்க|\b(?:remove|delete|drop|vendam|vendaam|venam|vena|not needed|don't want|do not want)\b)/i;

export function positiveRemoval(source:string,description=source):boolean {
 if(!description.includes(source)||!removalMention.test(source))return false;
 if(/\b(?:these|those)\s+(?:photos|pictures|images)\b|(?:இந்த|அந்த)ப்?\s*பட(?:ம்|ங்கள்)/iu.test(source)&&!/\b(?:item|product|cart|list|row)\b|பொருள்|பட்டியல்/iu.test(source))return false;
 // The source span may omit a preceding "don't" or a following negation.
 const boundary=/[;.!?\n]|\s+(?:and|but|instead|அடுத்து|ஆனா)\s+/iu;
 const start=description.indexOf(source),before=description.slice(0,start).split(boundary).at(-1)??'',after=description.slice(start+source.length).split(boundary)[0];
 const context=before+source+after;
 return !/\b(?:don't|dont|do not|never)\s+(?:remove|delete|drop)|(?:ரிமூவ்?|டெலீட்|டிலீட்|நீக்க|எடுக்க|எடுத்துர|எடுத்துட)[^;.!?\n]{0,35}(?:வேண்டாம்|வேணாம்|பண்ணாத|செய்யாத)|(?:remove|delete|drop)\s+(?:panna|pannu|pann)\s+(?:vendam|vendaam|venam)/iu.test(context);
}

export function mutationNegated(source:string,description=source):boolean {
 if(!description.includes(source))return true;
 const boundary=/[;.!?\n]|\s+(?:and|but|instead|அடுத்து|ஆனா)\s+/iu,start=description.indexOf(source);
 const context=(description.slice(0,start).split(boundary).at(-1)??'')+source+description.slice(start+source.length).split(boundary)[0];
 return /\b(?:don't|dont|do not|never|no need to)\s+(?:(?:just|ever|only)\s+)?(?:add|change|update|set|make|increase|decrease|replace|swap|remove|delete|drop)\b|(?:மாற்ற|மாத்த|சேர்|சேர்க்க|ஆட்|அட்|அப்டேட்|ரிமூவ்?|டெலீட்|டிலீட்)[^;.!?\n]{0,35}(?:வேண்டாம்|வேணாம்|பண்ணாத|செய்யாத)|மாற்றாத|மாத்தாத|சேர்க்காத|நீக்காத/iu.test(context);
}

export function intentClauses(text: string): string[] {
  return text.split(/[,;.!?\n]|\s+(?:and|but|instead)\s+|\s+அடுத்து\s+/i)
    .map(clause => clause.trim()).filter(Boolean);
}
