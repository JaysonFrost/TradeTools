# Релизы TradeTools

Этот документ описывает выпуск публичной версии через GitHub Releases.

## Что публикуется

Release workflow собирает:

- Windows NSIS installer: `TradeTools-<version>-win-x64.exe`;
- macOS DMG/ZIP: `TradeTools-<version>-mac-<arch>.dmg` и `.zip`;
- updater-файлы для автообновлений: `latest.yml`, `latest-mac.yml` и `.blockmap`;
- `SHA256SUMS.txt` для проверки файлов.

## Перед релизом

1. Проверьте, что рабочее дерево содержит только нужные изменения.
2. Обновите версию в `desktop/package.json`.
3. Обновите `CHANGELOG.md` в корне репозитория.
4. Синхронизируйте lockfile:

```bash
cd desktop
npm install --package-lock-only
```

5. Запустите проверки:

```bash
cd desktop
npm run typecheck
npm test
npm run build
```

6. Для быстрой проверки конфигурации electron-builder можно собрать unpacked package:

```bash
cd desktop
npm run pack
```

## Создание релиза

Сначала закоммитьте изменения релиза. Затем создайте тег. Тег должен начинаться с `v` и совпадать с версией приложения:

```bash
git tag v0.1.0
git push origin v0.1.0
```

После push GitHub Actions запустит workflow `Release`, соберёт артефакты на Windows/macOS и создаст GitHub Release.

## Ручной запуск

Workflow можно запустить вручную из GitHub UI:

1. Откройте `Actions`.
2. Выберите `Release`.
3. Нажмите `Run workflow`.
4. Укажите существующий тег, например `v0.1.0`.

## После релиза

1. Откройте страницу GitHub Release.
2. Проверьте, что загружены installer-файлы, updater-файлы и `SHA256SUMS.txt`.
3. Скачайте Windows installer и убедитесь, что приложение запускается.
4. При необходимости отредактируйте auto-generated release notes вручную.

## Автообновления

TradeTools использует GitHub Releases как источник обновлений. Для корректной работы в релизе должны быть:

- Windows: `.exe`, `.exe.blockmap`, `latest.yml`;
- macOS: `.dmg`, `.zip`, `.dmg.blockmap`, `.zip.blockmap`, `latest-mac.yml`.

Для каждой новой версии меняйте `desktop/package.json`, создавайте новый тег и не перевешивайте уже опубликованные теги. Например: `0.1.0` -> `v0.1.0`, затем `0.1.1` -> `v0.1.1`.

## Важно про подпись

Сейчас сборки не подписываются сертификатами Apple Developer ID или Windows Code Signing. Поэтому:

- Windows SmartScreen может предупреждать о неизвестном издателе;
- macOS Gatekeeper может потребовать ручного разрешения запуска;
- это нормально для раннего open-source релиза без платных сертификатов.
