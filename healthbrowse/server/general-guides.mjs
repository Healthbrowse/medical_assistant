// Short editorial syntheses of the linked primary sources. Dates identify
// publications or releases; a living standard can have no single publication date.
const excerpts = {
  law: 'state the responsibility of management for establishing and maintaining an adequate internal control structure and procedures for financial reporting',
  sec404: 'management can conduct a top-down, risk-based evaluation of internal control over financial reporting',
  as2201: 'Inquiry alone does not provide sufficient evidence to support a conclusion about the effectiveness of a control.',
  as1215: 'The auditor must document the procedures performed, evidence obtained, and conclusions reached with respect to relevant financial statement assertions.',
  issues: 'If its performance is below the target, this is a data quality issue.',
  plan: 'Focus on the specific data fields that are most critical to your purpose and avoid the temptation to measure everything.',
  map: 'visually represents the steps of a process, system, or workflow in sequential order',
  pdca: 'Test the change. Carry out a small-scale study.',
  scope: 'SIPOC analysis is most useful prior to process mapping or placing the process in a flow chart.'
};
const source = (id, title, publisher, date, url, takeaway) => ({id, title, publisher, date, url, takeaway, ...(excerpts[id] ? {quote:excerpts[id]} : {})});
const block = (text, ...sourceIds) => ({text, sourceIds});

const law = source('law', 'Sarbanes–Oxley Act of 2002', 'U.S. Congress', '2002-07-30',
  'https://www.govinfo.gov/app/details/PLAW-107publ204/summary', 'Sections 302 and 404 establish different responsibilities for public-company reporting.');
const sec = source('sec404', 'Commission guidance on management’s report on internal control', 'U.S. Securities and Exchange Commission', '2007-06-20',
  'https://www.sec.gov/rule-release/33-8810', 'The SEC explains how management can evaluate controls against identified financial reporting risks.');
const certification = source('sec302', 'Certification of disclosure in quarterly and annual reports', 'U.S. Securities and Exchange Commission', '2002-08-29',
  'https://www.sec.gov/rule-release/33-8124', 'The rule explains the certifications that principal executive and financial officers make in periodic reports.');
const audit = source('as2201', 'AS 2201 · Auditing internal control over financial reporting', 'Public Company Accounting Oversight Board', null,
  'https://pcaobus.org/oversight/standards/auditing-standards/details/AS2201', 'The standard distinguishes evaluating control design from testing whether a control operates effectively.');
const evidence = source('as1215', 'AS 1215 · Audit documentation', 'Public Company Accounting Oversight Board', null,
  'https://pcaobus.org/oversight/standards/auditing-standards/details/AS1215', 'An auditor’s record connects the work performed and evidence obtained to the conclusion reached.');
const controls = block('For a financial reporting control, start with the risk it addresses. Describe how the control should catch or prevent a material error, then identify evidence that it actually operated during the period under review.', 'sec404', 'as2201');
const records = block('In a deck or workpaper, trace each conclusion to its supporting record. Document the procedure, what the reviewer found, who performed and reviewed the work, and when the review occurred.', 'as1215');
const qualityBase = 'https://www.gov.uk/government/publications/';
const plan = qualityBase + 'implement-a-data-quality-action-plan';
const mapping = 'https://asq.org/quality-resources/';

const waterSource = (id, title, date, takeaway) => source(id, title, 'U.S. Geological Survey', date,
  'https://www.usgs.gov/water-science-school/science/'+id+'-and-water-cycle', takeaway);

export const generalGuides = [
  {
    pattern: /\b(?:water cycle|hydrologic(?:al)? cycle)\b/i,
    topic: 'The water cycle',
    articles: [
      waterSource('atmosphere','The Atmosphere and the Water Cycle','2019-06-08','This overview follows water as it moves between the surface and the atmosphere.'),
      waterSource('evaporation','Evaporation and the Water Cycle','2019-06-08','Evaporation carries water from the surface into the atmosphere as vapor.'),
      waterSource('condensation','Condensation and the Water Cycle','2019-06-08','The explanation connects cloud formation with the change from vapor to droplets.'),
      waterSource('precipitation','Precipitation and the Water Cycle','2019-09-08','This article explains how rain, snow and other forms of precipitation return water to the surface.')],
    blocks: () => [
      block('The water cycle describes how water moves among the atmosphere, the ground and bodies of water. Surface water can evaporate into the air as water vapor. When that vapor condenses, it forms tiny droplets, including the droplets in clouds.', 'atmosphere','evaporation','condensation'),
      block('Water returns to the surface as precipitation, such as rain or snow. Some of it can evaporate again and continue moving through the cycle.', 'precipitation','evaporation')]
  },
  {
    pattern: /\b(?:sox|sarbanes[\s–-]+oxley|icfr|internal controls? over financial reporting)\b/i,
    topic: 'SOX and financial reporting controls', articles: [law, certification, sec, audit, evidence],
    blocks(q) {
      if (/\b(?:deck|audit trail|document|evidence|test|walkthrough|audit plan)\w*/i.test(q)) return [controls, records];
      const section302 = block('Section 302 concerns the certifications that principal executive and financial officers make about the company’s periodic reports and related controls.', 'law', 'sec302');
      const section404 = block('Section 404 addresses management’s responsibility for internal control over financial reporting and its annual assessment of effectiveness. Whether an external auditor must attest depends on the company’s applicable reporting requirements.', 'law', 'sec404', 'as2201');
      return /\b302\b/.test(q) ? [section302, section404] : /\b404\b/.test(q) ? [section404, controls] : [
        block('The Sarbanes–Oxley Act is a U.S. law addressing the reliability of public-company financial reporting. Two provisions often discussed together are officer certification of reports and management’s assessment of financial reporting controls.', 'law', 'sec302', 'sec404'),
        section302, section404];
    }
  },
  {
    pattern: /\b(?:audit trails?|audit logs?|audit evidence|internal controls?|audit documentation|control testing)\b/i,
    topic: 'Audit trails and control evidence', articles: [
      source('logs', 'Guide to Computer Security Log Management', 'National Institute of Standards and Technology', '2006-09', 'https://csrc.nist.gov/pubs/sp/800/92/final', 'NIST describes the collection, storage and review of event logs.'), audit, evidence, sec],
    blocks: () => [
      block('An audit trail is a sequence of records that lets a reviewer reconstruct what happened. For a system event, look for the action, its time and the account or system involved, then check whether the records cover the period being investigated.', 'logs'),
      records, controls]
  },
  {
    pattern: /\b(?:data(?:set)? (?:quality|validat\w+|completeness)|validat\w* (?:a |the |my |our )?(?:data ?set|data)|quality of (?:the |a )?data|data quality action plan)\b/i,
    topic: 'Data quality and validation', articles: [
      source('framework', 'The Government Data Quality Framework', 'UK Government', '2020-12-03', qualityBase+'the-government-data-quality-framework/the-government-data-quality-framework', 'The framework separates data quality into six measurable dimensions.'),
      source('plan', 'Implementing a data quality action plan', 'Government Digital Service', '2025-11-11', plan+'/data-quality-action-plan-implementation-guide', 'This guide connects a dataset’s intended use to appropriate checks and ownership.'),
      source('issues', 'Data quality issues framework', 'Government Digital Service', '2025-11-11', plan+'/data-quality-issues-framework', 'Worked examples show how to turn quality rules into metrics and prioritize failures.')],
    blocks: () => [
      block('Validate a dataset against the decision it needs to support. Choose the fields that decision depends on and define what would make them usable. A record can contain a value in the correct format and still describe the wrong thing.', 'framework', 'plan'),
      block('For each critical field, write a test, a target and an owner. For example, measure the fraction of records missing a required value. Investigate repeated failures and document how they affect the intended use.', 'plan', 'issues')]
  },
  {
    pattern: /\b(?:process mapping|process map|operational workflows?|administrative workflows?|workflow mapping|map (?:an? |the )?(?:workflow|process)|process improvement|process flowchart|sipoc|pdca)\b/i,
    topic: 'Workflow mapping and improvement', articles: [
      source('map', 'What is a flowchart?', 'American Society for Quality', null, mapping+'flowchart', 'A flowchart makes handoffs, decisions and the order of operations explicit.'),
      source('scope','Process SIPOC Template','American Productivity & Quality Center','2019-04',mapping+'benchmarking/process-sipoc-template?id=cf2058f9fd5a4d13aebbd6cf10ee9272','SIPOC helps define the process boundary and the people who supply or receive its outputs.'),
      source('pdca', 'Plan–Do–Check–Act cycle', 'American Society for Quality', null, mapping+'pdca-cycle', 'This cycle tests a process change and checks the result before wider use.')],
    blocks: q => [
      /pdca|improvement/i.test(q) ? block('Plan–Do–Check–Act is a cycle for testing an improvement. Specify the change and how to judge it, try it on a small scale, check the result, then adopt or revise the change.', 'pdca') : block('To map a workflow, agree on its starting event and expected output. Identify the people who supply inputs and receive the result, then draw the actual sequence of tasks, decisions and handoffs with the people who perform them.', 'scope', 'map'),
      block('For an approval workflow, include the decision point and the return path for incomplete requests. Ask the team to walk through a real example before changing the process.', 'map')]
  }
];
