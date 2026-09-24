# Обновление пользовательского предпросмотра 3200

**PASS для обновления и сохранности данных.** Проверено 2026-09-22T15:14:51.672Z. Ссылка: http://localhost:3200. Позднейшая визуальная ошибка БиОТ описана отдельно в generated-photo-four-preview-readback/PHOTO_FOUR_ACCEPTANCE_RU.md.

По разрешению root для запроса пользователя на актуальную версию перезапущены только рабочий API4200 и worker. Next3200 (PID44096), PostgreSQL55432, хранилище и пользовательские заявки сохранены. Непосредственно перед остановкой PENDING/RUNNING=0; все 113исторических jobs имели SUCCEEDED.

Ранее ready сообщал renderer3, карточки7, протоколы5, ИТР4 и свидетельство6. После ограниченного обновления ready вернул HTTP200, storageok и renderer5. SHA всех десяти выбранных форм совпали с финальным manifest. Добавлены только десять новых неизменяемых TemplateVersion в исходный синтетический tenant.

| Таблица | Записей | Контрольный SHA до/после |
| --- | ---: | --- |
| printRequest | 140 | совпал |
| requestItem | 261 | совпал |
| issuerProfileVersion | 4 | совпал |
| issuedDocument | 44 | совпал |
| issuance | 10 | совпал |
| numberSequence | 11 | совпал |
| artifact | 113 | совпал |

Все 113существующих файлов артефактов прочитаны из хранилища до и после обновления; их сохранённые SHA подтверждены. Снимки выпусков, номера, реквизиты эмитента и введённые данные не изменились. Эта проверка выполнена до создания отдельной тестовой заявки с вымышленным портретом.

| Форма | Версия после обновления |
| --- | ---: |
| biot-worker-card | 14 |
| biot-itr-certificate | 13 |
| biot-protocol | 9 |
| ptm-card | 14 |
| ptm-protocol | 9 |
| pb-card | 14 |
| pb-protocol | 9 |
| ps-card | 15 |
| ps-protocol | 9 |
| ps-witness | 11 |

Доказательства: user-preview-processes.json, user-preview-update-before.json, user-preview-update-result.json, user-preview-readonly-final.json, user-preview-restarted-pids.json и журналы API/worker. Полные inherited process environments с секретами находятся только в игнорируемой.runtime; отчёты содержат разрешённые параметры и адрес БД без credentials.
