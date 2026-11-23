import {roleIndex} from './reading-profiles.js';

// Describe only topics with an answer the user can trace back to a source.
export function invitationTopic(answer, topic, question = '') {
  if (!topic || answer.safety || answer.kind === 'platform' || answer.documentMode ||
      answer.diagnosisNotice || answer.followUpQuestions?.length || answer.educationalOnly) return '';
  const cited = block => block?.references?.length || block?.citation;
  if (!answer.citations?.length && !answer.blocks?.some(cited) &&
      !answer.buddyDecks?.some(deck => deck.blocks?.some(cited))) return '';
  const index = question.toLowerCase().indexOf(topic.toLowerCase());
  return index < 0 ? topic : question.slice(index, index + topic.length);
}

export function invitationReply(text) {
  const reply = text.trim().toLowerCase().replace(/[,!.?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:yes(?: please)?|yes tell me more|sure(?: thing)?|please do|tell me more|go on)$/.test(reply)) return 'open';
  if (/^(?:no(?: thanks| thank you)?|not now|maybe later)$/.test(reply)) return 'dismiss';
  return '';
}

export function invitationChoices(turn, choices, general, role) {
  if (general) return [
    {label:'Check the cited claims', prompt:'Check the claims in the browser answer.'},
    {label:'Explore methods and limitations', prompt:'Explain the methodology and limitations.'}
  ];
  const covered = turn.buddyDecks?.filter(deck => deck.blocks?.length).map(deck => deck.deck);
  const first = [2, 3, 4, 1, 5, 6];
  const available = covered?.length ? first.filter(id => covered.includes(id)) : first.filter(id => id !== turn.deck);
  return available.slice(0, 3).flatMap(id => {
    const choice=choices.find(item => item.deck === id);
    if (!choice) return [];
    if (roleIndex(role)===1) return [choice];
    const label=turn.buddyDecks?.find(deck => deck.deck===id)?.title || choice.label.replace(/\s+\([^()]+\)$/,'');
    return [{...choice,label}];
  });
}
