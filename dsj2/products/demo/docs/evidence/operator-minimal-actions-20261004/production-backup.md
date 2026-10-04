# Проверенная production-копия перед выпуском — 04.10.2026

Backup завершён в18:47 UTC, дополнительная независимая локальная проверка —18:51 UTC. Никакие migrations/deploy/product credentials не изменялись. Существующий Railway project `250bb4a5-6462-4933-b1a7-8f61e2e7f507`, production environment `fc776e13-94fd-45ff-b14c-06b91a2b1380`, backend service `f9c22605-78ca-41ee-a483-52aa54036fba`; target проверялся внутри remote process до чтения БД/файлов.

Повторная read-only сверка перед cutover: **04.10.2026 19:16:36 UTC — baseline unchanged**, active generation jobs0. Counts и business-state hashes всех10 таблиц, per-ID historical hashes6 таблиц и все42 файла совпадают с backup18:47; differences пуст. Evidence `production-precutover-check.json`. Deployment и runtime release SHA не изменились. По этой сверке новая копия не требуется.

Remote-копия: `/data/backups/operator-minimal-actions-20261004T184700Z/`. Отдельная реально скачанная локальная копия внеGit: `C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/remaining-operator-flow/production-backup-minimal-actions-private/operator-minimal-actions-20261004T184700Z/`.

| Файл | Bytes | SHA256, совпал локально и remote |
| --- | ---: | --- |
| database.dump | 278679 | `39c86f9f361fc5cdf9b6f4d6361d23b9a65a882f5e3ea4e6ed57739c2de35c76` |
| files.tar.gz | 57177301 | `7713c957030625450a21d41d7655fab4d540415d5b388a146e7a9b63552123ca` |
| database.toc.txt | 36524 | `16f69b0c9294fb1d42208e70cd073a3b0d545041b36e5e963052cb223da8ea5a` |
| manifest.json | 40763 | `25fcee2711e792c1d2a22ba1be6510b3ef4afea641cea26e974f35510c19a6dc` |

`production-backup-verified.json` содержит санитизированные per-ID hashes без ФИО, паролей, database URL или содержимого документов:5 PrintRequest draft,44 RequestProposal payload/proposalHash,1 Issuance snapshot,22 Artifact fileSha256/bytes,2 IssuedDocument,11 RenderInputSnapshot input. Полные rowSha256 дополнительно сохранены для каждого из этих ID. Новые записи после релиза допустимы; для проверки сохранности нужно сравнивать именно эти ID и hashes, не только общие counts.

Также перед backup зафиксированы16 TemplateVersion,2 User,2 CustomerOrganization,3 RequestItem; business-state hashes до/после совпали, активных generation jobs0. Все22 Artifact ссылки совпали с фактическими хешами и размерами файлов. В storage всего42 файла; каждый member локального tar прочитан и сверен с manifest, архив на filesystem не распаковывался. Успешны remote `pg_restore --list`, `pg_restore --schema-only --no-owner --file -`, проверка core TABLE DATA и локального PGDMP header. Полное восстановление в отдельную БД не выполнялось.

Это online pg_dump при устойчивом business-state/file inventory до/после. API/worker не останавливались. На время получения копии exclusive storage maintenance lock предотвращал GC; lock удалён в finally. Нельзя называть этот результат offline backup. Время жизни копии и возможные новые production записи после18:47 нужно учитывать перед cutover; при обнаружении новых business изменений повторить тот же backup в новый каталог, не перезаписывая имеющийся.

До выпуска: runtime `DEMO_RELEASE_SHA=e10f3f77b195953555811c0b6c2b9de622dea4d4`,21 применённая migration, `request_rows` CHECK0..250. Runtime source hashes, список migrations и старый CHECK записаны в evidence. Новый forward CHECK0..10000 — необходимая часть уже авторизованной публикации текущей ветки в существующее environment; этот документ не подтверждает его применение.

## Release archive и возврат

Архив продукта создавать из реального commit, после сохранения всех нужных файлов. Пример ниже — инструкция, эти команды подготовки release здесь не запускались. `$releaseRoot` должен быть новым каталогом вне source tree; значения разрешаются и проверяются до записи. `git archive` не включает ignored/private runtime и выделяет только автономный продукт.

```powershell
$releaseSha = git rev-parse HEAD
$releaseRoot = 'C:/Users/Admin/Documents/DSJ-DEMO-cloud-20261002/releases/REPLACE_WITH_NEW_RELEASE_ID'
if (Test-Path -LiteralPath $releaseRoot) { throw 'Choose a new release directory' }
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
$archivePath = Join-Path $releaseRoot 'demo-product.tar'
git archive --format=tar --output=$archivePath "${releaseSha}:dsj2/products/demo"
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
$releaseDirectory = Join-Path $releaseRoot 'product'
New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
tar -xf $archivePath -C $releaseDirectory
if ($LASTEXITCODE -ne 0) { throw 'archive extraction failed' }
# Сверить tree/source manifest, затем exact-target deploy из release-preparation.md.
```

Предыдущий Railway deployment `4554ceda-96c8-4d00-8739-92e9573496c7`; Vercel canonical target `dpl_BPwv2qXMjxUQysfmDMe28E5d6E57`. До сохранения заявок >250 ранний rollback возвращает совместимый код/alias; расширенный CHECK автоматически не сужать. После появления новых больших заявок старый код с parsing limit250 может отказать: нужен совместимый rollback с сохранённой вместимостью либо fix-forward. Не восстанавливать старую БД поверх новой истории как обычный rollback. При аварийном полном восстановлении сначала остановить writers, сохранить текущее состояние отдельно, восстанавливать dump и соответствующие файлы согласованно, сверить все hashes/ссылки и только затем возобновлять работу.

Временный SSH key `codex-demo-minimal-actions-backup-20261004` оставлен для final attestation. Fingerprint `SHA256:Yn+RWwiOgzU72eB8urZVyyLQeYPLpJDVBaXDpLfNXS0`; private файл находится в `C:/Users/Admin/.ssh/codex_demo_minimal_actions_backup_20261004`, вне Git. После нового deployment SSH target следует заново получить через `railway ssh config --dry-run` с точными project/service/environment и этим identity-file, затем подтвердить target/runtime внутри процесса. После окончательного чтения отозвать точный ключ командой `railway ssh keys remove SHA256:Yn+RWwiOgzU72eB8urZVyyLQeYPLpJDVBaXDpLfNXS0`, подтвердить отсутствие в зарегистрированном списке и удалить только этот private/public local pair. Product credentials не меняются.
