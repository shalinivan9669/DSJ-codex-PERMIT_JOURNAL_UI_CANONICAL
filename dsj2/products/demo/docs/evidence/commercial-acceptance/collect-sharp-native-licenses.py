from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request,urllib.error,json,hashlib,re,base64
ROOT=Path.cwd();OUT=ROOT/'licenses/sharp-libvips';OUT.mkdir(parents=True,exist_ok=True)
HEAD='6e5971d333377743163edc3ad9e5d0b897abcbc9'
BASE='https://raw.githubusercontent.com/'
rows=[]
def gh(name,version,repo,ref,files,**extra):
 rows.append(dict(name=name,version=version,repository='https://github.com/'+repo,ref=ref,files=[{'path':f,'url':BASE+repo+'/'+ref+'/'+f} for f in files],**extra))
def raw(name,version,repo,ref,files):
 rows.append(dict(name=name,version=version,repository=repo,ref=ref,files=[{'path':f,'url':repo+'/-/raw/'+ref+'/'+f} for f in files]))
gh('cgif','0.5.3','dloebl/cgif','v0.5.3',['LICENSE'])
gh('expat','2.8.3','libexpat/libexpat','R_2_8_3',['expat/COPYING'])
gh('freetype','2.14.3','freetype/freetype','VER-2-14-3',['LICENSE.TXT','docs/FTL.TXT','docs/GPLv2.TXT'])
gh('fribidi','1.0.16','fribidi/fribidi','v1.0.16',['COPYING','COPYING.LIB'])
gh('glib','2.89.4','GNOME/glib','2.89.4',['COPYING','COPYING.tests'])
gh('harfbuzz','14.3.1','harfbuzz/harfbuzz','14.3.1',['COPYING'])
gh('highway','1.4.0','google/highway','1.4.0',['LICENSE'])
gh('lcms','2.19.1','mm2/Little-CMS','lcms2.19.1',['COPYING'])
gh('libarchive','3.8.9','libarchive/libarchive','v3.8.9',['COPYING'])
gh('libexif','0.6.26','libexif/libexif','v0.6.26',['COPYING'])
gh('libffi','3.8.0','libffi/libffi','v3.8.0',['LICENSE'])
gh('libheif','1.23.2','strukturag/libheif','v1.23.2',['COPYING'])
gh('libimagequant','2.4.1','lovell/libimagequant','v2.4.1',['COPYRIGHT'])
gh('libpng','1.6.58','pnggroup/libpng','v1.6.58',['LICENSE'])
gh('librsvg','2.62.91','GNOME/librsvg','2.62.91',['COPYING.LIB','COPYING'])
gh('libultrahdr','2.0.2','google/libultrahdr','v2.0.2',['LICENSE'])
gh('libvips','8.18.6','libvips/libvips','v8.18.6',['COPYING'])
gh('libxml2','2.15.3','GNOME/libxml2','v2.15.3',['Copyright'])
gh('mozjpeg','0826579','mozilla/mozjpeg','0826579',['LICENSE.md','README.ijg'])
gh('pango','1.58.2','GNOME/pango','1.58.2',['COPYING'])
gh('proxy-libintl','0.5','frida/proxy-libintl','0.5',['COPYING','COPYING.LIB'],scope='Generic README inventory; build/posix.sh enables this only for musl or Darwin, not glibc Linux.')
gh('zlib-ng','2.3.3','zlib-ng/zlib-ng','2.3.3',['LICENSE.md'])
raw('cairo','1.18.4','https://gitlab.freedesktop.org/cairo/cairo','1.18.4',['COPYING','COPYING-MPL-2'])
raw('fontconfig','2.18.3','https://gitlab.freedesktop.org/fontconfig/fontconfig','2.18.3',['COPYING'])
raw('pixman','0.46.4','https://gitlab.freedesktop.org/pixman/pixman','pixman-0.46.4',['COPYING'])
raw('libtiff','4.7.2','https://gitlab.com/libtiff/libtiff','v4.7.2',['LICENSE.md'])
rows.append(dict(name='aom',version='3.15.0',repository='https://aomedia.googlesource.com/aom',ref='v3.15.0',files=[{'path':f,'url':'https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.0/'+f+'?format=TEXT','encoding':'base64'} for f in ['LICENSE','PATENTS']]))
rows.append(dict(name='libwebp',version='1.6.0',repository='https://chromium.googlesource.com/webm/libwebp',ref='v1.6.0',files=[{'path':f,'url':'https://chromium.googlesource.com/webm/libwebp/+/refs/tags/v1.6.0/'+f+'?format=TEXT','encoding':'base64'} for f in ['COPYING','PATENTS']]))
gh('libnsgif','bundled-in-libvips-8.18.6','libvips/libvips','v8.18.6',['libvips/foreign/libnsgif/COPYING'],scope='No independent version pin in sharp build; embedded copy must be attributed by libvips tag.')
sources=[]
def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'DEMO-license-audit/1.0'})
 with urllib.request.urlopen(req,timeout=20) as response:
  data=response.read(2_000_001)
  if len(data)>2_000_000:raise ValueError('TEXT_EXCEEDS_2MB')
  return data,response.geturl(),response.status
def collect(row):
 dest=OUT/row['name'];dest.mkdir(exist_ok=True)
 for f in row['files']:
  try:
   data,url,status=fetch(f['url'])
   if f.get('encoding')=='base64':data=base64.b64decode(data)
   if b'<html' in data.lower()[:500]:raise ValueError('HTML_NOT_LICENSE')
   target=dest/f['path'].replace('/','__');target.write_bytes(data)
   f.update(status='COLLECTED',httpStatus=status,resolvedUrl=url,localPath=target.relative_to(ROOT).as_posix(),bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
  except Exception as error:f.update(status='UNRESOLVED',error=str(error))
 row['status']='COLLECTED' if all(f['status']=='COLLECTED' for f in row['files']) else 'PARTIAL' if any(f['status']=='COLLECTED' for f in row['files']) else 'UNRESOLVED'
 print(row['name'],row['status'],flush=True);return row
for name in ['versions.properties','build/posix.sh','npm/linux-x64/README.md']:
 url=BASE+'lovell/sharp-libvips/'+HEAD+'/'+name
 try:
  data,resolved,status=fetch(url);p=OUT/('build-'+name.replace('/','__'));p.write_bytes(data)
  sources.append({'url':url,'resolvedUrl':resolved,'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(data).hexdigest()})
 except Exception as e:sources.append({'url':url,'error':str(e)})
with ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(collect,rows))
report={'package':'@img/sharp-libvips-linux-x64','version':'1.3.3','gitHead':HEAD,'sources':sources,'components':rows,'scope':'Collection of exact upstream license texts; not a claim of complete corresponding-source/relink compliance or exact README-to-binary linkage.'}
(OUT/'collection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'components':len(rows),'collected':sum(r['status']=='COLLECTED' for r in rows),'partial':sum(r['status']=='PARTIAL' for r in rows),'unresolved':sum(r['status']=='UNRESOLVED' for r in rows)}))
