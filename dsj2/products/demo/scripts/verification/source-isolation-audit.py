"""Read-only release-candidate audit; emits metadata, never credential values.

Run from the DEMO product. Original checkout is only inspected. This audit does
not stage, reset, delete, rewrite source files, or control running processes.
"""

import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="59a961a07b4f8103db9fbdbe0fe4dc09406816f1")
    parser.add_argument("--original-root", required=True)
    parser.add_argument("--original-head", default="161c5ed022c9e2c643e80802d3f9dc2cd496a041")
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[2]

    repo = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=product,
                              check=True, stdout=subprocess.PIPE).stdout.decode().strip())

    def git(*command, cwd=repo):
        return subprocess.run(["git", *command], cwd=cwd, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    prefix = "dsj2/products/demo/"
    output = product / "docs/evidence/final-completion/source-isolation.json"
    original = Path(args.original_root).resolve()

    def paths(*command):
        return set(git(*command).decode().rstrip("\0").split("\0")) - {""}

    def candidates():
        return (paths("diff", "--name-only", "-z", args.base, "HEAD")
                | paths("diff", "--name-only", "-z", "HEAD")
                | paths("ls-files", "--others", "--exclude-standard", "-z"))

    def inventory(names):
        items = []
        for name in sorted(names):
            path = repo / name
            if path.is_file():
                data = path.read_bytes()
                items.append({"path": name, "sha256": sha(data), "bytes": len(data)})
            else:
                items.append({"path": name, "deleted": True})
        return items

    names = candidates()
    staged = paths("diff", "--cached", "--name-only", "-z")
    first = inventory(names)
    assert output.relative_to(repo).as_posix() not in names, "Audit output must remain ignored to avoid a self-referential hash."
    branch = git("branch", "--show-current").decode().strip()
    head = git("rev-parse", "HEAD").decode().strip()
    ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", args.base, head], cwd=repo).returncode == 0
    template_manifest = json.loads(git("show", f"{args.base}:{prefix}assets/templates/manifest.json"))
    templates = []
    for entry in template_manifest["templates"]:
        name = prefix + "assets/templates/" + entry["file"]
        before, current = git("show", f"{args.base}:{name}"), (repo / name).read_bytes()
        templates.append({"path": name, "baseSha256": sha(before), "currentSha256": sha(current), "identical": before == current})
    migrations = []
    migration_names = paths("ls-tree", "-r", "--name-only", "-z", args.base, "--", prefix + "packages/database/prisma/migrations")
    for name in sorted(migration_names):
        blob = git("show", f"{args.base}:{name}")
        checkout = git("cat-file", "--filters", f"{args.base}:{name}")
        current = (repo / name).read_bytes()
        base_object = git("rev-parse", f"{args.base}:{name}").decode().strip()
        current_object = git("hash-object", name, cwd=repo).decode().strip()
        migrations.append({"path": name, "baseSha256": sha(blob), "checkoutFilteredBaseSha256": sha(checkout),
                           "currentSha256": sha(current), "rawGitBlobBytesEqual": blob == current,
                           "gitBlobObjectAtBase": base_object, "gitBlobObjectCurrent": current_object,
                           "identical": checkout == current and base_object == current_object})
    original_branch = git("branch", "--show-current", cwd=original).decode().strip()
    original_head = git("rev-parse", "HEAD", cwd=original).decode().strip()
    tracked = git("status", "--porcelain=v1", "--untracked-files=no", cwd=original).decode().splitlines()
    untracked = set(git("ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory", "-z", cwd=original).decode().split("\0")) - {""}
    required_untracked = {".codex/ot-center-input-v2/", ".serena/", "dsj2/products/"}
    original_changes = []
    for name in [".gitignore", "dsj2/.gitignore"]:
        path = original / name
        data = path.read_bytes()
        original_changes.append({"path": name, "sha256": sha(data), "bytes": len(data),
                                 "modifiedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()})
    original_diff = git("diff", "HEAD", "--", ".gitignore", "dsj2/.gitignore", cwd=original)
    original_diff_path = output.with_name("original-ignore-diff.patch")
    original_diff_path.write_bytes(original_diff)

    # Credentials are collected and compared solely in memory, without hashes.
    secrets = set()
    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if isinstance(child, str) and len(child) >= 12 and re.search(r"(?:password|secret|token|cookie)$", key, re.I) and not re.search("hash", key, re.I):
                    secrets.add(child)
                else:
                    collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)
    runtime = product / ".runtime"
    for path in runtime.glob("*.json"):
        if re.search("auth|credential|invite|secret|token", path.name, re.I) and path.stat().st_size < 2_000_000:
            try:
                collect(json.loads(path.read_text(encoding="utf-8-sig")))
            except (UnicodeError, json.JSONDecodeError):
                pass
    for path in runtime.glob("*env*.ps1"):
        for match in re.finditer(r"\$env:[\w]*(?:PASSWORD|SECRET|TOKEN|KEY)[\w]*\s*=\s*(['\"])([^'\"\r\n]{12,})\1", path.read_text(encoding="utf-8-sig"), re.I):
            secrets.add(match[2])
    literal_allowlist = {
        "scripts/verification/business-scenarios.ts", "scripts/verification/operator-value-golden.ts",
        *[f"tests/integration/{name}.test.ts" for name in [
            "clarification-scope", "customer-export-scope", "employer-invites", "event-profiles",
            "finalize-races", "group-events", "history-links", "import-delivery", "lifecycle",
            "operator-value-http", "portal-evidence-http", "retake", "staff-directory"]],
    }
    patterns = {
        "PRIVATE_KEY": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        "PROVIDER_TOKEN": r"\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{24,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b",
        "PASSWORD_URI": r"(?:postgres(?:ql)?|mysql|redis)://[^\s/:]+:[^\s/@]{5,}@",
        "QUOTED_CREDENTIAL_LITERAL": r"\b(?:password|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*(['\"])([^'\"\r\n]{8,})\1",
    }
    findings, reviewed, excluded = [], [], []
    scanned = 0
    def scan(name, data, layer):
        nonlocal scanned
        if len(data) > 10_000_000 or b"\0" in data:
            excluded.append({"path": name, "layer": layer, "reason": "binary or larger than 10 MB"})
            return
        try:
            text = data.decode("utf-8-sig")
        except UnicodeError:
            excluded.append({"path": name, "layer": layer, "reason": "non-UTF8 binary asset"})
            return
        scanned += 1
        if any(secret in text for secret in secrets):
            findings.append({"path": name, "layer": layer, "kind": "EXACT_RUNTIME_CREDENTIAL"})
        for kind, pattern in patterns.items():
            for match in re.finditer(pattern, text, re.I if kind == "QUOTED_CREDENTIAL_LITERAL" else 0):
                item = {"path": name, "layer": layer, "kind": kind, "line": text.count("\n", 0, match.start()) + 1}
                if kind == "QUOTED_CREDENTIAL_LITERAL" and name.removeprefix(prefix) in literal_allowlist and "assertTestDatabase" in text:
                    reviewed.append({**item, "reason": "Previously reviewed isolated synthetic test or invalid-password error fixture; test database guard present."})
                else:
                    findings.append(item)
    for name in sorted(names):
        if set(Path(name).parts) & {".runtime", ".env", ".codex-runtime", "secrets", ".secrets", "pgdata", "node_modules", ".next"}:
            findings.append({"path": name, "kind": "PRIVATE_RUNTIME_CANDIDATE_PATH"})
        if (repo / name).is_file():
            scan(name, (repo / name).read_bytes(), "working")
    staged_hashes = []
    for name in sorted(staged):
        try:
            data = git("show", f":{name}")
        except subprocess.CalledProcessError:
            continue  # Staged deletion has no payload.
        staged_hashes.append({"path": name, "sha256": sha(data), "bytes": len(data)})
        scan(name, data, "index")
    after_names = candidates()
    second = inventory(after_names)
    changes = sorted({v["path"] for v in first if v not in second} | {v["path"] for v in second if v not in first})
    outside = sorted(name for name in names if not name.startswith(prefix))
    source_passed = (ancestor and branch.startswith("codex/") and not outside and not changes and names == after_names
              and len(templates) == 11 and all(v["identical"] for v in templates)
              and len(migrations) == 6 and all(v["identical"] for v in migrations)
              and not findings)
    passed = (source_passed and original_branch == "main" and original_head == args.original_head
              and not tracked and required_untracked <= untracked)
    result = {
        "status": "PASS" if passed else "FAIL", "generatedAt": datetime.now(timezone.utc).isoformat(),
        "releaseSourceStatus": "PASS" if source_passed else "FAIL",
        "worktree": {"path": str(repo), "branch": branch, "head": head, "requiredBase": args.base, "baseIsAncestor": ancestor},
        "changeBoundary": {"allowedPrefix": prefix, "comparison": "union of base-to-HEAD committed paths, HEAD-to-index/worktree paths, and nonignored untracked candidates",
                           "candidatePathCount": len(names), "stagedPathCount": len(staged), "outsideProduct": outside,
                           "candidateSetStableDuringAudit": names == after_names, "filesChangedDuringAudit": changes,
                           "candidateManifestSha256": sha(json.dumps(first, sort_keys=True).encode()), "candidateFiles": first, "stagedFiles": staged_hashes},
        "protectedTemplates": templates, "protectedMigrations": migrations,
        "lineEndingExplanation": "Migration raw Git blobs use LF. Windows checkout CRLF is compared using Git checkout filters and independently normalized Git blob object IDs; no applied migration rewrite is accepted.",
        "originalCheckout": {"path": str(original), "branch": original_branch, "head": original_head, "trackedChangeCount": len(tracked), "trackedChanges": tracked,
                             "trackedClean": not tracked, "observedIgnoreFiles": original_changes,
                             "ignoreDiffSha256": sha(original_diff), "ignoreDiffEvidence": str(original_diff_path),
                             "requiredUntrackedPresent": sorted(required_untracked & untracked), "untrackedDirectories": sorted(untracked)},
        "credentialAudit": {"textPayloadsScanned": scanned, "runtimeValuesComparedInMemory": len(secrets), "unreviewedFindings": findings,
                            "reviewedSyntheticLiterals": reviewed, "excludedBinaryPayloads": excluded, "secretValuesOrFingerprintsWritten": False},
        "auditActions": {"sourceMutations": 0, "commits": 0, "resets": 0, "deletes": 0, "processRestarts": 0, "onlyOutputs": [str(output), str(original_diff_path)]},
        "limits": ["Timestamped candidate/index snapshot; rerun after source or staging changes. Ignored runtime and raw evidence are not candidate source unless staged.",
                   "Credential catalog and common text patterns are bounded checks, not a proof that all possible secrets or binary payloads are absent.",
                   "Old individual DOCX are byte-identical; old migrations are Git-filter and object-identical. Original untracked contents are not recursively copied or hashed."]}
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "releaseSourceStatus": result["releaseSourceStatus"], "originalTrackedClean": not tracked, "candidatePaths": len(names), "textPayloadsScanned": scanned,
                      "protectedTemplates": len(templates), "protectedMigrations": len(migrations),
                      "unreviewedFindings": findings, "filesChangedDuringAudit": changes, "output": str(output)}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
