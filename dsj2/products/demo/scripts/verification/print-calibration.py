"""Generate a physical-print measurement sheet; never claims printer acceptance."""
from pathlib import Path
import argparse
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont("Liberation", str(root / "assets/fonts/LiberationSans-Regular.ttf")))
pdfmetrics.registerFont(TTFont("LiberationBold", str(root / "assets/fonts/LiberationSans-Bold.ttf")))
pdf = canvas.Canvas(str(args.output), pagesize=A4, invariant=True)
pdf.setTitle("DEMO контроль физической печати 100 процентов")

def mark(x, y):
    pdf.setLineWidth(.3)
    pdf.line(x-4*mm,y,x+4*mm,y)
    pdf.line(x,y-4*mm,x,y+4*mm)
    pdf.circle(x,y,2*mm,stroke=1,fill=0)

for orient, size, flip in [("Портрет", A4, "длинному"), ("Альбом", landscape(A4), "короткому")]:
    width, height = size
    for side in [1,2]:
        pdf.setPageSize(size)
        pdf.setFont("LiberationBold",16)
        pdf.drawString(20*mm,height-28*mm,f"{orient} — сторона {side} из 2")
        pdf.setFont("Liberation",11)
        lines = ["КОНТРОЛЬНЫЙ ОБРАЗЕЦ. Не является выданным документом.",
                 "Печатать: фактический размер / 100%, без подгонки под лист.",
                 f"Для этой пары: двусторонняя печать, переворот по {flip} краю.",
                 "Сначала напечатайте только эту пару страниц, затем измерьте линейкой.",
                 "При просмотре на просвет совместите четыре контрольные метки.",
                 "Не применяйте настройки пары к бланкам без проверки их раскладки."]
        for index,text in enumerate(lines): pdf.drawString(20*mm,height-(40+index*6)*mm,text)
        y = height-100*mm
        pdf.setFont("LiberationBold",12)
        pdf.drawString(20*mm,y+8*mm,"Контрольная длина: 100 мм")
        pdf.setLineWidth(.7)
        pdf.line(20*mm,y,120*mm,y)
        pdf.setFont("Liberation",8)
        for step in range(101):
            h=(4 if step%10==0 else 2 if step%5==0 else 1)*mm
            pdf.line((20+step)*mm,y-h,(20+step)*mm,y+h)
            if step%10==0: pdf.drawCentredString((20+step)*mm,y-8*mm,str(step))
        pdf.setFont("Liberation",11)
        pdf.drawString(20*mm,y-25*mm,"Измерено ______ мм. Смещение оборота X ______ мм / Y ______ мм.")
        pdf.drawString(20*mm,y-34*mm,"Принтер / драйвер __________________  Бумага _________________")
        pdf.drawString(20*mm,y-43*mm,"Оператор __________________________  Дата ___________________")
        pdf.drawString(20*mm,y-55*mm,"Физическая приёмка: НЕ ВЫПОЛНЕНА до измерения реального отпечатка.")
        for x in [15*mm,width-15*mm]:
            for yy in [15*mm,height-15*mm]: mark(x,yy)
        pdf.setFont("LiberationBold",11)
        pdf.drawCentredString(width/2,height-12*mm,"ВЕРХ ЛИСТА ↑")
        pdf.showPage()
pdf.save()
print(args.output)
