import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFullText,reusableLicense} from '../server/pmc-fulltext.mjs';
import {harvestRecords,harvestURL} from '../scripts/harvest-pmc.mjs';
import {retrieveEvidence,clearRetrievalCache} from '../server/live-evidence.mjs';
const article=(id=123,license='https://creativecommons.org/licenses/by/4.0/')=>`<article article-type="review-article"><front><article-meta><article-id pub-id-type="pmc">${id}</article-id><title-group><article-title>Pituitary physiology</article-title></title-group><permissions><license xlink:href="${license}"><license-p>Reuse terms</license-p></license></permissions></article-meta></front><body><sec><title>Mechanism</title><p>The <bold>pituitary</bold> gland produces hormones that regulate growth and other glands.</p></sec></body></article>`;
test('JATS full text preserves inline word order, section headings, original IDs and license',()=>{
 const p=parseFullText(article(),'PMC123');assert.equal(p.paragraphs[0].text,'The pituitary gland produces hormones that regulate growth and other glands.');assert.equal(p.paragraphs[0].heading,'Mechanism');assert.ok(p.license.includes('/by/4.0/'));
 for(const url of ['https://creativecommons.org/licenses/by-nc/4.0/','https://creativecommons.org/licenses/by-nd/4.0/','https://creativecommons.org/licenses/by-sa/4.0/','https://publisher.test/terms'])assert.equal(parseFullText(article(123,url),'PMC123'),null);
 assert.equal(parseFullText(article(),'PMC999'),null);assert.equal(parseFullText('<!ENTITY boom "secret">'+article(),'PMC123'),null);assert.equal(parseFullText(article().replace('review-article','retraction'),'PMC123'),null);
 assert.ok(reusableLicense('CC BY 4.0'));assert.ok(reusableLicense('https://creativecommons.org/publicdomain/zero/1.0/'));
});
test('OAI paging uses opaque tokens only and retains multiple distinct articles plus deletions',()=>{
 const xml='<OAI-PMH><ListRecords>'+[123,456].map(id=>`<record><header><identifier>oai:pubmedcentral.nih.gov:${id}</identifier><datestamp>2026-11-01</datestamp></header><metadata>${article(id)}</metadata></record>`).join('')+'<record><header status="deleted"><identifier>oai:pubmedcentral.nih.gov:789</identifier></header></record><resumptionToken>opaque-token</resumptionToken></ListRecords></OAI-PMH>';
 const result=harvestRecords(xml);assert.deepEqual(result.records.map(r=>r.pmcid),['PMC123','PMC456','PMC789']);assert.equal(result.records[2].status,'deleted');assert.equal(result.token,'opaque-token');
 const next=harvestURL({from:'2026-11-01',token:result.token});assert.deepEqual([...next.searchParams.keys()],['verb','resumptionToken']);
});
test('live lookup enriches eligible research with licensed full text and retains abstracts on failure',async()=>{
 const paper={source:'MED',id:'12345',pmcid:'PMC123',isOpenAccess:'Y',inEPMC:'Y',title:'Pituitary physiology',abstractText:'The pituitary gland produces hormones that regulate growth and other glands.'};
 const input={question:'What does the pituitary gland do?',role:'Medical professional',mode:'search',topic:'Pituitary gland'};let fail=false;
 const fetcher=async url=>{if(url.includes('wsearch'))return new Response('<root/>');if(url.endsWith('/fullTextXML'))return fail?new Response('',{status:503}):new Response(article());return Response.json({resultList:{result:[paper]}})};
 clearRetrievalCache();const first=await retrieveEvidence(input,null,{},undefined,fetcher);assert.ok(first.sources.some(s=>s.abstractOnly===false&&s.url.includes('/PMC123/')));
 fail=true;clearRetrievalCache();const second=await retrieveEvidence(input,null,{},undefined,fetcher);assert.ok(second.sources.some(s=>s.abstractOnly));assert.ok(second.retrieval.providers.some(p=>p.status==='unavailable'));
});
