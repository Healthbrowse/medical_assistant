"""Dataset validation and leakage detection, independently of GPU dependencies."""
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from .contracts import Query, validate_answer
from .prompts import messages


def read_jsonl(path):
    rows = []
    for number, line in enumerate(Path(path).read_text().splitlines(), 1):
        if line.strip():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON at {Path(path).name}:{number}") from exc
    if not rows:
        raise ValueError("Dataset is empty")
    return rows


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical_url(url):
    p = urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        raise ValueError("Source URLs must be public HTTPS references without credentials")
    return urlunsplit((p.scheme, p.netloc.lower(), p.path.rstrip("/"), "", ""))


def normalized(value):
    return re.sub(r"\W+", " ", value.casefold()).strip()


def validate_rows(rows, allow_examples=False):
    ids = set()
    for row in rows:
        if not row.get("id") or row["id"] in ids or not row.get("topic_group"):
            raise ValueError("Unique row ID and topic_group are required")
        ids.add(row["id"])
        q = Query.model_validate(row["input"])
        answer = validate_answer(row["target"], q)
        if row.get("example_only"):
            if not allow_examples:
                raise ValueError("Illustrative data is allowed only with --smoke or example validation")
        elif row.get("review", {}).get("status") != "approved" or not row.get("review", {}).get("reviewer"):
            raise ValueError("Training records need an accountable target review")
        rights = row.get("rights", {})
        for source in q.evidence:
            canonical_url(source.url)
            permission = rights.get(source.id, {})
            if permission.get("training_permitted") is not True or not permission.get("license") or not permission.get("basis_url"):
                raise ValueError("Each evidence source requires recorded training rights")
            canonical_url(permission["basis_url"])
        if not row.get("example_only") and not row.get("review", {}).get("claim_support_checked"):
            raise ValueError("Training targets need source-support review, not only valid citation syntax")
        if answer.status == "answer" and not q.evidence:
            raise ValueError("Answers require evidence")
    return rows


def split_keys(rows):
    return {
        "ids": {r["id"] for r in rows},
        "topics": {normalized(r["topic_group"]) for r in rows},
        "questions": {normalized(r["input"]["question"]) for r in rows},
        "pages": {canonical_url(s["url"]) for r in rows for s in r["input"].get("evidence", [])},
        "passages": {hashlib.sha256(normalized(s["text"]).encode()).hexdigest() for r in rows for s in r["input"].get("evidence", [])},
    }


def validate_splits(*splits):
    keys = [split_keys(rows) for rows in splits]
    for i, left in enumerate(keys):
        for right in keys[i + 1:]:
            for kind in left:
                if left[kind] & right[kind]:
                    raise ValueError(f"Split leakage detected by {kind}")
    return True


def encode_row(row, tokenizer, max_length):
    q = Query.model_validate(row["input"])
    prompt = messages(q)
    prefix = tokenizer.apply_chat_template(prompt, tokenize=True, add_generation_prompt=True)
    full = tokenizer.apply_chat_template([*prompt, {"role": "assistant", "content": json.dumps(row["target"], ensure_ascii=False)}], tokenize=True, add_generation_prompt=False)
    if full[:len(prefix)] != prefix:
        raise ValueError("Chat-template prefix mismatch: assistant labels cannot be located safely")
    if len(full) > max_length:
        raise ValueError(f"Example {row['id']} exceeds max_length; split evidence, never silently truncate")
    if len(full) <= len(prefix):
        raise ValueError("No assistant tokens to train")
    return {"input_ids": full, "attention_mask": [1] * len(full), "labels": [-100] * len(prefix) + full[len(prefix):]}
