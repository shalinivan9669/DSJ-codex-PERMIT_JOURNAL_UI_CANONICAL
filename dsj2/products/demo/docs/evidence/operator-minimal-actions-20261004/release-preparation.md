# Подготовка публикации и проверенная резервная копия — 04.10.2026

**Последующее выполнение backend release:** deployment `8f79e67a-85c6-489b-910e-f552454fc2ed` SUCCESS, SHA `17aab8af222a3683b5da1048082e96b46407505b`, migration22/CHECK10000, source/history/file attestation PASS, SSH отозван. См. `production-backend-release.md`. Сведения ниже описывают подготовку до этого выпуска.

Deployment, миграция и изменение product credentials/переменных в рамках этой подготовки не выполнены. Сведения о hosting прочитаны 18:28–18:33 UTC; свежая резервная копия получена 18:47 UTC и независимо проверена локально 18:51 UTC. Для backup зарегистрирован временный SSH-ключ, его отзыв требуется после final attestation. Целевой новый commit формируется основным агентом после локальной приёмки. Текущий HEAD при исходном чтении — `e10f3f77b195953555811c0b6c2b9de622dea4d4`, ветка `codex/operator-flow-refinement-20261003`, remote `https://github.com/shalinivan9669/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL.git`.

## Существующие цели, подтверждены live API/CLI

| Цель | Точное состояние |
| --- | --- |
| Vercel project | `prj_JMxxnkngWKGZRePXdvbn6jOCnk2V`, `dsj-demo-rows-20261002` |
| Vercel team | `team_omsifNnhVJe540dSiQvWq7H1` |
| Canonical alias | `dsj-demo-rows-20261002.vercel.app` → `dpl_BPwv2qXMjxUQysfmDMe28E5d6E57`, READY |
| Текущий frontend source metadata | commit `05a59455ef7f9346735e9d3c319d3d5a53c9cc78`, текущая рабочая ветка |
| Actual Vercel root | `apps/web`, framework nextjs; Git link отсутствует (`null`) — существующий проект получает standalone product upload, push не выпускает frontend |
| Build/install Vercel | `cd ../.. && corepack pnpm --filter @demo/web build`; `cd ../.. && corepack pnpm install --frozen-lockfile --filter @demo/web...` |
| Railway project/environment | `250bb4a5-6462-4933-b1a7-8f61e2e7f507`, production / `fc776e13-94fd-45ff-b14c-06b91a2b1380` |
| Backend service | `f9c22605-78ca-41ee-a483-52aa54036fba`, `demo-backend`, домен `demo-backend-production-2d4c.up.railway.app` |
| Backend current deployment | `4554ceda-96c8-4d00-8739-92e9573496c7`, SUCCESS, единственный active |
| Database service | `5e1e59b4-628a-427a-8104-7fdf07027f7e`, Postgres |
| Actual Railway build | rootDirectory null, uploaded product root, DOCKERFILE, `deployment/Dockerfile` |
| Actual Railway deploy | **preDeployCommand уже `pnpm db:deploy`**; `/health`, timeout 300 sec, 1 replica, sleep disabled, draining 60 sec, `/data` volume, штатный Docker CMD |

Санитизированные evidence: `release-prep-current.json`, `release-prep-vercel.json`, `release-prep-settings.json`, `release-prep-railway-config.json`. Прямой запрос со старым auth.json получил403; установленный Vercel CLI корректно читает тот же проект и alias. Использовать действующую CLI-сессию, не печатать/перезаписывать токен.

## Миграция и backup до release

Новый forward migration `packages/database/prisma/migrations/202610040029_request_resource_capacity/migration.sql` заменяет только `PrintRequest.request_rows` на CHECK `itemCount BETWEEN 0 AND 10000`. Existing rows, proposals, artifacts и история не переписываются. Эта техническая вместимость синхронизирована с контрактом/renderer; старый production CHECK на 250 не позволит сохранить обычную заявку400.

Ближайший AGENTS.md требует: “No production migrations or cutover without environment-specific authorization.” Явный запрос пользователя на публикацию текущей ветки в существующие Vercel/Railway предоставляет эту авторизацию, включая необходимое неразрушающее расширение CHECK до10000. Повторное разрешение не требуется. Выпуск выполняет основной агент после локальной приёмки и проверки backup. **Любой backend upload с новой миграцией уже автоматически запустит её через существующий pre-deploy command.** Не обходить это выключением команды или преждевременным `railway up`.

Свежая копия расположена вне Git: `.runtime/remaining-operator-flow/production-backup-minimal-actions-private/operator-minimal-actions-20261004T184700Z/`. Remote `/data/backups/operator-minimal-actions-20261004T184700Z/`. Dump, файлы, TOC и manifest реально скачаны; SHA256 каждого совпал с remote. Все42 файла внутри локального tar независимо прочитаны без extraction и сверены по bytes/SHA256. `pg_restore --list` и `--schema-only --file -` успешно прочитали dump; основные TABLE DATA присутствуют. Санитизированные evidence `production-backup-verified.json`, детали и rollback — `production-backup.md`. Предыдущая копия сохранена отдельно.

Это online pg_dump с проверкой устойчивости business-state и file inventory до/после. Активных generation jobs0, все22 ссылки Artifact соответствуют фактическим bytes/hash. Временный storage maintenance lock препятствовал сборке мусора; API/worker не останавливались. Это не offline backup и не доказанный full restore: `pg_restore` list/schema проверены, полный restore в отдельную БД не запускался. Штатный `deployment/backup.mjs` для offline режима требует остановленных API/worker и `DEMO_MAINTENANCE=1`.

Новый временный SSH key зарегистрирован как `codex-demo-minimal-actions-backup-20261004`, private path `C:/Users/Admin/.ssh/codex_demo_minimal_actions_backup_20261004`. Fingerprint `SHA256:Yn+RWwiOgzU72eB8urZVyyLQeYPLpJDVBaXDpLfNXS0`. Доступ к точному backend production проверен; пароли приложения и базы не менялись. Ключ нужен для после-релизного сравнения и должен быть отозван после attestation.

## Конкретный выпуск после проверки

1. Закоммитить и push текущую ветку с чистым staged manifest, зафиксировать `RELEASE_SHA`. Новый upload брать из коммита автономного `dsj2/products/demo`, без wrapper/frozen DSJ, runtime/private файлов, node_modules и тестовых БД. Полезен существующий `scripts/verification/stage-standalone.mjs ABSOLUTE_NEW_OUTSIDE_DIRECTORY`; он сверяет source manifest, но копирует текущие исходники, поэтому сначала нужен сохранённый коммит и проверка manifest против него. Для гарантированного Git snapshot подходит archive именно дерева `RELEASE_SHA:dsj2/products/demo` в новую папку.
2. После завершения приёмки и уже полученного свежего backup загрузить тот же product root в существующий Railway service, явно указывая project/service/environment. Пользовательская авторизация существующего environment уже получена. Зафиксировать новый deployment ID, build/migration logs, исходный SHA и source hashes. Предыдущий deployment ID выше сохранить как точку возврата.
3. Frontend загрузить в существующий Vercel project с `--prod --skip-domain` и metadata SHA/branch. Его настроенный root `apps/web` рассчитан на standalone product root. Не загрузить вместо него wrapper. Проверить READY и нужный commit metadata; затем явно promote/alias canonical origin.
4. Через canonical origin проверить director/operator login/session/context и authenticated readiness, then разрешённый smoke. Проверить backend API/worker, новый schema constraint, rendering и актуальные source hashes. Push, Vercel READY и Railway SUCCESS по отдельности не доказывают полный release.

Проверенные пути CLI и форма команд (запуск здесь **не выполнен**):

```powershell
$railwayCli = 'C:/Users/Admin/AppData/Local/npm-cache/_npx/d991ede4b4a6395c/node_modules/@railway/cli/bin/railway.exe'
$vercelCli = 'C:/Users/Admin/AppData/Local/npm-cache/_npx/c5e9bca3acff8f7b/node_modules/vercel/dist/index.js'
# $releaseDirectory: новый проверенный standalone product root; $releaseSha: его реальный commit.
& $railwayCli up $releaseDirectory --path-as-root --project 250bb4a5-6462-4933-b1a7-8f61e2e7f507 --service f9c22605-78ca-41ee-a483-52aa54036fba --environment production --detach --message "DEMO $releaseSha"
node $vercelCli deploy $releaseDirectory --project prj_JMxxnkngWKGZRePXdvbn6jOCnk2V --scope team_omsifNnhVJe540dSiQvWq7H1 --prod --skip-domain --yes --meta "githubCommitSha=$releaseSha" --meta 'githubCommitRef=codex/operator-flow-refinement-20261003'
# После READY и проверки target:
node $vercelCli promote $newVercelDeployment --scope team_omsifNnhVJe540dSiQvWq7H1 --yes
node $vercelCli alias set $newVercelDeployment dsj-demo-rows-20261002.vercel.app --scope team_omsifNnhVJe540dSiQvWq7H1
```

`DEMO_RELEASE_SHA` backend обновлять только на фактический выпущенный SHA; существующий Dockerfile не выводит его из Git автоматически. Если используется `railway variable set`, применять exact target и `--skip-deploys`, чтобы не запустить отдельный преждевременный redeploy; секретные переменные не трогать и raw variable list не выводить.

## Возврат и реквизиты

Сохранить canonical Vercel target и Railway deployment ID до переключения; при раннем отказе вернуть код/alias. CHECK 10000 обратно на250 автоматически не сужать. После сохранения новых заявок >250 старый frontend/backend с лимитом250 может не читать их; тогда нужен совместимый возврат с увеличенной вместимостью или исправление вперёд. DB restore поверх новой истории не является безопасным обычным rollback. Выпущенные bytes и hashes сохраняются.

Частный источник действующих ролей: `C:/Users/Admin/Documents/DSJ-DEMO-cloud-20261002/credentials.json`. Наличие director.email/password, operator.email/password и canonical origin проверено; значения не выводились. Это наличие реквизитов, не новая проверка входа; полный login smoke выполняется на окончательном deployment. Не менять пароли и не включать файл в Git/evidence.
