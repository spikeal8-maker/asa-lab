# Инвентаризация сохраняемых данных ASA Lab

Документ фиксирует границы резервного копирования. Изменяемое состояние задачи
находится только в [`current.yaml`](current.yaml).

## PostgreSQL — единственное активное серверное хранилище пользовательских данных

В текущем runtime нет подключённого S3/R2 и нет каталога пользовательских
uploads на диске. Карта проекта отмечает Object Storage как `planned`.

В PostgreSQL находятся:

- учётные записи, профили, роли, sessions и audit events;
- workspaces, классы, курсы, задания и результаты;
- проекты, drafts, documents, versions и checkpoints;
- `profiles.avatar_data_url` — аватары аккаунтов;
- `project_snapshots.image` — PNG/WebP превью проектов;
- `teacher_assignments.sample_bytes` — основное изображение задания;
- `teacher_assignment_images.bytes` — дополнительные изображения;
- versioned course media (`course_version_media.sample_bytes`).

Следствие: PostgreSQL custom dump с blobs и его проверенное восстановление
покрывают серверные данные и загруженные пользователями изображения.

## Git и release artifact

Статические ресурсы продукта входят в Git и затем в рекурсивный release
manifest. В частности, защищённые owner assets находятся в:

- `apps/web/public/assets/electronics/owner-supplied/`;
- `apps/web/public/assets/electronics/owner-audit/`;
- component database и owner catalog рядом с ними.

Git bundle плюс проверенный release artifact сохраняют эти файлы байт-в-байт.

## Только клиентские настройки

Размер панелей редактора Arduino и некоторые параметры интерфейса хранятся в
браузерном `localStorage`. Это удобства конкретного браузера, не проектные
документы и не источник истины. Их потеря не удаляет работу пользователя.

## Не являются хранилищем продукта

- `dist`, Nx cache, `node_modules` и Playwright reports воспроизводимы;
- `.env.local` содержит конфигурацию/секреты и сохраняется только в закрытом
  recovery-архиве, никогда в Git или release artifact;
- FRP, DNS, Cloudflare и Selectel маршрутизируют трафик, но не хранят проекты
  ASA Lab.

## Минимальный комплект восстановления

1. Проверенный PostgreSQL custom dump и globals.
2. Git bundle основной и обнаруженных рабочих копий плюс их patches.
3. Неизменяемые candidate и rollback manifests/artifacts.
4. Закрытая конфигурация окружения.
5. AES-зашифрованная независимая копия пунктов 1–4 и отдельный recovery key.

