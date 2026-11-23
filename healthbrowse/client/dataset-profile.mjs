import {documentLimits} from '../dist/document-policy.js';

// Text values and header names stay local. The review dialog gets only counts
// and column positions, which remain stable even with missing/duplicate headers.
function* records(text,delimiter){
 let pos=0;
 while(pos<text.length){
  // An empty physical line is distinct from a row of explicitly empty fields.
  let fields=[],start=pos;
  while(true){
   if(fields.length>=128)throw Error('Use up to 128 dataset columns.');
   let value;
   if(text[pos]==='"'){
    let begin=++pos,parts=[];
    while(true){
     pos=text.indexOf('"',begin);
     if(pos===-1)throw Error('Unterminated quoted dataset field.');
     parts.push(text.slice(begin,pos++));
     if(text[pos]!=='"')break;
     parts.push('"');begin=++pos;
    }
    value=parts.join('');
   }else{
    const begin=pos;
    while(pos<text.length&&text[pos]!==delimiter&&text[pos]!=='\r'&&text[pos]!=='\n'){
     if(text[pos]==='"')throw Error('Unexpected quotation mark in a dataset field.');
     pos++;
    }
    value=text.slice(begin,pos);
   }
   fields.push(value);
   if(text[pos]!==delimiter)break;
   pos++;
  }
  const blank=pos===start;
  if(pos<text.length){
   if(text[pos]==='\r'){pos++;if(text[pos]==='\n')pos++;}
   else if(text[pos]==='\n')pos++;
   else throw Error('Unexpected text after a quoted field.');
  }
  yield blank?null:fields;
 }
}

const isNumber=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
function kind(value){
 if(!value)return 'missing';
 if(isNumber.test(value))return 'numeric';
 if(/^(?:true|false)$/i.test(value))return 'boolean';
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return 'date-shaped';
 return 'text';
}

export function datasetProfile(bytes,delimiter){
 if(bytes.length>documentLimits.bytes)throw Error('Dataset exceeds the file-size limit.');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(text.includes('\0'))throw Error('Use a UTF-8 CSV or TSV file.');
 const seen=new Set();
 let columns=null,rows=0,blanks=0,duplicates=0,short=0,long=0,missing=0,emptyHeaders=0,repeatedHeaders=0;
 for(const row of records(text,delimiter)){
  if(!row){blanks++;continue;}
  if(!columns){
   columns=row.map(()=>({missing:0,numeric:0,boolean:0,'date-shaped':0,text:0}));
   const named=row.map(value=>value.trim()).filter(Boolean);
   emptyHeaders=row.length-named.length;
   repeatedHeaders=named.length-new Set(named).size;
   continue;
  }
  if(++rows>100000)throw Error('Use a dataset extract of up to 100,000 rows.');
  const signature=JSON.stringify(row);
  if(seen.has(signature))duplicates++;else seen.add(signature);
  if(row.length<columns.length)short++;
  if(row.length>columns.length)long++;
  columns.forEach((col,index)=>{
   const type=kind(row[index]?.trim());
   col[type]++;
   if(type==='missing')missing++;
  });
 }
 if(!columns)throw Error('No dataset header found.');
 const summary=[
  'Dataset profile computed in the browser. The first nonblank record is treated as the header.',
  'Data rows: '+rows+'. Header columns: '+columns.length+'. Blank lines skipped outside quoted fields: '+blanks+'.',
  'Rows shorter than the header: '+short+'. Rows wider than the header: '+long+'. Missing cells within the header width: '+missing+'. Empty, whitespace-only and absent fields count as missing.',
  'Exact duplicate rows beyond the first occurrence: '+duplicates+'. Comparisons include every parsed field, preserving case and spacing.',
  'Empty headers: '+emptyHeaders+'. Repeated nonempty header names beyond the first occurrence: '+repeatedHeaders+'.',
  'Column counts cover all data rows. Value types describe text patterns; date-shaped means YYYY-MM-DD. Columns beyond the header width have no profile.'
 ];
 const schema=columns.map((col,index)=>'Column '+(index+1)+'. '+Object.entries(col).map(([type,count])=>type+' '+count).join(', ')+'.');
 return [{number:1,text:summary.join('\n')},{number:2,text:schema.join('\n')}];
}
