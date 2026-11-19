"""Keep the printed exam panel and its original grade table inside the right fold."""
from original_card_flow import _paragraph
from source_fidelity import W, child, measure


def arrange_exam_panel(tree, *, managed=False):
    # One renewal strip in the original has two A4-wide cells. Its centre
    # anchor leaves half of each cell outside the paper in both renderers.
    for table in tree.iter(W + 'tbl'):
        width = table.find(W + 'tblPr/' + W + 'tblW')
        if width is None or width.get(W + 'w') != '23750':
            continue
        cells = table.findall(W + 'tr/' + W + 'tc')
        columns = table.findall(W + 'tblGrid/' + W + 'gridCol')
        if len(cells) != 2 or len(columns) != 2:
            raise ValueError('ORIGINAL_CARD_SLOT_MISMATCH')
        width.set(W + 'w', '11875')
        for cell, column, half in zip(cells, columns, ('5937', '5938')):
            cell.find(W + 'tcPr/' + W + 'tcW').set(W + 'w', half)
            column.set(W + 'w', half)
            p = cell.find(W + 'p')
            tokens = [t for t in p.iter(W + 't') if t.text == '{{ISSUER_RU}}']
            if len(tokens) != 2:
                raise ValueError('ORIGINAL_CARD_SLOT_MISMATCH')
            tokens[1].getparent().remove(tokens[1])
            for tab in list(p.iter(W + 'tab')):
                tab.getparent().remove(tab)
            child(child(p, 'pPr'), 'jc').set(W + 'val', 'center')
    # The seal labels are body paragraphs underneath the floating face. Put
    # them in the same flow as the signature lines, retaining their anchors.
    for paragraph in tree.find(W + 'body').findall(W + 'p'):
        nodes = list(paragraph.iter(W + 't'))
        if ''.join(t.text or '' for t in nodes).strip() in ('М.О.', 'М.П.'):
            for node in nodes:
                node.text = ''
    for box in tree.iter(W + 'txbxContent'):
        text = ''.join(box.itertext())
        if '{{FULL_NAME_BOTH}}' in text:
            # Use both language variants when they differ. The original
            # separates the two parts of the Kazakh word for commission.
            basis = [('Негіздеме / Основание: хаттама / протокол № {{PROTOCOL_NUMBER}}, {{PROTOCOL_DAY_MONTH}}.{{PROTOCOL_YEAR}}', 7.5, '', 3)]
            if managed:
                # Leave the full width for a numbered protocol reference.
                basis = [('Негіздеме / Основание: хаттама / протокол', 7.5, '', 3),
                         ('№ {{PROTOCOL_NUMBER}}  {{PROTOCOL_DAY_MONTH}}.{{PROTOCOL_YEAR}}', 7.5, '', 0)]
            lines = [
                ('КУӘЛІК / УДОСТОВЕРЕНИЕ № {{NUMBER}}', 9, 'bold', 0),
                ('Берілді / Выдано: {{FULL_NAME_BOTH}}', 9, 'bold', 4),
                ('{{QUALIFICATION_STATUS_KZ}}', 7.5, '', 4),
                ('{{POSITION_KZ}}', 8.5, 'underline', 0),
                ('{{QUALIFICATION_STATUS_RU}}', 7.5, '', 2),
                ('{{POSITION_RU}}', 8.5, 'underline', 0),
                ('(Мамандығы, разряды / профессия, разряд)', 6.5, '', 1),
                *basis,
                ('Емтихан комиссиясының төрағасы / Председатель экзаменационной комиссии', 7, '', 3),
                ('______________________   (қолы / подпись)', 7, '', 1),
                ('Комиссия мүшелері / Члены комиссии', 7, '', 3),
                ('______________     ______________   (қолы / подписи)', 7, '', 1),
                ('М.О. / М.П.', 7, '', 2),
            ]
            for paragraph in box.findall(W + 'p'):
                box.remove(paragraph)
            for index, (phrase, size, style, gap) in enumerate(lines):
                box.append(_paragraph([(phrase, size, style)], inset=6, right=8,
                                      align='center' if index == 0 else 'left', top=gap)['node'])
            continue
        if managed and 'Сведения о сданных экзаменах' in text:
            # Retain the managed template's subject and grade captions. Its
            # text box is on the right of the fold already.
            paragraphs = [' '.join(''.join(p.itertext()).split()) for p in box.findall(W + 'p')]
            for p in box.findall(W + 'p'):
                box.remove(p)
            for i, phrase in enumerate(filter(None, paragraphs)):
                caption = phrase.startswith('(баға')
                size = 8 if i < 2 else 6.5 if caption else 7
                box.append(_paragraph([(phrase, size, 'bold' if i < 2 else '')],
                                      inset=4, right=25, top=2 if i == 0 else 0)['node'])
            continue
        if '{{SOURCE_STUDIES_KZ}}' not in text:
            continue
        # The drawing begins to the left of the fold. The original uses ten
        # empty paragraphs to dodge a separate floating table. Word and Writer
        # collapse those spacers differently once the real fields are filled.
        lines = [
            ('Тапсырылған емтихандар туралы мәлімет {{SERIES}}', 8, 'bold'),
            ('Сведения о сданных экзаменах', 8, 'bold'),
            ('{{SOURCE_STUDIES_KZ}}', 7, ''),
            ('{{SOURCE_STUDIES_RU}}', 7, ''),
            ('Бітіру емтиханы / Выпускной экзамен: {{RESULT_KZ}} / {{RESULT_RU}}', 7.5, ''),
            ('Практикалық оқыту / Практическое обучение: {{RESULT_KZ}} / {{RESULT_RU}}', 7.5, ''),
        ]
        for paragraph in box.findall(W + 'p'):
            box.remove(paragraph)
        for i, line in enumerate(lines):
            box.append(_paragraph([line], inset=28, top=1 if i in (2, 4) else 0)['node'])


def position_grade_table(tree, layout, *, managed=False):
    table = next(t for t in tree.iter(W + 'tbl')
                 if 'Наименование дисциплины' in ''.join(t.itertext())
                 and t.find(W + 'tblPr/' + W + 'tblBorders') is not None)
    state = next(s for s in layout if 'Сведения о сданных экзаменах' in ''.join(s['box'].itertext()))
    typography = state['typography']
    text_height = sum(measure(p['node'], state['width'], typography)[0] for p in state['paragraphs'])
    # Allow for the managed form's lower text-box anchor and leave 4 pt
    # below the final grade caption before the table's top border.
    top = max(112, (75 if managed else 50) + text_height)
    table_height = 0
    for row in table.findall(W + 'tr'):
        heights = []
        for cell in row.findall(W + 'tc'):
            width = int(cell.find(W + 'tcPr/' + W + 'tcW').get(W + 'w')) / 20
            sizes = [measure(p, width, typography) for p in cell.findall(W + 'p')]
            if any(overflow for _, overflow, _ in sizes):
                raise ValueError('PRINT_LAYOUT_OVERFLOW')
            heights.append(sum(size for size, _, _ in sizes))
        minimum = row.find(W + 'trPr/' + W + 'trHeight')
        table_height += max(max(heights), int(minimum.get(W + 'val')) / 20 if minimum is not None else 0)
    # Both sides of the original A4 spread end at 233 pt.
    if top + table_height > 229:
        raise ValueError('PRINT_LAYOUT_OVERFLOW')
    position = child(child(table, 'tblPr'), 'tblpPr')
    position.set(W + 'vertAnchor', 'page')
    position.set(W + 'tblpY', str(round(top * 20)))
