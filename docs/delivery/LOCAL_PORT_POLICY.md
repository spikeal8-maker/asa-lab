# ASA Lab — Local Port Policy

**Статус:** обязательная политика локальной разработки и автоматизированных browser tests.  
**Программа:** [`DEVELOPMENT_PROGRAM_V1.md`](DEVELOPMENT_PROGRAM_V1.md).  
**Причина:** на компьютере владельца порты `5173` и часть стандартных dev-портов используются другими проектами. ASA Lab не должна мешать этим процессам.

## 1. Канонические порты

| Назначение | Переменная | Значение по умолчанию | Bind |
|---|---|---:|---|
| React/Vite development web | `ASA_WEB_PORT` | `4610` | `127.0.0.1` |
| API development server | `ASA_API_PORT` | `4611` | `127.0.0.1` |
| Same-origin automated E2E server | `ASA_E2E_PORT` | `4612` | `127.0.0.1` |
| Резерв для будущего локального preview | `ASA_PREVIEW_PORT` | `4613` | `127.0.0.1` |

Канонические URL:

```text
Web: http://127.0.0.1:4610
API: http://127.0.0.1:4611
E2E: http://127.0.0.1:4612
```

## 2. Запрещённые порты

ASA Lab не использует:

- `3000`;
- `3100`;
- `5173`.

Новые task/PR не могут вернуть эти значения в source, scripts, Playwright, Vite, README или test fixtures.

## 3. Правило занятого порта

Перед запуском dev/E2E процесс обязан проверить порт.

Если порт занят:

1. не завершать процесс по номеру порта;
2. не выполнять `Stop-Process`, `taskkill` или kill неизвестного PID;
3. не выбирать случайный порт молча;
4. вывести:
   - порт;
   - bind address;
   - тип запуска;
   - точный `BLOCKED`;
5. завершиться с ненулевым кодом.

Автоматический выбор случайного порта допускается только внутри unit/integration test, который не публикует URL пользователю. Канонический browser E2E использует `4612`.

## 4. Допустимое переопределение

Порты можно переопределить только явными environment variables:

```powershell
$env:ASA_WEB_PORT = "4610"
$env:ASA_API_PORT = "4611"
$env:ASA_E2E_PORT = "4612"
```

Переопределение:

- не коммитится в source;
- фиксируется в отчёте;
- не меняет канонические defaults;
- не используется для скрытого обхода конфликта теста.

## 5. Vite и API

Development mode:

```text
browser → 127.0.0.1:4610
Vite proxy /api and /health → 127.0.0.1:4611
```

Production-like/local same-origin mode:

```text
browser → 127.0.0.1:4611
API serves built SPA and /api
```

Automated E2E:

```text
browser → 127.0.0.1:4612
one same-origin test server serves SPA + API
```

## 6. PostgreSQL

Порт PostgreSQL не кодируется в приложении и не включается в эту таблицу.

Подключения передаются только через URL:

- `DATABASE_URL` — seed/admin/provisioning tools; never an implicit migration target;
- `MIGRATION_DATABASE_URL` + `MIGRATION_EXPECT_DATABASE` + `MIGRATION_CONFIRM`
  — explicit attested target for `db:migrate --apply`;
- `APP_DATABASE_URL` — runtime API role;
- `TEST_DATABASE_URL` — isolated automated tests.

API не получает `DATABASE_URL`. Test process обязан отказаться работать, если `TEST_DATABASE_URL` указывает на development/production database без явного test marker.

## 7. Сетевые ограничения

До отдельной deployment-задачи:

- все dev/test servers слушают только `127.0.0.1`;
- bind `0.0.0.0` запрещён;
- automatic LAN exposure запрещён;
- firewall/BIOS/WSL/Docker settings не меняются;
- browser E2E не обращается к внешней сети.

## 8. Обязательные проверки

Каждая UI-задача проверяет:

1. defaults равны `4610/4611/4612`;
2. `3000/3100/5173` отсутствуют в first-party runtime configs;
3. occupied-port smoke завершается ошибкой и не останавливает чужой процесс;
4. URLs выведены в console без секретов;
5. Playwright использует `4612`;
6. Vite proxy использует `4611`.

## 9. Отчёт агента

```text
PORTS:
  web: 127.0.0.1:4610
  api: 127.0.0.1:4611
  e2e: 127.0.0.1:4612
  forbidden ports found in runtime config: 0
  occupied-port safety test: PASS
```

Изменение канонических портов требует отдельной правки этого документа, связанных Issues и тестового каталога до изменения product code.

Electronics Project Slice (`TASK-ELECTRONICS-SLICE-001`) не вводит новых портов: редактор схемы работает в том же Web-приложении на `4610`, API на `4611`, browser E2E на `4612`.
