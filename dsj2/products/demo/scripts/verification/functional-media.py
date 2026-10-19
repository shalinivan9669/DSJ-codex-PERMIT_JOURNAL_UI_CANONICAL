"""Original local teaching assets. No downloaded media or external generation."""
import json, hashlib, subprocess, os
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.runtime/functional-completion-20261019/run-01/content'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = json.loads((OUT / 'curriculum.json').read_text('utf-8-sig'))
FONT = Path('C:/Windows/Fonts/arial.ttf')
BOLD = Path('C:/Windows/Fonts/arialbd.ttf')
pdfmetrics.registerFont(TTFont('Teaching', str(FONT)))
pdfmetrics.registerFont(TTFont('TeachingBold', str(BOLD)))
body = ParagraphStyle('body', fontName='Teaching', fontSize=11, leading=16, textColor=colors.HexColor('#19302D'), spaceAfter=11)
heading = ParagraphStyle('heading', parent=body, fontName='TeachingBold', fontSize=23, leading=28, spaceAfter=22)
small = ParagraphStyle('small', parent=body, fontSize=9, leading=12, textColor=colors.HexColor('#516F66'))

def footer(canvas, doc):
    canvas.setFont('Teaching', 9)
    canvas.setFillColor(colors.HexColor('#516F66'))
    canvas.drawString(42, 25, 'DEMO • Авторский учебный материал / Авторлық оқу материалы • 19.10.2026')
    canvas.drawRightString(553, 25, str(doc.page))

manifest = []
for course in SOURCE:
    output = OUT / (course['key'] + '-guide.pdf')
    story = [Paragraph(escape(course['titleRu']), heading), Paragraph(escape(course['titleKz']), heading), Spacer(1, 25), Paragraph(escape(course['goalRu']), body), Paragraph(escape(course['goalKz']), body), Spacer(1, 40), Paragraph('Учебная редакция • 19.10.2026', small), Paragraph('Материалы для осмысленного разбора и практики в демонстрационном контуре. Применение к реальной работе требует согласования содержания и местных процедур ответственным специалистом.', body), Paragraph('Демонстрациялық ортада талдау және практика үшін әзірленген материал. Нақты жұмыста мазмұнды және жергілікті рәсімдерді жауапты маман келісуі керек.', body), Paragraph('Справочная карточка источника: ' + escape(course['source']['title']) + ', ' + escape(course['source']['number']) + ', ' + escape(course['source']['date']) + '. Проверка актуальности редакции остаётся отдельным действием эксперта.', small), Paragraph(escape(course['source']['url']), small)]
    for lang, title_key, text_key in [('RU', 'ru', 'ruText'), ('KZ', 'kz', 'kzText')]:
        for index, lesson in enumerate(course['lessons']):
            story += [PageBreak(), Paragraph(f'{lang} / {index + 1:02d}', small), Paragraph(escape(lesson[title_key]), heading)]
            story += [Paragraph(escape(p), body) for p in lesson[text_key].split('\n\n')]
    SimpleDocTemplate(str(output), pagesize=(595,842), rightMargin=42,leftMargin=42,topMargin=42,bottomMargin=49,title=course['titleRu'],author='DEMO — авторский учебный пакет').build(story, onFirstPage=footer,onLaterPages=footer)
    doc = pdfium.PdfDocument(output)
    for i in [0,1,len(doc)-1]:
        doc[i].render(scale=1).to_pil().save(OUT / f"{course['key']}-page-{i+1}.png")
    manifest.append({'file':output.name,'pages':len(doc),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()})

slides = [
    ('01', 'Замечаем факты', 'Фактілерді байқаймыз', ['Место: проход у склада', 'Наблюдение: кабель пересекает путь', 'Возможное воздействие: падение человека'], ['Орын: қойма жанындағы жол', 'Бақылау: кабель жолды кесіп өтеді', 'Ықтимал әсер: адамның құлауы'], 'Сначала опишите наблюдаемые факты. Не подменяйте наблюдение догадкой о виновнике. Кабель на проходе — источник опасности; вероятность и тяжесть падения относятся к оценке риска.', 'Алдымен көрінген фактілерді сипаттаңыз. Бақылауды кінәлі адам туралы жорамалмен алмастырмаңыз. Жолдағы кабель — қауіп көзі; құлау ықтималдығы мен салдары тәуекел бағасына жатады.'),
    ('02', 'Уточняем полномочия', 'Өкілеттікті нақтылаймыз', ['Не выполняем незнакомую работу', 'Ограничиваем риск по местной процедуре', 'Передаём задачу ответственному'], ['Таныс емес жұмысты орындамаймыз', 'Жергілікті рәсіммен тәуекелді шектейміз', 'Тапсырманы жауапты тұлғаға береміз'], 'Знание проблемы не означает право самостоятельно разбирать оборудование. Действуйте в рамках своей подготовки и установленной процедуры. Если безопасный способ неизвестен, запросите решение ответственного.', 'Мәселені білу жабдықты өз бетімен бөлшектеуге құқық бермейді. Дайындығыңыз бен белгіленген рәсім шегінде әрекет етіңіз. Қауіпсіз тәсіл белгісіз болса, жауапты тұлғадан шешім сұраңыз.'),
    ('03', 'Передаём сообщение', 'Хабарлама береміз', ['Где и когда обнаружено?', 'Что наблюдалось и кому угрожает?', 'Что уже сделано и кто отвечает?'], ['Қайда және қашан анықталды?', 'Не байқалды және кімге қауіп төнеді?', 'Не істелді және кім жауапты?'], 'Сообщение должно позволять следующему человеку продолжить работу. Назовите место, время, факт, возможное воздействие и принятые безопасные меры. Сохраните подтверждение приёма по рабочей процедуре.', 'Хабарлама келесі адамға жұмысты жалғастыруға мүмкіндік беруі керек. Орынды, уақытты, фактіні, ықтимал әсерді және қауіпсіз шараларды көрсетіңіз. Қабылдау растауын жұмыс рәсіміне сәйкес сақтаңыз.'),
    ('04', 'Проверяем результат', 'Нәтижені тексереміз', ['Обещание не подтверждает выполнение', 'Выполнение не заменяет проверку', 'Фиксируем наблюдаемое состояние'], ['Уәде орындалуды растамайды', 'Орындалу тексеруді алмастырмайды', 'Нақты жағдайды тіркейміз'], 'После сообщения задача не закрывается автоматически. Ответственный задаёт проверяемый результат. После переноса кабеля нужно подтвердить, что проход действительно свободен и новая трасса согласована.', 'Хабарламадан кейін тапсырма автоматты жабылмайды. Жауапты тұлға тексерілетін нәтиже белгілейді. Кабель көшірілген соң жолдың ашықтығы және жаңа бағыттың келісілгені расталуы керек.'),
    ('05', 'Сохраняем преемственность', 'Жалғастықты сақтаймыз', ['Открытый вопрос и временная мера', 'Ответственный и следующий контроль', 'История исправления сохраняется'], ['Ашық мәселе және уақытша шара', 'Жауапты тұлға және келесі бақылау', 'Түзету тарихы сақталады'], 'Незавершённые меры передают следующей смене. Укажите текущее состояние, ограничения, исполнителя и следующий контроль. Исправление записи должно сохранять первоначальный факт и причину изменения.', 'Аяқталмаған шаралар келесі ауысымға беріледі. Қазіргі жағдайды, шектеуді, орындаушыны және келесі бақылауды көрсетіңіз. Жазбаны түзету бастапқы факт пен өзгеріс себебін сақтауы керек.'),
    ('06', 'Применяем к своей ситуации', 'Өз жағдайымызға қолданамыз', ['Отделите факт от предположения', 'Назовите безопасный следующий шаг', 'Опишите доказательство результата'], ['Фактіні жорамалдан ажыратыңыз', 'Қауіпсіз келесі қадамды атаңыз', 'Нәтиже дәлелін сипаттаңыз'], 'Задание: коробки обнаружены у выхода во время обычного обхода. Составьте краткое сообщение и порядок передачи задачи. Не придумывайте выполненные действия. Укажите, как будет проверен результат по местной процедуре.', 'Тапсырма: жоспарлы тексеруде шығу есігінің жанында қораптар табылды. Қысқа хабарлама және тапсырманы беру тәртібін құрыңыз. Орындалмаған әрекетті ойдан қоспаңыз. Нәтиже жергілікті рәсіммен қалай тексерілетінін көрсетіңіз.'),
]

def wrapped(draw, text, xy, width, size, fill, bold=False):
    font = ImageFont.truetype(str(BOLD if bold else FONT), size)
    words=text.split(); line=''; y=xy[1]
    for word in words:
        candidate=(line+' '+word).strip()
        if draw.textlength(candidate,font=font)>width and line:
            draw.text((xy[0],y),line,font=font,fill=fill);y+=size*1.3;line=word
        else: line=candidate
    if line: draw.text((xy[0],y),line,font=font,fill=fill);y+=size*1.3
    return y

for index, (number, ru, kz, points_ru, points_kz, *_rest) in enumerate(slides):
    frame=Image.new('RGB',(1280,720),'#F2F4EE');draw=ImageDraw.Draw(frame)
    draw.rectangle((0,0,1280,12),fill='#11634D')
    wrapped(draw,'DEMO / УЧЕБНЫЙ РАЗБОР • ОҚУ ТАЛДАУЫ',(54,34),1100,19,'#48675D')
    wrapped(draw,number,(1140,32),100,34,'#11634D',True)
    y=wrapped(draw,ru,(54,88),1150,42,'#12382E',True)
    wrapped(draw,kz,(54,y+7),1150,29,'#48675D')
    draw.line((640,220,640,583),fill='#CAD8CF',width=2)
    for col,points in enumerate([points_ru,points_kz]):
        y=235
        for i,p in enumerate(points):
            x=54+col*635
            draw.rounded_rectangle((x,y+5,x+32,y+37),radius=6,fill='#11634D')
            draw.text((x+9,y+8),str(i+1),font=ImageFont.truetype(str(BOLD),20),fill='white')
            y=wrapped(draw,p,(x+47,y),495,27,'#193C32')+27
    draw.rounded_rectangle((54,610,1225,666),radius=8,fill='#DFE9E1')
    wrapped(draw,'Факт → безопасное действие → подтверждённый результат',(74,621),1100,23,'#12382E')
    for i in range(6): draw.rectangle((54+i*195,694,54+i*195+176,701),fill='#11634D' if i<=index else '#CBD8D0')
    frame.save(OUT/f'slide-{index+1}.png')

def stamp(seconds):
    return f'{seconds//3600:02d}:{seconds//60%60:02d}:{seconds%60:02d}.000'
for lang, idx in [('ru',5),('kk',6)]:
    lines=['WEBVTT','']
    for i,slide in enumerate(slides):
        lines += [f'{stamp(i*30)} --> {stamp((i+1)*30)}',slide[idx],'']
    (OUT/f'biot-{lang}.vtt').write_text('\n'.join(lines),encoding='utf-8')
concat=[]
for i in range(6): concat += [f"file 'slide-{i+1}.png'",'duration 30']
concat += ["file 'slide-6.png'"]
(OUT/'slides.txt').write_text('\n'.join(concat),encoding='utf-8')
ffmpeg=os.environ['FUNCTIONAL_FFMPEG']
subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(OUT/'slides.txt'),'-t','180','-vf','fps=12','-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'biot-observation.mp4')],check=True)
video=OUT/'biot-observation.mp4'
manifest.append({'file':video.name,'seconds':180,'audio':False,'content':'Six original bilingual instructional cards; separate RU/KZ captions','sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'bytes':video.stat().st_size})
(OUT/'media-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=True))
