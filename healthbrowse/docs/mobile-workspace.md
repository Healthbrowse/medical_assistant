# HealthBrowse mobile research workspace

## Implemented

The mobile web app shares the authenticated search and source-grounded answer flow with the desktop browser.

The search form appears below the header. Four bottom-navigation actions change with the selected reading mode. The menu includes appearance controls and sign-out.

| Reading mode | Bottom actions | Workspace |
| --- | --- | --- |
| General (including legacy Patient preference) | Home, Sources, History, Account | Plain-language answers, guided Buddy prompts and a pinned medical disclaimer |
| Clinicians | Home, Evidence, Sources, History | Clinical Synthesis, Evidence Breakdown, and Limitations & Contraindications |

Reading modes control answer presentation. Legacy Student selections use the Clinician educational style.

Tapping a citation reveals the available supporting passage and its original publisher link. Readers can distinguish cited generated claims, source excerpts and evidence gaps.

The Student workspace, study-card controls and notebook are no longer presented. Existing session notes are not deleted by this role change; normal sign-out cleanup still clears them.

## Buddy, voice and feedback

Buddy remains user-opened. The mobile launcher sits above navigation; tap opens the conversation and hold opens the voice-input consent flow. The composer remains separate from the scrolling conversation and adjusts to the browser visual viewport when the software keyboard opens. Guided questions are collapsed under “Explore this topic.”

Voice typing uses SpeechRecognition where supported, only after explicit consent. Browser speech services may process audio remotely; the UI explains this before activation. Listening stops after 30 seconds, cancellation, closing Buddy, backgrounding or leaving the page. Only final text is placed in the input. Nothing is automatically submitted. Typing remains available when browser support or permission is absent.

Read-aloud uses an available on-device English voice only. Tapping the screen, closing the sheet or leaving the page cancels it. Four highlighted terms—etiology, prognosis, biopsy and biomarker—open short NCI-based explanations, pronunciation text, an optional local voice and an original-source link. This is a limited glossary, not arbitrary medical-term translation.

Detected safety blocks can request a short device vibration when supported and reduced-motion is not enabled. A static outline/status accompanies the existing response; no flashing warning is used. A missing vibration or audio capability never blocks the textual response.

## Not connected

Dedicated clinical imaging interpretation, a patient health vault and vector-based cross-modal retrieval require separate integrations.

## Verification

Automated regression tests cover role routing and persistence, source passage click events, source-preserving study cards, bounded/private notes and logout cleanup, dictation cancellation and unsupported devices, local-only speech voices, and long-press behavior. Existing search, safety, account and citation suites remain applicable.

Differences in software keyboards, speech support and haptic behavior require device-specific testing.

## Reference documentation

- [MDN: SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [MDN: VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
- [MDN: Navigator.vibrate](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)
- NCI Dictionary: [etiology](https://www.cancer.gov/publications/dictionaries/cancer-terms/def/etiology), [prognosis](https://www.cancer.gov/publications/dictionaries/cancer-terms/def/prognosis), [biopsy](https://www.cancer.gov/publications/dictionaries/cancer-terms/def/biopsy), [biomarker](https://www.cancer.gov/publications/dictionaries/cancer-terms/def/biomarker). Dictionary explanations checked 2026-11-13.

Home returns to the top without clearing the current answer or opening the keyboard. Sources opens the current browser answer’s references. Uploaded document citations open within Buddy. Before any search it shows a short explanation and a search action. Bookmarks remain available in Account settings.
