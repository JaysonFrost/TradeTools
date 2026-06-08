<p align="center">
  <img src="desktop/build/icon-128.png" width="96" height="96" alt="TradeTools logo">
</p>

<h1 align="center">TradeTools</h1>

<p align="center">
  Локальный desktop-помощник для трейдеров: автоматическая запись видео сделок, хранилище прокси/VPS и напоминания об оплате серверов.
</p>

<p align="center">
  <a href="https://github.com/JaysonFrost/TradeClipper/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/JaysonFrost/TradeClipper/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/JaysonFrost/TradeClipper/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/JaysonFrost/TradeClipper?label=release"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-22c55e.svg"></a>
</p>

## Скачать

Готовые сборки публикуются в [GitHub Releases](https://github.com/JaysonFrost/TradeClipper/releases).

- **Windows:** скачайте `TradeTools-<version>-win-x64.exe`.
- **macOS:** скачайте `.dmg` или `.zip` с `mac` в названии.
- **Linux:** скачайте `TradeTools-<version>-linux-x64.AppImage`.

Пока сборки не подписаны платным сертификатом разработчика, Windows SmartScreen и macOS Gatekeeper могут показать предупреждение. Скачивайте приложение только из раздела Releases этого репозитория и сверяйте `SHA256SUMS.txt`, если сомневаетесь.

## Что умеет TradeTools

- Записывает клипы сделок через **OBS Replay Buffer**.
- Берёт сделки из **Binance USDT-M Futures read-only API**.
- Обрезает replay через встроенный `ffmpeg` и кладёт готовый MP4 в выбранную папку.
- Показывает очередь клипов, предпросмотр, открытие файла и переименование видео.
- Хранит VPS/прокси: название, IP/домен, SSH-логин, пароль, день оплаты и ссылку на хостинг.
- Помогает собрать цепочку серверов и автоматически настроить Xray/VLESS через SSH.
- Поднимает локальный HTTP proxy для торгового терминала: `127.0.0.1:1083` по умолчанию.
- Напоминает системными уведомлениями об оплате серверов и успешной записи сделки.
- Работает локально: без подписки, без Telegram/Discord-gate и без загрузки клипов в облако.

## Быстрый старт

1. Установите OBS и включите Replay Buffer.
2. В OBS включите WebSocket, обычно `127.0.0.1:4455`.
3. Откройте TradeTools и перейдите в `Видео`.
4. Нажмите `Мастер настройки видео` и пройдите мастер.
5. Добавьте read-only API-ключи Binance Futures, если хотите автоматическое создание клипов по закрытым сделкам.
6. Нажмите `Создать тестовый клип`, чтобы проверить OBS, поиск replay-файла и ffmpeg-нарезку.

Подробная инструкция лежит в [desktop/docs/USER_GUIDE_RU.md](desktop/docs/USER_GUIDE_RU.md).

## Прокси и VPS

На странице `Прокси` можно открыть `Мастер настройки прокси`, добавить два сервера, сохранить связку и нажать `Настроить и запустить связку`. TradeTools подключится по SSH, установит Xray, свяжет серверы в маршрут и покажет, что указать в торговом терминале. Для трёх и более серверов используйте список `Порядок связки` на странице прокси.

Важно:

- используйте только свои VPS и свои доступы;
- SSH-пароли и API-ключи сохраняются в системный keychain;
- для биржи используйте ключи только с правами чтения, без торговли и вывода средств;
- VPN, антизапреты и другие локальные туннели могут конфликтовать с локальным proxy.

## Для разработчиков

Проект живёт в папке `desktop/`.

Требования:

- Node.js 22 LTS или новее;
- npm 10 или новее;
- OBS для ручной проверки видео-пайплайна;
- на Linux для `keytar` может понадобиться `libsecret-1-dev`.

Локальный запуск:

```bash
cd desktop
npm ci
npm run dev
```

Проверки:

```bash
cd desktop
npm run typecheck
npm test
npm run build
```

Сборка установщиков:

```bash
cd desktop
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Артефакты появятся в `desktop/dist/`.

## Релизы

Релизы собираются GitHub Actions из тегов:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Workflow соберёт Windows/macOS/Linux, создаст GitHub Release и загрузит установщики вместе с `SHA256SUMS.txt`.

Подробный порядок выпуска: [desktop/docs/RELEASES_RU.md](desktop/docs/RELEASES_RU.md).

История изменений ведётся в [CHANGELOG.md](CHANGELOG.md).

## Безопасность и дисклеймер

TradeTools не является финансовым советником и не принимает торговых решений. Приложение помогает записывать сделки и управлять локальными инструментами вокруг торговли.

Не публикуйте в issues и pull requests:

- API-ключи бирж;
- OBS WebSocket пароль;
- SSH-пароли;
- IP серверов, если не хотите раскрывать инфраструктуру;
- содержимое `settings.json` без ручной очистки.

## Лицензия

TradeTools распространяется по лицензии [MIT](LICENSE). Проект бесплатный и открыт для pull requests.

Часть сторонних компонентов распространяется по своим лицензиям. Особенно важно: bundled `ffmpeg-static` имеет лицензию `GPL-3.0-or-later`. Подробности: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Вклад в проект: [CONTRIBUTING.md](CONTRIBUTING.md). Сообщения о безопасности: [SECURITY.md](SECURITY.md).
