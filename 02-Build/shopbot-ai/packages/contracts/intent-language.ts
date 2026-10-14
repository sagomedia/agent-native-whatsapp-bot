// Shared evidence vocabulary. These patterns recognize wording; they do not
// authorize a cart mutation, pick a target, or bypass a current confirmation.
export const additionalMention = /(?:மேலும்|இன்னும்|இன்னம்|கூடுதலா|எக்ஸ்ட்ரா|\b(?:extra|additional|more|innum|innam|kooduthal(?:a)?|melum)\b)/i;
export const currentItemMention = /(?:இந்த|அந்த|இதை|அதை|\b(?:this|that|indha|intha|andha|antha)\b)/i;
export const negativeProductMention = /(?:வேண்டாம்|வெண்டாம்|வேணாம்|வேணாங்க|வெனாம்|\b(?:venda(?:m)?|vendam|vena(?:am)?|venam|don't want|do not want|not needed|not\s+(?:the\s+)?(?:pvc|this|that))\b)/i;
export const repeatMention = /(?:ஆல்ரெடி|ஏற்கனவே|சொல்லிட்டேன்|அதே|\b(?:already|same|as i said|told you|sonnen|sollitten|adhe)\b)/i;
export const correctionMention = /(?:இல்லை|இல்ல|மாத்து|மாற்று|மாத்தணும்|மாற்றணும்|பதிலா|மொத்தம்|\b(?:actually|sorry|correction|instead|no|maathu|maathanum|badhila|moththam|total|change|replace)\b)/i;
export const removalMention = /(?:நீக்கு|நீக்கிடு|எடுத்துடு|வேண்டாம்|வேணாம்|வேணாங்க|\b(?:remove|delete|drop|vendam|vendaam|venam|vena|not needed|don't want|do not want)\b)/i;

export function intentClauses(text: string): string[] {
  return text.split(/[,;.!?\n]|\s+(?:and|but|instead)\s+|\s+அடுத்து\s+/i)
    .map(clause => clause.trim()).filter(Boolean);
}
