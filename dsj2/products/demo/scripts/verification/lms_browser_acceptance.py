"""Validate raw browser execution or an exact, reviewed affected-case reconciliation.

This module never rewrites a command's status, exit code or Playwright results.
All paths in evidence references are relative to the evidence directory.
"""
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path


TARGET = "apps/web/e2e/operator-photo-details-live.spec.ts"
GENERATOR = "scripts/verification/lms-full-e2e-fixture.ts"
TARGET_FILE = "operator-photo-details-live.spec.ts"
HISTORY = "apps/web/e2e/final-history-live.spec.ts"
DELIVERY_HELPER = "scripts/verification/final-delivery-internal-qa.ts"
TIMING = "apps/web/e2e/operator-timing.spec.ts"
COMMERCIAL = "apps/web/e2e/commercial.spec.ts"
REPEAT = "apps/web/e2e/final-repeat-basis-live.spec.ts"
COMMERCIAL_TITLE = "finalize response lost after commit: retry and double activation reuse one issuance and the exact approved final text"
TIMING_FAILED_TITLE = "comparable operator measurements: 250 mixed recipients"
IMPACTED_FILES = {TARGET_FILE, "final-delivery-three-live.spec.ts", "final-history-live.spec.ts", "operator-timing.spec.ts", "commercial.spec.ts", "final-repeat-basis-live.spec.ts"}
CHANGED_FILES = {TARGET, GENERATOR, HISTORY, DELIVERY_HELPER, TIMING, COMMERCIAL, REPEAT}
DEPENDENCY_FILE = "remaining-print-pack-scale-live.spec.ts"
DEPENDENCY_COMMAND = (
    "pnpm --filter @demo/web exec playwright test -c playwright.config.ts "
    "--project=print-pack-scale --no-deps e2e/remaining-print-pack-scale-live.spec.ts"
)
CORRECTIVE_COMMAND = (
    "pnpm --filter @demo/web exec playwright test -c playwright.config.ts "
    "--project=remaining --project=common-consumers --no-deps e2e/operator-photo-details-live.spec.ts "
    "e2e/final-delivery-three-live.spec.ts e2e/final-history-live.spec.ts "
    "e2e/operator-timing.spec.ts e2e/commercial.spec.ts:375 e2e/final-repeat-basis-live.spec.ts"
)
TIMING_COMMAND = "pnpm --filter @demo/web exec playwright test -c playwright.config.ts --project=remaining --no-deps e2e/operator-timing.spec.ts"
MODE = "FULL_RUN_PLUS_AFFECTED_RECHECK"


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def contained(base, relative):
    require(isinstance(relative, str) and relative and "\\" not in relative,
            "BROWSER_REFERENCE_INVALID")
    part = Path(relative)
    require(not part.is_absolute() and ".." not in part.parts,
            "BROWSER_REFERENCE_TRAVERSAL")
    location = (base / part).resolve()
    require(location.is_relative_to(base.resolve()) and location.is_file(),
            "BROWSER_REFERENCE_MISSING_OR_OUTSIDE_ROOT")
    return location


def matches_executed_source(product_root, path, expected_sha):
    """Match executed bytes, with one separately reviewed post-acceptance EOF trim.

    Returned browser evidence retains its executed source hashes. Final source
    publication separately binds SOURCE_EOF_NORMALIZATION.json and current bytes.
    This is not a general whitespace or line-ending normalization rule.
    """
    body = contained(Path(product_root), path).read_bytes()
    current_sha = sha(body)
    if current_sha == expected_sha:
        return True
    before = "d69a33920bb815acee6ce53c9b2a554b92fb05f3fab61e565da4b27fc978845a"
    after = "501cc82378f45acd105330716d4240a23600a39be97781dd969ccdf057633d32"
    if path != "scripts/verification/lms-full-e2e-env.ps1" or expected_sha != before or current_sha != after:
        return False
    receipt_bytes = contained(Path(product_root), "docs/evidence/lms-one-run-20261015/SOURCE_EOF_NORMALIZATION.json").read_bytes()
    require(sha(receipt_bytes) == "fedc1aef413c742e1427bffd40ce1badb23d3e9bcdabc2043913a27221b65f3d",
            "BROWSER_POST_ACCEPTANCE_EOF_RECEIPT_CHANGED")
    receipt = json.loads(receipt_bytes.decode("utf-8-sig"))
    items = [item for item in receipt.get("files", []) if item.get("path") == path]
    require(receipt.get("status") == "EXACT_TERMINAL_BLANK_LINE_NORMALIZATION"
            and receipt.get("powershellParserEquivalent") is True
            and receipt.get("powershellNonWhitespaceTokensEquivalent") is True
            and receipt.get("productRuntimeChanged") is False and len(items) == 1,
            "BROWSER_POST_ACCEPTANCE_EOF_PROOF_INVALID")
    item = items[0]
    return (item.get("beforeSha256") == before and item.get("afterSha256") == after
            and item.get("beforeBytes") == 2042 and item.get("afterBytes") == len(body) == 2040
            and item.get("removedTerminalHex") == "0d0a"
            and item.get("onlyTerminalBlankLinesRemoved") is True
            and item.get("executedManifestPreserved") is True
            and body.endswith(b"}\n") and sha(body + b"\r\n") == before)


def clock(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, "BROWSER_CLOCK_NEEDS_TIMEZONE")
    return parsed


def cases(suite):
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            key = (spec["id"], test["projectId"])
            yield key, {
                "specId": key[0], "projectId": key[1],
                "title": spec["title"], "file": spec["file"].replace("\\", "/"),
                "test": test,
            }
    for child in suite.get("suites", []):
        yield from cases(child)


def case_map(results):
    items = list(cases(results))
    require(len(items) == len({key for key, _ in items}), "BROWSER_DUPLICATE_CASE_ID")
    return dict(items)


def actual_status(item, allow_dependency_skip=False):
    test = item["test"]
    require(test.get("expectedStatus") == "passed", "BROWSER_EXPECTED_FAILURE_FORBIDDEN")
    attempts = test.get("results", [])
    if allow_dependency_skip and item["projectId"] == "print-pack-scale" and Path(item["file"]).name == DEPENDENCY_FILE:
        if not attempts or (len(attempts) == 1 and attempts[0].get("status") == "skipped"):
            return "skipped"
    require(len(attempts) == 1, "BROWSER_RETRY_OR_MISSING_RESULT")
    status = attempts[0].get("status")
    require(status in ("passed", "failed"), "BROWSER_SKIPPED_INTERRUPTED_OR_TIMED_OUT")
    return status


def file_map(manifest):
    files = manifest.get("files", [])
    require(bool(files) and len(files) == len({item["path"] for item in files}),
            "BROWSER_SOURCE_MANIFEST_EMPTY_OR_DUPLICATED")
    return {item["path"]: item["sha256"] for item in files}


def jpeg_dimensions(data):
    require(data[:2] == b"\xff\xd8", "BROWSER_POSITIVE_FIXTURE_NOT_JPEG")
    offset = 2
    while offset + 4 <= len(data):
        require(data[offset] == 0xff, "BROWSER_JPEG_MARKER_INVALID")
        while offset < len(data) and data[offset] == 0xff:
            offset += 1
        marker = data[offset]
        offset += 1
        if marker in (0x01, *range(0xd0, 0xda)):
            continue
        size = int.from_bytes(data[offset:offset + 2], "big")
        require(size >= 2 and offset + size <= len(data), "BROWSER_JPEG_SEGMENT_INVALID")
        if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
            require(size >= 8, "BROWSER_JPEG_SOF_INVALID")
            return int.from_bytes(data[offset + 5:offset + 7], "big"), int.from_bytes(data[offset + 3:offset + 5], "big")
        require(marker != 0xda, "BROWSER_JPEG_DIMENSIONS_MISSING")
        offset += size
    raise RuntimeError("BROWSER_JPEG_DIMENSIONS_MISSING")


def validate_browser_acceptance(product_root, evidence_root, run_id, envelope_path=None):
    """Return verified coverage; raw full-command failure remains visibly false.

    Composite envelope schemaVersion1 binds full command/results/discovery,
    affected command/results/sourceManifest/fixtureManifest, deliveredTestSource,
    exactSourceDelta and independentDeltaReview. Only the seven independently
    reviewed harness files for nine exact affected cases may differ.
    The runtime/product cannot differ at all.
    """
    product_root, evidence_root = Path(product_root), Path(evidence_root)
    required = {}

    def read(relative, expected=None):
        location = contained(evidence_root, relative)
        digest = sha(location.read_bytes())
        require(expected is None or digest == expected, "BROWSER_EVIDENCE_HASH_MISMATCH")
        required[relative] = digest
        return json.loads(location.read_text(encoding="utf-8-sig"))

    def ref(reference):
        require(isinstance(reference, dict) and set(reference) >= {"path", "sha256"},
                "BROWSER_BOUND_REFERENCE_REQUIRED")
        return read(reference["path"], reference["sha256"])

    folder = f"agent-c/{run_id}"
    command = read(f"{folder}/command.json")
    results = read(f"{folder}/results.json")
    required[f"{folder}/command.log"] = sha(contained(evidence_root, f"{folder}/command.log").read_bytes())
    require(command.get("runId") == run_id and command.get("command") == "pnpm test:e2e",
            "BROWSER_FULL_COMMAND_IDENTITY_INVALID")
    require(command.get("exitCode") in (0, 1) and command.get("status") in ("PASS", "FAIL"),
            "BROWSER_FULL_COMMAND_NOT_TERMINAL")
    full_finished = clock(command.get("endedAt") or command.get("finishedAt"))
    require(command.get("testSourceUnchanged") is True and command.get("runtimeSourceUnchanged") is True
            and command.get("evidenceGeneratorSourceUnchanged") is True,
            "BROWSER_FULL_SOURCES_CHANGED_DURING_EXECUTION")
    discovery_path = command["discoveryManifest"]
    discovery = read(discovery_path)
    require(discovery.get("status") == "DISCOVERY_PASS_NOT_EXECUTION" and discovery.get("exitCode") == 0,
            "BROWSER_DISCOVERY_NOT_PASSED")
    discovered = case_map(read(str(Path(discovery_path).with_name("results.json")).replace("\\", "/")))
    actual = case_map(results)
    require(len(discovered) == 219 and set(discovered) == set(actual)
            and command.get("expectedTests") == discovery.get("tests") == 219,
            "BROWSER_EXACT_DISCOVERY_COVERAGE_MISMATCH")
    require(all(actual[key]["title"] == discovered[key]["title"]
                and actual[key]["file"] == discovered[key]["file"] for key in actual),
            "BROWSER_DISCOVERED_CASE_DETAILS_CHANGED")
    statuses = {key: actual_status(item, allow_dependency_skip=True) for key, item in actual.items()}
    failed = {key for key, status in statuses.items() if status == "failed"}
    skipped = {key for key, status in statuses.items() if status == "skipped"}
    stats = results.get("stats", {})
    require(results.get("errors") == [] and stats.get("flaky") == 0 and stats.get("skipped") == len(skipped)
            and stats.get("unexpected") == len(failed) and stats.get("expected") == 219 - len(failed) - len(skipped),
            "BROWSER_FULL_RAW_STATS_NOT_EXACT")
    require(command.get("stats") == stats, "BROWSER_COMMAND_STATS_DIFFER_FROM_RESULTS")
    original_sources = file_map(read(f"{folder}/{command['sourceManifest']}"))
    runtime = read(f"{folder}/runtime-start.json")
    runtime_sources = read(f"{folder}/runtime-source.json")
    require(command.get("runtime") == "runtime-start.json" and runtime.get("source") == "runtime-source.json",
            "BROWSER_RUNTIME_LINKS_INVALID")
    runtime_map = file_map(runtime_sources)
    require(all(sha(contained(product_root, path).read_bytes()) == digest for path, digest in runtime_map.items()),
            "BROWSER_CURRENT_PRODUCT_DIFFERS_FROM_EXECUTED_RUNTIME")
    build = ref(runtime["buildCommandEvidence"])
    build_id = command.get("buildId")
    require(build.get("command") == "pnpm build" and build.get("exitCode") == 0 and build_id
            and build_id == build.get("webBuildId") == runtime.get("webBuildId") == runtime_sources.get("webBuildId"),
            "BROWSER_BUILD_BINDING_INVALID")
    ordered = [clock(build["finishedAt"]), clock(runtime_sources["capturedAt"]),
               clock(runtime["startedAt"]), clock(command["startedAt"]), full_finished]
    require(ordered == sorted(ordered), "BROWSER_RUNTIME_CLOCK_ORDER_INVALID")
    raw_pass = not failed and not skipped and command["exitCode"] == 0 and command["status"] == "PASS"
    bindings = [{key: value for key, value in item.items() if key != "test"} | {
        "sourceRunId": run_id, "status": status, "rawFullStatus": status,
    } for identity, item in actual.items() for status in [statuses[identity]]]
    delivered_sources = original_sources
    deltas = []
    corrective_commands = []
    rechecked = set()
    mode = "FULL_RUN"

    if envelope_path is None:
        require(raw_pass, "BROWSER_FULL_COMMAND_FAILED_WITHOUT_AFFECTED_RECONCILIATION")
        require(all(matches_executed_source(product_root, path, digest) for path, digest in original_sources.items()),
                "BROWSER_CURRENT_TEST_SOURCES_CHANGED")
    else:
        envelope = read(envelope_path)
        require(envelope.get("schemaVersion") == 1 and envelope.get("mode") == MODE
                and envelope.get("runId") == run_id, "BROWSER_ENVELOPE_IDENTITY_INVALID")
        require(command["status"] == "FAIL" and command["exitCode"] == 1 and len(failed) == 6,
                "BROWSER_COMPOSITE_REQUIRES_EXACTLY_SIX_RECORDED_FAILURES")
        require(len(skipped) == 1, "BROWSER_EXACT_FULL212_SIX_FAILURES_ONE_DEPENDENCY_SKIP_REQUIRED")
        if skipped:
            projects = results.get("config", {}).get("projects", [])
            dependent = next((p for p in projects if p.get("id") == "print-pack-scale"), None)
            config_path = "apps/web/playwright.config.ts"
            config_bytes = contained(product_root, config_path).read_bytes()
            require(sha(config_bytes) == original_sources.get(config_path),
                    "BROWSER_EXECUTED_DAG_SOURCE_HASH_CHANGED")
            dependency_block = re.search(
                r'name:\s*"print-pack-scale",\s*testMatch:\s*printPackScale,\s*dependencies:\s*\[([^\]]*)\]',
                config_bytes.decode("utf8"),
            )
            require(dependent is not None
                    and any("remaining-print-pack-scale-live" in value for value in dependent.get("testMatch", []))
                    and dependency_block is not None
                    and '"remaining"' in dependency_block.group(1)
                    and '"common-consumers"' in dependency_block.group(1)
                    and all(actual[key]["projectId"] in {"remaining", "common-consumers"} for key in failed),
                    "BROWSER_DEPENDENCY_SKIP_NOT_PROVEN_BY_EXECUTED_DAG")
        for name, suffix in (("command", "command.json"), ("results", "results.json"),
                             ("testSource", command["sourceManifest"]), ("runtimeSource", "runtime-source.json")):
            binding = envelope["full"][name]
            require(binding["path"] == f"{folder}/{suffix}", "BROWSER_ENVELOPE_FULL_REFERENCE_MISMATCH")
            ref(binding)
        require({Path(actual[key]["file"]).name for key in failed} == IMPACTED_FILES
                and all(actual[key]["projectId"] == ("common-consumers" if Path(actual[key]["file"]).name == "final-repeat-basis-live.spec.ts" else "remaining") for key in failed)
                and all(actual[key]["title"] == COMMERCIAL_TITLE for key in failed if Path(actual[key]["file"]).name == "commercial.spec.ts")
                and all(actual[key]["title"] == TIMING_FAILED_TITLE for key in failed if Path(actual[key]["file"]).name == "operator-timing.spec.ts"),
                "BROWSER_COMPOSITE_FAILURE_OUTSIDE_REVIEWED_CASES")
        rechecked = failed | {key for key, item in actual.items() if Path(item["file"]).name == "operator-timing.spec.ts"}
        require(len(rechecked) == 9 and {actual[key]["title"] for key in rechecked if Path(actual[key]["file"]).name == "operator-timing.spec.ts"} == {f"comparable operator measurements: {count} mixed recipients" for count in (10,100,150,250)},
                "BROWSER_SHARED_TIMING_IMPACT_SCOPE_INVALID")
        current_manifest = ref(envelope["deliveredTestSource"])
        delivered_sources = file_map(current_manifest)
        require(set(delivered_sources) == set(original_sources), "BROWSER_DELIVERED_SOURCE_SET_CHANGED")
        changed = {path for path in original_sources if original_sources[path] != delivered_sources[path]}
        require(changed == CHANGED_FILES, "BROWSER_DELTA_OUTSIDE_EXACT_HARNESS_SCOPE")
        require(all(matches_executed_source(product_root, path, digest) for path, digest in delivered_sources.items()),
                "BROWSER_DELIVERED_TEST_SOURCE_HASH_MISMATCH")
        affected = envelope["affected"]
        intermediate_manifest = ref(affected["sourceManifest"])
        intermediate_sources = file_map(intermediate_manifest)
        require(set(intermediate_sources) == set(original_sources)
                and {path for path in original_sources if intermediate_sources[path] != original_sources[path]} == CHANGED_FILES
                and {path for path in original_sources if intermediate_sources[path] != delivered_sources[path]} == {TIMING},
                "BROWSER_INTERMEDIATE_SOURCE_CHAIN_SCOPE_INVALID")
        timing_delta = ref(envelope["timingDelta"])
        timing_review = ref(envelope["timingIndependentReview"])
        require(timing_review.get("status") == "PASS_SOURCE_REVIEW_NOT_EXECUTION"
                and timing_review.get("testHarnessOnly") is True
                and timing_review.get("productSourcesChanged") is False
                and timing_review.get("originalAssertionIntentPreserved") is True
                and timing_review.get("bothExactReverseProofsActuallyVerified") is True,
                "BROWSER_FINAL_TIMING_REVIEW_REQUIRED")
        timing_items = timing_delta.get("files", [])
        require(len(timing_items) == 1 and timing_items[0]["path"] == TIMING,
                "BROWSER_FINAL_TIMING_DELTA_SCOPE_INVALID")
        timing_item = timing_items[0]
        require(timing_item["beforeSha256"] == intermediate_sources[TIMING]
                and timing_item["candidateSha256"] == delivered_sources[TIMING]
                and all(timing_review["sourceDelta"].get(key) == timing_item.get(key) for key in ("path", "beforeSha256", "candidateSha256", "restoredSha256")),
                "BROWSER_FINAL_TIMING_REVIEW_SOURCE_BINDING_INVALID")
        delta = ref(envelope["exactSourceDelta"])
        review = ref(envelope["independentDeltaReview"])
        require(review.get("status") == "PASS_SOURCE_REVIEW_NOT_EXECUTION"
                and review.get("testHarnessOnly") is True
                and review.get("productSourcesChanged") is False
                and review.get("originalAssertionIntentPreserved") is True
                and review.get("exactSourceDelta") == envelope["exactSourceDelta"],
                "BROWSER_INDEPENDENT_DELTA_REVIEW_MISSING")
        for evidence in review.get("supportingReviews", []):
            ref(evidence)
        delta_items = delta.get("files", [])
        require(len(delta_items) == 7 and {item["path"] for item in delta_items} == CHANGED_FILES,
                "BROWSER_EXACT_DELTA_SET_INVALID")
        reviewed = {item["path"]: item for item in review.get("sourceDeltas", [])}
        require(set(reviewed) == CHANGED_FILES and set(review.get("affectedCaseFiles", [])) == IMPACTED_FILES,
                "BROWSER_REVIEWED_IMPACT_SET_INVALID")
        for item in delta_items:
            path = item["path"]
            require(item["path"] == path and item["beforeSha256"] == original_sources[path]
                    and item["candidateSha256"] == intermediate_sources[path]
                    and reviewed[path]["beforeSha256"] == original_sources[path]
                    and reviewed[path]["candidateSha256"] == intermediate_sources[path],
                    "BROWSER_DELTA_HASH_BINDING_MISMATCH")
            restored = contained(product_root, path).read_bytes()
            if path == TIMING:
                require(bool(timing_item.get("reverseReplacements")), "BROWSER_FINAL_TIMING_REVERSE_PROOF_MISSING")
                for replacement in timing_item["reverseReplacements"]:
                    after, before = replacement["after"].encode(), replacement["before"].encode()
                    require(after and restored.count(after) == 1, "BROWSER_FINAL_TIMING_REVERSE_NOT_UNIQUE")
                    restored = restored.replace(after, before, 1)
                require(sha(restored) == intermediate_sources[TIMING] == timing_item["restoredSha256"],
                        "BROWSER_INTERMEDIATE_TIMING_NOT_EXACTLY_RECONSTRUCTED")
            require(bool(item.get("removeBlocks") or item.get("reverseReplacements")),
                    "BROWSER_DELTA_HAS_NO_EXACT_REVERSE_PROOF")
            for block in item.get("removeBlocks", []):
                encoded = block.encode("utf8")
                require(encoded and restored.count(encoded) == 1, "BROWSER_INSERTION_NOT_UNIQUE")
                restored = restored.replace(encoded, b"", 1)
            reverse = item.get("reverseReplace", {})
            require(not reverse if path != GENERATOR else reverse == {".jpeg({ quality: 40 })": ".jpeg({ quality: 88 })"},
                    "BROWSER_ORIGINAL_ASSERTION_OR_GENERATOR_CHANGE_NOT_ALLOWED")
            for after, before in reverse.items():
                require(restored.count(after.encode()) == 1, "BROWSER_FIXTURE_QUALITY_REPLACEMENT_NOT_UNIQUE")
                restored = restored.replace(after.encode(), before.encode(), 1)
            replacements = item.get("reverseReplacements", [])
            require(not replacements or path in {HISTORY, DELIVERY_HELPER, TIMING, COMMERCIAL, REPEAT},
                    "BROWSER_REVERSE_REPLACEMENT_OUTSIDE_REVIEWED_FILES")
            for replacement in replacements:
                after, before = replacement["after"].encode(), replacement["before"].encode()
                require(after and restored.count(after) == 1, "BROWSER_REVERSE_REPLACEMENT_NOT_UNIQUE")
                restored = restored.replace(after, before, 1)
            require(sha(restored) == original_sources[path] == item["restoredSha256"],
                    "BROWSER_ORIGINAL_SOURCE_NOT_EXACTLY_RECONSTRUCTED")
            deltas.append({"path": path, "beforeSha256": original_sources[path],
                           "afterSha256": delivered_sources[path], "intermediateSha256": intermediate_sources[path], "evidence": envelope["exactSourceDelta"], "finalTimingDelta": envelope["timingDelta"] if path == TIMING else None})
        affected = envelope["affected"]
        rerun_command, rerun_results = ref(affected["command"]), ref(affected["results"])
        rerun_log = str(Path(affected["command"]["path"]).with_name("command.log")).replace("\\", "/")
        required[rerun_log] = sha(contained(evidence_root, rerun_log).read_bytes())
        rerun_cases = case_map(rerun_results)
        rerun_stats = rerun_results.get("stats", {})
        require(isinstance(rerun_command.get("runId"), str) and rerun_command["runId"]
                and rerun_command["runId"] != run_id, "BROWSER_AFFECTED_RUN_ID_NOT_DISTINCT")
        require(rerun_command.get("status") == "FAIL" and rerun_command.get("exitCode") == 1
                and rerun_command.get("fullRunId") == run_id and rerun_command.get("buildId") == build_id
                and rerun_command.get("testSourceUnchanged") is True and rerun_command.get("runtimeSourceUnchanged") is True,
                "BROWSER_FIRST_AFFECTED_RAW_COMMAND_NOT_BOUND_ON_SAME_RUNTIME")
        require(rerun_command.get("command") == CORRECTIVE_COMMAND,
                "BROWSER_AFFECTED_COMMAND_SCOPE_INVALID")
        timing_cases = {key for key in rechecked if Path(actual[key]["file"]).name == "operator-timing.spec.ts"}
        first_timing_failures = {key for key in timing_cases if actual[key]["title"] != TIMING_FAILED_TITLE}
        require(set(rerun_cases) == rechecked
                and all(actual_status(item) == ("failed" if key in first_timing_failures else "passed") for key, item in rerun_cases.items())
                and rerun_results.get("errors") == [] and rerun_stats.get("expected") == 6
                and rerun_stats.get("unexpected") == 3
                and all(rerun_stats.get(key) == 0 for key in ("skipped", "flaky")),
                "BROWSER_FIRST_AFFECTED_RAW_CASES_NOT_EXACT_SIX_PASS_THREE_TIMING_FAIL")
        require(rerun_command.get("stats") == rerun_stats, "BROWSER_AFFECTED_RAW_STATS_MISMATCH")
        require(all(rerun_cases[key]["title"] == actual[key]["title"]
                    and rerun_cases[key]["file"] == actual[key]["file"] for key in rechecked),
                "BROWSER_AFFECTED_CASE_IDENTITY_CHANGED")
        require(affected["sourceManifest"]["path"] != envelope["deliveredTestSource"]["path"], "BROWSER_INTERMEDIATE_AND_FINAL_MANIFESTS_MUST_BE_DISTINCT")
        require(rerun_command.get("sourceManifest") == affected["sourceManifest"]["path"],
                "BROWSER_AFFECTED_COMMAND_SOURCE_LINK_MISMATCH")
        ref(affected["sourceManifest"])
        require(full_finished <= clock(intermediate_manifest["capturedAt"]) <= clock(rerun_command["startedAt"])
                < clock(rerun_command.get("endedAt") or rerun_command.get("finishedAt")),
                "BROWSER_AFFECTED_EXECUTION_CLOCK_INVALID")
        common = ref(affected["commonCheckpointBinding"])
        common_original = f"docs/evidence/lms-one-run-20261015/{folder}/common-prepared/common-history-result.json"
        common_copy = f"docs/evidence/lms-one-run-20261015/agent-c/{rerun_command['runId']}/common-prepared/common-history-result.json"
        require(common.get("privateOriginalProductPath") == common_original
                and common.get("privateCopyProductPath") == common_copy,
                "BROWSER_REPEAT_CHECKPOINT_PATH_MISMATCH")
        original_common = contained(product_root, common_original).read_bytes()
        copied_common = contained(product_root, common_copy).read_bytes()
        prepared_common = json.loads(original_common.decode("utf-8-sig"))
        require(original_common == copied_common and sha(original_common) == common.get("sha256")
                and prepared_common.get("status") == "PASS"
                and prepared_common.get("suiteRunId") == common.get("suiteRunId") == run_id
                and rerun_command.get("checkpointRunId") == run_id
                and prepared_common.get("requestId") == common.get("requestId"),
                "BROWSER_REPEAT_CHECKPOINT_NOT_EXACT_EXECUTED_FULL_SOURCE")
        fixture = ref(affected["fixtureManifest"])
        image = next((item for item in fixture.get("images", []) if item.get("name") == "large-synthetic.jpg"), None)
        require(image is not None and fixture.get("synthetic") is True, "BROWSER_POSITIVE_FIXTURE_PROVENANCE_MISSING")
        source_bytes = contained(product_root, affected["fixtureProductPath"]).read_bytes()
        require(sha(source_bytes) == image.get("sha256") and len(source_bytes) == image.get("bytes")
                and 1024 * 1024 < len(source_bytes) <= 5 * 1024 * 1024
                and jpeg_dimensions(source_bytes) == (image.get("width"), image.get("height")) == (3000, 4000),
                "BROWSER_POSITIVE_FIXTURE_OUTSIDE_UNCHANGED_CONTRACT")
        for binding in bindings:
            if (binding["specId"], binding["projectId"]) in rechecked - timing_cases:
                binding.update(sourceRunId=rerun_command["runId"], status="passed",
                               replacedFailureEvidence=envelope["full"]["results"],
                               passingEvidence=affected["results"])
        corrective_commands.append({"commandEvidence": affected["command"],
                                    "resultsEvidence": affected["results"],
                                    "record": rerun_command})
        timing = envelope["timingCompletion"]
        timing_command, timing_results = ref(timing["command"]), ref(timing["results"])
        timing_log = str(Path(timing["command"]["path"]).with_name("command.log")).replace("\\", "/")
        required[timing_log] = sha(contained(evidence_root, timing_log).read_bytes())
        final_timing_cases = case_map(timing_results)
        timing_stats = timing_results.get("stats", {})
        require(timing_command.get("runId") not in (None, "", run_id, rerun_command["runId"])
                and timing_command.get("fullRunId") == run_id
                and timing_command.get("command") == TIMING_COMMAND
                and timing_command.get("status") == "PASS" and timing_command.get("exitCode") == 0
                and timing_command.get("buildId") == build_id
                and timing_command.get("testSourceUnchanged") is True and timing_command.get("runtimeSourceUnchanged") is True
                and timing["sourceManifest"] == envelope["deliveredTestSource"]
                and timing_command.get("sourceManifest") == envelope["deliveredTestSource"]["path"],
                "BROWSER_FINAL_TIMING_COMMAND_NOT_EXACT_PASS")
        require(set(final_timing_cases) == timing_cases
                and all(actual_status(item) == "passed" for item in final_timing_cases.values())
                and timing_results.get("errors") == [] and timing_stats.get("expected") == 4
                and all(timing_stats.get(key) == 0 for key in ("unexpected", "skipped", "flaky"))
                and timing_command.get("stats") == timing_stats
                and all(final_timing_cases[key]["title"] == actual[key]["title"] and final_timing_cases[key]["file"] == actual[key]["file"] for key in timing_cases),
                "BROWSER_FINAL_TIMING_CASES_NOT_EXACT_FOUR_PASS")
        require(clock(rerun_command.get("endedAt") or rerun_command.get("finishedAt"))
                <= clock(current_manifest["capturedAt"]) <= clock(timing_command["startedAt"])
                < clock(timing_command.get("endedAt") or timing_command.get("finishedAt")),
                "BROWSER_FINAL_TIMING_CLOCK_INVALID")
        for binding in bindings:
            if (binding["specId"], binding["projectId"]) in timing_cases:
                binding.update(sourceRunId=timing_command["runId"], status="passed",
                               originalFullEvidence=envelope["full"]["results"],
                               intermediateCorrectiveEvidence=affected["results"],
                               passingEvidence=timing["results"])
        corrective_commands.append({"commandEvidence": timing["command"], "resultsEvidence": timing["results"], "record": timing_command})
        if skipped:
            dependency = envelope.get("dependencyCompletion")
            require(isinstance(dependency, dict), "BROWSER_DEPENDENCY_COMPLETION_REQUIRED")
            dep_command, dep_results = ref(dependency["command"]), ref(dependency["results"])
            dep_log = str(Path(dependency["command"]["path"]).with_name("command.log")).replace("\\", "/")
            required[dep_log] = sha(contained(evidence_root, dep_log).read_bytes())
            dep_cases, dep_stats = case_map(dep_results), dep_results.get("stats", {})
            require(dep_command.get("runId") not in (None, "", run_id, rerun_command["runId"], timing_command["runId"])
                    and dep_command.get("fullRunId") == dep_command.get("checkpointRunId") == run_id
                    and dep_command.get("command") == DEPENDENCY_COMMAND
                    and dep_command.get("status") == "PASS" and dep_command.get("exitCode") == 0
                    and dep_command.get("buildId") == build_id
                    and dep_command.get("sourceManifest") == envelope["deliveredTestSource"]["path"]
                    and dep_command.get("testSourceUnchanged") is True
                    and dep_command.get("runtimeSourceUnchanged") is True,
                    "BROWSER_DEPENDENCY_COMMAND_NOT_PASSED_ON_EXACT_RUNTIME_AND_CHECKPOINT")
            require(set(dep_cases) == skipped and all(actual_status(item) == "passed" for item in dep_cases.values())
                    and dep_results.get("errors") == [] and dep_stats.get("expected") == 1
                    and all(dep_stats.get(key) == 0 for key in ("unexpected", "skipped", "flaky"))
                    and dep_command.get("stats") == dep_stats,
                    "BROWSER_DEPENDENCY_COMPLETION_NOT_EXACT_PASS")
            require(all(dep_cases[key]["title"] == actual[key]["title"]
                        and dep_cases[key]["file"] == actual[key]["file"] for key in skipped)
                    and dependency["sourceManifest"] == envelope["deliveredTestSource"],
                    "BROWSER_DEPENDENCY_CASE_OR_SOURCE_CHANGED")
            require(clock(timing_command.get("endedAt") or timing_command.get("finishedAt"))
                    <= clock(dep_command["startedAt"])
                    < clock(dep_command.get("endedAt") or dep_command.get("finishedAt")),
                    "BROWSER_DEPENDENCY_COMPLETION_CLOCK_INVALID")
            proof = ref(dependency["verifiedPages"])
            checkpoint = ref(dependency["checkpointBinding"])
            prepared = ref(checkpoint["g1Result"])
            original_checkpoint = contained(product_root, checkpoint["privateOriginalProductPath"]).read_bytes()
            copied_checkpoint = contained(product_root, checkpoint["privateCopyProductPath"]).read_bytes()
            saved_checkpoint = json.loads(original_checkpoint.decode("utf-8-sig"))
            require(checkpoint.get("suiteRunId") == run_id
                    and checkpoint.get("privateOriginalProductPath") == f"docs/evidence/lms-one-run-20261015/{folder}/g1-prepared/g1-checkpoint.json"
                    and checkpoint.get("privateCopyProductPath") == f"docs/evidence/lms-one-run-20261015/agent-c/{dep_command['runId']}/g1-prepared/g1-checkpoint.json"
                    and checkpoint["g1Result"]["path"] == f"{folder}/g1-prepared/g1-result.json"
                    and original_checkpoint == copied_checkpoint
                    and sha(original_checkpoint) == checkpoint.get("checkpointSha256")
                    and saved_checkpoint.get("suiteRunId") == prepared.get("suiteRunId") == run_id
                    and saved_checkpoint.get("status") == "FILES_VERIFIED" and prepared.get("status") == "PASS"
                    and checkpoint.get("requestId") == saved_checkpoint.get("requestId") == prepared.get("requestId"),
                    "BROWSER_DEPENDENCY_ORIGINAL_CHECKPOINT_IDENTITY_MISMATCH")
            require(proof.get("status") == "PASS" and proof.get("suiteRunId") == run_id
                    and proof.get("requestId") == checkpoint.get("requestId")
                    and proof.get("people") == 100 and len(proof.get("originalHashes", [])) == 101,
                    "BROWSER_ORIGINAL_CHECKPOINT_PRINT_PACK_PROOF_MISSING")
            for binding in bindings:
                if (binding["specId"], binding["projectId"]) in skipped:
                    binding.update(sourceRunId=dep_command["runId"], status="passed",
                                   dependencySkippedEvidence=envelope["full"]["results"],
                                   passingEvidence=dependency["results"])
            corrective_commands.append({"commandEvidence": dependency["command"],
                                        "resultsEvidence": dependency["results"], "record": dep_command})
        else:
            require(not envelope.get("dependencyCompletion"), "BROWSER_UNNEEDED_DEPENDENCY_OVERRIDE")
        mode = MODE

    require(len(bindings) == 219 and all(item["status"] == "passed" for item in bindings),
            "BROWSER_EFFECTIVE_COVERAGE_UNRESOLVED")
    return {
        "mode": mode, "coverageVerified": True, "rawFullSuitePassed": raw_pass,
        "runId": run_id, "fullRunId": run_id,
        "rawFullCommand": {"status": command["status"], "exitCode": command["exitCode"], "stats": stats,
                           "recordPath": f"{folder}/command.json", "sha256": required[f"{folder}/command.json"],
                           "commandLogPath": f"{folder}/command.log", "commandLogSha256": required[f"{folder}/command.log"],
                           "record": command},
        "logicalCoverage": {"discovered": 219, "passed": 219, "unresolved": 0,
                            "retainedFromFull": 219 - len(rechecked) - len(skipped),
                            "rechecked": len(rechecked), "dependencyCompleted": len(skipped)},
        "caseBindings": bindings, "deliveredTestSources": [{"path": path, "sha256": digest} for path, digest in sorted(delivered_sources.items())],
        "reviewedSourceDeltas": deltas, "webBuildId": build_id,
        "correctiveCommandRecords": corrective_commands,
        "runtimeSource": {"path": f"{folder}/runtime-source.json", "sha256": required[f"{folder}/runtime-source.json"]},
        "requiredEvidence": [{"path": path, "sha256": digest} for path, digest in sorted(required.items())],
    }
