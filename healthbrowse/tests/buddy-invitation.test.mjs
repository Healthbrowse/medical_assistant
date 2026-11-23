import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationTopic,invitationReply,invitationChoices} from '../dist/buddy-invitation.js';
import {roleQuestions} from '../dist/reading-profiles.js';

const cited = {text:'Example passage',references:[{id:'S1',url:'https://medlineplus.gov/leukemia.html'}]};

test('the closing question uses the researched subject and requires supporting evidence',()=>{
  const answer={blocks:[cited]};
  assert.equal(invitationTopic(answer,'Leukemia','What is leukemia?'),'leukemia');
  assert.equal(invitationTopic({buddyDecks:[{blocks:[cited]}]},'HIV','Show six decks'),'HIV');
  assert.equal(invitationTopic({blocks:[{text:'Still checking'}]},'Leukemia'),'');
  for(const excluded of [{safety:{}},{documentMode:true},{kind:'platform'},{diagnosisNotice:'Personal symptoms'},{followUpQuestions:['When did this start?']}])
    assert.equal(invitationTopic({...answer,...excluded},'Leukemia'),'');
});

test('only a standalone acceptance or decline is handled locally',()=>{
  assert.equal(invitationReply('Yes, please!'),'open');
  assert.equal(invitationReply('Tell me more'),'open');
  assert.equal(invitationReply('No, thank you.'),'dismiss');
  assert.equal(invitationReply('Yes, what about asthma?'),'');
  assert.equal(invitationReply('Yes, I have chest pain.'),'');
});

test('offered choices use the audience and the contributions with cited coverage',()=>{
  const turn={buddyDecks:[{deck:2,blocks:[]},{deck:3,title:'Signs & symptoms',blocks:[cited]},{deck:4,title:'Diagnosis & tests',blocks:[cited]}]};
  for(const role of ['General reader','Medical professional']){
    const choices=roleQuestions(role);
    const offered=invitationChoices(turn,choices,false,role);
    assert.deepEqual(offered.map(({deck,prompt})=>[deck,prompt]),choices.slice(2,4).map(({deck,prompt})=>[deck,prompt]));
    assert.deepEqual(offered.map(c=>c.label),role==='General reader'?['Signs & symptoms','Diagnosis & tests']:['Review clinical manifestations','Review diagnostic modalities']);
    assert.ok(invitationChoices({deck:2},choices,false,role).every(choice=>choice.deck!==2));
  }
  assert.ok(invitationChoices({},[],true).every(choice=>!choice.deck&&choice.prompt));
});
