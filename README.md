# Zvoon — аудиозвонки по ссылке с саммари на почту

> Домен: **zvoon.me** | API: **api.zvoon.me**

## Концепция

Самый простой способ позвонить и получить саммари. Без регистрации, без экосистемы, pay-per-use.

- Пользователь открывает сайт → создаёт звонок → получает ссылку
- Участники заходят по ссылке, вводят имя — и говорят
- Если хост указал email — после звонка приходит AI-саммари + полная транскрипция
- Если email не указан — чистый звонок без записи

## Текущий статус (v0.1 — прототип, работает в проде)

### Что работает
- Лендинг на zvoon.me (GitHub Pages, custom domain, SSL)
- Создание аудио-комнаты по кнопке "Создать звонок"
- Вход по ссылке (гость вводит имя → присоединяется)
- Аудио-звонок через LiveKit (WebRTC SFU)
- Mute/unmute, таймер, список участников, кнопка "Пригласить"
- Экран запроса микрофона с инструкциями для каждого браузера
- Режим "без микрофона" (listen-only)
- Двуязычный интерфейс (RU/EN) + dual-кнопка переключения языка (RU/EN с active state)
- Мобильная навигация: sticky nav-бар под хедером с горизонтальным скроллом
- Rate limiting (5 комнат/час, 20 токенов/час на IP)
- Per-track запись через LiveKit Egress (отдельный OGG на каждого участника)
- **Двухшаговая AI-транскрипция** (Gemini 2.5 Flash):
  - Шаг 1: параллельная транскрипция каждого трека отдельно (с таймкодами)
  - Шаг 2: слияние в коде по абсолютным таймкодам → хронологическая транскрипция
  - Шаг 3: саммари из текста (не из аудио)
- **Полная транскрипция вложением** (.txt файл) в email вместе с саммари
- Хронологический порядок реплик через offset (egressStartTimes на сервере)
- Отправка саммари на email через Resend (HTML, тёмная тема)
- Индикатор записи (красная пульсирующая точка) при наличии зарегистрированных email
- LiveKit webhooks (track_published, room_finished, egress_ended)
- `disconnectOnPageLeave: false` — переключение вкладок не обрывает звонок
- Лендинг v2: green/navy палитра (spring #DBE64C, midnight #001F3F, mantis #74C365, book-green #00804C)
  - Hero: Glass Orbit карточка (glass morphism, орбита аватара, волны, телефоны-трубки)
  - Секции: How It Works, AI Summary Showcase (email preview), Security, Pricing, FAQ, Footer
  - Fade-in анимации через IntersectionObserver
  - Pricing: горизонтальный scroll с snap на мобилке
- Экран звонка v2: midnight палитра, Glass Orbit карточки участников
  - Орбитальное кольцо при говорении, wave-бары, пульсирующий статус
  - Мобилка: компактный стек карточек по центру (до 5 штук)
  - Терминология: «сводка» → «саммари» во всех i18n строках

### Что НЕ готово
- Платежи (Stripe + ЮKassa) — только заглушки вебхуков
- Лимиты free tier (время, участники)
- БД (Neon Postgres + Drizzle) — схема готова, не подключена к Neon
- Кредитная система (pay-per-use)
- E2E шифрование (см. раздел Безопасность)

## Инфраструктура

### Продакшен

| Компонент | Где | URL | Детали |
|---|---|---|---|
| Лендинг + звонки | GitHub Pages | https://zvoon.me | Статика из `docs/`, auto-deploy при push |
| API (Hono) | Сервер 171.22.31.175 | https://api.zvoon.me | PM2 `zvoon-api`, порт 3510 |
| LiveKit Server | Сервер 171.22.31.175 | wss://livekit.kotik.space | Docker, порт 7880 |
| LiveKit Egress | Сервер 171.22.31.175 | — | Docker, записи в /srv/livekit/recordings/ |

### Сервер 171.22.31.175 (Frankfurt, DE)

- **OS:** Ubuntu 24.04, 4 vCPU (Ryzen 9 5950X), 8 GB RAM, 148 GB NVMe
- **Соседи:** mute-api, kotikgo-rent, maya-bot (НЕ ТРОГАТЬ)
- **Docker:** LiveKit Server + Egress
- **PM2:** zvoon-api (id 4)
- **nginx:** `/etc/nginx/sites-available/zvoon-api` (api.zvoon.me → :3510)
- **nginx:** `/etc/nginx/sites-available/livekit` (livekit.kotik.space → :7880)
- **Сетевые буферы:** оптимизированы в `/etc/sysctl.d/99-livekit.conf` (2.5 MB)
- **Firewall:** 7881-7891/udp, 7882/tcp, 5349/tcp, 3478/udp (LiveKit)

### DNS (Namecheap)

**zvoon.me:**
- 4× A `@` → 185.199.108-111.153 (GitHub Pages)
- CNAME `www` → salimovsf.github.io
- A `api` → 171.22.31.175

**kotik.space:**
- A `livekit` → 171.22.31.175
- A `zvoon` → 171.22.31.175 (старый, можно удалить после миграции)

### SSL сертификаты (Let's Encrypt, auto-renew)

| Домен | Истекает |
|---|---|
| api.zvoon.me | 2026-06-09 |
| livekit.kotik.space | 2026-06-08 |

### LiveKit конфигурация

- Путь: `/srv/livekit/`
- Файлы: `livekit.yaml`, `docker-compose.yml`, `egress.yaml`
- API Key/Secret: **ротированы 2026-03-12** (продовые, не дефолтные)
- **⚠️ Ключи в ТРЁХ местах:** `livekit.yaml`, `egress.yaml`, `/srv/zvoon-api/.env` — при ротации менять ВСЕ ТРИ!
- TURN: включён (domain: livekit.kotik.space, TLS 5349, UDP 3478)

### API конфигурация

- Путь: `/srv/zvoon-api/`
- `.env`: LIVEKIT_API_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, PORT=3510, GEMINI_API_KEY, RESEND_API_KEY, RECORDINGS_DIR
- CORS: zvoon.me, www.zvoon.me, salimovsf.github.io
- **Пути записей:** RECORDINGS_DIR=/srv/livekit/recordings (на хосте), Docker volume /recordings → /srv/livekit/recordings

## Структура репозитория

```
call-project/
├── docs/                       # ← GitHub Pages (продакшен сайт)
│   ├── index.html              # Лендинг (SEO, pricing, FAQ, RU/EN)
│   ├── call.html               # Звонок (join → mic → call flow)
│   └── CNAME                   # Custom domain zvoon.me
│
├── apps/                       # ← Turborepo монорепо (для будущего dev)
│   ├── web/                    # Next.js 15 (пока не используется в проде)
│   └── api/                    # Hono backend (задеплоен на сервер)
│       └── src/
│           ├── index.ts        # Hono app + CORS + route registration
│           ├── routes/
│           │   ├── rooms.ts    # POST /rooms, GET /rooms/:slug, POST /rooms/:slug/token
│           │   ├── summary.ts  # POST /summary/register-email, GET /summary/:slug, processRoomSummary()
│           │   ├── webhook.ts  # POST /webhook/livekit (track/room/egress events)
│           │   └── payments.ts # Stripe + YooKassa webhooks (TODO)
│           ├── services/
│           │   ├── livekit.ts  # createRoom, generateToken
│           │   ├── ai-pipeline.ts  # transcribeTrack() + processCallRecording() (двухшаговый Gemini)
│           │   ├── email.ts    # sendSummaryEmail, sendErrorEmail (Resend)
│           │   └── egress.ts   # startRoomEgress, startTrackEgress (LiveKit Egress)
│           ├── middleware/
│           │   └── rate-limit.ts  # Per-IP rate limiting
│           └── db/schema.ts    # Drizzle schema (rooms, participants, summaryOrders, subscriptions)
│
├── packages/shared/            # Общие типы
├── concepts/                   # HTML-макеты и прототипы
│   ├── zvoon-redesign-v2.html  # Утверждённый концепт v2 (green/navy палитра)
│   └── participant-card-concepts.html  # 5 концептов карточки участника
├── README.md                   # ← этот файл
├── turbo.json
└── package.json
```

## Локальная разработка

```bash
# Установить зависимости
npm install

# API (порт 3500)
npx tsx watch apps/api/src/index.ts

# Или оба через turbo
npm run dev
```

Локальный `.env` для API: `apps/api/.env`
Локальный `.env` для фронта: `apps/web/.env.local`

## Деплой

### Фронтенд (лендинг + звонки)
Автоматически при `git push origin main` → GitHub Pages деплоит `docs/`.

### API
```bash
scp apps/api/src/*.ts root@171.22.31.175:/srv/zvoon-api/src/
scp apps/api/src/routes/*.ts root@171.22.31.175:/srv/zvoon-api/src/routes/
scp apps/api/src/services/*.ts root@171.22.31.175:/srv/zvoon-api/src/services/
ssh root@171.22.31.175 "source /root/.nvm/nvm.sh && pm2 restart zvoon-api"
```

## Целевая аудитория

- **Основная:** команды 3-10 человек (стендапы, ретро, клиентские созвоны)
- **Вторичная:** фрилансеры, консультанты, интервьюеры
- **Рынки:** RU + EN одновременно с первого дня
- **Ценность:** простота входа + AI-саммари дешевле конкурентов (Zoom AI $13/мес, Teams Copilot $30/мес)

## Тарифы

### Бесплатно
- 1 на 1 — без ограничений по времени
- До 5 участников — до 60 минут
- До 10 участников — до 30 минут
- Без AI-саммари
- Без регистрации

### Платный хост ($5/мес)
- До 10 участников
- Без ограничения по времени
- Гости ничего не платят
- AI-саммари в тариф не входит (покупается отдельно)

### AI-кредиты (pay-per-use)
- **$3 за пакет = 120 участнико-минут**
- Включает: расшифровку, саммари, темы, action items, отправку на email

## Безопасность

### Что сделано (2026-03-12)
- **API ключи ротированы** — дефолтные dev-ключи заменены на продовые
- **Webhook signature verification** — подпись LiveKit вебхуков проверяется
- **CORS ограничен** — только zvoon.me, www.zvoon.me (+ salimovsf.github.io для dev)
- **Rate limiting** — 5 комнат/час, 20 токенов/час, 30 email/час на IP
- **Input sanitization** — имена, email, XSS-защита в call.html
- **Crypto slug** — `crypto.randomBytes(8)`, не Math.random()
- **Записи удаляются** — сразу после отправки саммари (finally block), живут 5-20 мин
- **Секреты не в коде** — .env в .gitignore, нет hardcoded ключей
- **HTTPS везде** — SSL сертификаты для api.zvoon.me и livekit.kotik.space
- **Endpoint `/summary/trigger` удалён** — был вектором для абьюза Gemini API

### Архитектура приватности
- **Без email** = чистый звонок, ничего не записывается, ничего не хранится
- **С email** = per-track запись → AI обработка → email → **мгновенное удаление**
- Серверы в Германии (Frankfurt), вне юрисдикции РФ
- In-memory хранение (roomStore) — данные комнаты удаляются через 1 час

### Что НЕ сделано (в теории надо бы)
- **E2E шифрование** — аудиопоток через сервер не зашифрован. Trade-off: с E2E невозможна запись → невозможно саммари. Решение: E2E по умолчанию, отключается когда пользователь сам просит саммари
- **Шифрование записей на диске** — пока записи лежат plaintext 5-20 мин. LUKS/dm-crypt как опция
- **Redis для rate limiting** — сейчас in-memory, сбрасывается при рестарте PM2
- **PIN/пароль для комнат** — сейчас slug единственный "секрет" (8 символов, brute-force нереалистичен с rate limit, но для параноиков можно)
- **Удаление dev домена из CORS** — `salimovsf.github.io` ещё в allowlist
- **Cron для orphaned recordings** — если API крашится до отправки саммари, файлы могут остаться

### Что НЕ НАДО делать
- **SOC 2, пентесты** — overkill для текущей стадии, актуально после PMF
- **Шифрование колонок БД** — БД ещё не подключена
- **SSL pinning** — нет мобильного приложения
- **Bug bounty** — нет пользовательской базы
- **Аудит-логирование** — усложнение без пользы на текущем этапе

## Unit Economics

Маржа ~99% благодаря Gemini Flash. Двухшаговый pipeline (per-track транскрипция → саммари из текста) дешевле чем один вызов с аудио, т.к. индивидуальные треки не превышают 200k token threshold.

| Сценарий | Расход | Выручка | Маржа |
|---|---|---|---|
| 2×30 мин | $0.013 | $3 | 99.6% |
| 5×30 мин | $0.03 | $6 | 99.5% |
| 10×30 мин | $0.06 | $9 | 99.3% |

При масштабе 1000 саммари (10 участников × 60 мин): ~$197 vs $350 при одном вызове.

Постоянные: $60-190/мес. Точка безубыточности: ~20-30 саммари/мес.

## Стек

| Слой | Технология |
|---|---|
| Фронтенд (прод) | Чистый HTML/CSS/JS + LiveKit Client SDK (CDN), палитра v2 (green/navy) |
| Фронтенд (dev) | Next.js 15 + Tailwind 4 + LiveKit React SDK |
| Бэкенд | Hono (TypeScript) |
| WebRTC | LiveKit (self-hosted, Docker) |
| БД (план) | Neon Postgres + Drizzle ORM |
| AI | Gemini 2.5 Flash (двухшаговый: транскрипция per-track → саммари из текста) |
| Email | Resend (HTML, markdown→HTML конвертация) |
| Платежи (план) | Stripe + ЮKassa |
| Хранение (план) | Cloudflare R2 (аудиофайлы) |
| Кэш (план) | Upstash Redis |

## Roadmap

### v0.1 ✅ Прототип (в проде с 2026-03-12)
- Лендинг + аудио-звонок по ссылке
- LiveKit на своём сервере
- Custom domain zvoon.me
- Per-track запись + двухшаговая AI-транскрипция + саммари (Gemini 2.5 Flash)
- Полная транскрипция .txt вложением в email
- Двуязычный интерфейс (RU/EN)
- Rate limiting, индикатор записи, LiveKit webhooks
- Security hardening: ротация ключей, webhook verification, CORS, XSS, crypto slugs
- **Редизайн v2 (2026-03-13):** green/navy палитра, Glass Orbit карточки участников,
  мобильная навигация, горизонтальный pricing scroll, телефоны-трубки на лендинге

### v1 — MVP
- Подключить БД (Neon Postgres + Drizzle) — убрать in-memory хранение
- Оплата (Stripe + ЮKassa, кредиты + подписка)
- Лимиты free tier (время, участники)
- Полировка UI

### v1.5 — видеозвонки
- Toggle аудио/видео, grid layout, screen sharing
- Simulcast (720p/360p/180p)

### v2 — после PMF
- Полноценные аккаунты
- Dashboard с историей саммари
- Live transcription
- Интеграции: Slack, Notion, Telegram

### v3 — масштаб
- Мульти-регион (EU + US + Asia)
- Мобильное приложение
- База знаний команды
