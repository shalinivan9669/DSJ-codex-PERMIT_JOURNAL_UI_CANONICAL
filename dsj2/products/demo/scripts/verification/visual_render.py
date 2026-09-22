"""Render each acceptance DOCX through the document QA renderer, then catalogue
every page. Requires explicit --renderer-script; not a product runtime dependency.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--renderer-script',required=True);args=parser.parse_args()
manifest=json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf8'))
names=[t['id'] for t in manifest['templates']]+['biot-batch-two']
out=ROOT/'docs/evidence/render';qa=out/'pages';qa.mkdir(exist_ok=True)
def render(name):
    target=qa/name
    result=subprocess.run([sys.executable,args.renderer_script,str(out/(name+'.docx')),'--output_dir',str(target),'--dpi','130'],capture_output=True,timeout=180)
    if result.returncode:raise RuntimeError(name+': '+result.stderr.decode('utf8',errors='replace')[-2000:])
    pages=sorted(target.glob('page-*.png'))
    if not pages:raise RuntimeError(name+': no pages')
    print(name,len(pages),flush=True)
    return {'template':name,'pages':[{'file':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in pages]}
with ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(render,names))
(out/'page-inventory.json').write_text(json.dumps(results,indent=2),encoding='utf8')
thumbs=[]
for record in results:
    for index,page in enumerate(record['pages']):
        im=Image.open(ROOT/page['file']).convert('RGB');im.thumbnail((440,570))
        tile=Image.new('RGB',(460,610),'#e7e8e9');tile.paste(im,((460-im.width)//2,30));ImageDraw.Draw(tile).text((10,8),record['template']+' / '+str(index+1),fill='black');thumbs.append(tile)
for offset in range(0,len(thumbs),6):
    group=thumbs[offset:offset+6];sheet=Image.new('RGB',(1380,1220),'white')
    for i,im in enumerate(group):sheet.paste(im,((i%3)*460,(i//3)*610))
    sheet.save(out/f'qa-contact-{offset//6+1}.png')
print(json.dumps({'documents':len(results),'pages':len(thumbs)}))
