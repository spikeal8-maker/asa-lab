# Learning E1 — проверка оснований новой редакции ТЗ

**Тип:** датированный review receipt, не текущее execution-state и не product acceptance.
**Source baseline:** `3a54a9edf58633331fd466b5f46cb2a8c4f5d390`.
**Объём изменения:** документация и её проверка; приложение, миграции и runtime tests этим срезом не исправляются.
**Публичный ресурс:** https://asa-lab.ru/.

## 1. Что выполнено заново

17 сентября 2026 выполнены fresh GitHub main read, fast-forward чистого runner checkout и `python tools/agent_recover.py --scope learning --check`: SAFE_TO_START. Source review сделан по этому baseline, не по старому отчёту о готовности.

Компонентная проверка через Node 24: импортированы реальные `apps/api/src/rate-limit.ts` и `apps/web/src/components/course-version-diff.ts`, лимит прочитан из текущего `classroom-join.controller.ts`. Только synthetic входы и snapshots, без HTTP authentication и подключения к БД.

| Проверка | Наблюдаемый результат |
| --- | --- |
| Лимит одного адреса за окно | MAX_ATTEMPTS=30; общий для resolve и sign-in |
| 30 последовательных двухшаговых входов | 15 полных разрешённых входов из 30 |
| Сначала resolve всех 30, затем sign-in всех | resolve=30, sign-in=0 |
| Synthetic version: поменять activity pin и только maxAttempts 1→2 | comparator возвращает только категорию «Задания», не «Политика» |

Git blob identities реально импортированных файлов:
- rate-limit.ts: `7cd85c4e624e241ec7ae58e09d245b4d7ac5268b`;
- classroom-join.controller.ts: `9625136960a2c031a2a156ffe9eeac4504bcf69d`;
- course-version-diff.ts: `45228fc52b244bff2e6a595df7def7b8a047e425`.

Это воспроизведение компонентов, не проверка входа 30 реальных детей и не причинный диагноз всех старых сбоев. PolicySnapshot в synthetic pair нужен для проверки игнорирования поля компаратором; полнота извлечения исторических policy через API требует самостоятельной интеграционной проверки.

## 2. Статические выводы и требуемые воспроизведения

| FIX | Основание в source | Уровень доказательства / чего не делали |
| --- | --- | --- |
| E1-FIX-01 | Shared per-address limiter в resolve и studentseat | component_reproduced; полный endpoint/NAT/browser сценарий ещё нужен |
| E1-FIX-02 | 0142: hash UUID/имени/номера строки с salt; raw code в login_handle | source_review; не проверяли чужие входы и не выполняли ротацию |
| E1-FIX-03 | Константа карточки и e2e ожидают неправильный host; тест читает data-qr-url | source_review; actual QR decode/камера/print пока not_run |
| E1-FIX-04 | Parent selectTab размонтирует CoursesPanel; ack/save generation может потерять newer dirty | source_review; delayed browser/DB тест ещё нужен |
| E1-FIX-05 | 0145 v3 проверяет revision до receipt в v2; 0137 публикация меняет draft_active/revision | source_review; PostgreSQL lost-response reproduction в этом срезе не выполнялось |
| E1-FIX-06 | Diff не сравнивает полный policy; synthetic policy change | component_reproduced; exact historical API pair ещё нужен |
| E1-FIX-07 | SQL даёт lesson path, API сворачивает structured problem в строку; legacy picker доступен | source_review; точный block focus пока не доказан |
| E1-FIX-08 | Архивный guard отдельным pool.query до assign | concurrency_risk_from_source; требуется interleaving reproduction, не заявлен production incident |
| E1-FIX-09 | Compact IDA-CRED-001 требовал одноразовость вопреки repeat-print; stale Student R0 и текущие refs | Противоречие документации; исправляется и проверяется только в doc-slice |
| E1-FIX-10 | GitHub/product и установленная версия различны | live_readonly_metadata; private authenticated journey не выполнялся |

## 3. Повторная read-only проверка реального сайта

Время начала browser probe: **2026-09-17T07:29:57.825Z**. Chromium, новый неавторизованный контекст, только открытие публичных страниц/метаданных. Синтетические или реальные профили на сервере не создавались.

| URL path | HTTP / факт |
| --- | --- |
| `/` | 200, страница ASA Lab |
| `/build-metadata.json` | 200; Web revision `1ae93cbb99ffa53abbf53430bf2c6d1dfca39e1e`, builtAt `2026-09-16T18:34:07.562Z` |
| `/health/ready` | 200; ready, database up; API revision тот же; schemaVersion=142, expectedSchemaVersion=142, synchronized=true |
| `/#/join-class` | 200; первый экран с одним text input `class-code` |

`artifactIntegrity=unknown`, не verified. Совпадение Web/API и схемы относится только к этой старой сборке. Source baseline этого review не развёрнут данным действием. Закрытые teacher/learner кабинеты, имя после действующего class code, меню, печать и прохождение курса в данном live probe **not_run**. Production и БД не обновлялись.

## 4. Граница новой редакции

Integrated V1.5 переписан целиком; Learning/Access 2.2 сохраняют прежние stable requirement IDs и специализированные формулы/permissions, но заменяют конфликтующие актуальные разделы. Student UI переписан без обязательных login/secret и одноразовой печати. Compact contracts, Registry и Learning execution refs согласуются с новыми редакциями. Старые V1.4/V2.1 сохраняются byte-exact snapshots и исключены из ordinary agent context.

План исправления не означает устранение ошибок кода. E1-FIX-01…08 требуют product regression/repair; E1-FIX-10 требует отдельно разрешённого deployment и authenticated smoke. `INT-E1-01…17=implemented` из старого отчёта не используется как blanket proof: затронутые агрегаты вновь in_progress.

Требование «Собрать курс из истории» сохранено, его точный этап требует решения; не объявляется готовым и не удаляется. E2–E6, все восемь quiz types, Python 3, controlled access/timers, Knowledge/linking, collaboration/organization и operations остаются TARGET.

## 5. Проверка самой документации

Команды doc gate определены в `tools/gate-governance.sh`. Новый validator проверяет версии/ссылки/правильный публичный host, сохранение requirement IDs, комплект FIX cases и различие observations/planned/executed. Unit tests намеренно портят копии контрактов, чтобы доказать обнаружение дрейфа. Их успешность означает только согласованность документов, не работоспособность продукта.

Final command results доступны в exact-SHA CI/итоговом отчёте этого изменения; этот receipt не заранее присваивает им PASS. Непроверенные source hypotheses должны остаться явно квалифицированы. Самопроверка этого автора не является независимым security/product review.

## 6. Итог локальной самопроверки документационного среза

- `python tools/test_validate_learning_spec_rebaseline.py`: 14/14 PASS, включая отрицательные проверки ошибочного домена, stale revision, одноразового readback, потери IDs, отсутствия FIX/scenarios и фиктивного product/live evidence.
- `python tools/validate_learning_spec_rebaseline.py`: PASS только для согласованности документации.
- `node tools/run-governance-gate.mjs`: завершён с exit code 0; полный governance gate PASS после согласования ссылки на переведённый заголовок Preview.
- `python tools/agent_context.py --scope learning --json`: exit code 0; новые нормативные редакции и открытый acceptance blocker видны в generated context.
- Сопоставление старых/новых stable IDs: 348 Learning и 277 Access сохранены; прежние специализированные формулы/permission-каталоги не удалялись.
- Старые V1.4/V2.1 snapshots byte-exact; checksum проверен Document Registry. Миграции, app/domain/package/schema paths не исправлялись этим doc change.

Самопроверка: DOCS PASS; PRODUCT CORRECTIONS OPEN; DEPLOYMENT NOT_PERFORMED; AUTHENTICATED LIVE JOURNEY NOT_RUN; INDEPENDENT REVIEW NOT_RUN. Общий продуктовый suite этим локальным doc-check не объявляется повторно пройденным. CI после публикации имеет собственный exact SHA и conclusion.
