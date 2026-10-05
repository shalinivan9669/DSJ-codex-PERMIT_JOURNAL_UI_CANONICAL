"""Read-only preservation inventory taken before the neutral template revision."""
from pathlib import Path
from zipfile import ZipFile
import hashlib, json
from lxml import etree as E
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/evidence/neutral-forms-20261005'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / 'preservation-before.json'
    if dest.exists():
        raise SystemExit('Baseline already exists; never overwrite it')
    paths = set((ROOT / 'assets/templates').glob('*'))
    for folder in ['.runtime/document-audit-20261005', '.runtime/manual20-files-v1']:
        paths.update(p for p in (ROOT / folder).rglob('*') if p.is_file())
    paths.update((ROOT / 'scripts/render').glob('*.py'))
    paths.add(ROOT / 'scripts/render/legacy_reference_sources.json')
    paths.update(ROOT / p for p in ['apps/web/next-env.d.ts', 'apps/web/tsconfig.json', 'docs/evidence/operator-minimal-actions-20261004/acceptance-matrix.json', 'docs/evidence/progress.md'])
    records = {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(paths) if p.is_file()}
    dest.write_text(json.dumps(records, indent=2) + '\n', encoding='utf8')
    manifest = json.loads((ROOT / 'assets/templates/manifest.json').read_text(encoding='utf8'))
    (OUT / 'manifest-before.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    for t in manifest['templates']:
        with ZipFile(ROOT / 'assets/templates' / t['file']) as z:
            media = {n: hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('word/media/')}
            print(t['id'], json.dumps(media))
    print('Preserved baseline files:', len(records))
if __name__ == '__main__': main()
