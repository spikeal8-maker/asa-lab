# Компактный профиль ученика для преподавателя — контракт #589

Document ID: `TEACHER-STUDENT-PROFILE-UI-589`. Revision: `1.0`.

Канонический контракт ограниченного UI-среза по
[Issue #589](https://github.com/spikeal8-maker/asa-lab/issues/589) и
[независимому аудиту](https://github.com/spikeal8-maker/asa-lab/issues/589#issuecomment-6247088153).
Задача, checkpoint, ветка, статус и результаты проверок читаются только из
[`../execution/current.yaml`](../execution/current.yaml) и фактического GitHub.
Этот документ задаёт требования, а не подтверждает реализацию или приёмку.

## 1. Вход, координация и разрешённые пути

Меняется только профиль ученика, открытый **преподавателем из конкретного класса**.
Продуктовый исполнитель начинает запись только после принятия governance-selection
в GitHub `main` и наследования этого состояния своей отдельной продуктовой веткой.
Правка `current.yaml` в собственной продуктовой ветке не разрешает задачу.

Перед записью обязательны fetch актуального `origin/main`, точный Git/CI snapshot,
scoped preflight и проверка dirty/intersecting paths всех затрагиваемых worktree.
Использовать `pnpm agent:preflight --scope teacher-student-profile-ui --check`;
после сбоя — `pnpm agent:recover --scope teacher-student-profile-ui --check` и
восстановление удалённого snapshot. Нужен `SAFE_TO_START`, а не предположение по
предыдущему запуску.

Прочитать `AGENTS.md`, `START_HERE_FOR_AI.md`, этот контракт,
[`review-protocol.md`](../agent/review-protocol.md),
[`ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md`](ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md) и
[`AGENT_CHANGE_WORKFLOW.md`](../delivery/AGENT_CHANGE_WORKFLOW.md).
Инвентаризировать актуальные `ClassroomStudentPage.tsx`, `classroom-student.css`,
`ClassroomParticipantPanels.tsx`, `classroom-participants-api.ts` (API только читать),
`ClassroomPage.tsx`, `classroom-open-compact.css`, «Мои классы» и «Мои проекты».
Сверять исходники текущего GitHub main, не старую локальную Docker-сборку.

Полный разрешённый набор путей будущего продуктового среза:

- `apps/web/src/pages/classroom-student.css`;
- `apps/web/src/components/ClassroomParticipantPanels.tsx`;
- `apps/web/src/components/testing/classroom-student-navigation.spec.ts`;
- `apps/web/src/components/testing/classroom-student-profile.spec.ts`;
- `e2e/classroom-student-profile.spec.ts`;
- `docs/product/ASA_TEACHER_STUDENT_PROFILE_UI_589.md`;
- **координируемый** `apps/web/src/pages/ClassroomStudentPage.tsx`;
- **координируемый** `.github/workflows/teacher-student-profile-ui.yml`.

Контролёр обязан согласовать **единственного автора** `ClassroomStudentPage.tsx`
с Learning lane, а workflow — с integration. Эти два пути не получают второго
владельца через дублирование `owned_paths`. Существующие Learning owned paths,
integration shared paths, все selections Scratch/Learning/Electronics/Arduino/
Account и остальные lanes сохраняются. При пересечении чужих незавершённых
изменений — STOP; не перезаписывать и не включать их в коммит. Индексировать
только проверенные разрешённые пути, сохранять protected assets, backups и owner ZIP.

Исполнитель пишет один целый согласованный UI-блок, делает focused gate и
self-review, сообщает результат и STOP. Независимый reviewer только читает
точный финальный SHA, контролёр отдельно принимает решения и интегрирует после
обязательных проверок. Governance repair не разрешает продуктовые правки.

**Оставшийся preflight по mapping:** отсутствие `ClassroomStudentPage.tsx` в
Surface Map нельзя считать исправленным этим документом или registry route.
Нужен отдельно разрешённый canonical mapping/tooling slice, его принятие на main
и проверка targeted preflight
`pnpm agent:preflight --path apps/web/src/pages/ClassroomStudentPage.tsx --check`
на актуальной базе до продуктовых edits. Этот UI-срез не разрешает менять tooling,
Surface Map, catalogs, package/lockfile или придумывать рабочий selector.

## 2. Компактная навигация и шапка

- Сразу под общей шапкой, с минимальным отступом: `← К классу`, предыдущий ученик,
  позиция `N/total`, следующий ученик на одном навигационном уровне desktop.
  На 320/390 — компактная адаптивная группа без page overflow и огромных рядов.
  «К классу» соответствует «← Мои классы» принятого открытого класса (#587).
  Сохранить callbacks, доступные имена соседей, disabled при 1/1 и границах списка.
- Возврат ведёт именно в прежний класс/журнал, сохраняет контекст и фильтры #587.
- Непосредственно ниже одна согласованная шапка: аватар, полное имя,
  `Работы/Сдано/Ждут`, настоящий рейтинг и **место в текущем классе**,
  роль `Учащийся/Помощник`, статус защиты `Включена/Выключена`.
  Явный `safeMode: false` виден как «Выключена». Не разносить на три полосы.
- Использовать реальные API-значения; не подменять нули, пустоту или ошибки
  фиктивными метриками. Сохранить существующие кнопки, проверку права менять роль,
  архивный read-only, awards, suspended state и touch targets не меньше 44px.
- Школьный рейтинг **BLOCKED** до надёжных авторизованных серверных данных;
  допускается только предусмотреть будущее размещение/модель без выдуманных школы,
  API и места. Защита здесь — правдивый статус; новый клиентский security toggle
  или серверная операция безопасности в этот срез не входят.

## 3. Все оценки текущего класса и подробная история

Заголовок — «Оценки этого класса». Компактная горизонтальная лента или
упорядоченный список показывает реальные ручные оценки **и** результаты
назначенных работ: дата, работа/категория, истинный балл/оценка, понятный статус.
Набор доступен за все годы/периоды текущего класса, с управляемой подгрузкой.

Существующий API отдаёт страницы по 30 и **два независимых курсора**:
`journal.nextOffset` для ручных оценок и `nextResultOffset` для assignment results.
Обрабатывать оба независимо до исчерпания каждого; окончание одного не должно
скрывать страницы другого. Удалить предел истории вида `slice(0, 3)` для каждого
источника. Обеспечить доступ ко всем оценкам без дублей/пропусков, без бесконечной
автозагрузки; на 30–100+ записей ограничить видимую высоту/ширину, сохранив
возможность открыть каждую оценку и последующие страницы. Проверить различную
длину/исчерпание потоков, повтор подгрузки, ошибки и retry.

Сохранить вкладку «Оценки и история», подробные ревизии и отзывы;
не менять `Gradebook`/`Submission` и семантику оценивания. Проверить сортировку
по дате, timezone/date-only, archive/year behavior и 0/1/30/100 оценок обоих типов.
`ParticipantGradeHistory` в `ClassroomParticipantPanels.tsx` используется также
ученическими self-results: инвентаризировать настоящих consumers, сохранить их
поведение и проверить регрессии любого teacher variant.

**Cross-class grades BLOCKED.** Нельзя связывать учеников по одинаковому имени,
угадывать по `seatId`, собирать чужие классы или раскрывать roster. `helperClasses`
не доказывает идентичность ученика и права чтения оценок. Нужен отдельный
канонический learner identity/API authorization/RLS slice: server-backed связь
той же личности, mapping целевого класса/seat, права именно этого преподавателя,
тесты denied, unlinked, revoked и cross-tenant. До принятия такого контракта
описать blocker; не показывать фальшивую кнопку или фиктивные результаты.

## 4. Восемь вкладок и consumers

Сохранить все восемь вкладок в порядке: **Все работы / Оценки и история / Задания /
3D / Электроника / Scratch / Заслуги / Активность**. Визуальное и интерактивное
соответствие открытому классу #587: плотный единый контейнер, явный active/focus,
клавиатурная навигация и предсказуемое мобильное поведение. Восьмой пункт не
обрезан и достижим; огромная стопка кнопок недопустима.

Сравнить «Мои классы», открытый класс, профиль и «Мои проекты», перечислить
consumers и impact radius. Переиспользовать локальный примитив/стиль только
после инвентаризации и со сквозными браузерными проверками затронутых consumers.
Фильтры по типу не равны разделам страницы. Сохранить принятую компоновку
#582/#585/#587. Расширение общих компонентов за разрешённые пути требует
отдельного аудированного среза, а не косметического scope expansion.

## 5. Работы, ожидание проверки и архив

Единая компактная панель вместо разнесённых controls: статус, включение/исключение
архива, модуль через существующие вкладки. Показывать активный фильтр и сброс,
исключить конфликтующие состояния. «Остальные» допустимы только когда реальные
данные позволяют их отличить.

Текущий `onlyAwaiting` фильтрует **только загруженные работы**. Явно назвать эту
границу в UI; пустой результат загруженного набора не означает отсутствие
ожидающих работ на других страницах. Существующий works API не даёт глобальных
review-status/sort. Не выдавать сортировку первой/загруженных страниц по обновлению,
названию или статусу за сортировку всего набора. Глобальный фильтр/сортировка
потребует отдельного аудированного server contract с permission tests.

Сохранить реальные карточки, открытие и оценивание, «Ещё работы», loading,
API error/retry, архив и ограничения приватных личных работ. Фильтр не должен
скрывать возможность подгрузить следующие работы или терять archive state.

## 6. Browser gate и обязательное доказательство результата

Lane gates берутся из `current.yaml`: focused baseline и `gate:repository`
дополняются **обязательным browser gate**. Vitest или repository gate не
заменяют built-page journey. Планируемый workflow называется точно
`Teacher Student Profile UI`, путь `.github/workflows/teacher-student-profile-ui.yml`;
его создание и подключение вместе с `e2e/classroom-student-profile.spec.ts` —
обязанность продуктового автора. Эта декларация не означает, что workflow/test
уже существуют, были запущены или прошли.

В качестве существующего образца использовать
`.github/workflows/teacher-open-classroom-layout.yml`, `playwright.config.ts`,
`e2e/classroom-open-compact.spec.ts` и `e2e/fixtures/classroom-owner.ts`:
реальная production-сборка `apps/web/dist`, synthetic API fixtures,
`ASA_E2E_EXTERNAL=true` для отключения DB-backed `e2e/server.mjs`,
loopback origin `http://127.0.0.1:4612` без доступа к живой установке.
Fixture должен обслуживать собранные HTML/JS/CSS, а не подменять UI картинкой.

Workflow обязан checkout точный PR head SHA (не synthetic merge SHA), задать
`ASA_BUILD_REVISION` тому же SHA, `NX_SKIP_NX_CACHE=true` буквально и
`NX_DAEMON=false`, установить pinned dependencies через frozen lockfile и Chromium.
Обязательная подготовка — свежая production-сборка Web:

```bash
pnpm exec nx run web:build --skip-nx-cache
```

Затем workflow выполняет **точно команду browser gate**:

```bash
pnpm e2e:access-a e2e/classroom-student-profile.spec.ts --config=playwright.config.ts --workers=1 --reporter=list
```

Это существующий package script `e2e:access-a` =
`playwright test --config playwright.access-a.config.ts`, используемый как
обёртка Playwright: последний явный `--config=playwright.config.ts` заменяет
Access config, а positional path выбирает только новый profile test.
Такой вызов нужен потому, что control-plane допускает в `gates.commands`
только существующие package scripts; tooling/package.json здесь не меняются.
Эквивалентный прямой вызов — `pnpm exec playwright test
e2e/classroom-student-profile.spec.ts --config=playwright.config.ts --workers=1
--reporter=list`. Запуск Access suite/DB-backed launcher не является этим gate.
Автор проверяет discovery через ту же команду с `--list` и подтверждает выбор
именно нового теста; discovery не заменяет настоящий browser run.

Нужны PR path triggers для всех разрешённых UI/test путей и самого workflow,
а также управляемый запуск на выбранном ref. Сохранить exact-SHA run URL,
команды/conclusions, build-metadata, Playwright reports/trace и скриншоты artifacts;
указать число реально выполненных Nx задач. `Cache: N/N hit (100%)` не новое evidence.
Отсутствующий/неподключённый/неисполненный browser job означает `NOT_RUN` и
блокирует UI completion/приёмку. Нельзя применять `--pass-with-no-tests`, skip
journey, ослаблять assertions/timeouts или засчитывать старый/отменённый workflow.

Browser assertions и screenshots **реальной собранной страницы** обязательны на
1440/1024/390/320, включая split-screen, длинное ФИО и 125–175% zoom.
Проверить populated/empty/loading/error/retry/disabled, много данных, archived,
helper, suspended, safeMode true/false; отсутствие page-level horizontal overflow,
overlap, text squeeze, обрезанного CTA и потерянной вкладки. Локальный scroll
оценок/вкладок не должен расширять страницу.

Проверить предыдущего/следующего и 1/1, возврат в прежний класс/журнал с фильтрами,
все восемь вкладок, 0/1/30/100 manual+assignment оценок, обе независимые пагинации
без дублей, подробную историю/отзывы, pupil self-results consumers, фильтр loaded-only,
архив, скрытые private works и отсутствие регрессий #582/#585/#587.
Если shared style затронут, браузером проверяются все его consumers.

## 7. Запреты, приёмка и отчёт

В этом срезе запрещены API, SQL, миграции, Auth/permissions/RLS, tenant model,
grade semantics, реальные пользователи/данные, PostgreSQL/MinIO живой установки,
backup/restore, Docker/runtime и deployment. Нельзя обновлять установки на
4610/4620, менять порты, origin, сеть/DNS/VPN/firewall/hosts/routes/proxy.
Тесты — только изолированный CI/synthetic data; реальный локальный Docker и
локальный дополнительный стенд не разрешены. Отдельный server/identity slice
не является разрешением на такие действия.

Перед предложением приёмки нужны exact-final-SHA focused, browser и обязательные
general evidence, self-review и независимый read-only review этого же SHA.
Известные посторонние baseline failures классифицировать отдельно по AGENTS.md;
не чинить чужой модуль и не заявлять общий PASS/release candidate при красном
`gate:repository`. Зелёный CI не равен owner acceptance. Интеграция требует
обязательных проверок и решения контролёра/владельца; push не равен deployment.

Итог отдельно перечисляет `CODE_SHA, UI_FILES, TESTS, FOCUSED_CI, GLOBAL_CI, REVIEW,
MERGED, DEPLOYED, OWNER_ACCEPTED, CROSS_CLASS_BLOCKER, SCREENSHOTS, NEXT_ALLOWED_TASK`,
фактические browser run/artifacts, непроверенное и состояние рабочего дерева.
После целого выбранного блока исполнитель и reviewer останавливаются;
самостоятельно начинать соседний READY-срез запрещено.
