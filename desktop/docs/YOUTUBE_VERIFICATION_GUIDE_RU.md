# Гайд: YouTube API verification для TradeCut

## Что именно нужно пройти

Для TradeCut есть два разных процесса:

1. **Google OAuth app verification** — чтобы пользователи могли авторизоваться через Google со scope `https://www.googleapis.com/auth/youtube.upload` без режима Testing.
2. **YouTube API Services audit** — чтобы видео, загруженные через `videos.insert`, могли становиться public/unlisted. Для непроверенных API-проектов, созданных после 28 июля 2020, YouTube ограничивает такие загрузки private-режимом.

Если приложение только для себя, пока можно оставить OAuth в Testing и добавить свой Gmail в Test users. Но API-загрузки всё равно могут оставаться private до YouTube audit.

## Подготовка проекта

1. Открой Google Cloud Console и выбери проект с Client ID:
   `174480335890-qig5c1401fi1hdvap3nuv3a9ipcsagqu.apps.googleusercontent.com`.
2. Убедись, что включён **YouTube Data API v3**.
3. В OAuth consent screen / Google Auth Platform заполни:
   - App name: `TradeCut`
   - User support email
   - Developer contact email
   - Homepage / Privacy Policy / Terms, если Google просит URL
4. В Data access / Scopes оставь минимальный scope:
   `https://www.googleapis.com/auth/youtube.upload`
5. В Audience добавь свой Gmail в Test users, чтобы пользоваться приложением во время проверки.

## Если Google пишет `client_secret is missing`

Это значит, что созданный OAuth Client требует `Client secret` при обмене кода на токены.

1. Google Cloud Console → APIs & Services → Credentials.
2. Открой OAuth Client с Client ID:
   `174480335890-qig5c1401fi1hdvap3nuv3a9ipcsagqu.apps.googleusercontent.com`.
3. Скопируй `Client secret`.
4. Запусти dev-сервер так:

```bash
cd <project-root>/desktop
TRADECUT_GOOGLE_OAUTH_CLIENT_SECRET="твой-client-secret" npm run dev
```

Client ID уже встроен в приложение. Если хочешь переопределить и его, добавь:

```bash
TRADECUT_GOOGLE_OAUTH_CLIENT_ID="твой-client-id.apps.googleusercontent.com" \
TRADECUT_GOOGLE_OAUTH_CLIENT_SECRET="твой-client-secret" \
npm run dev
```

После изменения env-переменных полностью перезапусти Electron/dev-сервер.

## Что написать в обосновании scope

Короткая формулировка:

> TradeCut uses `youtube.upload` only to upload video clips that the user creates locally from their own trading recordings. The app does not read, list, modify, or delete existing YouTube videos. The user explicitly confirms each upload from the local review queue.

Если форма просит объяснить хранение данных:

> TradeCut stores local clip metadata on the user's device. OAuth tokens are stored in the operating system keychain. The app does not sell, share, or transfer YouTube API data.

## Демо-видео для OAuth verification

Запиши короткий screencast:

1. Открыть TradeCut.
2. Показать настройки YouTube.
3. Нажать `Авторизоваться в Google`.
4. Показать Google consent screen со scope upload.
5. Вернуться в приложение.
6. Показать локальную очередь клипов.
7. Нажать `Загрузить на YouTube`.
8. Показать, что клип появился в YouTube Studio.

Видео должно показывать реальный flow, который использует именно заявленный scope.

## Отправка OAuth verification

1. Google Cloud Console → Google Auth Platform / OAuth consent screen.
2. Проверь Branding, Audience, Data access.
3. Открой Verification Center или кнопку Submit for verification.
4. Выбери sensitive scope `youtube.upload`.
5. Добавь justification и demo video.
6. Отправь и отвечай на письма Google с того email, который указан как developer contact.

## Отправка YouTube API Services audit

Открой форму **YouTube API Services - Audit and Quota Extension Form**.

Рекомендуемые ответы по смыслу:

- Reason: `I am completing a Compliance Audit or requesting additional API quota`
- API Client: `TradeCut`
- Use case: `YouTube video uploads` или `Creator Tools`
- API Services: `Data API`
- Audience: если пока только для себя, честно укажи internal/private use; если планируешь продукт, укажи creators.
- How users use the app: пользователь создаёт локальные клипы из своих записей сделок, вручную подтверждает загрузку, приложение отправляет видео и метаданные на YouTube.
- Data storage: OAuth tokens in OS keychain, local queue metadata on device, no resale/share of YouTube API data.
- Upload implementation: `videos.insert` with title, description, privacy status, and user-confirmed local video file.

Если форма просит файл меньше 10 MB, загрузи короткий screencast или PDF с flow.

## Частые причины отказа

- Scope в коде не совпадает со scope в Cloud Console.
- Нет privacy policy или описание данных противоречит фактическому поведению.
- Demo video не показывает полный OAuth/upload flow.
- Проект/Client ID в форме не тот, который использует приложение.
- Указано, что приложение публичное, но нет доступной сборки, сайта или инструкции для проверяющих.
- Запрошены лишние scopes. Для TradeCut нужен только `youtube.upload`.

## Официальные ссылки

- OAuth app verification: https://support.google.com/cloud/answer/13463073
- Sensitive scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- OAuth app audience / Testing users: https://support.google.com/cloud/answer/15549945
- YouTube videos.insert private restriction: https://developers.google.com/youtube/v3/docs/videos
- YouTube API Services audit form: https://support.google.com/youtube/contact/yt_api_form
