"""Compare this run with its preserved full source snapshot, never with a clean checkout."""
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

product = Path(__file__).resolve().parents[2]
repository = product.parents[2]
runtime = product / ".runtime/mvp-all-roles-20261019/run-01"
output = product / "docs/evidence/mvp-all-roles-20261019/run-01"
prefix = "dsj2/products/demo/"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=repository)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def relevant(name):
    return name.startswith(prefix) and not name.startswith(prefix + "docs/evidence/")


current_names = {
    item.decode("utf-8")
    for item in git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split(b"\0")
    if item
}
changes = []
with zipfile.ZipFile(runtime / "baseline-source.zip") as archive:
    before_names = set(archive.namelist())
    for name in sorted((before_names | current_names)):
        if not relevant(name):
            continue
        target = repository / name
        before = digest(archive.read(name)) if name in before_names else None
        after = digest(target.read_bytes()) if target.is_file() else None
        # Files already deleted at baseline have no bytes in either snapshot.
        if before == after:
            continue
        changes.append({"path": name, "change": "MODIFIED" if before and after else "ADDED" if after else "DELETED", "beforeSha256": before or "", "afterSha256": after or ""})

with (output / "SOURCE_CHANGES.tsv").open("w", encoding="utf-8", newline="") as stream:
    writer = csv.DictWriter(stream, fieldnames=["path", "change", "beforeSha256", "afterSha256"], delimiter="\t")
    writer.writeheader()
    writer.writerows(changes)

status = git("status", "--short").decode("utf-8")
baseline_status = (runtime / "baseline-status.txt").read_text(encoding="utf-8-sig")
deleted = lambda value: sorted(line for line in value.splitlines() if len(line) > 2 and "D" in line[:2])
preserved = deleted(status) == deleted(baseline_status)
provenance = {
    "repository": str(repository), "product": str(product),
    "branch": git("branch", "--show-current").decode().strip(),
    "head": git("rev-parse", "HEAD").decode().strip(),
    "baselineArchive": str(runtime / "baseline-source.zip"),
    "baselineArchiveSha256": digest((runtime / "baseline-source.zip").read_bytes()),
    "comparison": "Current bytes versus the task's initial snapshot, including untracked source; prior dirty changes preserved",
    "changesExcludingEvidence": len(changes),
    "newDeletedFiles": [row["path"] for row in changes if row["change"] == "DELETED"],
    "baselineGitDeletedCount": len(deleted(baseline_status)),
    "currentGitDeletedCount": len(deleted(status)),
    "preexistingDeletionsPreserved": preserved,
    "sourceManifestSha256": digest((output / "SOURCE_CHANGES.tsv").read_bytes()),
    "gitCommitCreated": False, "gitPushOrCloudDeploy": False,
}
(output / "SOURCE_PROVENANCE.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
assert preserved, "Unexpected deletion difference from baseline"
assert not provenance["newDeletedFiles"], "Unexpected new source deletion"
print(json.dumps({"changedSourceFiles": len(changes), "preservedDeletions": len(deleted(status))}))
