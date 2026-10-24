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



MAX_REVIEW_PAGES = 50
REVIEW_PAGE_SIZE = 100


def github_all_pages(path: str, access_token: str, *, max_pages: int = MAX_REVIEW_PAGES):
    """Read every GitHub collection page, rejecting incomplete or unstable snapshots.

    REST page 1 intentionally keeps the previous ?per_page=100 URL. Following
    pages append &page=N; no API redirects or off-repository hosts are used.
    """
    if not path.endswith("?per_page=100") or not 1 <= max_pages <= MAX_REVIEW_PAGES:
        raise RemoteProofError("Invalid bounded GitHub pagination request")
    seen_ids = set()
    entries = []
    for page in range(1, max_pages + 1):
        page_path = path if page == 1 else path + "&page=" + str(page)
        batch = github_json(page_path, access_token)
        if not isinstance(batch, list) or len(batch) > REVIEW_PAGE_SIZE or any(
            not isinstance(entry, dict) for entry in batch
        ):
            raise RemoteProofError("Incomplete or malformed GitHub review collection")
        for item in batch:
            identity = item.get("id")
            if identity is not None:
                if identity in seen_ids:
                    raise RemoteProofError("Duplicate GitHub review/comment across pages")
                seen_ids.add(identity)
        entries.extend(batch)
        if len(batch) < REVIEW_PAGE_SIZE:
            return entries
    raise RemoteProofError("Review/comment pagination limit reached; cannot prove completeness")




def _verified_implementation_authors(pr_number: int, commit_sha: str, access_token: str):
    """Use GitHub's linked commit author and committer identities, never receipt.actor.

    All pages of the exact PR commit list must be readable. Missing attribution
    is an ambiguity, not proof that a contributor is independent.
    """
    commits = github_all_pages(
        "/repos/" + REPOSITORY + "/pulls/" + str(pr_number) + "/commits?per_page=100",
        access_token,
    )
    if not commits:
        raise RemoteProofError("PR has no GitHub-attributed implementation commits")
    source_found = False
    actors = set()
    visited = set()
    for commit in commits:
        if not isinstance(commit, dict):
            raise RemoteProofError("Unverifiable GitHub implementation commit")
        identity = _sha(commit.get("sha"))
        if identity in visited:
            raise RemoteProofError("Duplicate GitHub implementation commit")
        visited.add(identity)
        if identity == commit_sha:
            source_found = True
        for role in ("author", "committer"):
            contributor = commit.get(role)
            login = contributor.get("login") if isinstance(contributor, dict) else None
            if not isinstance(login, str) or not login.strip():
                raise RemoteProofError(
                    "Implementation " + role + " has no authenticated GitHub identity"
                )
            actors.add(login)
    if not source_found:
        raise RemoteProofError("Source SHA absent from authenticated PR commits")
    return actors


def _get_reviews(pr_number: int, commit_sha: str, author_login: str, needs_security: bool, access_token: str, implementation_authors=None):
    """Use the latest authenticated exact-SHA reviewer verdict, never an old PASS."""
    reviews = github_all_pages(
        "/repos/" + REPOSITORY + "/pulls/" + str(pr_number) + "/reviews?per_page=100",
        access_token,
    )
    if not isinstance(reviews, list):
        raise RemoteProofError("Unexpected PR review response")
    # Read the ENTIRE authenticated PR review history before filtering the
    # source SHA. A prior-commit CHANGES_REQUESTED remains a blocker until
    # explicitly APPROVED or DISMISSED by that reviewer; a new head alone is
    # not a dismissal. Positive review evidence still must match exact SHA.
    if any(type(e.get("id")) is not int or e["id"] <= 0 for e in reviews):
        raise RemoteProofError("Invalid or missing authenticated GitHub review ID")
    previous_veto_by_reviewer = {}
    for entry in sorted(reviews, key=lambda e: e["id"]):
        author = (entry.get("user") or {}).get("login")
        if not author:
            raise RemoteProofError("Missing authenticated GitHub reviewer in PR history")
        state = entry.get("state")
        if state == "CHANGES_REQUESTED":
            previous_veto_by_reviewer[author] = True
        elif state in {"APPROVED", "DISMISSED"}:
            previous_veto_by_reviewer[author] = False
        elif state not in {"COMMENTED", "PENDING"}:
            raise RemoteProofError("Unknown state in authenticated PR review history")
    if any(previous_veto_by_reviewer.values()):
        raise RemoteProofError("Undismissed CHANGES_REQUESTED review persists across source SHA changes (change requests)")
    exact = [x for x in reviews if x.get("commit_id") == commit_sha]
    # GitHub's REST review list is chronological across the fully-paginated
    # collection. A new PENDING review has no submitted_at, therefore sorting
    # by submitted_at would incorrectly put it before the older APPROVED.
    # Order by the GitHub review ID, including PENDING without submitted_at.
    excluded = {author_login} | set(implementation_authors or ())
    # A GitHub review has a unique positive integer ID even when PENDING
    # omits submitted_at. Never accept an unverifiable ordering fallback:
    # missing/negative/string IDs could hide a newer pending or failed review.
    if any(type(entry.get("id")) is not int or entry["id"] <= 0 for entry in exact):
        raise RemoteProofError("Invalid or missing authenticated GitHub review ID")
    latest_by_reviewer = {}
    permitted_states = {"APPROVED", "CHANGES_REQUESTED", "PENDING", "DISMISSED", "COMMENTED"}
    # The full paginated REST collection can arrive out of order. Every ID was
    # validated as a positive integer above; fold by ascending review ID so a
    # newer COMMENTED cannot hide an older unresolved CHANGES_REQUESTED/PENDING.
    for entry in sorted(exact, key=lambda item: item["id"]):
        reviewer = (entry.get("user") or {}).get("login")
        if not reviewer:
            raise RemoteProofError("Review has no authenticated GitHub reviewer")
        state = entry.get("state")
        if state not in permitted_states:
            raise RemoteProofError("Unknown exact-SHA GitHub review state")
        order = entry["id"]
        previous = latest_by_reviewer.get(reviewer)
        # COMMENTED is not a review decision. It cannot revoke a previous
        # change request, pending re-review, or approval; only a decisive
        # APPROVED, CHANGES_REQUESTED, DISMISSED or PENDING can change it.
        if state == "COMMENTED" and previous is not None:
            state = previous[1]
        latest_by_reviewer[reviewer] = (order, state)
    if any(
        state in {"PENDING", "CHANGES_REQUESTED"}
        for _, state in latest_by_reviewer.values()
    ):
        raise RemoteProofError("Latest exact-SHA review pending or requesting changes (change requests)")
    human_approved = any(
        state == "APPROVED" and reviewer not in excluded
        for reviewer, (_, state) in latest_by_reviewer.items()
    )
    comments = github_all_pages(
        "/repos/" + REPOSITORY + "/issues/" + str(pr_number) + "/comments?per_page=100",
        access_token,
    )
    if not isinstance(comments, list):
        raise RemoteProofError("Unexpected review comments response")
    # A Codex summary may be edited in place. Track Code and Security
    # independently: a new code-only update must never erase an outstanding
    # security failure (and vice versa). Only an exact-SHA verdict of the same
    # review kind can supersede a previous exact-SHA result.
    latest = {}
    for comment in comments:
        if (comment.get("user") or {}).get("login") != "chatgpt-codex-connector[bot]":
            continue
        marker = "<!-- codex-review-state:v1 "
        body = comment.get("body") or ""
        if marker not in body:
            continue
        try:
            parsed = json.loads(body.split(marker, 1)[1].split(" -->", 1)[0])
        except (ValueError, IndexError, TypeError) as error:
            raise RemoteProofError("Malformed authenticated Codex review state") from error
        if not isinstance(parsed, dict):
            raise RemoteProofError("Authenticated Codex review state is not an object")
        comment_id = comment.get("id")
        if type(comment_id) is not int or comment_id <= 0:
            raise RemoteProofError("Authenticated Codex review comment lacks a valid ID")
        order = (
            comment.get("updated_at") or comment.get("created_at") or "",
            comment_id,
        )
        code = parsed.get("code_review") or {}
        security = parsed.get("security_review") or {}
        if not isinstance(code, dict) or not isinstance(security, dict):
            raise RemoteProofError("Malformed authenticated Code/Security review details")
        for kind, verdict in (("code_review", code), ("security_review", security)):
            exact_sha = verdict.get("commit_sha") == commit_sha
            # A failed/in-progress security result without an explicit SHA is
            # still applicable if the same authenticated summary targets this
            # exact source SHA in its code review. Null SHA cannot attest PASS.
            implicit_security_block = (
                kind == "security_review"
                and verdict.get("commit_sha") is None
                and code.get("commit_sha") == commit_sha
                and (
                    verdict.get("has_any_findings") is True
                    or verdict.get("has_unresolved_findings") is True
                    or verdict.get("status") in {"running", "in_progress", "pending"}
                )
            )
            if not exact_sha and not implicit_security_block:
                continue
            previous = latest.get(kind)
            if previous is None or order > previous[0]:
                latest[kind] = (order, verdict)
    if latest:
        if "chatgpt-codex-connector[bot]" in excluded:
            raise RemoteProofError("Codex code contributor cannot independently review itself")
        code = latest.get("code_review", (None, {}))[1]
        security = latest.get("security_review", (None, {}))[1]
        if (
            security.get("has_any_findings") is True
            or security.get("has_unresolved_findings") is True
        ):
            raise RemoteProofError("Latest exact-SHA Codex security review has findings")
        # An actual started security review is authoritative even for a task
        # whose policy does not require one. Running, pending, incomplete, or
        # explicitly failed security can never be overwritten by code-only PASS.
        required = [code]
        if needs_security or "security_review" in latest:
            required.append(security)
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


# Registration is deliberately *fail-closed*. CTRL-00 is a governance slice
# whose exact Python checks are in the controller workflow. A product task
# requires an owner-reviewed task-specific focused_ci contract in the canonical
# registry before any CI may authorize acceptance. Generic "classroom" jobs
# are never interchangeable with a task's own E2E/PG/security assertions.
_CONTROLLER_FOCUSED_CI = {
    "task_id": "CTRL-00",
    "workflow_path": ".github/workflows/classroom-controller.yml",
    "required_jobs": ["validate"],
    "required_steps": [
        "Validate requirements, dependencies and decisions",
        "Run all controller regression tests",
        "Rebuild registry and check deterministic output",
    ],
}
_TASK_ID = re.compile(r"^[A-Z]+-[0-9]{2}$")
_WORKFLOW_PATH = re.compile(r"^\.github/workflows/[a-z0-9][a-z0-9_-]*\.ya?ml$")


def _focused_ci_contract(task: dict):
    if not isinstance(task, dict) or not _TASK_ID.fullmatch(task.get("id") or ""):
        raise RemoteProofError("Missing canonical focused task ID")
    task_id = task["id"]
    contract = _CONTROLLER_FOCUSED_CI if task_id == "CTRL-00" else task.get("focused_ci")
    if not isinstance(contract, dict) or contract.get("task_id") != task_id:
        raise RemoteProofError(
            "No task-specific approved focused_ci workflow/job/step contract for " + task_id
        )
    path = contract.get("workflow_path")
    jobs = contract.get("required_jobs")
    steps = contract.get("required_steps")
    if (
        not isinstance(path, str)
        or not _WORKFLOW_PATH.fullmatch(path)
        or (task_id != "CTRL-00" and path == _CONTROLLER_FOCUSED_CI["workflow_path"])
        or not isinstance(jobs, list) or not jobs
        or not isinstance(steps, list) or not steps
        or any(not isinstance(v, str) or not v.strip() for v in jobs + steps)
        or len(set(jobs)) != len(jobs)
        or len(set(steps)) != len(steps)
    ):
        raise RemoteProofError("Malformed or generic focused_ci contract for " + task_id)
    if task_id != "CTRL-00" and not any(task_id in step for step in steps):
        raise RemoteProofError("Focused CI step must be explicitly bound to " + task_id)
    return contract


def _ci_run(ev: dict, commit_sha: str, kind: str, access_token: str, task: dict | None = None):
    number = _matched(RUN_LINK, ev.get("uri"), kind)
    contract = _focused_ci_contract(task) if kind == "focused" else None
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
    if kind == "focused" and run.get("path") != contract["workflow_path"]:
        raise RemoteProofError(
            "Focused workflow path does not match task-specific contract for " + task["id"]
        )
    jobs_data = github_json(
        "/repos/" + REPOSITORY + "/actions/runs/" + number + "/jobs?per_page=100",
        access_token,
    )
    jobs = jobs_data.get("jobs", [])
    if not isinstance(jobs, list) or not jobs:
        raise RemoteProofError("Workflow has no verifiable jobs")
    count = jobs_data.get("total_count")
    if (kind == "focused" and type(count) is not int) or (
        count is not None and (type(count) is not int or count != len(jobs))
    ):
        raise RemoteProofError("Focused workflow job collection is incomplete")
    if kind == "focused":
        # All required jobs AND their exact step names must be completed and
        # successful on this run. A generic CI result cannot replace a real
        # task-specific executed check.
        successful_jobs = [
            job for job in jobs
            if job.get("status") == "completed" and job.get("conclusion") == "success"
        ]
        required_jobs = [
            job for job in successful_jobs
            if job.get("name") in contract["required_jobs"]
        ]
        for name in contract["required_jobs"]:
            if not any(job.get("name") == name for job in required_jobs):
                raise RemoteProofError("Missing successful focused CI job " + name)
        executed = {
            step.get("name")
            for job in required_jobs
            for step in job.get("steps", [])
            if step.get("status") == "completed" and step.get("conclusion") == "success"
        }
        if not set(contract["required_steps"]).issubset(executed):
            raise RemoteProofError("Missing task-specific successful focused CI steps")
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
    # The PR opener may be a controller. Authenticate ALL implementation
    # authors/committers through GitHub, excluding them as well as the opener
    # from independent approvals. Receipt author can only add a veto, never
    # supply a trusted implementer identity.
    authors = _verified_implementation_authors(pr_number, code_sha, access_token)
    claimed_author = receipt.get("author") if isinstance(receipt, dict) else None
    if isinstance(claimed_author, str) and claimed_author.strip():
        authors.add(claimed_author.strip())
    _get_reviews(
        pr_number,
        code_sha,
        pr.get("user", {}).get("login"),
        task.get("risk") == "security",
        access_token,
        implementation_authors=authors,
    )

    for kind in task["gates"]:
        if kind in {"focused", "pg", "visual"}:
            _ci_run(evidence[kind], code_sha, kind, access_token, task=task)

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
