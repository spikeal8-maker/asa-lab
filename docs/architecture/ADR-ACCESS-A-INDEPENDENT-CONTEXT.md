# ADR — независимое преподавание без фиктивной школы

Область: Result A, Issue #173. Решение подлежит fresh/upgrade и RLS проверкам;
production этим документом не разрешается. Связь: ADR-LEARNER-IDENTITY-001.

## Проблема и отклонённые варианты

`0022.classroom_ensure_personal_teacher` создаёт `schools('Личные классы')`.
Classroom, academic period, learner identity и gradebook ссылаются на school UUID.
Скрыть эту строку в интерфейсе — не независимое преподавание. Отдельный набор
таблиц Classroom/Attempt или nullable scope без FK также недопустимы.

## Совместимое расширение

Добавить один справочник `learning_contexts`: school либо independent_teaching.
Реальная школа ссылается на существующий `schools.id`; независимый контекст —
на владельца Account и его существующий Personal Workspace. Создание личного
класса больше не вставляет `schools` и organization workspace.

Сохранить UUID и NOT NULL составных границ `(tenant_id, school_id)` во всех
существующих учебных таблицах. Имя `school_id` в этих legacy-колонках становится
совместимым именем context ID; FK направляются на `(tenant_id, learning_contexts.id)`.
Это не изменение tenant/RLS модели: политики и права существующих таблиц остаются
прежними, новая таблица имеет forced tenant RLS и только SELECT для runtime.
В API новое поле именуется `learningContext`, а не вымышленной школой.

Исторические личные школы сохраняются физически и по UUID как provenance
`legacy_school_id`; их учебный контекст классифицируется independent_teaching.
Не переписываются learner/Attempt/Submission/Result/Project owner IDs, не
отзываются memberships и не выполняется новый learner backfill. Реальные школы
попадают в новый справочник через совместимый insert trigger.

Создание контекста сериализуется по Account; grant, active Account и Personal
Workspace owner проверяются серверной функцией. Старый grant не служит токеном:
revoke обязан проверяться вновь при каждом защищённом запросе.

## Обязательные доказательства

- Fresh и upgrade: все прошлые UUID и FK сохранены, новые личные классы не
  увеличивают число schools/organization workspace.
- Два независимых преподавателя не читают чужой roster и private UUID.
- School classroom продолжает работать, включая создание новой школы после DDL.
- Составной FK запрещает подстановку чужого tenant/context.
- Runtime не меняет справочник напрямую и не получает BYPASSRLS.
- Класс, Seat и Account learner проходят существующий канонический Learning
  runtime с неизменной идентичностью и отдельной resource authorization.

Linking Seat → Account не реализуется сменой context ID; для него требуется
отдельное доказательство обеих сторон и предусмотренное политикой подтверждение.
