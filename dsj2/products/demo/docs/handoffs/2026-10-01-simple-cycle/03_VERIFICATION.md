# Проверки и доказательства

## Свежие результаты перед остановкой

| Проверка | Результат и граница |
|---|---|
| Последняя production web build `.next-first-live-more` | PASS, Next 15.5.25; обслуживается localhost3132 |
| Все web unit tests | 96 PASS, 0 fail, 0 skip |
| API readiness/customer/approval tests | 11 PASS; включая реальный decideProposal через fake transaction, ноль writes при неполных данных |
| Resolution tests | 6 PASS на этапе короткой формы/работодателя |
| ПТМ renderer tests | 2 целевых PASS, включая split Word runs |
| Targeted lint | PASS для последних editor/approvals/details/four embedded panels/files/helpers |
| API/web typecheck | PASS после scoped изменений; build дополнительно проверил web |
| Browser физлицо и компания | Реальные create/save/list/reopen ранее выполнены; сохранённые данные подтверждены read-only в той же БД |
| Browser после последней сборки | Меню «Прочее», отсутствие четырёх больших блоков/нижней панели, PENDING без prepare/print подтверждены |
| Browser красная ошибка → ввод → исчезновение → директор → документы | НЕ ЗАВЕРШЕНО: пользователь остановил процесс |
| Две роли без ADMIN/третьих участников | НЕ РЕАЛИЗОВАНО ПОЛНОСТЬЮ |
| Полный актуальный verify/CI | НЕ ЗАЯВЛЕН |
| Реальная ЭЦП / физическая печать / production | НЕ ПОДТВЕРЖДЕНЫ этим этапом |

Большая renderer suite ранее была прервана пользователем. В matrix отмечено `INTERRUPTED_BY_USER_NO_FINAL_RESULT`. Старые 208 unit и старые PASS предыдущих аудитов не относятся автоматически к последним правкам.

## Основные доказательства в workspace

Относительно `products/demo`:

- `docs/evidence/first-live-iteration/compact-entry/persistence.json` — read-only сохранённые первоначальные проверки физлица/компании. Данные заявок пользователь позже менял; это snapshot того момента, не утверждение об их сегодняшней ревизии.
- `docs/evidence/first-live-iteration/compact-entry/company.jpg` и `person.jpg` — прежняя короткая форма, до последнего меню.
- `docs/evidence/first-live-iteration/compact-entry/more-menu-current.jpg` — новое меню в PENDING тестовой заявке, снимок при остановке.
- `docs/evidence/first-live-iteration/expiry-fix/ptm-expiry-fixed.pdf`, `.docx`, `.txt`, `ptm-expiry-fixed-1.png`, `verification.json` — синтетический новый ПТМ.
- `docs/evidence/progress.md` и `docs/evidence/commercial-acceptance/matrix.json` — история, сохранять старые записи и добавлять только актуальные результаты.

PDF: одна страница, строка срока ровно одна: «Действительно до 01.10.2029 г.». SHA256: `c7afd65278a8984104f4dbce10bc6cfb91ae07c5cadd4c32ad4c0da4e1ed013e`. Этот документ синтетический DEMO; он не является реально выданным/подписанным документом. Исправление renderer не меняет старые сохранённые байты.

## Команды продолжения

Запускать из активного `products/demo`, сначала проверив собственный environment и локальные инструкции:

```powershell
pnpm --filter @demo/web test
pnpm --filter @demo/web typecheck
pnpm --filter @demo/api typecheck
pnpm exec tsx --tsconfig tsconfig.base.json --test tests/approval-data-readiness.test.ts tests/request-customer.test.ts tests/approval-signing-contracts.test.ts
pnpm exec tsx --tsconfig tsconfig.base.json --test tests/resolution.test.ts
```

Для renderer выбрать именно существующие два теста дубля срока в `tests/render/test_render.py`; полную большую suite запускать осмысленно, не переносить на неё старый PASS. Для выпуска/печатного цикла нужны соответствующие integration и browser проверки, двух аккаунтов и PDF. Следующий web build делать в другом distDir, пока `.next-first-live-more` обслуживает пользователей; потом переключать только проверенный web процесс, сохраняя API/worker и чужие процессы.

Приватный config содержит доступы. Не сохранять его вывод и не включать в пакет доказательств. Если Next добавляет новый `.next-*/types` в tsconfig, убрать только созданную build запись, сохранив исходные изменения пользователя.
