# Shizuka Music Bot

Музыкальный Discord-бот на `discord.js` + `lavalink-client` + PostgreSQL.

## Возможности

- Воспроизведение музыки из SoundCloud, Spotify, YouTube, YouTube Music, Yandex Music.
- Очередь, пропуск, пауза/продолжение, повтор, перемешивание, перемотка, громкость.
- DJ-ограничения и голосование за пропуск.
- Панель управления плеером на Discord Components.
- Логи серверов и диагностические команды.

## Требования

- Node.js 18+ (рекомендуется 20+)
- Сервер Lavalink
- PostgreSQL (опционально, но рекомендуется для полной функциональности)

## Установка

1. Установите зависимости:

```bash
npm install
```

2. Создайте `.env` из шаблона:

```bash
cp .env.example .env
```

Для Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Заполните обязательные переменные в `.env`:

- `TOKEN`
- `OWNER_IDS`
- `DATABASE_URL` (если используется)
- `LAVALINK_HOST`
- `LAVALINK_PORT`
- `LAVALINK_PASSWORD`

4. Запустите бота:

```bash
npm start
```

## Конфигурация

Основные настройки находятся в `config.js`, а чувствительные данные должны передаваться через переменные окружения.

## Лицензия

Проект распространяется по лицензии MIT. Подробнее в [LICENSE](./LICENSE).
