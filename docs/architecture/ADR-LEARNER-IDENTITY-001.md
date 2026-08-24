# ADR-LEARNER-IDENTITY-001: school-scoped stable learner mapping

**Статус:** accepted  
**Дата:** 2026-08-24  
**Владелец:** ASA Lab owner  
**Task:** `LRN-M0-002`  
**Заменяет:** не применимо

## Контекст

ASA Learning требует один immutable learner key, который переживает смену
способа входа, переход между классами одной школы и связывание email-free
StudentSeat с Account. CURRENT хранит разные части учебной истории на разных
ключах:

- `classroom_student_seats.id` владеет Attempt и Gradebook lineage;
- `principals.id` владеет Project и авторскими действиями;
- `accounts.id` агрегирует только активные связанные места;
- classroom membership задаёт доступ, а не долговременного ученика.

CURRENT evidence полностью перечислена в
`docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md`. Ключевые
физические доказательства:

- `migrations/0010_account_identity_sessions_v2.sql` создаёт глобальные
  `accounts` и отдельный account Principal, без school lineage;
- `migrations/0021_classroom_roster_studentseat.sql` задаёт `StudentSeat` с
  `tenant_id`, `classroom_id` и lifecycle `issued|active|suspended|removed`;
- `migrations/0026_student_seat_principal.sql` создаёт Principal лениво и строго
  для одного seat; account Principal и seat Principal взаимоисключающи;
- `migrations/0050_account_learners.sql` разрешает одному Account иметь по
  одному seat в нескольких классах и может не создать membership, если Account
  не имеет legacy user в tenant класса;
- `migrations/0077_learning_assessment_foundation.sql` и
  `migrations/0083_quiz_engine.sql` записывают `learning_attempts.seat_id` и
  `gradebook_entries.seat_id`;
- `migrations/0084_grade_scales_and_learner_results.sql` показывает Account
  историю как union только активных seat, поэтому removal/suspension может
  скрыть, но не удалить исторические строки.

Ни одна CURRENT сущность не является одновременно school-scoped,
class-independent, доступной email-free ученику и неизменной при появлении
Account.

## Рассмотренные варианты

### Вариант A — переиспользовать существующую сущность как stable key

Кандидаты: `accounts.id`, `classroom_student_seats.id`, `principals.id` или
classroom seat/membership identity.

Преимущество — отсутствие новой mapping table. Недостаток — каждый кандидат
нарушает минимум один обязательный identity invariant и создаёт orphan либо
duplicate history при linking/rejoin/multi-class сценариях.

### Вариант B — минимальный learning-owned mapping layer

Создать в будущей, отдельно разрешённой migration school-scoped logical
`LearnerIdentity` и ссылки на существующие Account/StudentSeat subjects. Это не
новый authentication core: вход, сессии, Principal, Classroom и Project Core
остаются существующими системами. Mapping layer отвечает только за устойчивое
владение учебной историей и разрешение auth/access subjects в один learner key.

Цена — additive schema, backfill, duplicate reconciliation и новые RLS/
authorization проверки. Преимущество — один ключ сохраняется при linking,
выходе из класса, повторном вступлении и нескольких классах одной школы.

## Обязательная оценка CURRENT кандидатов

Сокращения в таблице: `Account` = `accounts.id`; `Seat` =
`classroom_student_seats.id`; `Principal` = `principals.id`; `Membership` =
`classroom_memberships` вместе с seat как class participation.

| Критерий | Account | StudentSeat | Principal | Classroom seat/membership |
|---|---|---|---|---|
| Стабильность ID во времени | UUID стабилен, пока Account существует, но отсутствует у email-free ученика и Account lifecycle относится к входу | UUID строки стабилен, но строка является местом одного класса; новый seat даёт новый ID | UUID стабилен для одного subject, но seat Principal создаётся лениво, а account и seat Principals не объединяются | Membership/seat стабилен только внутри конкретной class participation |
| School tenant lineage | Нет собственного school/tenant FK; lineage идёт через workspace/link | Есть `tenant_id` и classroom, school выводится через classroom | Нет собственного school FK; account Principal может иметь несколько workspace, seat Principal выводит school через seat | Есть tenant/classroom lineage; school выводится через classroom |
| Class scope vs school scope | Глобальнее школы и класса | Строго class-scoped | Account Principal глобален; seat Principal class-scoped | Строго class-scoped |
| StudentSeat → Account linking | Может быть auth link, но не существует до регистрации и не может владеть прежней email-free историей без remap | `account_id` nullable; CURRENT account join создаёт/возвращает account-owned seat, но не определяет merge старого email-free seat | CURRENT сохраняет два разных Principal: `kind=account` и `kind=student_seat` | Membership может отсутствовать для cross-tenant Account; не является обязательным link record |
| Один Account в нескольких классах | Один Account, но не различает school/class participation | По одному отдельному seat на каждый класс | Один account Principal плюс отдельный Principal каждого seat | Отдельная membership/seat на класс |
| Один Account в нескольких школах | Один глобальный ID смешал бы независимые school histories и RLS scopes | Отдельные seats сохраняют school scope, но не дают один learner в классах одной школы | Account Principal смешивает schools; seat Principal дробит learner по классам | Отдельные class rows; нет school-level logical learner |
| Suspension/removal seat | Account остаётся активным и не выражает classroom suspension | Seat остаётся FK owner истории, но current account/learner reads фильтруют `status=active` | Principal остаётся, но resolver для suspended/removed seat не выдаёт доступ; это actor/owner, не learner lifecycle | Membership/seat status управляет доступом; его нельзя использовать как состояние всей school identity |
| Выход из класса | Account не фиксирует, из какого класса вышли | Seat может стать removed и перестать читаться | Seat Principal остаётся привязан к вышедшему seat | Class participation заканчивается; school learner должен остаться |
| Повторное вступление | Account join переактивирует найденный account seat в том же классе, но email-free rejoin не имеет общего account key | Может переиспользоваться только если найден тот же seat; новый seat создаёт новую историю | Новый seat создаёт новый seat Principal | Новая membership/seat может дублировать прежнего school learner |
| Historical Attempt/Submission/Result ownership | CURRENT rows не имеют `account_id`; реконструкция только через mutable seat link | CURRENT Attempt/Gradebook явно ссылаются на seat; это надёжная source evidence, но неправильный cross-class owner key | Result lineage не ссылается на learner Principal | Membership не является FK owner; seat является current owner только class-local history |
| Project Principal ownership | Account Principal владеет личными проектами, но email-free проекты принадлежат seat Principal | Seat сам не владеет Project; связанный seat Principal владеет | Правильный Project Core owner/actor key, но account и seat ownership различаются и не образуют одного learner | Membership не владеет Project; seat participation может указывать на Project другого allowed Principal |
| Existing historical rows can reference key | Нет без backfill/update либо derived mapping | Да для current Attempt/Gradebook, но CourseEnrollment/Participation across classes будут раздроблены | Projects уже ссылаются; Attempts/Gradebook не ссылаются | Только class-local rows; универсального FK key нет |
| Orphan/duplicate history risk | Email-free rows orphan; cross-school merge risk | Duplicate learner per class/rejoin; removed seats disappear from active reads | Duplicate account/seat Principals for one human; lazy missing Principal rows | Duplicate per class and optional Account membership; lifecycle hides history |
| RLS implications | Global Account cannot itself establish school authorization | Tenant RLS работает для seat, но school/class authorization всё равно нужно выводить | Principal не несёт tenant; authorization требует внешнего lineage | Tenant/class authorization пригодна для access, но не для school-wide identity |
| Migration/backfill implications | Нельзя безопасно присвоить email-free rows; cross-school Account must split | Every historical seat can seed/map deterministically, but merging same learner needs verified evidence | Must preserve Project owner and map both principal kinds; never rewrite ownership blindly | Participation rows are mapping evidence, not safe learner key |

## Решение

Выбран **вариант B: существующих сущностей недостаточно; требуется минимальный
learning-owned mapping layer**.

### Stable learner key

Точный долговременный ключ: **`learner_identities.id`**, immutable UUID будущей
school-scoped logical learner row.

Одна logical identity принадлежит ровно одной паре `(tenant_id, school_id)`.
Один Account:

- переиспользует одну `learner_identities.id` во всех классах одной школы;
- получает отдельную `learner_identities.id` в каждой другой школе;
- не объединяет academic history разных школ автоматически.

StudentSeat, Account и Principal не становятся альтернативными owner keys. Они
остаются subjects/actors и связываются с logical identity.

### Минимальный будущий mapping layer

Физические имена ниже фиксируют responsibility, но DDL этой task не является:

```text
learner_identities
  id                    immutable stable learner key
  tenant_id, school_id  immutable school lineage
  display identity
  state                 active/inactive; never deletes history

learner_identity_links
  learner_identity_id
  link_kind             student_seat | account
  seat_id XOR account_id
  validity/audit metadata
```

Будущая migration execution-spec MUST определить exact FK, CHECK, unique/partial
indexes, RLS, link audit, concurrency and reconciliation. Она обязана минимум:

- обеспечить один learner link на каждый seat;
- запретить две active identities для одного verified Account в одной школе без
  explicit reconciliation;
- сохранить expired/removed links для исторического разрешения;
- не использовать display name, login handle или email как merge key;
- не менять `principals.id` и Project ownership в рамках identity backfill.

### Кто владеет учебной историей после linking

Если ученик сегодня входит через StudentSeat, а завтра связывает обычный
Account, неизменным владельцем остаётся тот же **`learner_identities.id`**:

| Объект | Immutable/stable owner |
|---|---|
| `CourseEnrollment` | `learner_identities.id` через обязательный `learner_id` |
| `ActivityParticipation` | тот же `learner_identities.id` через обязательный `learner_id` |
| `Attempt` | тот же `learner_identities.id`, напрямую или через immutable Participation lineage |
| `Submission` | тот же `learner_identities.id` через immutable Attempt lineage; linking не переписывает evidence |
| `AssessmentResultRevision` | тот же `learner_identities.id` через immutable Attempt lineage |
| Historical Gradebook result | тот же `learner_identities.id`; selection/projection может перестроиться, evidence не меняется |

Linking добавляет `account` link к существующей logical identity. Он не создаёт
новый learner, Attempt, Submission, Result или grade. Existing `seat_id` remains
as provenance/access evidence during compatibility period.

## Почему вариант A отклонён

### Account отклонён

Он отсутствует у email-free learner, не имеет school lineage и может состоять в
нескольких школах. Account suspension/closure является auth lifecycle и не
может удалять либо менять владельца academic history.

### StudentSeat отклонён

Он является местом одного класса. Один Account получает несколько seat, а
выход/rejoin может создать новую строку. Seat годится как immutable provenance
для CURRENT rows, но не как school-wide learner key.

### Principal отклонён

Principal — actor/Project owner union. Account Principal и seat Principal по
CHECK constraint взаимоисключающи и CURRENT не содержит merge/mapping между
ними. Выбор Principal либо orphan-ит email-free/account историю, либо дробит
одного learner по seat. Project ownership должен сохраниться независимо от
learning identity.

### Classroom seat/membership отклонён

Membership и seat выражают class access/participation. Membership может вообще
не создаться для Account из другого tenant, а email-free learner membership не
имеет. Уход из класса завершает participation, но не school learner identity.

## Linking, lifecycle и historical ownership

1. **Seat first, Account later.** Resolve seat to existing learner; atomically
   attach verified Account link to the same learner. Never allocate a second
   learner merely because auth mode changed.
2. **Several classes in one school.** Every verified seat of the same Account
   resolves to one school learner. Ambiguous email-free seats require explicit
   reconciliation; labels are not evidence.
3. **Several schools.** Resolve/create one learner per school. The same Account
   is an auth link to multiple school identities; cross-school academic merge is
   forbidden by default.
4. **Suspension/removal/leave.** Disable access link or participation, not the
   learner key and not historical rows.
5. **Rejoin.** Reuse the learner key when a verified active/expired link proves
   continuity. Otherwise create a new identity and flag possible duplicate;
   never guess.
6. **Project ownership.** Preserve CURRENT `projects.owner_principal_id` and
   immutable `project_versions`. Learning Participation/Attempt links a project
   artifact to learner identity without transferring the personal project.
7. **Historical rows.** Existing Attempt, Submission, AssessmentResult and
   Gradebook evidence remains unchanged. Additive mapping/projection supplies
   stable learner ownership; no fabricated Submission or retroactive grade.

## Migration and backfill consequences

No migration is created by this ADR. A future separately activated migration
must be additive and dry-run first:

1. create school-scoped identity and link tables with exact constraints/RLS;
2. seed one identity per historical seat as a lossless default;
3. map each current `seat_id` deterministically to that identity;
4. consolidate multiple seats only with verified same Account and same school;
5. keep different-school identities separate;
6. emit ambiguity/duplicate/orphan reports instead of guessing;
7. add stable learner FK to new canonical runtime before cutover;
8. retain current seat FKs as provenance/compatibility until equivalence is
   proven;
9. map Project Principal ownership separately and never rewrite it as identity;
10. do not fabricate missing historical Attempt/Submission/Result rows.

Backfill must specifically report:

- email-free seats with no Principal;
- multiple seats for one Account within one school;
- Account-linked seats in different schools;
- removed/suspended seats with historical attempts/results;
- projects owned by account Principal versus seat Principal;
- learning rows whose composite tenant/class/school lineage is inconsistent.

## RLS and security consequences

- Mapping rows are tenant-owned and school-scoped. RLS MUST check server-derived
  `tenant_id`; application authorization MUST additionally check school/resource
  scope. Client-supplied tenant, school or learner ID is never authoritative.
- Account-link resolution may traverse schools only for the authenticated
  Account and returns separate school-scoped learner IDs.
- Seat-link resolution requires a valid server-resolved seat session and
  classroom lineage; suspended/removed seats cannot gain current access.
- Teacher access requires current role/capability in the target school/class;
  knowing learner UUID is insufficient.
- `SECURITY DEFINER` resolvers require fixed `search_path`, revoked PUBLIC
  access, explicit caller/resource checks and cross-school negative tests.
- Link/merge/reconciliation operations require durable audit events and
  idempotency; silent reassignment of child academic history is forbidden.
- Answer keys, feedback release and Project visibility remain governed by their
  existing contexts; learner mapping grants no extra content capability.

## Compatibility and data consequences

CURRENT readers continue to use seat-owned rows until an authorized migration
and dual-read comparison prove the new resolver. Mapping is additive, so an ADR
rollback does not mutate existing evidence. Future cutover is forward-fix:
disable new resolver writes, preserve mappings/audit, and return to current
seat-based readers without deleting identities.

## Consequences

### Positive

- exact stable ownership across StudentSeat → Account linking;
- one learner across classes in a school without merging different schools;
- existing Account, Principal, Classroom and Project Core remain reusable;
- immutable CURRENT evidence is preserved;
- RLS gets explicit school tenant lineage rather than inferred global Account.

### Negative

- requires new learning-owned tables in a future authorized task;
- requires ambiguity reports and a reconciliation workflow for real legacy
  duplicates;
- adds resolver joins and indexes;
- migration cannot be a blind one-shot backfill;
- Principal Project ownership and LearnerIdentity ownership remain intentionally
  separate concepts that services must not confuse.

## Unresolved risks and follow-up boundaries

- Production row population and duplicate rates are UNKNOWN until an authorized
  non-mutating migration audit.
- Exact DDL, FK actions, indexes, link validity model and merge command require
  a separate execution-spec; this ADR does not implement them.
- M0-003 must reproduce legacy status divergence and is not started here.
- Runtime `ActivityParticipation`, result revision/selection and Gradebook
  convergence remain M1+ work behind milestone gates.
- Cross-school negative authorization must be proven against a running database
  before runtime acceptance.
- Whether account-owned projects can complete the CURRENT submission path is a
  separate observed compatibility risk; this ADR preserves ownership and does
  not repair the path.

## Условия пересмотра

Review through a new ADR only if an existing repository entity is changed to
prove all of these simultaneously: immutable school lineage, email-free support,
cross-class continuity, Account linking without history rewrite, and safe
multi-school/RLS behavior. Convenience or desire to avoid migration is not
sufficient.

## Проверка решения

This architecture-only task is accepted when:

- CURRENT candidate matrix is evidence-backed and selects only B;
- stable key and school/multi-school rules are exact;
- migration and RLS consequences are explicit;
- `IDN-002` is proven in the ledger while `IDN-001`, `IDN-003` and `IDN-004`
  are not claimed implemented;
- `git diff --check`, `pnpm control-plane:check`, `pnpm gate:governance` and
  documentation/contract checks pass;
- no migrations, runtime, OpenAPI, UI or tests are changed.
