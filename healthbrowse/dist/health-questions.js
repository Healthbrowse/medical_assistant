// Examples use the same search and safety handlers as typed questions.
export const healthQuestions = [
  'What are the main symptoms and early warning signs of type 2 diabetes?',
  'Can you explain this lab report result in simple terms?',
  'What does this medical scan or image show?',
  'How is high blood pressure usually managed day to day?',
  'What is the difference between viral and bacterial sinus infections?',
  'What are common side effects and general precautions for ibuprofen?',
  'Can you diagnose what is causing my chest pain right now?',
  'How do vaccines build immunity, and why do booster schedules exist?',
  'What preventive health screenings are generally discussed for adults in their 30s and 40s?',
  'How can I prepare a clear list of questions before my upcoming doctor’s appointment?'
];

export function buddyHealthTask(question) {
  const q = String(question).toLowerCase().replace(/[’']/g, '');
  if (/\b(?:appointments?|doctors? visits?|visits? (?:to|with) (?:my|the|a) doctor|questions (?:for|to ask) (?:my|the|a) doctor)\b/.test(q)
      && /\b(?:prepar\w*|checklist|questions|bring)\b/.test(q)) return 'visit';
  const personalFile = /\b(?:this|these|my|our|attached|uploaded|upload|attach)\b/.test(q);
  const review = /\b(?:explain|walk me through|show|say|mean|review|interpret|understand|upload|attach|read|summari[sz]e)\w*\b/.test(q);
  if (personalFile && review) {
    if (/\b(?:scans?|radiology|imaging|mri|x[ -]?ray|ct scan|ultrasound|medical images?)\b/.test(q)) return 'imaging';
    if (/\b(?:lab(?:oratory)?|blood|test)\s+(?:test\s+)?(?:reports?|results?|work)\b/.test(q)) return 'lab';
  }
  return null;
}

const visitSource = {
  id: 'NIA', title: 'How to Prepare for a Doctor’s Appointment',
  url: 'https://www.nia.nih.gov/health/medical-care-and-appointments/how-prepare-doctors-appointment'
};
const visitItems = [
  ['Your priorities', 'Write down the one or two concerns you most want to discuss. Bring up the most important one first.'],
  ['Your timeline', 'Note when the problem started, what changes it, and how it affects your day. Bring relevant reports or changes in family health history.'],
  ['What you take', 'Bring a list of prescriptions, over-the-counter medicines, vitamins and supplements. Include questions you have about them.'],
  ['Before you leave', 'Ask what the next step is, when to follow up, and whom to contact if you have questions afterward.']
];
export function buddyHealthGuide(task) {
  if (task === 'visit') return {
    text: 'Prepare for your appointment', blocks: visitItems.map(([title, text]) => ({title, text, references: [visitSource]}))
  };
  const text = task === 'imaging'
    ? 'Use the + button to attach a written radiology report or a photo of its text. Include Findings and Impression if available. Buddy can explain the wording and point to the supporting passage. A radiologist or clinician should interpret the scan itself.'
    : 'Use the + button to attach a readable lab report. Include the test name, value, units and reference range as printed. Buddy can explain the terms and point to the relevant passage.';
  return {text: text + ' Use a de-identified example. Check the reviewed text for names, dates of birth and record numbers before attaching it.'};
}
