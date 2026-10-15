"""Generate a reviewable 44-criterion draft; never declare final acceptance."""
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[2]
evidence = root / "docs/evidence/lms-one-run-20261015"
destination = evidence / "agent-c"
audit = json.loads((destination / "acceptance-gap-audit.json").read_text(encoding="utf8"))
now = datetime.now(timezone.utc).isoformat()
base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=root, text=True).strip()

# Each row is an independently assessable assertion, not a criterion-level PASS.
# P: executed evidence supports this bounded assertion; N: still requires execution/reconciliation.
# All top-level criteria remain NOT_RUN until the coordinator binds the final battery/tree.
cases = {
"L01": [
 ("P", "B2C registration creates only learner and records consent/profile", "Real HTTP rejects role/tenant/membership injection, false consent and foreign-person claim; browser registration completed with three fields and consent."),
 ("P", "B2B invitation is scoped, expires and is single use", "Concurrent invite consumers produced one success and one used-token rejection; expired and repeated invites denied."),
 ("P", "Login/logout/revocation and recovery preserve authentication boundaries", "Persisted-cookie logout/session-version revocation denied subsequent access; different recovery tokens cannot both reset one learner."),
 ("N", "Safe error/rate-limit assertions bind to final source and logs contain no sensitive values", "Targeted HTTP evidence exists; final whole-suite/source and log audit is pending."),
],
"L02": [
 ("P", "Learner cannot use old printing/settings/users/approvals/files/jobs endpoints", "Real authenticated HTTP denial assertions passed across old read/write surfaces; route-policy unit matrix also passed."),
 ("P", "Unknown role has no implicit authorization", "Fresh isolated DB normally rejected unsupported role with23514; controlled unsupported-row fixture then got login401 and nine protected operations403, with exact CHECK restored."),
 ("P", "Employer membership is checked on server", "Same-tenant other-organization data excluded; own protected PDF downloaded and foreign PDF returned404 in actual browser."),
 ("P", "Limited existing VIEWER role cannot gain new LMS authority", "Actual fresh VIEWER login after role change retains ordinary GET print-requests200, denies three legacy writes403 and seven new LMS/learner read/write surfaces403. Optional instructor user role is not enabled; see scope interpretation."),
 ("N", "Existing allowed manager/director workflows remain valid throughout final suite", "Targeted prepared assignment/document workflows pass; complete production browser suite pending."),
],
"L03": [
 ("P", "Substituted tenant/person/enrollment IDs cannot redirect reads or writes", "Direct IDs and aggregates tested across tenants/self and two employer organizations; request tenant cannot change scope."),
 ("P", "Files/materials/results are scoped and do not reveal another person", "Private Range/PDF and same-issuance wrong-recipient artifact checks reject foreign scopes; exact paper binding409."),
 ("P", "Confirmed people counts/search are tenant scoped", "Own confirmed2/recipients5/unknown3 remained distinct from foreign1/8/7; equal names were not inferred as identity, learner/employer count requests403."),
],
"L04": [
 ("P", "RU/KZ course draft can be saved and published with explicit profile/calendar", "Actual editor and calendar browser scenarios passed; published course/profile immutable and draft hidden in PostgreSQL tests."),
 ("P", "New version does not alter existing enrollment or exam snapshot", "Created next draft while enrolled version stayed unchanged; changed bilingual question bank did not change started attempt."),
 ("N", "Complete UI-authored linked course has ordered required text/PDF and prereqs", "Actual critical first-flow created the course, required lessons and exam, closed UI and restarted its worker; it failed later on a real document snapshot name-fallback mismatch. Root fix and regression pass; whole-flow fresh rerun remains necessary."),
 ("P", "Unconfirmed legal profile cannot start official center exam", "NEEDS_LEGAL_REVIEW and incompatible GENERAL competency rejected; no effective date/confirmation inferred."),
],
"L05": [
 ("P", "Only permitted file types and sizes can be uploaded", "Actual private file upload, disguised HTML rejection, over512MB header413 and chunked22MB external413 passed."),
 ("P", "Private file authorization cannot be bypassed by paths, storage URL or wrong-purpose token", "Traversal/public storage and valid recovery-token-as-material credential denied; unassigned/foreign tenant/prereq access denied."),
 ("P", "Bytes are streamed privately and corruption is rejected", "Authenticated MP4 Range206 matched exact bytes/Content-Length; invalid ranges and altered stored bytes rejected."),
 ("N", "Opening PDF is separate from acknowledgment through actual learner UI", "The actual critical flow reached PDF open and separate acknowledgement before completing its exam, but its enclosing test failed later at document preparation. Fresh complete rerun is pending."),
],
"L06": [
 ("P", "Actual video plays, pauses, seeks, reloads and resumes", "Chrome video playback acceptance passed; Range and saved position were measured on real file."),
 ("P", "Seek/end jump/duplicate and overlapping heartbeat cannot fake viewing", "Server interval, sequence and client completion attacks did not satisfy required progress."),
 ("P", "Video continues after logout and login", "Actual critical Chrome video scenario passed pause/reload/logout/login, resumed from saved position and completed only after natural playback; exact PLAYBACK_ACCEPTANCE and enclosing passed result are linked."),
],
"L07": [
 ("P", "Required lesson completion gates server attempt and material access", "Missing required progress rejects exam and private URLs; client completion100/sequence replay cannot invent progress."),
 ("P", "Reload, conflict and new version cannot overwrite fresh state", "Real two-tab409 browser retained saved answer; reload/logout/login recovered state; enrolled version unchanged after new draft."),
 ("P", "Expiry and permitted extension are scoped and audited", "Expired direct material denied; director actual UI extension restored permitted path and learner recovery worked."),
 ("N", "Aggregate progress and linked text/PDF prerequisites survive complete fresh UI flow", "First-flow pending; standalone text100/PASSED and server prerequisite scenarios already passed."),
],
"L08": [
 ("P", "Prepared groups1/10/100/250 assign with one shared operation", "Real UI every scale preselected correct known group/course, Enter submitted one batch; exact database counts verified."),
 ("P", "Mixed error preserves ready rows and only failed row is retried", "One EMPLOYMENT_REQUIRED row per scale repaired using known employer; selected successful rows cleared once, failed row stayed selected, repeatedFields0."),
 ("P", "Concurrent/repeated identical assignments never duplicate enrollment", "PostgreSQL concurrency and actual UI replay retained required counts and same IDs."),
 ("P", "Identical names never merge confirmed people or infer a selected Recipient", "Actual HTTP search returned two distinct confirmed profiles with visible positions; name-only assignment400, explicit IDs created1 then1, replay0 and foreign same-name enrollment404."),
 ("P", "Ambiguous-person UI selection is measured without repeated entry", "Actual complete batch-ambiguity-02 passed all1/10/100/250 repairs and at390px selected one of two equal-name profiles using visible distinguishing data, preserving explicit IDs and recording search/choice/assignment without repeated business entry."),
],
"L09": [
 ("P", "New staff/employer screens work RU/KZ at360/390/768/1440", "64 actual Chrome geometry samples: no page overflow, controls at least44px and focus/no raw enums; screenshots retained."),
 ("P", "Learner registration/course/exam retain data through language switch", "Registration and learning browser paths passed both languages and four widths, answers remained after language switch."),
 ("N", "Final visual/focus/error review is bound to delivered UI", "Existing visual reviews are recorded; full production suite may expose fresh regressions and remains pending."),
],
"L10": [
 ("P", "Saved enrollment/snapshot/progress survive database reconnect and restore", "Persisted enrollment reconnect and restored result/private bytes/outbox verified; restored worker restarted without duplicate records."),
 ("P", "Every required audit event contains actor/scope/revision/time/correlation and cannot be edited", "Actual HTTP registration/create/save/publish/assign/extend/role update tied response correlation to immutable DB actor/tenant/entity/time; content revision/hash and old/new role/active/sessionVersion verified. Learner/foreign audit denied, DB UPDATE/DELETE immutable; API restart and Prisma reconnect preserved records."),
 ("N", "Final source and runtime manifest plus sensitive-log audit is complete", "Manifest and logs are being assembled; not a completed assertion yet."),
],
"E01": [
 ("P", "RU/KZ single/multiple questions support categories and selected order", "Boundary test authored9 questions with categories/multiple and froze selected5; stored attempt carried chosen order and grading policy."),
 ("P", "Published bank changes cannot change started attempt", "New published version had changed bank while original attempt snapshot/hash unchanged."),
 ("P", "External result has no invented internal question attempt", "Document-reviewed external result retained null attempt and score with externalEvidenceId."),
],
"E02": [
 ("P", "Server checks assignment/version/profile/prerequisites before official exam", "Missing lessons, foreign scope, NEEDS_LEGAL_REVIEW and incompatible competency denied; local-midnight admission uses profile timezone date."),
 ("P", "PRACTICE/CENTER_EXAM/EXTERNAL_AUTHORIZED stay separate", "Practice passed but remained ineligible; allowed center produced attempt-bound result; external did not create an internal attempt."),
 ("P", "Required practice/proctoring and commission cannot be bypassed", "Actual start409 and external ineligible for required practice/proctoring; missing commission publish400 and corrupted-import finalizer ineligible. Separate explicit signing policy tests enforce required signers."),
],
"E03": [
 ("P", "Server deadline controls timer and cannot be moved by client clock", "Actual browser changed Date.now by plus/minus24h while countdown continued from monotonic clock; server deadline/state unchanged."),
 ("P", "Offline answer/reconnect and two-tab conflict retain work", "One offline final answer autosaved on reconnect; stale tab got409 and explicit return restored saved answer without loss."),
 ("P", "Closed-browser expiry and restart finalize saved answers once", "Deadline worker/submit race and fresh child-process replay gave exactly one result and one outbox."),
],
"E04": [
 ("P", "Client cannot set score/pass/correctAnswer/maximum", "Real HTTP and service injection rejected; unknown questions and stale answer sequence could not overwrite saved answers."),
 ("P", "Keys are hidden from learner before allowed disclosure", "Course/attempt read assertions excluded answer keys; published source remained immutable; server computed actual10/10 and strict threshold."),
 ("P", "Actual serialized learner responses and material bytes do not reveal keys against policy", "Actual catalogue/enrollment/attempt/autosave/progress/material full and Range responses checked, including FINISHED/replay under revealAnswers=false; keys and explanations absent."),
],
"E05": [
 ("P", "Parallel start and double submit create one active attempt/result", "Eight concurrent starts yielded one active attempt; simultaneous submits returned same immutable result and outbox."),
 ("P", "Submit versus deadline and post-restart replay are consistent", "Controlled concurrent expiry/submit plus fresh-process replay preserved counts1/1."),
 ("P", "Retake count cannot be bypassed", "Retake90 percent passed after80 failed; subsequent limit enforced after deadline completion."),
],
"E06": [
 ("P", "Sanitary comparison is strictly more than80 percent without rounding", "200/250 failed;201/251 passed and200/251 failed using exact integer comparison."),
 ("P", "Empty/incomplete result uses known maximum and no fabricated external score", "Empty0/251 failed; partial answers counted against full maximum; reviewed external score stayed null."),
 ("P", "Threshold remains versioned and other policy can be GTE", "Pure domain test distinguishes sanitaryGT80 from ordinaryGTE and attempt stores policy."),
],
"E07": [
 ("P", "Ordinary PASSED/AUTO is not verified LMS evidence", "Actual ordinary PrintRequest plus assignment retained PASSED/AUTO and revision after both IDs were rejected by LMS document preparation; 0 result/outbox/documentLink/job/document/number."),
 ("P", "Practice, unreviewed external and legal-review profiles cannot be eligible", "Actual tests reject internal/external wrong routes; voided result excluded from list/detail without rewriting old snapshot."),
 ("P", "Allowed external review preserves provenance and level", "Director DOCUMENT_REVIEWED generated source-bound result without attempt/score; MACHINE_VERIFIED injection denied; OPERATOR review denied."),
 ("N", "All FAILED/ABSENT/AUTO and historical MANUAL/IMPORTED/CLEARED combinations retain old printing behavior", "Final existing DEMO regression is pending; this draft does not infer all combinations from new LMS tests."),
],
"E08": [
 ("P", "Three LMS document types use existing DEMO approval/render/numbering", "Real protocol/certificate/credential prepared and rendered; concurrent prepare preserved one request and transactional numbers."),
 ("P", "Replay/correction/source binding does not invent a second issuance", "Original artifact bytes and numbers remain immutable, linked correction revisions and repeat identity checked."),
 ("N", "Full first-entry UI path and all legacy production-build issuance scenarios pass", "Prepared operator path passed; first-flow and full suite pending."),
],
"E09": [
 ("P", "Explicit approval/signing policy cannot borrow unrelated default signer", "Signing-policy tests retain explicit required/unbound slots; director and mixed DEMO defaults cannot silently satisfy LMS requirements."),
 ("P", "Unsigned paper preparation only becomes issued after separate honest attestation", "Latest actual UI AWAITING_SIGNATURE toISSUED, actor/date stored, no electronic signatures and unchangedPDFhash; invalid/future/conflicting/employer attempts denied."),
 ("P", "Mandatory commission/practice/proctoring cannot be silently treated as optional", "Dedicated actual API boundary test rejects start and external eligibility when practice/proctoring required; missing commission blocks publish and corrupted imported profile cannot finalize eligible."),
],
"E10": [
 ("P", "Public verification displays minimal data and truthful type/legalForm", "24 real issued views across3types,4widths,RU/KZ reviewed; no private fields; paper attestation never creates electronic signature."),
 ("P", "Protected download and paper source identity are enforced", "Own employerPDF allowed/foreign404; wrong recipient and unknowncanonical paper fixtures409 with originals unchanged."),
 ("N", "Full first-entry actual UI publication and final legalForm matrix are reconciled", "New full flow includes publication checkbox/QR/public popup; execution pending; root must preserve four-form test coverage."),
],
"E11": [
 ("P", "Correction creates new linked revision and preserves original bytes/source", "Root document test verifies old artifacts/snapshot/number stable and revoked QR status; immutable result revision keeps source/issuer."),
 ("P", "Repeated/concurrent correction and late receipt do not duplicate/rewrite history", "Regulatory test creates one correction under race, fences original stale delivery, usespreviousExternalId and adapter.correct."),
],
"E12": [
 ("P", "Actual application DOCX/PDF and public screens have evidence", "Root document files, operator realZIP,24public views and RU/KZ internal list PDFs retained and visually inspected."),
 ("N", "Full fresh production-build render/browser regression passes", "Full browser03 actually stopped after a positive-fixture date error; corrected portal target passed. Critical14 finished11PASS/3FAIL; complete fresh suite04 and final renderer binding remain required."),
 ("P", "Physical print/real signatures are distinguished from local visual test", "Paper evidence explicitly physicalPrintPerformed=false and electronicSignatures=0; external real completion remains gated."),
],
"S01": [
 ("P", "Eligible internal/external sources use exact frozen profile/version/tenant", "Attempt and reviewed external result cases create correct outbox; unknown external date preserves source while requiring review."),
 ("P", "Wrong legal status/route/program cannot generate outbound eligible result", "PRACTICE,unverified,voided/legal-review/general route rejected or remainedineligible; no title-based authorization."),
 ("P", "Historical AUTO cannot enter the result/outbox/document path", "Dedicated realHTTP synthetic ordinary PASSED/AUTO request and assignment IDs produced0 documentitems/2errors; zero result,outbox,link,job,document,number and unchanged ordinary outcome/revision."),
],
"S02": [
 ("P", "Result commit/outbox/expired preparation lease survive crash without UI", "Forced checkpoint/expired lease/reconnect plus replay created exactlyonejournal,batchitem,delivery; all groupedoutboxesDONE."),
 ("P", "Restored worker resumes pending outbox without duplicates", "Actual backup/restore then two preparation workers and a second fresh process left one result/item/journal/delivery and processed0 on replay."),
 ("N", "Persistent worker creates linked first-flow list with0 user actions", "Actual critical flow closed all UI contexts, stopped its own worker46580, started37980, signed in afresh and preserved exact result/outbox/journal/item/delivery IDs and hashes with no duplicates. The outbox was already DONE before restart, explicitly recorded. Its enclosing first-flow failed later at document preparation; a complete fresh pass and complete automatic timing record remain pending."),
],
"S03": [
 ("P", "Calendar handles Friday/holiday chain/workingSaturday/year coverage/localmidnight", "Fixed calendar cases retainedINTERNAL_SLA/timezone/cutoff/frozenversion; unknowncoverage returned review rather than inferredworkday."),
 ("P", "Unknown external exam time is not upload time", "Result examAtnull produced immediate internalNEEDS_REVIEW and dueAtnull; document preparation409; new datedsource creatednewrevision."),
 ("P", "Late confirmation and a new calendar cannot move the original deadline", "Dedicated case confirms late source exam October2 keeps deadline October5 and overdue state; calendar2 and outbox replay preserve frozen original hash/deadline."),
],
"S04": [
 ("P", "Batch/item carry exact frozen source/revision/profile and stable wholehash", "Persisted snapshot compared after currentperson/employer change; batchhash coverscomplete snapshot and eachitem deadline/reason."),
 ("P", "Privacy scope and minimalpayload remain enforced", "Foreign batch/files denied; route-required missingfields blocked; internal exports do not claim provider schema/clinicalrecord."),
],
"S05": [
 ("P", "Lease/fencing/replay and two workers do not create duplicate delivery", "Expiredlease reclaimed; stale token rejected; concurrentclaim1; restart replay preserves1; payloadhash conflict rejected."),
 ("P", "Throttle uses bounded backoff and cannot immediatelyretry", "429retry delayed and maximumattempt guard reached; safe transportstate distinct fromacceptance."),
 ("P", "Crash after possible send yieldsUNKNOWN with guardedreconciliation", "No blind resubmit withoutlookup/idempotency; lookup path reconciled recorded externalID."),
],
"S06": [
 ("P", "HTTP200/202 are not business acceptance orLMK confirmation", "200pending preservedreceipt semantics; explicitacceptedreceipt updatesonlydelivery and noLMK."),
 ("P", "Mixed item outcomes do not mark wholebatchaccepted", "Three pending results atomically sealedonebatch; accepted/rejected/pending counts1/1/1 and aggregatePARTIAL."),
 ("P", "Unknown outcome with no safe lookup staysneedsreview", "Post-sendcrash/timeout and missinglookup blocked second submit; supportedlookup resolved idempotently."),
],
"S07": [
 ("P", "Callback authenticates signature/hash/tenant/destination/environment", "Forged signature/bodyhash/foreignscope/wrongenvironment rejected using strictlocal testcontract."),
 ("P", "Correct replay is idempotent and terminalconflict is refused", "Same externalID/receipt replay stable; conflictingaccepted/rejected callback did notoverwrite terminalstate."),
],
"S08": [
 ("P", "Correction retains oldpayload/receipt and creates linkednewresult/delivery", "Immutable correction underparallel calls producedone revision andadapter.correct withpreviousExternalId."),
 ("P", "Late oldreceipt/unsupportedcorrection/void cannot impersonatesuccess", "Fencing rejected late receipt; unsupportedcapabilityNEEDS_REVIEW; voidedsupersededsource unclaimable."),
],
"S09": [
 ("P", "Disconnected route and DataAccessPolicy failclosed", "Everymissing connection/policy prerequisite tested; actualadapterinjection requiresloopbackdemo_test/demoOnlySANDBOX; no realprovider traffic."),
 ("P", "UI exposes truthful context to responsible role", "Director sanitarygeometry shows connectionnotconfigured; learner has no serviceconfig or fakeSend action."),
 ("N", "Final productiondeclaration/localgate source binding is complete", "Deploymentinventory/policy tests and packet exist; coordinator finalEXTERNAL_GATES/source hashes pending."),
],
"S10": [
 ("P", "CSV/XLSX/PDF preserveexactrows and neutralizeformula injection", "ActualCSV escapedformula, workbookcells hadnoformula, realRU/KZPDFreadable and inspected; nameswrapped withoutclipping."),
 ("P", "Manualevidence is protected, hashed and onlyoperatorattested", "ActualPDFupload/downloadSHA matched,foreign404/learner403, actor/source/revision retained; delivery/LMKstates notupgraded."),
],
"S11": [
 ("P", "Freshinstall/upgrade preserve oldrows and newrelations", "Separatefresh25migration and baseline23upgradeDBs comparedoldhashes/noAUTO backfill; backuprestore76tables126assets/privatefilespassed."),
 ("P", "Restored pendingtask runs once afterrestart", "FreshrestoredDB workerprocessedpendingoutbox; secondfreshprocess0 and1eachitem/journal/delivery; hashespreserved."),
 ("P", "Prepared250assignment and confirmedsubjects scoped correctly", "ActualUI1/10/100/250mixed-errorrepair passed; accountingown2/unknown3 vsforeign1/unknown7 didnotleak."),
 ("P", "Quietfinal100activelearnerload meetsbudget", "Fullintegration02 quiet window22:41:19–22:41:22UTC:100simultaneouslyactive,400actualauthenticatedrequests,p95799.1326ms,0unexpected5xx,maxinflight100. Actualrecord load-1792017682452.json; earlier loaded-run failure retained, not overwritten."),
 ("N", "Fullfirst-entry and completelegacyDEMO freshbuildregressionpass", "Fullmandatoryintegration/render/browser/build chain notcomplete; no acceptedrollup."),
],
"S12": [
 ("P", "Localdeploymentpolicy blocksunknownrealplacement", "Unitpolicy requiresknowncopies/region/owner/access/retention and blocksunknown/foreignrealdeployment; inventorypacketpresent."),
 ("N", "P01-P13 owners/status/prerequisites and independentexternalstatuses reconciled", "Draftprovider/data-gate documents exist; coordinator finalEXTERNAL_GATES remains required. Externalprovider/production/LMK remainBLOCKED_EXTERNAL_INPUTS."),
],
"UX01": [
 ("N", "Freshpreimplementationbrowsercomparison", "NOT_RUN excluded by explicituserinstruction: Продолжить без исходного браузерного замера. Archive/build preserved; no before/aftertimeclaim."),
 ("P", "CurrentordinaryDEMO draft has compactentry/autosave/return", "Currentdev ordinarydraft enteredperson,autosaved,navigatedawayandreturned; thisisnotoriginalbaseline."),
 ("N", "Allcurrentordinaryprinting/manualexceptions/import/keyboard/bundlepaths remainusable", "Current ordinary prepared cycle passed on production build; full mandatory legacy browser03 stopped after a fixture error and fresh full04 remains required."),
],
"UX02": [
 ("P", "Preparedassignment≤2,continue1,prepare≤2,download≤2", "Measuredassignment1click/continue1click; preparedresult1prepare+1download, directorapprovalaccountedseparately."),
 ("P", "Fullselection costandrole actions remainvisible", "Existingmetrics identifypreparedstartstate/APIfixture exclusions; separatefirst-entrymetrics recordactualfields,selection andnavigation."),
 ("N", "Finalwholefirst-entry measurementsandcurrentUIbudgets merged", "Newlinkedflow pending; finalUX_ACTIONS aggregation notyetpublished."),
],
"UX03": [
 ("P", "Knownfacts travelwithoutrepeatedentry", "Preparedassignment/exam/documents anderrorrepair reportrepeatedFields0; sourcebindings anddocbridge copyknownfacts."),
 ("P", "Language/tab/error changes do notclear work", "Offline/stale-tab andmixedbatch repairs retainedsavedanswers/selectedfailedrow/course; knownemployer repairneeded no nameinput."),
 ("N", "Fullfirst-entry person→course→documents→sanitary repeatedFields0 measured", "Actual linked UI reached result/list/restart then failed at document preparation. A complete fresh pass remains required; business reentry and authentication reentry are separately counted."),
],
"UX04": [
 ("P", "Course/answersautosave showstateandpreserveinput", "Editorautosavepublished, offlinefinalanswerrecovered andstaleconflict blockedunsafe submit."),
 ("P", "Defaultsnevercreateofficialexam/signature/receipt", "Practiceineligible,reviewlevelpreserved,paperrequiresattestation,HTTP200doesnotaccept."),
 ("N", "Oldmanual/imported/clearedexceptions and shareddefaultsremainpreserved", "Fulllegacybrowser/integrationrerun pending; historicalproofalone isnotfinalPASS."),
],
"UX05": [
 ("P", "Batchconfirmationsdo notscaleperperson", "All1/10/100/250preparedgroupssubmittedonekeyboardaction; onefailedrow repairedwithtwoactions,0dialogs/repeatedfields."),
 ("P", "Successfulrows/course/format persist throughmixedfailure", "ActualUI verifiedonlyfailedrowselected,courseunchanged,successcountintact,replaydeduplicated."),
 ("P", "Separateparticipantsignaturesarenotclaimedautomatic", "Directorapproval/paperattestation aremeasuredseparate; no electronic signaturesinvented."),
],
"UX06": [
 ("P", "Role/statecontrols andhumanerrorshaveappropriatenextstep", "Geometry/director/employer screens andexplicitrowemployerrepair passed; disconnectednotfakeSend."),
 ("P", "Internalauto-preparationneedsnooperatorbutton", "Directoutbox/restoreworkerscreatejournal/list/deadlinewithoutUIorPDF."),
 ("N", "Linkedrealpersistentworker flow records0operatoradvancement", "First-flowpending; existingisolatedworkerproofdoesnotreplacefullbrowsermeasurement."),
],
"UX07": [
 ("P", "Actualscreens inspectedforreadablelabels andtruthfuldocumentstates", "B reviewedKZ360editor/RU390sanitary; root reviewedrealpublictype/legalForm;64geometrysamples checkedrawenums andaccessiblelabels."),
 ("P", "Warningsdistinguishunsigned/notaccepted/unknownwithoutfakegreen", "Paperstatusonlychangesafterattestation; sanitarynotconnected andunknownreceiptstates preserved."),
 ("N", "Finalerror-state microcopy reviewbindsdeliveredtree", "Fullsuiteandfinalvisualaudit pending; regexaloneisnotcriterionacceptance."),
],
"UX08": [
 ("P", "Offline/relogin/conflict/replayretainwork andavoidduplicates", "Browserofflineautosave/stale409/relogin/replay andactualrecoverypathpassed; APIpasswordrecoveryraceclosed."),
 ("P", "Unknownoutcomeandmixederrorshavehonestrecovery", "Providerunknownrequireslookup/review; mixedgrouprepairsone rowwithoutrestart/modalcascade."),
 ("N", "Finalslow-network feedback andallloading/focus pathsreconciled", "Existingoffline/conflictproof pass; coordinator finalsource andfullsuite reviewpending."),
],
"UX09": [
 ("P", "RU/KZfourwidths touch/focusgeometryusable", "64staff/employer pluslearner/publicsamples show≥44px,nooverflow andretainedfocus."),
 ("P", "Keyboarddoesnotdangerouslyfinalizeexam", "Tab/Enter/Escape conflictbrowser didnotautosubmit; assignmentEnter allowedexplicitbatchaction;390scale100/250tested."),
 ("N", "Finalfreshproductionbrowserregressioncomplete", "Full03 partial failure and critical14 results are preserved; corrected fresh full04 remains pending. Passing targeted Chrome paths do not establish all mandatory paths."),
],
"UX10": [
 ("P", "Prepared/error/firstentryparts recordactionsandactualtime", "Assignment/learning/operator/registration/editor/conflict/batch evidence hasroles/start/preconditions/steps andperkindmetrics, separateauthentication/approval."),
 ("N", "Allsection8 scenarios havewholelinkedmeasurement andunifiedUX_ACTIONS", "Newlinkedfirstflow notrun; finalaggregationmustincludeactualtimestampsandallmetrics withoutseedcostconcealment."),
 ("N", "Before/afterbrowsercomparison", "NOT_RUN excluded by explicit user instruction: Продолжить без исходного браузерного замера. Original browser measurement remains excluded; no fabricated before/after saving."),
],
}

definitions = (root / "docs/handoffs/2026-10-15-lms-one-run/ACCEPTANCE_AND_VERIFICATION_RU.txt").read_text(encoding="utf-8-sig")
criterion_definitions = {}
matches = list(re.finditer(r"^((?:L|E|S)\d{2}|UX\d{2}) — (.+)$", definitions, re.M))
for i, match in enumerate(matches):
    end = matches[i + 1].start() if i + 1 < len(matches) else definitions.index("8. ОБЯЗАТЕЛЬНЫЕ")
    body = definitions[match.end():end].strip()
    body = re.split(r"\n\d+\. ", body)[0].strip()
    criterion_definitions[match.group(1)] = body

assert len(cases) == 44
draft = []
for criterion in audit["criteria"]:
    key = criterion["criterionId"]
    subs = []
    for i, (state, expected, actual) in enumerate(cases[key], 1):
        excluded = key in ["UX01", "UX10"] and "Продолжить без исходного браузерного замера" in actual
        subs.append({"subcaseId": f"{key}.{i:02d}", "expected": expected, "actual": actual,
                     "status": "PASS" if state == "P" else "NOT_RUN",
                     "evidencePaths": ["agent-c/baseline-scope-adjustment.json"] if excluded else criterion["existingEvidencePaths"],
                     "excludedByUserInstruction": excluded,
                     "userInstructionQuote": "Продолжить без исходного браузерного замера" if excluded else None})
    draft.append({"criterionId": key, "requirementIds": criterion["requirementIds"], "title": criterion["title"],
      "checkedAt": now, "checkedAtMeaning": "Draft evidence reconciliation time; actual execution timestamps remain in linked original reports.",
      "environment": {"scope": "local synthetic disposable PostgreSQL and private storage only", "databaseHost": "127.0.0.1:55449", "browser": "installed Chrome via Playwright", "productPath": str(root)},
      "sourceRevision": {"baseCommit": base, "branch": branch, "state": "uncommitted implementation; final manifest must bind exact tested tree"},
      "fixtureVersion": "lms-one-run-synthetic-v1 plus per-agent synthetic fixtures recorded in evidence",
      "preconditions": "Only demo_test* databases and synthetic demoOnly tenants; local provider adapter requires strict test guard; no real-provider calls.",
      "stepsOrCommand": "See original command manifests/logs and browser actions JSON linked per subcase; final command battery pending.",
      "requiredDefinitionVerbatim": criterion_definitions[key],
      "expected": "All mandatory local clauses in the preserved definition are executed and supported by final-tree evidence, subject only to explicit user baseline exclusion.",
      "actual": "Bounded executed subcases are listed below. This draft does not assert completeness of final source/commands.",
      "status": "NOT_RUN", "statusReason": "DRAFT: final delivered-tree binding and complete mandatory battery are not yet finished; see subcases.",
      "subcases": subs, "evidencePaths": criterion["existingEvidencePaths"], "defects": criterion["remainingChecks"],
      "externalDependencies": ["Real provider connection, signatures/authority and production data placement remain separate external gates; local synthetic PASS does not assert them."]})
manifest = []
for item in [Path(__file__), root / "scripts/verification/lms-acceptance-gap-audit.py"]:
    manifest.append({"path": item.relative_to(root).as_posix(), "sha256": hashlib.sha256(item.read_bytes()).hexdigest()})
out = {"draftOnly": True, "localAccepted": False, "criteriaCount": 44, "generatedAt": now,
       "reviewNote": "P subcases are bounded actual assertions, not a substitute for every source clause. N items require execution or explicit coordinator reconciliation. Never copy a top-level PASS from this draft.",
       "sourceManifest": manifest, "criteria": draft}
(destination / "acceptance-results-draft.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps({"criteria": len(draft), "subcases": sum(len(c["subcases"]) for c in draft), "notRunSubcases": sum(s["status"] == "NOT_RUN" for c in draft for s in c["subcases"])}))
