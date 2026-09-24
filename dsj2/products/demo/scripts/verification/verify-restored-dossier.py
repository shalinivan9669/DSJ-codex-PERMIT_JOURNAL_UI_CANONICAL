"""Compare the restored HTTP dossier with the exact earlier browser download."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile


def canonical_dossier(value):
    return {key: sorted(value[key], key=lambda row: row["id"])
            if key in ("artifacts", "attachments", "events", "issuances", "missing")
            else value[key] for key in value}


expected = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["dossier"]
with zipfile.ZipFile(sys.argv[1]) as archive:
    manifest = json.loads(archive.read("manifest.json"))
    dossier = json.loads(archive.read("order-dossier.json"))
    assert canonical_dossier(dossier) == canonical_dossier(expected["detail"])
    assert manifest["complete"] is False
    assert manifest["missing"] == expected["manifest"]["missing"]
    expected_files = {f["id"]: f for f in expected["manifest"]["files"]}
    assert {f["id"] for f in manifest["files"]} == set(expected_files)
    verified = []
    for file in manifest["files"]:
        data = archive.read(file["file"])
        digest = hashlib.sha256(data).hexdigest()
        assert len(data) == file["size"] and digest == file["sha256"]
        original = expected_files[file["id"]]
        if not file["id"].startswith("inventory-"):
            assert file == original, (file["id"], "original file metadata changed")
            verified.append({"id": file["id"], "sha256": digest, "bytes": len(data)})
    assert len(verified) == 8
    assert manifest["readyCount"] == manifest["expectedCount"] == 9
    print(json.dumps({"status": "PASS", "availableOriginalAndSourceFiles": verified,
                      "missingSignedEvidence": manifest["missing"], "complete": False,
                      "issuanceSnapshotsEqual": True, "eventBindingsEqual": True,
                      "inventoryIncluded": True}, ensure_ascii=True))
