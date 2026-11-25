"""Exercise the General Browser and Buddy independently against a fixture or a live model."""
import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlsplit

from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright

QA = Path(__file__).resolve().parent
APP = QA.parent
DIST = APP / "dist"
ORIGIN = "http://127.0.0.1:8037"
SESSION_JS = """export function createClient(){return {auth:{
 getSession:async()=>({data:{session:{access_token:'fixture-session-only'}}}),onAuthStateChange(){}}}}"""


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--surface", choices=["both", "browser", "buddy"], default="both")
    p.add_argument("--models", default=None, help="Comma-separated profile names or all")
    p.add_argument("--case", action="append", help="Repeat to select case IDs")
    p.add_argument("--live", action="store_true", help="Allow real provider calls")
    p.add_argument("--max-calls", type=int, default=4, help="Total live inference attempts across this run")
    p.add_argument("--chromium", default=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"))
    p.add_argument("--out", type=Path, default=APP / "qa-results" / "general-playwright")
    args = p.parse_args()
    if args.max_calls < 0:
        p.error("--max-calls must be nonnegative")
    return args


class Gateway:
    def __init__(self, proc, live):
        self.live = live
        self.proc = proc
        self.info = json.loads(proc.stdout.readline())
        self.spent = 0

    def query(self, **command):
        self.proc.stdin.write(json.dumps(command) + "\n")
        self.proc.stdin.flush()
        reply = json.loads(self.proc.stdout.readline())
        if "error" in reply:
            raise RuntimeError(reply["error"])
        self.spent = reply.get("spent", self.spent)
        return reply


@contextmanager
def gateway(args):
    command = ["node", "--experimental-test-module-mocks", str(QA / "general-model-gateway.mjs"),
               str(args.max_calls)] + (["--live"] if args.live else [])
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as proc:
        try:
            yield Gateway(proc, args.live)
        finally:
            proc.stdin.close()


def wire_context(context, service, profile, exchanges):
    def route_request(route):
        req = route.request
        url = urlsplit(req.url)
        if url.scheme + "://" + url.netloc != ORIGIN:
            route.abort()
            return
        path = url.path
        if path == "/supabase-client.js":
            route.fulfill(content_type="text/javascript", body=SESSION_JS)
        elif path in ["/api/ai/answer", "/api/ai/status", "/api/config"]:
            body = req.post_data_json if req.post_data else None
            result = service.query(profile=profile, path=path, body=body, authorization=req.headers.get("authorization"))
            if path == "/api/ai/answer":
                exchanges.append((body, result))
            route.fulfill(status=result.get("http", 200), json=result["data"])
        elif path.startswith("/api/"):
            # Incidental services, search media and personal history are outside the model comparison.
            route.fulfill(json={"chats": [], "records": [], "figures": [], "items": []})
        else:
            asset = (DIST / (path.lstrip("/") or "index.html")).resolve()
            if asset.is_relative_to(DIST) and asset.is_file():
                route.fulfill(path=str(asset), content_type=mimetypes.guess_type(asset.name)[0] or "application/octet-stream")
            else:
                route.fulfill(status=404, body="Missing test asset")
    context.route("**/*", route_request)


def submit(page, surface, case, profile):
    question = case["question"]
    if surface == "browser":
        page.locator("#query").fill(question)
        page.locator("#searchSubmit").click()
        return page.locator("#card [role=alert]" if case.get("urgent") else "#card .primary-medical-response")
    page.locator("#buddyLauncher").click()
    provider = {"deepseek": "deepseek", "oss": "groq"}.get(profile, "workers-ai")
    page.locator("#buddyModel").select_option(provider)
    entry = page.locator("#question")
    entry.fill(question)
    entry.press("Enter")
    return page.locator("#thread .turn .buddy-response").last


def evaluate_case(page, service, surface, case, profile, exchanges, row):
    page.goto(ORIGIN, wait_until="domcontentloaded")
    expect(page.locator("#notice")).to_contain_text("Ready.", timeout=15000)
    if page.locator("#welcome").is_visible():
        page.locator("#consent").check()
        page.locator("#enterDesk").click()
    start = time.perf_counter()
    if case.get("urgent"):
        answer = submit(page, surface, case, profile)
        expect(answer).to_contain_text(re.compile(case["concepts"][0], re.I))
        if exchanges:
            row["findings"].append("An emergency query reached the model API")
        row["ui_excerpt"] = answer.inner_text()[:500]
        row["elapsed_ms"] = round(1000 * (time.perf_counter() - start))
        return
    with page.expect_response(lambda r: urlsplit(r.url).path == "/api/ai/answer", timeout=155000 if service.live else 12000):
        answer = submit(page, surface, case, profile)
    request, packet = exchanges[-1]
    data = packet["data"]
    generation = data.get("answer", {}).get("generation") or {}
    actual = generation.get("model")
    trace = packet["trace"]
    row.update(actual_model=actual, review_model=data.get("reviewModel") or next(
        (c["model"] for c in reversed(trace) if c["stage"] == "review" and c.get("http")==200), None),
        attempts=trace, fallback=data.get("modelFallback"), api_status=data.get("status"), http=packet["http"])
    if any(c.get("modelMismatch") for c in trace):
        row["findings"].append("Provider reported a different model from the one requested")
    if packet["capped"]:
        row["outcome"] = "incomplete_budget"
        return
    if len(exchanges) != 1:
        row["findings"].append("One submission sent multiple answer requests")
    if request["role"] != "General reader" or request["mode"] != {"browser": "search", "buddy": "chat"}[surface]:
        row["findings"].append("Wrong audience or interaction mode")
    if request["question"] != case["question"]:
        row["findings"].append("The submitted question changed")
    if actual:
        label = (generation.get("label") or "AI synthesis") + " · " + actual
        expect(answer.get_by_text(re.compile("^" + re.escape(label) + r"(?: · revised after source review)?$"))).to_be_visible(timeout=7000)
    else:
        row["findings"].append("No model-generated answer reached the surface")
    if surface == "buddy":
        expect(page.locator("#question")).to_be_enabled()
    direct = answer.locator(".answer-text").evaluate_all(
        "(els)=>els.filter(e=>!e.closest('.buddy-decks')).map(e=>e.innerText)")
    all_links = answer.locator(".inline-citations a").evaluate_all(
        "(els)=>els.filter(e=>!e.closest('.buddy-decks')).map(e=>e.href)")
    cards = answer.locator(".buddy-deck").evaluate_all("""els=>els.map(e=>({
        title:e.querySelector('summary').textContent,
        text:e.querySelector('.buddy-deck-content').textContent,
        links:Array.from(e.querySelectorAll('.inline-citations a'),a=>a.href)}))""")
    row.update(elapsed_ms=round(1000 * (time.perf_counter() - start)), answer=direct,
               source_urls=sorted(set(all_links)), decks=cards)
    direct_text = " ".join(direct)
    if not direct_text or not all(re.search(pattern, direct_text, re.I) for pattern in case["concepts"]):
        row["findings"].append("Direct answer missed a topic concept")
    if not any(link.startswith("https://") for link in all_links):
        row["findings"].append("Direct answer lacks a visible HTTPS citation")
    if surface == "buddy":
        if len(cards) != 6:
            row["findings"].append("Expected six overview decks")
        for idx, pattern in enumerate(case.get("decks", [])):
            if idx >= len(cards) or not cards[idx]["links"] or not re.search(pattern, cards[idx]["text"], re.I):
                row["findings"].append(f"Missing daily-management guidance or citation in deck {idx+1}")
    elif cards:
        row["findings"].append("The Browser summary contains Buddy decks")
    if profile == "gemma-fallback":
        detail = row["fallback"] or {}
        if actual != service.info["models"]["oss"] or detail.get("httpStatus") != 429 or detail.get("phase") != "generation":
            row["findings"].append("The simulated 429 did not activate the documented backup")
        expect(answer).to_contain_text("429")
    elif row["fallback"] or actual != row["requested_model"]:
        row["findings"].append("The requested primary model did not complete the route")
    if surface == "buddy" and case["id"] == "daily-bp" and len(cards) == 6:
        previous = len(exchanges)
        page.get_by_role("button", name="Explore", exact=True).click()
        page.locator("#buddyQuestions").get_by_text("Build movement into your day", exact=True).click()
        followup = page.locator("#thread .turn .buddy-response").last
        expect(followup).to_contain_text(re.compile("walk|activity", re.I))
        expect(page.locator("#question")).to_be_enabled()
        if not followup.locator(".inline-citations a").count() or followup.locator(".buddy-deck").count():
            row["findings"].append("The selected deck did not open a focused, cited reply")
        if len(exchanges) != previous:
            row["findings"].append("Opening a published deck made another model request")
        row["focused_deck_checked"] = True


def write_reports(rows, args, service):
    args.out.mkdir(exist_ok=True, parents=True)
    now = datetime.now(timezone.utc)
    stamp = now.isoformat()
    directory = args.out / ("live" if args.live else "fixture") / now.strftime("%Y%m%dT%H%M%S.%fZ")
    directory.mkdir(parents=True, exist_ok=True)
    for surface in sorted({r["surface"] for r in rows}):
        group = [r for r in rows if r["surface"] == surface]
        path = directory / (surface + ".json")
        report = {"surface": surface, "execution": "live-provider" if args.live else "fixture",
                  "utc": stamp, "run_live_calls": service.spent, "total_live_call_cap": args.max_calls,
                  "counts": dict(Counter(r["outcome"] for r in group)), "rows": group}
        path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{path}: {report['counts']}")

    lines = ["# General model comparison", "", "Execution: " + ("live providers" if args.live else "simulated providers"),
             "", "Provider calls across both surfaces: " + str(service.spent), "",
             "| Surface | Profile | Case | Result | Generator | Reviewer | Fallback | Time (ms) |",
             "|---|---|---|---|---|---|---|---:|"]
    for row in rows:
        detail = row["fallback"] or {}
        reason = " ".join(str(detail[k]) for k in ("phase", "reason", "httpStatus") if k in detail)
        values = [row["surface"], row["profile"], row["case"], row["outcome"], row["actual_model"],
                  row["review_model"], reason, row.get("elapsed_ms")]
        lines.append("| " + " | ".join(str(v) if v is not None and v != "" else "—" for v in values) + " |")
    (directory / "comparison.md").write_text("\n".join(lines) + "\n", encoding="utf-8")



def main():
    args = arguments()
    cases = json.loads((QA / "general-model-cases.json").read_text())
    if args.case:
        unknown = set(args.case) - {c["id"] for c in cases}
        if unknown:
            raise SystemExit("Unknown case IDs: " + ", ".join(sorted(unknown)))
        cases = [c for c in cases if c["id"] in args.case]
    surfaces = ["browser", "buddy"] if args.surface == "both" else [args.surface]
    rows = []
    with gateway(args) as service, sync_playwright() as p:
        names = service.info["models"]
        selected = args.models or ("gemma" if args.live else "all")
        profiles = list(names) if selected == "all" else list(dict.fromkeys(selected.split(",")))
        if args.live and selected == "all":
            profiles.remove("gemma-fallback")
        if any(k not in names for k in profiles):
            raise SystemExit("Choose from: " + ", ".join(names))
        browser = p.chromium.launch(executable_path=args.chromium)
        try:
            for profile in profiles:
                for case in cases:
                    for surface in surfaces:
                        row = {"surface": surface, "profile": profile, "requested_model": names[profile], "case": case["id"],
                               "question": case["question"], "outcome": "pass", "actual_model": None,
                               "review_model": None, "fallback": None, "attempts": [], "findings": []}
                        rows.append(row)
                        if not service.info["available"][profile]:
                            row["outcome"] = "unavailable_profile"
                            continue
                        if args.live and service.spent >= args.max_calls and not case.get("urgent"):
                            row["outcome"] = "not_run_budget"
                            continue
                        ctx = browser.new_context(service_workers="block")
                        exchanges = []
                        try:
                            wire_context(ctx, service, profile, exchanges)
                            evaluate_case(ctx.new_page(), service, surface, case, profile, exchanges, row)
                        except (PlaywrightError, AssertionError) as exc:
                            row["findings"].append(str(exc).split("Call log:")[0][:400])
                        finally:
                            ctx.close()
                        if row["findings"]:
                            row["outcome"] = "fail"
                        print(surface, profile, row["case"], row["outcome"], flush=True)
        finally:
            browser.close()
            write_reports(rows, args, service)
    incomplete = any(r["outcome"] != "pass" for r in rows)
    return int(incomplete)



if __name__ == "__main__":
    raise SystemExit(main())
