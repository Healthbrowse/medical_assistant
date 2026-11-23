import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSynthesis} from '../dist/model-client.js';

test('the browser reads a direct answer from either API version and passes only current material to Buddy', async()=>{
 const context={role:'Clinicians',topic:'Sleep',query:'What is sleep?',answerSummary:'Current answer',
  browserSources:[{title:'Current reference'}],deckSummaries:['Obsolete card material']};
 const answer={text:'Reviewed answer',blocks:[]};
 const tokenProvider=async()=>'fixture-auth';
 for(const previous of [true,false])for(const mode of ['search','chat']){
  const fetcher=async(url,options)=>{
   if(url.endsWith('/status'))return Response.json({});
   const request=JSON.parse(options.body);
   if(mode==='chat'){
    assert.equal(request.browserContext,'Current answer\nCurrent reference');
    assert.doesNotMatch(request.browserContext,/Obsolete/);
   }
   return Response.json({status:'generated',answer,...(previous?{decks:[{text:'Obsolete card material'}]}:{})});
  };
  const result=await requestSynthesis(context,context.query,{mode,deck:1,tokenProvider,fetcher});
  assert.deepEqual(result.answer,answer);
  assert.deepEqual(result.decks,[]);
 }
});
