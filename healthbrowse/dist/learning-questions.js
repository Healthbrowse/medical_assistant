import {roleIndex} from './reading-profiles.js';

const generalQuestions=[
 'What is it, in simple terms?',
 'How does it work?',
 'What role does it play in the body?',
 'How is it measured or studied?',
 'What changes or related conditions matter?',
 'What are the key takeaways?'
];
const clinicalQuestions=[
 'Definition and core concepts', 'Physiology and mechanisms', 'Functional significance',
 'Assessment and investigations', 'Associated abnormalities and clinical relevance', 'Key learning points and further reading'
];
export const buddyLearningQuestions=role=>roleIndex(role)===1?clinicalQuestions:generalQuestions;
