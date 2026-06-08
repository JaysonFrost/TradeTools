# Security Policy

## Supported Versions

Поддерживается последняя опубликованная версия из [GitHub Releases](https://github.com/JaysonFrost/TradeTools/releases) и текущая ветка разработки.

## Reporting a Vulnerability

Если вы нашли уязвимость, не публикуйте секреты и рабочий exploit в публичном issue.

Предпочтительный путь:

1. Откройте приватный GitHub Security Advisory, если он доступен в репозитории.
2. Если приватного канала нет, создайте issue без секретов и без публичного exploit, указав, что готовы передать детали приватно.

## Sensitive Data

TradeTools работает с данными, которые нельзя раскрывать публично:

- Binance API key/secret;
- OBS WebSocket password;
- SSH host/login/password;
- proxy route details;
- локальный `settings.json`, если он не очищен вручную.

Биржевые ключи должны быть read-only: без прав торговли, вывода средств и изменения аккаунта.
