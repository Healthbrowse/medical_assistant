import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveSearch} from '../dist/discovery.js';
const entities=[{name:'High Blood Pressure',aliases:['hypertension']},{name:'Diabetes',aliases:[]}];
test('matches catalog aliases in questions and distinguishes multiple conditions',()=>{
  assert.deepEqual(resolveSearch('What causes hypertension?',entities).choices,['High Blood Pressure']);
  assert.equal(resolveSearch('Diabetes and hypertension',entities).choices.length,2);
});
test('extracts a research subject beyond the catalog',()=>{
  assert.deepEqual(resolveSearch('What causes asthma?',entities),{choices:[],keywords:'asthma'});
});

test('extracts vocabulary topics embedded in complete questions without forwarding other words',async()=>{
  const {topicIndex}=await import('../dist/discovery.js');
  const index=topicIndex(entities,['Asthma','Allergic asthma']);
  assert.deepEqual(resolveSearch('Can you explain how asthma affects the lungs?',index).choices,['Asthma']);
  assert.deepEqual(resolveSearch('How is allergic asthma identified?',index).choices,['Allergic asthma']);
  assert.deepEqual(resolveSearch('Compare asthma and diabetes',index).choices,['Asthma','Diabetes']);
  assert.deepEqual(resolveSearch('What is asthmatic?',index).choices,[]);
});

test('ordinary all is not the ALL leukemia acronym in a symptom description',async()=>{
 const {topicIndex}=await import('../dist/discovery.js');
 const index=topicIndex([{name:'Sore Throat',aliases:['Pharyngitis']},{name:'Acute Lymphocytic Leukemia',aliases:['ALL']}]);
 assert.deepEqual(resolveSearch('Doctor said viral pharyngitis all throat hurting pretty bad',index).choices,['Sore Throat']);
 assert.deepEqual(resolveSearch('What are the treatments for ALL?',index).choices,['Acute Lymphocytic Leukemia']);
});
