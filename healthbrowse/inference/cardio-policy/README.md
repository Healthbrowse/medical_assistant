# Cardiology visual policy pilot

Open `/cardio-pilot.html` on the feature build. From a normal Browser heart result, **Try the research visual on this answer** applies the learned selector to that answer’s claims and citations without making a second model call. The adjacent link opens the standalone pilot. Choose General or Clinicians and try “Heart”, “Show the valves of the heart” and “Trace the pulmonary circuit of the heart”. The pilot is opt-in.

The planner interprets a question about normal adult chambers, valves or circulation and checks what the local textbook snapshot supports. SigLIP scored the two bundled JPEGs against three concept prompts on CPU. The visual agent ranks eligible illustrations by those cached scores. The response composer uses the same passages for text and SVG edges. An illustration must match the indexed JPEG hash before display. Unsupported questions receive a scope message. The regular Browser retains its existing model providers. The pilot itself uses extractive answers and grounded flow descriptions and makes zero hosted inference calls.

## Run or review for free

From the `healthbrowse` directory, run the following and open `http://localhost:8000/cardio-pilot.html`. No account, GPU, API key or Node installation is needed for this local viewer.

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Under **Reviewer session**, choose **Start review**. The page assigns 24 randomized responses across both reading modes. Rate relevance, factual support and text–visual agreement. For clarifications and text-only answers, rate whether the omission of a visual is appropriate. Progress stays in this browser. **Export ratings** produces a JSON file, including for partial sessions. Use independent clinician and general-audience reviewers. Assignments use authored educational questions. The export contains item IDs, logged action probabilities and ratings. Free-form searches are excluded.

To distribute assignments separately or fit a research candidate using Node 24:

```sh
node inference/cardio-policy/study.mjs assign reviewer-assignment.json
node inference/cardio-policy/study.mjs fit candidate.json reviewer-report.json cardio-ratings-*.json
```

The fitting command rejects duplicate records, altered action probabilities and incompatible study versions. All four actions need training coverage. A factual-support or agreement failure earns a reward of −1. Fully supported, relevant responses earn +1. Supported but irrelevant responses earn 0. Each action has a linear expected-reward model trained on CPU with inverse-propensity-weighted squared loss and ridge regularization. The runtime selects the highest-scoring eligible action. Exploration occurs only in review sessions. A fresh assignment is needed for each independent reviewer. The fitting command writes a separate candidate and report for inspection.

## First benchmark

The 120 authored questions form 30 paraphrase families. Eighteen families (72 questions) train the policy. Twelve disjoint families (48 questions) evaluate it. Both audiences see the same questions. One randomly chosen eligible action per training question and audience has a simulated reward derived from its design target, giving 144 training decisions. The family split is fixed. These are engineering checks against author-defined routing expectations.

| Selector | General matches | Clinician matches | Unwanted visuals per audience | Missed visuals per audience |
| --- | ---: | ---: | ---: | ---: |
| Existing heart-specific routing rules | 29/48 | 29/48 | 1 | 14 |
| Expanded planner and evidence checks with fixed action priority | 47/48 | 47/48 | 0 | 1 |
| Expanded planner with learned action selection | 47/48 | 47/48 | 0 | 1 |

The original heart router's ordinary-search handoff counts as no dedicated heart visual. The benchmark excludes images the broader search service might return. The controlled comparison shows equal performance for the learned selector and rules with the same planner. Running the two audiences gives 96 decisions from 48 distinct held-out questions. No clinician ratings or end-to-end medical accuracy estimate are included.

The reviewer report separately estimates held-out reward by audience, with matched counts, unsupported action counts and effective sample size. It withholds the estimate when logged trials cannot support the comparison. For a publication study, freeze the candidate before collecting a new independently authored test set, have reviewers assess clinical support and visual agreement, and account for repeated question families and reviewers. Keep ambiguous cases, false-premise questions and missing evidence in the test set.

## Reproduce the artifacts

```sh
node inference/cardio-policy/study.mjs casebook dist/cardio-review-cases.json
node inference/cardio-policy/study.mjs smoke dist/cardio-policy.json inference/cardio-policy/smoke-results.json
node --test tests/cardio-policy.test.mjs
```

To regenerate the pixel scores, use Python 3.12 and run the following inside an isolated environment. The first run downloads about 210 MB of pinned model and tokenizer files. The Worker only serves the score table and the small policy.

```sh
python -m pip install numpy==2.3.5 pillow==13.0.0 tokenizers==0.22.1 onnxruntime==1.23.2
python inference/cardio-policy/index_figures.py --cache /tmp/healthbrowse-siglip
```

The model index records the ONNX revision, prompts, JPEG checksums and cosine scores. The vision model ranked the valve image highest even for the chambers prompt. Restricting eligible figures using the cited catalog prevents that mismatch. [SigLIP ONNX checkpoint](https://huggingface.co/Xenova/siglip-base-patch16-224/tree/4649052661e53c7000355844105f8a1792088239)
