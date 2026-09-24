"""Verify the saved customer ZIP/XLSX, without regeneration or database writes."""
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZipFile
from openpyxl import load_workbook

scenario = sys.argv[1]
assert scenario in ['G1', 'G2']
root = Path(__file__).resolve().parents[2] / 'docs/evidence/operator-value/golden' / scenario / 'customer'
archive = next(root.glob('*.zip'))
expected_count = 202 if scenario == 'G1' else 406
expected_protocols = {'PB-PROTOCOL-00001': 100} if scenario == 'G1' else {
    'PB-PROTOCOL-00001': 100, 'PTM-PROTOCOL-00001': 60, 'BIOT-PROTOCOL-00001': 40}
with ZipFile(archive) as bundle:
    manifest = json.loads(bundle.read('manifest.json'))
    assert manifest['complete'] and not manifest['missing']
    assert len(manifest['files']) == expected_count
    for entry in manifest['files'] + manifest['attachments']:
        assert hashlib.sha256(bundle.read(entry['file'])).hexdigest() == entry['sha256']
        assert not entry['file'].startswith('/') and '..' not in Path(entry['file']).parts
    reconstructed = sum(entry['provenance'] == 'RECONSTRUCTED' for entry in manifest['files'])
    if scenario == 'G1':
        assert reconstructed == 2
    assert sum('Групповой протокол' in entry['file'] for entry in manifest['files']) == len(expected_protocols) * 2
    cover = bundle.read('Сопроводительное письмо.txt').decode('utf8')
    assert 'ПОЛНЫЙ КОМПЛЕКТ' in cover and 'НЕПОЛНЫЙ КОМПЛЕКТ' not in cover
    assert f'Готовых файлов: {expected_count} из {expected_count}.' in cover
    assert cover.count('\nГотов: ') == expected_count
    assert all('Готов: ' + entry['file'] in cover for entry in manifest['files'])
    assert 'Не включено: ' not in cover
workbook = load_workbook(next(root.glob('*.xlsx')), data_only=False)
rows = list(workbook.active.values)
headers = rows.pop(0)
assert len(rows) == sum(expected_protocols.values())
number_column = headers.index('Номер протокола')
personnel_column = headers.index('Табельный номер')
counts = {number: sum(row[number_column] == number for row in rows) for number in expected_protocols}
assert counts == expected_protocols
assert all(isinstance(row[personnel_column], str) and row[personnel_column].startswith('0') for row in rows)
assert all(cell.data_type != 'f' for row in workbook.active for cell in row)
workbook.close()
result = {'scenario': scenario, 'complete': True, 'savedFiles': expected_count,
          'reconstructedFiles': reconstructed, 'allSavedSha256Match': True,
          'allDerivativeSha256Match': True, 'friendlyGroupNames': True,
          'factualCoverStatusAndCounts': True, 'allReadyFilesListedInCover': True,
          'registryRows': len(rows), 'protocolCounts': counts, 'zeroPrefixedTextIds': True,
          'noFormulaCells': True, 'archive': archive.name}
(root / 'bundle-qa.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(result))
