"""Importable cells of the four original bilingual mail-merge workbooks."""
import hashlib
import json

# Fingerprints cover every source header, including the repeating protocol grid.
# Ambiguous bilingual fields shown with no default target can be mapped explicitly.
_FORMS = {
    "7f31acd43e8c113a4a89cce106477a6de8ed9245a56a72990886c2564a7dd25c": (
        "BIOT", {2: "", 3: "fullNameRu", 4: "positionKz", 5: "positionRu", 6: "workplaceKz", 7: "workplaceRu"},
    ),
    "8f527138588ded85052074b630a8ec8c68831595ba128021aa45c9471d126a3e": (
        "PB", {2: "fullNameRu", 3: "", 4: "positionRu", 8: "trainingSubjectKz", 9: "trainingSubject",
               16: "education", 17: "positionKz"},
    ),
    "7eda3fcee3fe89b5c8bd42750589d2fd5f9f07eaa98df3beb0784151f5f9d681": (
        "PTM", {2: "fullNameRu", 3: "positionKz", 4: "positionRu", 5: "workplaceKz", 6: "workplaceRu"},
    ),
    "b38e6bd1cd305bcf9e38ca47741e29f0b5d1f0d1141ef84eae0f1ae35c6012ac": (
        "PS", {2: "fullNameRu", 3: "psQualificationKz", 4: "psQualificationRu",
               15: "psGeneralSubjectKz", 16: "psSpecialSubjectKz",
               17: "psGeneralSubjectRu", 18: "psSpecialSubjectRu"},
    ),
}


def original_course_form(header):
    names = [" ".join(str(value if value is not None else "").lower().split()) for value in header]
    while names and not names[-1]:
        names.pop()
    fingerprint = hashlib.sha256(json.dumps(names, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return _FORMS.get(fingerprint)
