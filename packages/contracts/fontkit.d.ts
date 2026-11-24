declare module 'fontkit' {
 export function create(data:Buffer):{unitsPerEm:number;layout(text:string):{glyphs:{path:{toSVG():string}}[];positions:{xAdvance:number;yAdvance:number;xOffset:number;yOffset:number}[]}};
}
