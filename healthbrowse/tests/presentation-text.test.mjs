import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {validateDocuments} from '../dist/document-policy.js';
import {extractSlides} from '../client/presentation-text.mjs';

function deck(target='slides/slide2.xml',first='Ownership &amp; review'){
 const ids=['r2','r1','r3'];
 const presentation='<p:presentation><p:sldIdLst>'+ids.map(id=>'<p:sldId id="1" r:id="'+id+'"/>').join('')+'</p:sldIdLst></p:presentation>';
 const rels='<Relationships>'+['slides/slide1.xml',target,'slides/slide3.xml'].map((part,i)=>'<Relationship Type="https://example.org/slide" Id="r'+(i+1)+'" Target="'+part+'"/>').join('')+'</Relationships>';
 const slide=text=>'<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
 return zipSync(Object.fromEntries(Object.entries({'ppt/presentation.xml':presentation,'ppt/_rels/presentation.xml.rels':rels,
  'ppt/slides/slide1.xml':slide(''),'ppt/slides/slide2.xml':slide(first),'ppt/slides/slide3.xml':slide('Final test'),
  'ppt/notesSlides/notesSlide1.xml':slide('not visible')}).map(([key,value])=>[key,strToU8(value)])));
}

test('PPTX text follows deck order, maintains slide locators across blank slides, and omits notes',()=>{
 assert.deepEqual(extractSlides(deck()),[{number:1,text:'Ownership & review'},{number:3,text:'Final test'}]);
});
test('unresolvable slide targets and oversized slides fail closed',()=>{
 assert.throws(()=>extractSlides(deck('https://example.com/slides/slide1.xml')));
 assert.throws(()=>extractSlides(deck('slides/slide2.xml','X'.repeat(60001))),/too much text/);
});

test('validated document location types support new slides and existing untyped files',()=>{
 const file={id:'doc-0123456789abcdef',pages:[{number:1,text:'Slide text'}]};
 for(const kind of ['slide','page','section'])assert.equal(validateDocuments([{...file,kind}])[0].kind,kind);
 assert.equal(validateDocuments([file])[0].kind,undefined);
 assert.throws(()=>validateDocuments([{...file,kind:'row'}]),/Invalid document location/);
});
