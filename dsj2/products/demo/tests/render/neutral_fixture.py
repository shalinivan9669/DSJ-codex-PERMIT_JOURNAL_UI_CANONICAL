"""Pin neutral-policy regressions to their immutable registry, not active forms."""
import hashlib
import json
from pathlib import Path

from test_render import fixture as active_fixture
from test_group_protocol import group_fixture as active_group_fixture

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = json.loads((ROOT / 'scripts/render/neutral_forms_sources.json').read_text(encoding='utf8'))
assert REGISTRY['policy'] == 'NEUTRAL_FORMS_V1'
MANIFEST = {kind: [record for record in REGISTRY['templates'] if record['kind'] == kind]
            for kind in ['templates', 'groupTemplates']}


def record(template_id, grouped=False):
    value = next(item for item in MANIFEST['groupTemplates' if grouped else 'templates']
                 if item['id'] == template_id)
    source = ROOT / 'assets/templates' / value['file']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == value['sha256'], value['file']
    return value


def fixture(template_id):
    snapshot = active_fixture(template_id)
    snapshot['templateVersion'] = record(template_id)['version']
    return snapshot


def group_fixture(template_id, count):
    snapshot = active_group_fixture(template_id, count)
    snapshot['templateVersion'] = record(template_id, grouped=True)['version']
    return snapshot
