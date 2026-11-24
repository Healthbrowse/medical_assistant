"""Prepare one shared, chronological NNDSS benchmark for the Buddy model adapters."""
import argparse
import hashlib
import json
import os
from datetime import date, timedelta
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
FIRST_YEAR = 2014


def fetch(url, params=None):
    if params:
        url += "?" + urlencode(params)
    token = os.getenv("SOCRATA_APP_TOKEN")
    request = Request(url, headers={"X-App-Token": token} if token else {})
    with urlopen(request, timeout=120) as response:
        return json.load(response)


def mmwr_year_start(year):
    # CDC weeks start on Sunday. Week 1 contains January 4.
    jan4 = date(year, 1, 4)
    return jan4 - timedelta(days=(jan4.weekday() + 1) % 7)


def download_rows(where):
    query = {"$select": "label,states,year,week,m1,m1_flag", "$where": where,
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
    return pd.concat(pages, ignore_index=True) if pages else pd.DataFrame()


def download(weeks):
    version = fetch(METADATA)["rowsUpdatedAt"]
    target = download_rows(f"year >= '{FIRST_YEAR}' AND week <= {weeks}")
    if target.empty:
        raise ValueError("Empty CDC snapshot.")
    context = []
    for year in sorted(target.loc[target.week.astype(int).eq(1), "year"].astype(int).unique()):
        previous_year = int(year) - 1
        last_week = (mmwr_year_start(int(year)) - mmwr_year_start(previous_year)).days // 7
        if last_week > weeks or previous_year < FIRST_YEAR:
            context.append(f"(year = '{previous_year}' AND week = {last_week})")
    if context:
        previous = download_rows(" OR ".join(context))
        target = pd.concat([target, previous], ignore_index=True)
    if fetch(METADATA)["rowsUpdatedAt"] != version:
        raise ValueError("Empty or changing CDC snapshot. Retry the download.")
    return target, version


def modeling_rows(raw, weeks=53):
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
    years = frame.year.unique()
    starts = {year: mmwr_year_start(int(year)).toordinal() for year in years}
    lengths = {year: (mmwr_year_start(int(year) + 1).toordinal() - starts[year]) // 7 for year in years}
    if ((frame.week < 1) | (frame.week > frame.year.map(lengths))).any():
        raise ValueError("Invalid week number for the MMWR reporting year")
    frame["week_start"] = frame.year.map(starts) + 7 * (frame.week - 1)
    groups = frame.groupby(["disease", "area"], sort=False)
    frame["previous"] = groups["count"].shift().where(groups["week_start"].diff().eq(7))
    targets = frame.year.ge(FIRST_YEAR) & frame.week.le(weeks)
    return frame.loc[targets].drop(columns="week_start").reset_index(drop=True)


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
    frame = modeling_rows(raw, weeks=args.weeks)
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
