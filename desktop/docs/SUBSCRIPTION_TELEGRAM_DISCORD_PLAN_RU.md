# План подписки, Telegram, Discord и админ-панели

## Цель

Сделать TradeCut коммерческим desktop-продуктом по подписке: доступ управляется сервером, регистрация проходит через Telegram-бота, промокоды могут зависеть от Discord-сервера, а администратор позже видит пользователей в панели управления.

## Архитектура

Desktop-приложение не хранит платежные секреты и не решает, активна ли подписка. Оно отправляет license/session token на backend и получает короткий ответ: доступ активен или нет, тариф, срок действия, ограничения.

Компоненты:

1. Desktop app.
2. Backend API.
3. Telegram bot.
4. Discord bot/guild checker.
5. Payment/subscription provider.
6. Admin panel.
7. Database.

## Основные сущности

### User

- id
- telegram_id
- telegram_username
- discord_id
- discord_username
- email, если понадобится
- created_at
- last_seen_at

### Subscription

- user_id
- plan
- status
- current_period_start
- current_period_end
- provider
- provider_subscription_id

### PromoCode

- code
- discount_type
- discount_value
- starts_at
- expires_at
- max_uses
- discord_guild_required
- allowed_discord_guild_id
- created_by_admin_id

### LicenseDevice

- user_id
- device_id
- device_name
- platform
- app_version
- activated_at
- last_check_at

## Telegram flow

1. Пользователь пишет боту `/start`.
2. Бот создает или находит пользователя.
3. Бот предлагает привязать Discord, если промокод требует сервер.
4. Пользователь вводит промокод.
5. Backend проверяет промокод, Discord membership и лимиты.
6. Бот показывает статус подписки и ссылку/код активации desktop-приложения.

## Discord gate

1. Пользователь привязывает Discord OAuth или вводит одноразовый код из Discord-бота.
2. Backend сохраняет discord_id.
3. Backend проверяет membership в нужном guild.
4. Если пользователь не состоит на сервере, промокод не активируется или подписка получает ограничение.

## Desktop auth flow

1. Desktop показывает экран входа.
2. Пользователь вводит код из Telegram-бота или сканирует deep link.
3. Desktop получает device token.
4. При запуске приложение вызывает backend `/license/check`.
5. Если подписка активна, функции включаются.
6. Если подписка истекла, приложение показывает экран продления.

## Админ-панель позже

Минимальный набор:

1. Список пользователей.
2. Поиск по Telegram, Discord, email, device_id.
3. Статус подписки.
4. История промокодов.
5. Устройства пользователя.
6. Ручная выдача/отмена доступа.
7. Экспорт CSV.

## Безопасность

1. API keys бирж и YouTube хранить локально в OS keychain.
2. Платежные и bot tokens хранить только на backend.
3. Desktop получает только краткоживущий access token и refresh/device token.
4. IPC в Electron остается узким: renderer не получает filesystem/secrets напрямую.
5. Проверки доступа кешировать локально только на короткое время, чтобы приложение работало при временном сбое сети.

## Этапы внедрения

1. Локальный MVP клипов без обязательной авторизации.
2. Экран входа и backend license check.
3. Telegram bot registration.
4. Promo code model.
5. Discord membership check.
6. Payment provider.
7. Admin panel.
8. Device limits and abuse monitoring.
