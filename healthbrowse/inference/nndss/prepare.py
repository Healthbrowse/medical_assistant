"""Prepare one shared, chronological NNDSS benchmark for the Buddy model adapters."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.pipeline import make_pipeline

DATASET = "x9gk-5huc"
API = f"https://data.cdc.gov/resource/{DATASET}.json"
METADATA = f"https://data.cdc.gov/api/views/{DATASET}.json"
LABELS = ["no_reported_cases", "low", "medium", "high"]
SEED = 42


def fetch(url, params=None):
    if params:
        url += "?" + urlencode(params)
    token = os.getenv("SOCRATA_APP_TOKEN")
    request = Request(url, headers={"X-App-Token": token} if token else {})
    with urlopen(request, timeout=120) as response:
        return json.load(response)


def download(weeks):
    version = fetch(METADATA)["rowsUpdatedAt"]
    query = {"$select": "label,states,year,week,m1,m1_flag", "$where": f"year >= '2014' AND week <= {weeks}",
             "$order": "year,week,sort_order,:id", "$limit": 25000}
    pages = []
    offset = 0
    while True:
        page = fetch(API, {**query, "$offset": offset})
        if page:
            pages.append(pd.DataFrame.from_records(page))
        if len(page) < query["$limit"]:
            break
        offset += len(page)
    if not pages or fetch(METADATA)["rowsUpdatedAt"] != version:
        raise ValueError("Empty or changing CDC snapshot. Retry the download.")
    return pd.concat(pages, ignore_index=True), version


def modeling_rows(raw):
    frame = raw.rename(columns={"label": "disease", "states": "area"}).copy()
    numbers = pd.to_numeric(frame["m1"], errors="coerce")
    flags = frame["m1_flag"].fillna("").str.strip()
    # Some numbered rows also carry '-'. The published number takes precedence.
    no_report = frame["m1"].isna() & flags.eq("-")
    frame["count"] = numbers.mask(no_report, 0)
    frame = frame.loc[flags.isin(["", "-"]) & frame["count"].ge(0)].copy()
    for column in ["disease", "area"]:
        frame[column] = frame[column].astype("string").str.strip().str.casefold()
    frame = frame.dropna(subset=["disease", "area", "year", "week"])
    frame = frame.loc[frame.disease.ne("") & frame.area.ne("")]
    frame[["year", "week"]] = frame[["year", "week"]].astype(int)
    key = ["disease", "area", "year", "week"]
    frame = frame[key + ["count"]].drop_duplicates().sort_values(key).reset_index(drop=True)
    if frame.duplicated(key).any():
        raise ValueError("Conflicting observations for the same condition, area and MMWR week")
    groups = frame.groupby(["disease", "area", "year"], sort=False)
    frame["previous"] = groups["count"].shift().where(groups["week"].diff().eq(1))
    return frame


def make_splits(frame, sizes):
    years = sorted(frame.year.unique().tolist())
    if len(years) < 3:
        raise ValueError("At least three distinct reporting years are required")
    train = frame[frame.year < years[-2]]
    positive = train.loc[train["count"] > 0, "count"]
    if positive.empty:
        raise ValueError("No positive counts in the training years")
    low, medium = positive.quantile([1/3, 2/3])
    if medium <= low:
        low, medium = positive.quantile([0.5, 0.9])
        medium = max(low + 1, medium)
    splits = {}
    for (name, group), size in zip([("train", train), ("validation", frame[frame.year == years[-2]]),
                                    ("test", frame[frame.year == years[-1]])], sizes, strict=True):
        rows = []
        for r in group.sample(n=min(len(group), size), random_state=SEED).itertuples():
            prior = str(int(r.previous)) if pd.notna(r.previous) else "unknown"
            text = (f"Disease: {r.disease}. Reporting area: {r.area}. MMWR year: {r.year}. "
                    f"MMWR week: {r.week}. Previous week reported cases: {prior}.")
            label = LABELS[0 if r.count == 0 else 1 if r.count <= low else 2 if r.count <= medium else 3]
            rows.append({"text": text, "label": label})
        splits[name] = rows
    return splits, {"train": years[:-2], "validation": years[-2], "test": years[-1]}, [low, medium]


def scores(truth, predictions):
    report = classification_report(truth, predictions, labels=LABELS, output_dict=True, zero_division=0)
    return {"accuracy": accuracy_score(truth, predictions), "macro_f1": report["macro avg"]["f1-score"],
            "per_class": {label: {"f1": report[label]["f1-score"], "support": int(report[label]["support"])}
                          for label in LABELS}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--weeks", type=int, default=4, help="First N MMWR weeks of each available year (53 for all)")
    parser.add_argument("--train-size", type=int, default=4096)
    parser.add_argument("--validation-size", type=int, default=256)
    parser.add_argument("--test-size", type=int, default=1000)
    args = parser.parse_args()
    sizes = [args.train_size, args.validation_size, args.test_size]
    if min(sizes) < 1 or not 1 <= args.weeks <= 53 or args.out.exists():
        parser.error("Use positive split sizes, 1–53 weeks and a new output directory")
    raw, version = download(args.weeks)
    frame = modeling_rows(raw)
    splits, years, cutoffs = make_splits(frame, sizes)
    train, test = splits["train"], splits["test"]
    baseline = make_pipeline(TfidfVectorizer(ngram_range=(1, 2)), LogisticRegression(max_iter=500, class_weight="balanced"))
    baseline.fit([r["text"] for r in train], [r["label"] for r in train])
    truth = [r["label"] for r in test]
    majority = pd.Series([r["label"] for r in train]).mode()[0]
    manifest = {"dataset": DATASET, "source": API, "rows_updated_at": version, "weeks_per_year": args.weeks,
                "downloaded_rows": len(raw), "usable_rows": len(frame), "years": years, "seed": SEED,
                "positive_training_cutoffs": cutoffs, "labels": LABELS, "splits": {},
                "majority_baseline": scores(truth, [majority] * len(test)),
                "tfidf_logistic_regression": scores(truth, baseline.predict([r["text"] for r in test]))}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=args.out.parent) as temp:
        staged = Path(temp) / "splits"
        staged.mkdir()
        for name, rows in splits.items():
            path = staged / (name + ".jsonl")
            path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
            manifest["splits"][name] = {"rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        (staged / "benchmark.json").write_text(json.dumps(manifest, indent=2) + "\n")
        staged.rename(args.out)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
