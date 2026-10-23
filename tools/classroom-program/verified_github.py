"""Fail-closed, read-only GitHub attestations for Classroom programme state.

No API call in this module writes to GitHub. Recorded receipts are claims until
checked against the canonical repository, exact SHA, workflow and reviewer.
"""
from __future__ import annotations

from functools import lru_cache
import json
import os
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import quote

REPOSITORY = "spikeal8-maker/asa-lab"
REPO_OWNER = "spikeal8-maker"
SHA = re.compile(r"^[0-9a-f]{40}$")
RUN_LINK = re.compile(r"^https://github\.com/spikeal8-maker/asa-lab/actions/runs/([0-9]+)$")
PR_LINK = re.compile(r"^https://github\.com/spikeal8-maker/asa-lab/pull/([0-9]+)$")
COMMIT_LINK = re.compile(r"^https://github\.com/spikeal8-maker/asa-lab/commit/([0-9a-f]{40})$")
OWNER_LINK = re.compile(r"^https://github\.com/spikeal8-maker/asa-lab/issues/715#issuecomment-([0-9]+)$")


class RemoteProofError(Exception):
    pass


def token() -> str:
    value = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    if not value:
        raise RemoteProofError("GitHub bearer token missing; offline evidence cannot be accepted")
    return value


def github_json(path: str, access_token: str):
    """Only relative paths under the pinned repository; redirect-free JSON API."""
    if not path.startswith("/repos/" + REPOSITORY + "/"):
        raise RemoteProofError("Cross-repository GitHub evidence is prohibited")
    req = Request(
        "https://api.github.com" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Authorization": "Bearer " + access_token,
            "User-Agent": "asa-classroom-verified-proof",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=20) as response:
            if response.geturl().split("/", 3)[:3] != ["https:", "", "api.github.com"]:
                raise RemoteProofError("Unexpected GitHub redirect")
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        raise RemoteProofError("GitHub evidence unavailable: " + type(exc).__name__) from exc


def _sha(value: str) -> str:
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise RemoteProofError("Exact 40-character GitHub SHA required")
    return value


def _matched(pattern, uri, kind):
    match = pattern.fullmatch(uri or "")
    if match is None:
        raise RemoteProofError("Untrusted " + kind + " proof link: " + str(uri)[:160])
    return match.group(1)


def _main_sha(access_token):
    resp = github_json("/repos/" + REPOSITORY + "/git/ref/heads/main", access_token)
    return _sha(resp.get("object", {}).get("sha"))


def verify_owner_choice(key: str, recorded: dict | None):
    """A local decision file only carries a claim; check an exact owner comment."""
    if not isinstance(recorded, dict) or recorded.get("choice") is None:
        return False
    url = recorded.get("evidence", "")
    match = OWNER_LINK.fullmatch(url)
    if not match:
        return False
    try:
        return _verified_owner_comment(key,recorded["choice"],url,token())
    except (RemoteProofError, KeyError, TypeError):
        return False


@lru_cache(maxsize=128)
def _verified_owner_comment(key: str, choice: str, url: str, access_token: str):
    comment_id = _matched(OWNER_LINK,url,'owner decision')
    item = github_json(
        "/repos/" + REPOSITORY + "/issues/comments/" + comment_id, access_token
    )
    exact_line = "ASA-CLASSROOM-DECISION:" + key + "=" + choice
    lines = (item.get("body") or "").splitlines()
    return (
        item.get("user", {}).get("login") == REPO_OWNER
        and item.get("html_url") == url
        and any(line.strip() == exact_line for line in lines)
    )


def _get_reviews(pr_number: int, commit_sha: str, author_login: str, needs_security: bool, access_token: str):
    """Use the latest authenticated exact-SHA reviewer verdict, never an old PASS."""
    reviews = github_json(
        "/repos/" + REPOSITORY + "/pulls/" + str(pr_number) + "/reviews?per_page=100",
        access_token,
    )
    if not isinstance(reviews, list):
        raise RemoteProofError("Unexpected PR review response")
    exact = [x for x in reviews if x.get("commit_id") == commit_sha]
    if any(x.get("state") == "CHANGES_REQUESTED" for x in exact):
        raise RemoteProofError("Exact-SHA independent review contains change requests")
    human_approved = any(
        x.get("state") == "APPROVED"
        and x.get("user", {}).get("login") not in {author_login, "", None}
        for x in exact
    )
    comments = github_json(
        "/repos/" + REPOSITORY + "/issues/" + str(pr_number) + "/comments?per_page=100",
        access_token,
    )
    if not isinstance(comments, list):
        raise RemoteProofError("Unexpected review comments response")
    # A Codex summary may be edited in place. Use updated_at rather than relying
    # on creation order; do not silently skip a newer failed exact-SHA verdict.
    latest = None
    for comment in comments:
        if (comment.get("user") or {}).get("login") != "chatgpt-codex-connector[bot]":
            continue
        marker = "<!-- codex-review-state:v1 "
        body = comment.get("body") or ""
        if marker not in body:
            continue
        try:
            state = json.loads(body.split(marker, 1)[1].split(" -->", 1)[0])
        except (ValueError, IndexError, TypeError):
            continue
        if not isinstance(state, dict):
            continue
        code = state.get("code_review") or {}
        security = state.get("security_review") or {}
        if not isinstance(code, dict) or not isinstance(security, dict):
            continue
        if code.get("commit_sha") != commit_sha and security.get("commit_sha") != commit_sha:
            continue
        order = (comment.get("updated_at") or comment.get("created_at") or "",
                 comment.get("id") or 0)
        if latest is None or order > latest[0]:
            latest = (order, code, security)
    if latest is not None:
        _, code, security = latest
        required = [code] + ([security] if needs_security else [])
        if all(
            state.get("commit_sha") == commit_sha
            and state.get("status") == "completed"
            and state.get("has_any_findings") is False
            and state.get("has_unresolved_findings") is False
            for state in required
        ):
            return
        raise RemoteProofError("Latest exact-SHA Codex review has findings or is incomplete")
    if human_approved:
        return
    raise RemoteProofError("No authenticated independent clean review for exact SHA")

def _ci_run(ev: dict, commit_sha: str, kind: str, access_token: str):
    number = _matched(RUN_LINK, ev.get("uri"), kind)
    run = github_json(
        "/repos/" + REPOSITORY + "/actions/runs/" + number, access_token
    )
    if (
        run.get("head_sha") != commit_sha
        or run.get("conclusion") != "success"
        or run.get("status") != "completed"
        or run.get("repository", {}).get("full_name") != REPOSITORY
    ):
        raise RemoteProofError(kind + " workflow not successful on exact source SHA")
    run_name = (run.get("name") or "").lower()
    if kind == "focused" and "classroom" not in run_name:
        raise RemoteProofError("Focused evidence must be from a Classroom workflow")
    jobs_data = github_json(
        "/repos/" + REPOSITORY + "/actions/runs/" + number + "/jobs?per_page=100",
        access_token,
    )
    jobs = jobs_data.get("jobs", [])
    if not isinstance(jobs, list) or not jobs:
        raise RemoteProofError("Workflow has no verifiable jobs")
    success = [
        (j.get("name") or "").lower()
        for j in jobs
        if j.get("status") == "completed" and j.get("conclusion") == "success"
    ]
    if kind == "pg" and not any("postgres" in n or "rls" in n for n in success):
        raise RemoteProofError("No successful real PostgreSQL/RLS job")
    if kind == "visual" and not any(
        "browser" in n or "playwright" in n or "visual" in n for n in success
    ):
        raise RemoteProofError("No successful browser/visual job")
    if not success:
        raise RemoteProofError("Workflow lacked successful jobs")


def verify_acceptance(reg: dict, task: dict, receipt: dict, main_sha: str, code_sha: str, evidence: dict):
    """Authenticate ALL relevant acceptance proofs; reject any missing remote fact."""
    if reg.get("repository") != REPOSITORY:
        raise RemoteProofError("Programme repository identity mismatch")
    access_token = token()
    current_main = _main_sha(access_token)
    if _sha(main_sha) != current_main:
        raise RemoteProofError("Main changed; refresh baseline before acceptance")
    if code_sha != current_main:
        compare = github_json(
            "/repos/" + REPOSITORY + "/compare/" + code_sha + "..." + current_main,
            access_token,
        )
        if compare.get("status") not in {"ahead", "identical"} or compare.get("behind_by") != 0:
            raise RemoteProofError("Source commit not an ancestor of actual GitHub main")

    _matched(COMMIT_LINK, evidence["source"]["uri"], "source")
    if evidence["source"]["uri"] != "https://github.com/" + REPOSITORY + "/commit/" + code_sha:
        raise RemoteProofError("Source receipt link does not identify exact source commit")
    if evidence["integration"]["uri"] != "https://github.com/" + REPOSITORY + "/commit/" + current_main:
        raise RemoteProofError("Integration proof must identify current real GitHub main")

    pr_number = int(_matched(PR_LINK, evidence["review"]["uri"], "review"))
    pr = github_json(
        "/repos/" + REPOSITORY + "/pulls/" + str(pr_number),
        access_token,
    )
    if (
        not pr.get("merged_at")
        or pr.get("head", {}).get("sha") != code_sha
        or pr.get("base", {}).get("ref") != "main"
        or pr.get("base", {}).get("repo", {}).get("full_name") != REPOSITORY
    ):
        raise RemoteProofError("Exact source PR is not merged into canonical main")
    # A reused old PR from another module must not authorize this task.
    scope_refs = (pr.get("body") or "") + "\n" + (pr.get("title") or "")
    if task["id"] not in scope_refs:
        raise RemoteProofError("PR does not reference the selected task ID")
    _get_reviews(
        pr_number,
        code_sha,
        pr.get("user", {}).get("login"),
        task.get("risk") == "security",
        access_token,
    )

    for kind in task["gates"]:
        if kind in {"focused", "pg", "visual"}:
            _ci_run(evidence[kind], code_sha, kind, access_token)

    # General guard is mandatory even for a focused documentation/control task.
    check_data = github_json(
        "/repos/" + REPOSITORY + "/commits/" + code_sha + "/check-runs?per_page=100",
        access_token,
    )
    checks = check_data.get("check_runs", [])
    required = {"Governance contracts", "Format lint types contracts build"}
    if "pg" in task["gates"]:
        required.add("PostgreSQL tests and RLS")
    if "visual" in task["gates"]:
        required.add("Access A real browser journeys")
    for name in required:
        found = sorted(
            (x for x in checks if x.get("name") == name and x.get("head_sha") == code_sha),
            key=lambda x: x.get("id") or 0,
        )
        if not found or found[-1].get("status") != "completed" or found[-1].get("conclusion") != "success":
            raise RemoteProofError("Missing latest exact-SHA General CI success: " + name)
    if _main_sha(access_token) != current_main:
        raise RemoteProofError("GitHub main moved during attestation")
    return {
        "verified": "GITHUB_API_VERIFIED",
        "repository": REPOSITORY,
        "source_sha": code_sha,
        "main_sha": current_main,
        "pull_request": pr_number,
    }
