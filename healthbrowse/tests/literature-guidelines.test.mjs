import test from 'node:test';
import assert from 'node:assert/strict';
import {guidelineEvidence} from '../server/literature-guidelines.mjs';

const url='https://www.cdc.gov/vision/guidelines/';
const specific={topic:'Vision screening',focus:'Vision screening',url,title:'Clinical Guidance for Vision Screening',text:'This stale sentence has since been removed.'};
const page=(canonical=url,title=specific.title)=>`<html><head><link href="${canonical}" rel="canonical"><meta itemprop="datePublished" content="2023-02-14"><meta property="article:modified_time" content="2026-01-01"></head><body>
<main><h1>${title}</h1><nav><p>Vision screening sign up for journal news.</p></nav><h2>Eligible population</h2>
<p>The pilot vision screening programme included participants aged 18 years or older.</p>
<h2>Results</h2><p>The observed completion rate was 81.5% (95% CI, 78.2% to 84.8%).</p>
<h2>References</h2><p>Sign up for clinical guidance email updates.</p></main></body></html>`;
const assets=(records=[specific])=>({'/grounded-sources.json':{text:JSON.stringify({passages:records})}});

test('verified institutional findings keep exact statistics, section and publication year',async()=>{
 const calls=[];
 const result=await guidelineEvidence({assets:assets(),terms:'vision screening population results',request:async(link,accept)=>{calls.push(link);assert.equal(accept,'text/html');return page()}});
 assert.deepEqual(result.searches,calls);
 assert.equal(result.sources.length,1);
 const s=result.sources[0];
 assert.equal(s.evidence_tier,1);assert.equal(s.publication_year,2023);assert.equal(s.url,url);
 assert.ok(s.extracted_findings.some(f=>f.text.includes('81.5% (95% CI, 78.2% to 84.8%).')&&f.section==='Results'));
 assert.doesNotMatch(JSON.stringify(s),/stale sentence|Sign up|journal news/i);
});

test('skips lookalike hosts and unrelated topics and rejects canonical and title mismatches',async()=>{
 const wrong={...specific,url:'https://www.cdc.gov.example.com/guideline'};
 const redirects={...specific,url:'https://www.cdc.gov/vision/elsewhere'};
 const unrelated={...specific,topic:'Dental examination',focus:'Dental examination',url:'https://www.cdc.gov/dental/'};
 const calls=[];
 const result=await guidelineEvidence({assets:assets([wrong,specific,redirects,unrelated]),terms:'vision screening',request:async(link)=>{calls.push(link);return link===specific.url?page('https://www.cdc.gov/unrelated/'):page(link,'Clinical Guidance for Hearing Screening')}});
 assert.deepEqual(calls,[specific.url,redirects.url]);assert.equal(result.sources.length,0);assert.equal(result.gaps.length,2);
});
test('clinical education pages are tier 2 and review dates do not become publication years',async()=>{
 const record={...specific,title:'About Vision Screening'};const html=page(url,record.title).replace('itemprop="datePublished"','itemprop="dateModified"');
 const r=await guidelineEvidence({terms:'vision screening',assets:assets([record]),request:async()=>html});
 assert.equal(r.sources[0].evidence_tier,2);assert.equal(r.sources[0].publication_year,null);
});

test('national guidance takes precedence and an academic guideline title stays tier 2',async()=>{
 const academic='https://www.hopkinsmedicine.org/health/conditions-and-diseases/vision-screening';
 const education='https://www.hopkinsmedicine.org/infectious-diseases/education/fellowships/program';
 const results=await guidelineEvidence({terms:'vision screening',assets:assets([
  {...specific,url:academic},{...specific,url:education},specific,
 ]),request:async link=>page(link)});
 assert.deepEqual(results.searches,[url,academic]);
 assert.deepEqual(results.sources.map(s=>s.evidence_tier),[1,2]);
 assert.deepEqual(results.sources[1].study_design,['Academic medical center reference']);
 const mismatch=await guidelineEvidence({terms:'vision screening',assets:assets([{...specific,url:academic}]),request:async()=>page(education)});
 assert.deepEqual(mismatch.sources,[]);assert.equal(mismatch.gaps.length,1);
});

test('known academic Health Library articles are discoverable without catalog matches',async()=>{
 const target='https://www.hopkinsmedicine.org/health/conditions-and-diseases/the-pituitary-gland';
 const html='<main><h1>Pituitary Gland</h1><h2>Overview</h2><p>This fixture describes the pituitary gland in a clinical education article.</p></main>';
 const result=await guidelineEvidence({terms:'pituitary gland',assets:{},request:async()=>html});
 assert.deepEqual(result.searches,[target]);assert.equal(result.sources[0].evidence_tier,2);
});
