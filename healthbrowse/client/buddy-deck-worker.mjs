import {citedEvidence} from '../server/model-cited.mjs';
import {addEducation,educationEvidence} from '../server/education-evidence.mjs';
import {learningDecks} from '../server/learning-decks.mjs';
import {buddyOverviewDecks} from '../server/buddy-decks.mjs';

// Fetch public, versioned application assets. No question or chat history leaves this worker.
let catalog;
async function loadCatalog() {
  const files = ['medline-topics','clinical-passages','grounded-sources','education-sources'];
  return Object.fromEntries(await Promise.all(files.map(async name => {
    const path = '/' + name + '.json';
    const response = await fetch(path, {credentials:'omit'});
    if (!response.ok) throw new Error('Catalog unavailable');
    return [path, {text:await response.text()}];
  })));
}

self.onmessage = async ({data:{id, topic, role}}) => {
  try {
    catalog ??= loadCatalog().catch(error => { catalog = null; throw error; });
    const assets = await catalog;
    const input = {mode:'chat', deck:0, topic, role, question:'What is ' + topic + '?'};
    const local = citedEvidence(assets, input);
    const evidence = learningDecks(addEducation(local, educationEvidence(assets,input), input), input, local);
    const decks = evidence ? buddyOverviewDecks(input,evidence) : [];
    self.postMessage({id, report:{decks, learningMode:!!evidence?.learningMode}});
  } catch {
    self.postMessage({id, report:null});
  }
};
