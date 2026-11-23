import test from 'node:test';
import assert from 'node:assert/strict';
import {auditBrowserAnswer} from '../dist/buddy-audit.js';
import {readFileSync} from 'node:fs';
const reference={id:'a',title:'Audit report',url:'https://example.org/report',text:'The review covered 14 controls. Two controls had incomplete evidence.'};
const context={query:'Which controls were reviewed?',answerSummary:'The review covered 14 controls.',
 directAnswer:{blocks:[{text:'The review covered 14 controls.',sourceIds:['a']},{text:'Control effectiveness was assessed by interview.',sourceIds:['a']},{text:'Every control passed.'}]},browserSources:[reference]};
test('Buddy compares each claim with its linked passage and keeps citation gaps visible',()=>{
 const result=auditBrowserAnswer(context);
 assert.deepEqual(result.blocks.map(b=>b.title),['Matches cited passage','Compare with cited source','Citation unavailable for this claim']);
 assert.equal(result.blocks[0].references[0].quote,reference.text);
 assert.deepEqual(result.blocks[2].references,[]);
 assert.match(auditBrowserAnswer(context,'What methodology did it use?').text,/do not describe/);
});
test('Buddy uploader is bound only to the chat composer',()=>{
 const src=readFileSync(new URL('../dist/attachments.js',import.meta.url),'utf8');
 assert.match(src,/container=\$\('ask'\)/);
 assert.doesNotMatch(src,/\$\('(?:query|find)'\)/);
});
