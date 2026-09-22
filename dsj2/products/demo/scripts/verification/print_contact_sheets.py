"""Produce bounded stress sampling sheets; creating a sheet never marks it reviewed."""
import hashlib
import json
from pathlib import Path
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/evidence/commercial-acceptance/printing'


def main():
    dest=OUT/'stress-visual';dest.mkdir(exist_ok=True);allsets=[]
    for resultpath in sorted(OUT.glob('*-stress-*.result.json')):
        result=json.loads(resultpath.read_text(encoding='utf8'));count=result['recipients']
        if count<10 or result['status']!='PASS':continue
        per=len(result['pages'])//count
        people=sorted({1,count,*[n for n in [9,10,12,13,49,50,99,100] if n<=count]})
        selected=[p for i in people for p in result['pages'][(i-1)*per:i*per]]
        entries=[];sheets=[]
        for start in range(0,len(selected),6):
            batch=selected[start:start+6];canvas=Image.new('RGB',(1800,((len(batch)+1)//2)*870),'#eeeeee');draw=ImageDraw.Draw(canvas)
            for index,page in enumerate(batch):
                path=ROOT/page['image'];im=Image.open(path).convert('RGB');im.thumbnail((890,825))
                x=(index%2)*900;y=(index//2)*870;draw.text((x+10,y+5),f"{result['name']} page {page['page']}",fill='black');canvas.paste(im,(x+(900-im.width)//2,y+30))
                entries.append({'path':path.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'physicalPage':page['page']})
            sheet=dest/f"{result['name']}-sheet-{start//6+1:02}.jpg";canvas.save(sheet,quality=92);sheets.append(sheet.relative_to(ROOT).as_posix())
        allsets.append({'case':result['name'],'people':people,'pages':entries,'sheets':sheets})
    (OUT/'stress-visual-manifest.json').write_text(json.dumps(allsets,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'cases':len(allsets),'sampledPhysicalPages':sum(len(s['pages']) for s in allsets)}))


if __name__=='__main__':main()
