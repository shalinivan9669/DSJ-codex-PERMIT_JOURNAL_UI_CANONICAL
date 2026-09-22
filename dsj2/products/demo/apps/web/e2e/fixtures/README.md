# Synthetic import fixture

`import-multiple.xlsx` contains two worksheets, **Инструкция** and **Получатели**. It contains no macros, formulas, external references or real personal data.

The recipient worksheet deliberately uses headers that require explicit mapping:

| Сотрудник       | Аты               | Табельный код |
| --------------- | ----------------- | ------------- |
| Проверка XLSX   | Ә Ғ Қ Ң Ө Ұ Ү Һ І | 00123         |
| Неполная строка | empty             | 00456         |

The workbook is a test asset for sheet selection, reusable mapping, independent Kazakh text, preserved leading zeros and incomplete draft rows. Its values are stored as strings.

`import-formula.xlsx` is the same synthetic workbook with the first recipient's C2 cell changed to the actual XLSX formula `=1+1`. Browser acceptance verifies that source row 2 is rejected with an actionable message, while source row 3 remains explicitly importable. No formula is executed; this fixture contains no macros or external references.
