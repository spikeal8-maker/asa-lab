# ASA Lab Learning — единая очередь реализации

**Статус:** канонический delivery-index.  
**Источник подробной интеграции:** `../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md` V1.3.  
**Академическая семантика:** `../ASA_LEARNING_TECHNICAL_SPEC.md`.  
**Пользователи/доступы:** `../ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md`.  
**Execution state:** только `../../execution/current.yaml`.

Этот файл больше не является самостоятельным большим планом V3.1. История V3.1 остаётся в Git. Здесь хранится только единый порядок шести крупных результатов и ссылка на нормативный интеграционный контракт.

## Очередь

| Порядок | Product ID | Результат | Основной scope |
|---|---|---|---|
| 1 | `LRN-COURSE-01` | Первый законченный курс: авторство → публикация → класс → выполнение → exact Submission → review/revision → матрица | Integrated Spec §4 |
| 2 | `LRN-COURSE-02` | Полный assessment: 8 quiz types, server answers/timer, essay/file/manual/rubric, prerequisites, course result, 30×100/export | §5 |
| 3 | `ASA-SELF-01` | Public Knowledge, self-study без fake school/class, bilateral StudentSeat→Account linking | §6 |
| 4 | `ASA-COLLAB-01` | Editor/publisher/teacher/reviewer/mentor/coordinator, invites, help, safe cross-owner delivery, capacity | §7 |
| 5 | `ASA-ORG-01` | Organization/team, groups/bulk, adaptation/copy, summary/detail, ownership/responsibility | §8 |
| 6 | `ASA-EXPERIENCE-01` | Остаток settings/preferences/data/moderation/support/platform operations | §9 |

Обычно выполняется 1→2→3→4→5→6. После E1 владелец может поменять приоритет E3/E4; это не меняет обязательный scope соответствующего этапа. Следующий этап никогда не начинается автоматически.

## Активный ближайший результат — LRN-COURSE-01

Целевой пользовательский сценарий:

```text
Account
→ подключить авторство
→ создать/исправить/опубликовать материал и курс
→ подключить преподавание
→ тот же материал остаётся доступен
→ создать независимый класс
→ подготовить Account learner и StudentSeat
→ назначить exact CourseVersion
→ learner работает в Electronics/3D и сохраняет
→ submit фиксирует exact immutable evidence
→ teacher получает работу в queue/in-app
→ review / changes requested
→ новая Attempt и пересдача
→ selected result одинаков у learner и teacher
→ журнал learner × ActivityRun
```

Обязательные дополнения E1:
- private by default; publish != public;
- whole-class dynamic / named snapshot;
- late join exactly once;
- настоящие UTC/effective settings и индивидуальные overrides;
- три resultMode без искусственного `100/60`;
- append-only correction;
- 30×10 matrix;
- notification categories/master OFF/per-class overrides без изменения академического state;
- batch StudentSeat + одноразовые print-friendly credentials;
- archive/restore class без hard-delete;
- preview as learner без impersonation/writes;
- new draft from historical published version;
- compact teacher-attention block на существующей Home;
- mixed-data/legacy preservation.

### E1 не считается готовым, если
- author-only умеет только создать черновик;
- подключение teaching меняет библиотеку/ID материала;
- курс/Activity заранее создаются SQL вместо принимаемого UI-пути;
- `submitted` нельзя официально проверить;
- preview показывает mutable draft вместо exact Submission;
- пересдача требует ручной БД;
- feedback badge называется официальной оценкой;
- журнал остаётся списком «ученик—работа» вместо матрицы;
- StudentSeat создаются только по одному;
- preview-as-learner пишет progress;
- archive удаляет историю;
- уведомления считаются из unread/count вместо реальных событий.

## Внутренние checkpoints E1

Они не требуют нового owner-ticket:

1. `authoring_converged` — одна библиотека, edit/publish/version recovery/preview.
2. `direct_project_complete` — direct project от назначения до review/revision/result.
3. `class_operations_complete` — Account/Seat, batch credentials, settings, archive/notifications.
4. `course_runtime_complete` — тот же canonical цикл внутри CourseRun, late join, repeated blocks.
5. `gradebook_complete` — 30×10 matrix, exact submission/history/correction.
6. `candidate_ready` — required gate + owner-visible browser evidence.

Частичный checkpoint может быть показан/выпущен только по отдельному решению, но не закрывает весь `LRN-COURSE-01`.

## Проверки без повторного расхода

Во время разработки — focused tests изменённого перехода.  
На готовом кандидате — один обязательный repository/CI gate по действующей policy плюс новые browser journeys.  
После установки того же exact candidate — короткий domain smoke.  
Не повторять весь неизменный test set только потому, что меняется название стадии отчёта.

Fixtures допустимы для synthetic users/load, но не выполняют принимаемое действие вместо человека.

## Исторические этапы

M0, M1, VS и V3.1 не удаляются и не переименовываются задним числом. Их доказанные результаты остаются foundation/ledger evidence. Эта очередь не объявляет старые требования невыполненными и не маркирует новые требования proven.

Трассировка требований и фактические PASS/partial/pending живут в существующем `ASA_LEARNING_REQUIREMENTS_LEDGER.yaml`; при реализации stage исполнитель добавляет к нему mapping текущего stage/evidence, не создавая второй ledger.
