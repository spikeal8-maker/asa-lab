# Capacity model, SLO и эксплуатационные цели ASA Lab

**Статус:** принято для проектирования; значения подтверждаются нагрузочными тестами перед каждым уровнем эксплуатации.

## 1. Термины

- **Registered users** — все созданные аккаунты и StudentSeat.
- **MAU** — пользователи, активные за месяц.
- **CCU** — одновременные активные пользователи.
- **Active editor** — открытый предметный редактор с локальными изменениями.
- **RPS** — запросы в секунду на API.
- **Job** — серверная компиляция, автопроверка, рендер, экспорт или симуляция.
- **Lesson window** — период массового входа в начале урока и массовой сдачи в конце.

## 2. Базовый школьный сценарий

Расчётная нагрузка:

- 1 800–3 000 учеников в организации;
- 100–200 педагогов;
- 10 классов одновременно;
- 350 учеников в редакторе;
- 10 учителей в dashboard;
- 350 realtime-соединений;
- 35 batched save requests/s при интервале 10 секунд;
- 12–20 compile/autograder jobs/s в коротком burst;
- 350 открытий проектов в течение первых 2–3 минут урока.

Цель L1 задаётся с запасом: **500 CCU и 300 API RPS burst**.

## 3. Почему нельзя сохранять полный snapshot на каждое действие

При среднем проекте 200 KB:

| CCU | Интервал | Full snapshot writes/s | Payload throughput |
|---:|---:|---:|---:|
| 350 | 10 s | 35 | 7 MB/s |
| 1 800 | 10 s | 180 | 36 MB/s |
| 10 000 | 10 s | 1 000 | 200 MB/s |
| 100 000 | 10 s | 10 000 | 2 GB/s |

Поэтому редактор использует operation batches размером обычно в единицы KB и периодические immutable checkpoints.

## 4. Capacity tiers

| Tier | Scope | CCU | API burst RPS | Saves/s target | Realtime | Concurrent jobs | Project versions/year |
|---|---|---:|---:|---:|---:|---:|---:|
| L0 | dev/demo | 50 | 30 | 5 | 50 | 5 | 100k |
| L1 | large school | 500 | 300 | 75 | 500 | 50 | 5m |
| L2 | school network | 10k | 3k | 1k | 10k | 500 | 100m |
| L3 | region | 50k | 15k | 5k | 50k | 2k | 500m |
| L4 | national | 200k | 50k | 20k | 200k | 10k | 2b |

`Project versions/year` — верхняя planning envelope. Фактическая retention и checkpoint policy определяются модулем и тарифом.

## 5. SLO школьного пилота

| Service indicator | Target |
|---|---:|
| Availability during agreed lesson hours | 99.9% |
| Monthly overall availability | 99.5% |
| API read P95 | ≤ 400 ms |
| API write P95 | ≤ 700 ms |
| Login P95 | ≤ 2 s |
| Project metadata save P95 | ≤ 700 ms |
| Durable checkpoint P95, typical project | ≤ 1.5 s |
| Save error rate | < 0.1% |
| Cross-tenant authorization errors | 0 accepted incidents |
| Job queue oldest age during normal load | < 30 s |

## 6. Regional/national target

| Service indicator | Target |
|---|---:|
| Control Plane availability | 99.95% |
| Project save availability | 99.99% |
| API read P95 | ≤ 300 ms |
| API write P95 | ≤ 500 ms |
| Realtime delivery P95 | ≤ 1 s |
| Queue admission P95 | ≤ 300 ms |
| Critical audit event durability | 99.999% target |

SLO формирует error budget и release policy. Это не обещание производительности непроверенной инфраструктуры.

## 7. RPO/RTO

| Profile | RPO | RTO |
|---|---:|---:|
| Local school pilot | ≤ 24 h disaster; ≤ 15 min with PITR | ≤ 8 h |
| Cloud school production | ≤ 5 min | ≤ 2 h |
| Regional/national | ≤ 1 min metadata; object replication отдельно | ≤ 60 min |

После сообщения `Сохранено на сервере` отказ одного API/worker не должен терять подтверждённую версию.

## 8. Нагрузочные профили

### 8.1. Начало урока

- 500 входов за 120 секунд;
- 500 dashboard reads;
- 350 project opens;
- 350 object downloads;
- 350 WebSocket connections;
- 10 teacher roster pages.

### 8.2. Активное редактирование

- 350 local editors;
- batched operations каждые 5–15 секунд с jitter;
- периодические checkpoints;
- 5% reconnect rate;
- 2% concurrent two-tab conflicts;
- 10% weak-network simulation.

### 8.3. Конец урока

- 350 final sync;
- 350 submission creates;
- 200 autograder jobs за 60 секунд;
- 10 teacher queue refreshes;
- notification fanout.

### 8.4. Failure injection

- остановка одной API replica;
- restart Redis;
- задержка object storage на 2 секунды;
- остановка worker pool;
- duplicate outbox delivery;
- database failover;
- отказ realtime gateway;
- временная ошибка OIDC.

## 9. Autoscaling signals

### API

- request rate;
- P95 latency;
- CPU saturation;
- event loop lag;
- DB pool wait time.

### Realtime

- active connections;
- messages/s;
- outbound buffer;
- reconnect storm rate.

### Workers

- queue depth by type;
- oldest job age;
- expected work seconds;
- CPU/memory/GPU requirement;
- timeout rate.

### Database

PostgreSQL не масштабируется как stateless API. Требуются connection pooler, query budgets, slow-query analysis, indexes, partitioning горячих журналов, read replicas для отчётов, controlled vertical scaling и TenantPlacement для крупных организаций.

## 10. Capacity exit gates

Переход на следующий tier разрешён, когда:

1. профиль предыдущего tier выдержан с 2x safety factor;
2. error budget не исчерпан;
3. backup restore проверен;
4. database failover протестирован;
5. queue backlog восстанавливается после 15 минут worker outage;
6. нет cross-tenant утечек;
7. autosave не теряет операции при reconnect;
8. стоимость на active user измерена;
9. сформирован прогноз storage growth;
10. назначены владельцы on-call и runbooks.
