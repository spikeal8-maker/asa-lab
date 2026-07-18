# Принятые архитектурные решения ASA Lab

Все решения имеют статус **принято** с 17 июля 2026 года. Изменение решения требует новой ADR, а не скрытого редактирования причины.

## ADR-0001: модульный монолит Control Plane и отдельный Compute Plane

### Контекст

Платформа начинает работу в одной крупной школе, но должна иметь путь к федеральному масштабу. Ранняя микросервисная архитектура увеличивает число deployment units, сетевых отказов и распределённых транзакций. При этом симуляция, компиляция и 3D-обработка имеют иной профиль нагрузки и угроз.

### Решение

Classroom, Projects, Assignments, Billing и административные функции реализуются как строгий модульный монолит. Компиляция, автопроверка, серверная симуляция, рендер и экспорт выполняются отдельными workers с durable job contract.

### Последствия

Плюсы:

- быстрые транзакционные use cases;
- меньше операционной сложности;
- независимое масштабирование тяжёлых задач;
- готовые seams для последующего выделения сервисов.

Цена решения:

- внутренние границы должны проверяться автоматически;
- один API artifact может стать крупным;
- независимый deployment core-context появится только при реальной необходимости.

### Условия пересмотра

Измеримый bottleneck, отдельная команда, независимый security/placement boundary, другой runtime или независимый release cadence.

---

## ADR-0002: shared-schema multitenancy с TenantPlacement

### Решение

P0/P1 использует shared PostgreSQL schema с обязательным `tenant_id`, application authorization, composite tenant-lineage foreign keys и RLS defense-in-depth. `TenantPlacement` позволяет позднее перевести tenant в dedicated database, dedicated region или on-premise deployment.

### Не выбрано

- schema per school — дорого управлять тысячами схем;
- database per school с первого дня — высокая стоимость и сложные массовые миграции;
- отсутствие RLS — недостаточная глубина защиты;
- доверие `tenantId` из HTTP body — неприемлемая security boundary.

### Последствия

Каждая tenant-owned migration и query проходит tenant lint, cross-tenant negative tests и database constraints. Маршрутизация БД находится в infrastructure layer и не меняет domain/application API.

---

## ADR-0003: Classroom Core и версионированный Module SDK

### Решение

Все предметы подключаются через Module Manifest и универсальные `Project`/`ProjectVersion` contracts. Classroom Core не импортирует предметные типы.

### Обязательный контракт модуля

```text
moduleKey
moduleVersion
projectSchemaVersions
capabilities
validator
migrator
diffProvider
previewProvider
autograderProvider
exportProviders
workerProfiles
safeModeCompatibility
analyticsAllowlist
```

### Последствия

- электроника, шахматы, 3D и робототехника используют один образовательный workflow;
- модуль обязан иметь schema, migrator, preview и validation;
- произвольный backend plugin без admission, подписи и sandbox запрещён;
- Classroom Core не содержит предметных `switch/if`.

---

## ADR-0004: неизменяемые ProjectVersion и Submission

### Решение

Сохранённый checkpoint и сданная версия не редактируются. Изменение создаёт новую `ProjectVersion`. `Submission` ссылается на точную версию, module version и engine environment.

### Причина

Педагогическая проверка, воспроизводимость, аудит, сравнение попыток и безопасные миграции невозможны при скрытом изменении истории.

### Последствия

- нужны retention policies;
- payload получает SHA-256 digest;
- крупные payload хранятся в object storage;
- UI должен показывать версии и diff;
- удаление выполняется регламентированным workflow, а не обычным UPDATE.

---

## ADR-0005: contract-first и schema-first

### Решение

HTTP API описывается OpenAPI 3.1.x, module/project documents — JSON Schema 2020-12, события — versioned schemas. Реализация и тесты проверяются по контрактам.

### Причина

AI-разработка без формальных контрактов быстро создаёт несовместимые frontend, backend и worker реализации.

### Последствия

- contract diff является release gate;
- несовместимое изменение требует major/schema version bump;
- сначала меняется контракт и acceptance fixture, затем код;
- generated clients и validators воспроизводимы;
- миграция и rollback/forward-fix входят в PR.

---

## ADR-0006: Rust/WASM для детерминированного симуляционного ядра

### Решение

Netlist, численное ядро и приборный runtime реализуются в Rust. Один core собирается в WebAssembly для браузера и в native worker binary для серверной автопроверки.

### Причина

Нужны производительность, memory safety, детерминизм и минимальное расхождение поведения browser/server.

### Последствия

- TypeScript отвечает за UI и document orchestration;
- FFI API остаётся маленьким и версионируемым;
- обязательны одинаковые golden tests в native и WASM;
- результаты floating-point сравниваются с допусками;
- версия движка и execution manifest сохраняются вместе с результатом;
- серверная симуляция не обязана запускаться для каждого пользовательского действия.

---

## ADR-0007: entitlement-модель вместо paid-флагов

### Решение

Платные и договорные возможности разрешаются через `EntitlementService` и `QuotaService`. Тарифы, usage ledger и provider adapters принадлежат отдельному bounded context.

### Причина

Планы меняются, школы получают индивидуальные условия, модули продаются отдельно, возможны гранты, региональные договоры и on-premise лицензии. Boolean-поля быстро превращаются в неуправляемую матрицу.

### Последствия

Каждая capability имеет key, scope, источник grant, период действия и quota policy. Истечение entitlement не удаляет данные. Предметный модуль не знает тариф и платёжного провайдера.

---

## ADR-0008: локальный operation journal и серверные checkpoints

### Решение

Редактор пишет операции в IndexedDB, объединяет их в idempotent batches и периодически создаёт immutable server checkpoint.

### Причина

Школьная сеть нестабильна, а полный snapshot на каждое действие создаёт лишнюю нагрузку и повышает риск потери работы при reconnect.

### Последствия

- UI различает local и server save;
- operation batch имеет client sequence и idempotency key;
- conflict resolution является частью module contract;
- перед Submission выполняется final sync и checkpoint;
- offline queue очищается только после подтверждения сервера.

---

## ADR-0009: transactional outbox для критических событий

### Решение

Бизнес-изменение и запись события в outbox выполняются в одной PostgreSQL-транзакции. Доставка — at least once, обработчики идемпотентны.

### Причина

Прямая публикация после commit может потерять событие между успешной транзакцией и сбоем процесса.

### Последствия

- событие имеет `eventId`, version, tenant, aggregate, occurredAt и payload digest;
- consumer хранит inbox/idempotency record;
- порядок гарантируется только там, где он формально определён;
- аналитика и уведомления не блокируют основную транзакцию.

---

## ADR-0010: российский primary data plane

### Решение

Персональные данные российских граждан собираются и хранятся в российском или локальном primary data plane. Учебный процесс не зависит от зарубежного SaaS. Возможная трансграничная передача рассматривается отдельным юридическим и техническим процессом.

### Последствия

- Data Inventory фиксирует место хранения каждого класса данных;
- внешняя аналитика, почта и CDN отключаемы без остановки урока;
- production backup и object storage размещаются в допустимом контуре;
- on-premise profile остаётся поддерживаемым вариантом;
- техническое решение не заменяет юридические основания, локальные акты и модель угроз.

---

## Порядок принятия новой ADR

Новая ADR содержит:

1. проблему и наблюдаемые данные;
2. варианты;
3. принятое решение;
4. положительные и отрицательные последствия;
5. migration и rollback plan;
6. security, tenant и cost impact;
7. условия пересмотра;
8. владельца решения.

ADR обязательна при изменении доменной границы, базы данных как tenancy model, основного runtime, протокола публичного API, формата проектов, security boundary, коммерческой модели или стратегии размещения.
