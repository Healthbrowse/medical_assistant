import test from 'node:test';
import assert from 'node:assert/strict';
import {datasetProfile} from '../client/dataset-profile.mjs';
import {validateDocuments} from '../dist/document-policy.js';
const profile=(s,delim=',')=>datasetProfile(new TextEncoder().encode(s),delim);

test('quoted fields, multi-line values, missing and duplicate rows produce only aggregate information',()=>{
 const pages=profile('private_header,email,status\r\n"record,one",private@example.org,true\r\n"record,one",private@example.org,true\r\n"record\ntwo","escaped ""input""",false\r\n\r\nonly-one\r\nfive,2026-01-01, ,extra\r\n');
 const text=pages.map(p=>p.text).join('\n');
 assert.match(text,/Data rows: 5. Header columns: 3./);
 assert.match(text,/Blank lines skipped outside quoted fields: 1/);
 assert.match(text,/Rows shorter than the header: 1. Rows wider than the header: 1. Missing cells within the header width: 3/);
 assert.match(text,/Exact duplicate rows beyond the first occurrence: 1/);
 assert.match(text,/Column 2. missing 1, numeric 0, boolean 0, date-shaped 1, text 3/);
 assert.doesNotMatch(text,/private|example\.org|record,one|escaped|2026-01-01/);
 assert.equal(validateDocuments([{id:'doc-1234567890abcdef',kind:'section',pages}])[0].pages.length,2);
});
test('profiles TSV, leading UTF-8 BOM, blank headings and quoted empty values',()=>{
 const pages=profile('\ufeffA\tA\t\n1\t.1\t""\n2\t10e2\t""','\t');
 assert.match(pages[0].text,/Empty headers: 1. Repeated nonempty header names beyond the first occurrence: 1/);
 assert.match(pages[1].text,/Column 2. missing 0, numeric 2/);
});
test('broken quoting, empty input and excess columns fail visibly',()=>{
 for(const input of ['x\n"unclosed','x\nneeds"escaping','x\n"closed"suffix','\n\n',Array(130).fill('col').join(',')])assert.throws(()=>profile(input));
});
