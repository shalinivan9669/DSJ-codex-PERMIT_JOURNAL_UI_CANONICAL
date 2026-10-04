# Railway backend release — 04.10.2026 UTC

**SUCCESS**: существующий backend выпущен из commit `17aab8af222a3683b5da1048082e96b46407505b`. Последняя HTTP/CLI проверка19:32:33 UTC: deployment SUCCESS, `/health`200. Frontend публикация и входы ролей выполняются основным агентом и не заявляются доказанными этим backend-отчётом.

| Поле | Фактическое значение |
| --- | --- |
| Railway project | `250bb4a5-6462-4933-b1a7-8f61e2e7f507` |
| Environment | production / `fc776e13-94fd-45ff-b14c-06b91a2b1380` |
| Backend service | `f9c22605-78ca-41ee-a483-52aa54036fba` |
| New deployment | `8f79e67a-85c6-489b-910e-f552454fc2ed` |
| Image | `sha256:1bdfa6bbb599b16ccd44cfb395c6f1fbbc45d19e4d10c64af10029454692b301` |
| Runtime release SHA | `17aab8af222a3683b5da1048082e96b46407505b` |
| Previous deployment | `4554ceda-96c8-4d00-8739-92e9573496c7` |
| Uploaded product root | `C:/Users/Admin/Documents/DSJ-DEMO-cloud-20261002/releases/minimal-actions-17aab8af222a-v2` |

Исходный пустой archive был выявлен до production variable/deploy операции. Root подготовил исправленный archive-v2 из Git root; `package.json`, Dockerfile, migration и requests Gitblob были проверены до upload. Backend upload выполнен с явными существующими project/service/environment и `--path-as-root`. Из переменных изменена только `DEMO_RELEASE_SHA` через `--skip-deploys`, затем запущен один deployment. Product credentials, профили и пользовательские записи не менялись.

Штатный pre-deploy `pnpm db:deploy` применил `202610040029_request_resource_capacity` в19:27:03 UTC. В БД теперь22 завершённые migrations, `request_rows` подтверждён как CHECK0..10000. Санитизированный вывод применения: `production-migration-log.json`; deploy metadata и HTTP health: `production-backend-release.json`.

Финальная attestation19:29:57 UTC: `production-release-attestation.json`, `pass=true`. Внутри фактического контейнера подтверждены deployment ID и release SHA.269 файлов runtime source — API, worker, web app/components/lib, packages, renderer и deployment — побайтно совпадают с release archive. Общий SHA256 этого набора: `a9a131764afc6e2ce0228799fff5594ce90049413aa62386579c2d08e37619ea`. Исключены не входящие в Docker image docs/tests и исключённый Dockerignore legacy selection helper. Отдельные hashes критичных файлов сохранены в evidence.

Процессы API и worker с `src/main.ts` и правильными cwd обнаружены под UID1000. Для чтения `/proc` использован отдельный read-only helper с тем же UID; первоначальный root SSH helper не имел ptrace доступа к cwd. Worker heartbeat на момент проверки —4,9 секунды. Никакие env/секреты процессов не выводились.

Сохранность относительно проверенного backup18:47 UTC доказана по каждому прежнему ID:5 PrintRequest,44 RequestProposal,1 Issuance,22 Artifact,2 IssuedDocument,11 RenderInputSnapshot. Совпали row/payload/proposal/file hashes, все42 исходных storage файла и aggregate business hashes10 таблиц. `differences=[]`, `changedBusinessTables=[]`, новых записей в этих6 исторических таблицах0. До cutover19:16:36 baseline также совпадал, active jobs0 (`production-precutover-check.json`).

Временный SSH key `codex-demo-minimal-actions-backup-20261004` успешно отозван после attestation; повторное чтение зарегистрированного списка подтвердило отсутствие fingerprint `SHA256:Yn+RWwiOgzU72eB8urZVyyLQeYPLpJDVBaXDpLfNXS0`. Evidence `production-ssh-cleanup.json`.

Автоматическая проверка разрешений отклонила удаление локальных private/public файлов этого временного ключа с причиной `blocked by policy`. Файлы остаются в `C:/Users/Admin/.ssh/`, вне Git; зарегистрированный доступ к Railway уже закрыт. Обход запрета другим инструментом не выполнялся.

Rollback остаётся описанным в `production-backup.md`: не сужать CHECK обратно на250 и не восстанавливать старую БД поверх новой истории. После появления больших заявок прежнему коду требуется совместимая capacity-правка либо fix-forward. Текущий backup и старые bytes сохранены.
