# ASA Lab — Assessment, Feedback and Rewards Specification

**Статус:** нормативная продуктовая спецификация.  
**Основные capability IDs:** `CAP-SUBMISSIONS`, `CAP-REVIEW`, `CAP-COMMENTS`, `CAP-ASSESSMENT`, `CAP-REWARDS`, `CAP-PROGRESS`, `CAP-ANALYTICS`.

## 1. Цель

Система проверки ASA Lab должна поддерживать не только выставление числа, но полный педагогический цикл:

```text
ученик выполняет
→ отправляет версию
→ получает автоматические результаты
→ педагог изучает работу
→ оставляет комментарии
→ возвращает или принимает
→ ученик исправляет
→ педагог фиксирует результат
→ система выдаёт достижения и обновляет прогресс
```

## 2. Принципы

1. Проверяется конкретная неизменяемая версия работы.
2. Комментарии не теряются при новой попытке.
3. Автоматическая проверка не подменяет педагогическое решение.
4. Скрытые тесты защищены.
5. Результат объясним ученику.
6. Изменение оценки аудируется.
7. Награды связаны с evidence.
8. Публичное сравнение детей отсутствует по умолчанию.
9. Один механизм работает для всех предметных модулей.

## 3. SubmissionAttempt

Каждая отправка создаёт отдельную попытку.

Поля:

- assignment;
- student principal;
- attempt number;
- project version;
- submitted at;
- late state;
- validation result;
- automated result;
- teacher review;
- final assessment;
- superseded by optional.

Нельзя заменять payload старой попытки новой версией.

## 4. AutomatedCheckRun

Поля:

- immutable input version;
- test bundle version;
- engine/runtime version;
- environment manifest;
- started/finished timestamps;
- status;
- score;
- check results;
- evidence refs;
- failure category;
- resource usage.

Статусы:

- queued;
- running;
- completed;
- failed infrastructure;
- invalid project;
- timed out;
- cancelled.

Инфраструктурная ошибка не считается ошибкой ученика.

## 5. ReviewSession

Педагог открывает review session, привязанную к submission attempt.

Review workspace содержит:

- viewer проекта;
- assignment instructions;
- rubric;
- automated checks;
- предыдущие попытки;
- diff;
- comments;
- final decision.

## 6. Комментарии

### 6.1. Типы

- общий отзыв;
- вопрос;
- ошибка;
- рекомендация;
- сильная сторона;
- обязательное исправление;
- internal teacher note;
- system diagnostic.

### 6.2. Anchor

Anchor хранит точную ProjectVersion и module reference. После изменения draft комментарий остаётся связанным с исходной сдачей.

### 6.3. Visibility

- student visible;
- teachers only;
- project team;
- system generated.

### 6.4. Moderation

- edit history;
- delete policy;
- abuse reporting;
- audit для административного удаления;
- запрет личных сообщений вне учебного контекста.

## 7. Rubric

Rubric является версионируемым объектом.

```text
Rubric
└── Criteria
    └── Levels
```

Criterion:

- key;
- title;
- description;
- max points;
- weight;
- required;
- competency links;
- evaluation source;
- module evidence mapping.

Level:

- label;
- description;
- points/range;
- examples optional.

После публикации assignment rubric version неизменяема.

## 8. Assessment policies

Поддерживаются:

- manual only;
- automatic only для простых тренировок;
- automatic proposal + teacher confirmation;
- weighted mixed;
- pass/fail;
- points;
- percent;
- school grade scale;
- competency mastery.

Конвертация баллов в оценку является versioned policy.

## 9. Решения педагога

### Accepted

Работа соответствует минимальному критерию.

### Changes requested

Работа возвращается. Указываются обязательные unresolved comments и открывается новая попытка, если policy разрешает.

### Incomplete

Ученик отправил недостаточный результат; отличается от технической ошибки.

### Excused

Задание исключено из обязательного расчёта по административной причине.

### Rejected

Используется редко и требует reason/audit.

## 10. Grade history

Итоговая оценка не перезаписывается бесследно.

```text
AssessmentRevision
├── previous result
├── new result
├── reason
├── changedBy
├── changedAt
└── audit event
```

Ученик видит актуальный результат и разрешённую историю.

## 11. Badges

### 11.1. Категории

- knowledge;
- engineering practice;
- creativity;
- debugging;
- collaboration;
- persistence;
- safety;
- course completion;
- module mastery.

### 11.2. Выдача

- автоматическая по versioned rule;
- педагогом;
- методистом/программой;
- массовая по результатам курса.

### 11.3. Evidence

BadgeAward ссылается на:

- submission;
- project version;
- assessment criterion;
- course completion;
- teacher comment;
- event sequence.

### 11.4. Отзыв

Отзыв не удаляет историю, а создаёт `revokedAt` и reason.

## 12. Certificates

CertificateDefinition:

- program/course version;
- completion conditions;
- issuer;
- template;
- validity;
- verification policy.

CertificateAward:

- recipient;
- definition version;
- evidence snapshot;
- verification code;
- issued/revoked metadata.

## 13. Competencies

Компетенция может быть связана с несколькими заданиями и модулями.

Примеры:

- базовая электрическая цепь;
- логическое мышление;
- циклы и условия;
- пространственное моделирование;
- отладка;
- проектная коммуникация.

Evidence:

- rubric criterion;
- accepted automated check;
- teacher observation;
- certificate completion.

Mastery calculation версионируется и объясняется.

## 14. Progress

Состояния assignment:

- not available;
- available;
- not started;
- in progress;
- submitted;
- changes requested;
- accepted;
- overdue;
- excused.

Course progress вычисляется из published course version и completion rules.

## 15. Teacher analytics

Педагог видит:

- completion matrix;
- score distribution;
- rubric heatmap;
- common diagnostics;
- attempt distribution;
- time to first submission;
- return rate;
- unresolved feedback;
- competency gaps;
- students needing attention.

Analytics не должна превращаться в бездоказательный «рейтинг способностей».

## 16. Student presentation

Ученик видит:

- понятный status;
- что сделано хорошо;
- что исправить;
- rubric results;
- автоматические public checks;
- итоговый результат;
- achievements;
- следующий шаг.

Системные stack traces, hidden tests и внутренние scores не показываются.

## 17. Notifications

- submission accepted;
- changes requested;
- new comment;
- grade finalized;
- badge awarded;
- certificate issued.

Notification содержит безопасный preview без чувствительного содержимого проекта.

## 18. Module integration

Module предоставляет:

- anchors;
- diagnostics;
- autograding checks;
- evidence;
- semantic diff;
- preview.

Assessment Core не импортирует внутренние типы модуля.

## 19. API invariants

- submit требует final sync;
- review mutation требует reviewer policy;
- grade mutation идемпотентна или version-checked;
- hidden tests не возвращаются;
- cross-tenant denial обязателен;
- teacher internal notes недоступны ученику;
- badge award требует evidence/reason;
- все финальные изменения аудируются.

## 20. First assessment release

Минимальный сквозной сценарий:

```text
teacher creates assignment
→ student works in dummy/electronics project
→ student submits immutable version
→ automatic validation completes
→ teacher opens viewer
→ teacher adds anchored comment
→ teacher requests changes
→ student submits attempt 2
→ teacher accepts
→ teacher fills 3-criterion rubric
→ grade appears
→ badge awarded
```

Автоматизированный E2E должен подтверждать весь поток.
