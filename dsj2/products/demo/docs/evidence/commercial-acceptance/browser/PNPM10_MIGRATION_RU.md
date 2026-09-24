# Ограниченное обновление pnpm — 22.09.2026

По результату фактического сканирования контейнера root поручил обновить менеджер продукта с pnpm 9.15.9 до 10.34.5 и выровнять `apps/web` tsx с уже используемой в root/API версией 4.23.15. Другие зависимости не обновлялись.

Перед изменением прочитаны официальные [release notes pnpm 10](https://github.com/pnpm/pnpm/releases/tag/v10.0.0), [описание lifecycle allowlist](https://pnpm.io/10.x/settings#onlybuiltdependencies) и [режим lockfile-only](https://pnpm.io/10.x/cli/install#--lockfile-only). pnpm 10 по умолчанию блокирует сценарии установки зависимостей; lockfile-only обновляет метаданные без записи в node_modules.

В `pnpm-workspace.yaml` разрешены lifecycle scripts только четырёх уже используемых пакетов: `@prisma/client`, `@prisma/engines`, `prisma`, `esbuild`. Проверены реальные package.json установленных версий. `sharp@0.35.4` и `@nestjs/core@11.2.5` не содержат preinstall/install/postinstall, поэтому дополнительные разрешения для них не потребовались.

Выполнены `corepack pnpm --version` (10.34.5), `corepack pnpm install --lockfile-only --ignore-scripts` и повторная проверка `corepack pnpm install --lockfile-only --frozen-lockfile --ignore-scripts`. Обе команды завершились с кодом 0. Файлы `pnpm10-lockfile.log`, `pnpm10-frozen-lockfile.log`, `pnpm10-migration.json` сохраняют результат.

Независимое сравнение lockfile с HEAD подтвердило: новых package versions 0; изменений содержимого сохранённых package entries, кроме libc metadata, 0; удалены 30 неиспользуемых entries старого tsx/esbuild, платформенных сборок и двух зависимостей старого tsx. Для 20 платформенных пакетов pnpm уточнил libc metadata. Ни relink node_modules, ни Prisma generate в работающем Windows-окружении не запускались.

Это проверка согласованности lockfile, а не заявление о чистой установке новой версии. Полный frozen install/build/test в Linux и повторное сканирование собранного контейнера выполняет root отдельно.
