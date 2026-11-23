const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',le:'≤',ge:'≥',plusmn:'±',times:'×'};
export const decode=value=>String(value||'').replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi,(token,entity)=>{
 if(entity[0]!=='#')return entities[entity.toLowerCase()]??token;
 const cp=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
 return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):'';
});
// MedlinePlus can return escaped HTML inside XML. Match only real HTML tags
// after decoding, so statistical expressions such as "p < 0.05" survive.
export const plainText=text=>decode(decode(text))
 .replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
 .replace(/<\/?(?:p|div|abstracttext|h[1-6]|li|title)\b[^>]*>/gi,'\n')
 .replace(/<\/?[a-z][\w:-]*(?:\s[^<>]*?)?\s*\/?>/gi,'')
 .split('\n').map(p=>p.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
