# Zvoon — аудиозвонки по ссылке с ИИ-сводкой

> Домен: **zvoon.me** | API: **api.zvoon.me**

## Концепция

Самый простой способ позвонить и получить сводку. Без регистрации, без экосистемы, pay-per-use.

- Пользователь открывает сайт → создаёт звонок → получает ссылку
- Участники заходят по ссылке, вводят имя — и говорят
- После звонка можно заказать AI-расшифровку и сводку за кредиты
- Результат приходит на email

## Текущий статус (v0.1 — прототип)

### Что работает
- Лендинг на zvoon.me (GitHub Pages, custom domain, SSL)
- Создание аудио-комнаты по кнопке "Создать звонок"
- Вход по ссылке (гость вводит имя → присоединяется)
- Аудио-звонок через LiveKit (WebRTC SFU)
- Mute/unmute, таймер, список участников, кнопка "Пригласить"
- Экран запроса микрофона с инструкциями для каждого браузера
- Режим "без микрофона" (listen-only)
- RU интерфейс

### Что НЕ готово
- AI-сводка (Gemini Flash pipeline)
- Запись per-track (LiveKit Egress настроен, но не подключен к flow)
- Платежи (Stripe + ЮKassa)
- Полноценный i18n (EN)
- Лимиты free tier (время, участники)
- БД (Neon Postgres + Drizzle) — пока всё stateless

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
- API Key: `zvoon_dev_key`
- API Secret: `zvoon_dev_secret_change_me_in_prod` (**сменить перед продом!**)
- TURN: включён (domain: livekit.kotik.space, TLS 5349, UDP 3478)

### API конфигурация

- Путь: `/srv/zvoon-api/`
- `.env`: LIVEKIT_API_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, PORT=3510
- CORS: zvoon.me, www.zvoon.me, salimovsf.github.io, localhost

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
│           ├── index.ts        # Hono app + CORS
│           ├── routes/rooms.ts # POST /rooms, POST /rooms/:slug/token
│           ├── services/livekit.ts  # createRoom, generateToken
│           └── db/schema.ts    # Drizzle schema (rooms, participants, etc.)
│
├── packages/shared/            # Общие типы
├── concepts/                   # HTML-макеты лендинга (5 вариантов)
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
- **Ценность:** простота входа + AI-сводка дешевле конкурентов (Zoom AI $13/мес, Teams Copilot $30/мес)

## Тарифы

### Бесплатно
- 1 на 1 — без ограничений по времени
- До 5 участников — до 60 минут
- До 10 участников — до 30 минут
- Без AI-сводки
- Без регистрации

### Платный хост ($5/мес)
- До 10 участников
- Без ограничения по времени
- Гости ничего не платят
- AI-сводка в тариф не входит (покупается отдельно)

### AI-кредиты (pay-per-use)
- **$3 за пакет = 120 участнико-минут**
- Включает: расшифровку, сводку, темы, action items, отправку на email

## Unit Economics

Маржа ~99% благодаря Gemini Flash (один вызов = транскрипция + сводка).

| Сценарий | Расход | Выручка | Маржа |
|---|---|---|---|
| 2×30 мин | $0.013 | $3 | 99.6% |
| 5×30 мин | $0.03 | $6 | 99.5% |
| 10×30 мин | $0.06 | $9 | 99.3% |

Постоянные: $60-190/мес. Точка безубыточности: ~20-30 сводок/мес.

## Стек

| Слой | Технология |
|---|---|
| Фронтенд (прод) | Чистый HTML/CSS/JS + LiveKit Client SDK (CDN) |
| Фронтенд (dev) | Next.js 15 + Tailwind 4 + LiveKit React SDK |
| Бэкенд | Hono (TypeScript) |
| WebRTC | LiveKit (self-hosted, Docker) |
| БД (план) | Neon Postgres + Drizzle ORM |
| AI (план) | Gemini 2.0 Flash (транскрипция + сводка в одном вызове) |
| Email (план) | Resend |
| Платежи (план) | Stripe + ЮKassa |
| Хранение (план) | Cloudflare R2 (аудиофайлы) |
| Кэш (план) | Upstash Redis |

## Roadmap

### v0.1 ✅ Прототип (текущий)
- Лендинг + аудио-звонок по ссылке
- LiveKit на своём сервере
- Custom domain zvoon.me

### v1 — MVP
- Неделя 2: запись per-track + Gemini Flash (транскрипция + сводка)
- Неделя 3: оплата (Stripe + ЮKassa, кредиты + подписка) + email
- Неделя 4: i18n EN + полировка

### v1.5 — видеозвонки
- Toggle аудио/видео, grid layout, screen sharing
- Simulcast (720p/360p/180p)

### v2 — после PMF
- Полноценные аккаунты
- Dashboard с историей сводок
- Live transcription
- Интеграции: Slack, Notion, Telegram

### v3 — масштаб
- Мульти-регион (EU + US + Asia)
- Мобильное приложение
- База знаний команды
