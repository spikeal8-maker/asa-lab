[ТЗ AI: содержание](../../ASA_AI_ASSISTANT_SPEC.md) · [Вход бота](../README.md)

# 16. Программа небольших видимых задач

Очередь T01–T32 редакции v1.0 заменена ASAI-01–ASAI-44. Полные специфичные записи — [PROGRAM_DEFINITION.json](../PROGRAM_DEFINITION.json), общая часть карточки — [TASK_CONTRACT.md](../TASK_CONTRACT.md). Это определения, не созданные Issues и не разрешение выполнить всё. Требования R01–R35 и проверки C01–C32 обязательны.

Первый предлагаемый шаг — ASAI-01, настоящий Обзор. Demo-доступ проверяется перед первым выбранным срезом и при изменении причины, а не бесконечным preflight «изучил и остановился». Срочные ASAI-15 и ASAI-19 независимы от полного admin контура; допустим иной порядок при каноническом выборе и непересекающихся путях. Каталог моделей не искусственный prerequisite своего context preview.

| ID | Видимый результат | Зависимости |
| --- | --- | --- |
| ASAI-01 | Реальный Обзор: три показателя и первый график | Нет |
| ASAI-02 | Фильтры, ошибки, модели, инструменты | ASAI-01 |
| ASAI-03 | Честные статусы подключений и положение админки | ASAI-01 |
| ASAI-04 | Сохранение настроек/промпта, общий синтаксис | ASAI-03 |
| ASAI-05 | Что система знает обо мне | ASAI-04 |
| ASAI-06 | Живой каталог OpenAI | ASAI-03 |
| ASAI-07 | Живой каталог DeepSeek | ASAI-06 |
| ASAI-08 | Живой каталог Ollama Cloud | ASAI-06 |
| ASAI-09 | Несколько local моделей в чате | ASAI-03 |
| ASAI-10 | Категории: модели/default | ASAI-06, ASAI-07, ASAI-08, ASAI-09 |
| ASAI-11 | Класс и индивидуальные права Seat | ASAI-10 |
| ASAI-12 | Токенные бюджеты/остаток | ASAI-02, ASAI-10 |
| ASAI-13 | Профиль, аватар, устройство, геоданные | ASAI-05 |
| ASAI-14 | Выбранный класс/курс/проект | ASAI-11, ASAI-13 |
| ASAI-15 | Настоящий streaming при tools | Нет |
| ASAI-16 | Реальные стадии, Stop, recovery | ASAI-15 |
| ASAI-17 | Иконки и боковое меню форматов | ASAI-15 |
| ASAI-18 | Типографика, код, вложения | ASAI-17 |
| ASAI-19 | Диагностика/включение поиска, живой источник | Нет |
| ASAI-20 | Настоящая галерея найденных изображений | ASAI-19 |
| ASAI-21 | Общий tools runtime: рабочая Ollama-вертикаль | ASAI-15, ASAI-19, ASAI-20 |
| ASAI-22 | Общие инструменты OpenAI | ASAI-21 |
| ASAI-23 | Общие инструменты DeepSeek | ASAI-21 |
| ASAI-24 | Общие инструменты Ollama Cloud | ASAI-21 |
| ASAI-25 | Файлы и Auto вместе | ASAI-21, ASAI-22, ASAI-23, ASAI-24 |
| ASAI-26 | Большой файл: диапазоны/полнота | ASAI-21 |
| ASAI-27 | Чтение PDF/DOCX | ASAI-26 |
| ASAI-28 | Чтение XLSX/CSV | ASAI-26 |
| ASAI-29 | OpenAI Vision | ASAI-26, ASAI-22 |
| ASAI-30 | DeepSeek Vision | ASAI-26, ASAI-23 |
| ASAI-31 | Ollama Cloud Vision | ASAI-26, ASAI-24 |
| ASAI-32 | Длинный ответ/terminal reason/continuation | ASAI-06, ASAI-07, ASAI-08, ASAI-09, ASAI-15 |
| ASAI-33 | Настоящий Excel и CSV | ASAI-17 |
| ASAI-34 | Сохранённые документы/код/артефакты | ASAI-33 |
| ASAI-35 | Remote ComfyUI settings/probe | ASAI-03 |
| ASAI-36 | Несколько image models/recipes, Auto | ASAI-21, ASAI-35 |
| ASAI-37 | Ollama download/delete | ASAI-09 |
| ASAI-38 | ComfyUI controlled model delivery | ASAI-35, ASAI-36 |
| ASAI-39 | 20 диалогов и очистка | ASAI-34 |
| ASAI-40 | Сжатие без потери оригинала | ASAI-12, ASAI-26, ASAI-32 |
| ASAI-41 | Погода/составные периоды | ASAI-21, ASAI-22, ASAI-23, ASAI-24 |
| ASAI-42 | Проверенный Cloud login | ASAI-08 |
| ASAI-43 | Update preservation | ASAI-03, ASAI-04, ASAI-12, ASAI-39, ASAI-40 |
| ASAI-44 | Финальная продуктовая/модельная/нагрузочная приёмка | Все ASAI-01–43, исключения только явным решением |

## Порядок контролёра

Свежие remote/main/candidate/CI/current.yaml → одна dependency-ready карточка → назначенный автор → реальный показ → независимый reviewer → разрешённая интеграция → evidence → следующий отдельный выбор. AiChatPage/AiChatService/current.yaml/migrations/lockfile имеют одного согласованного автора за раз. Параллельность — лишь непересекающиеся пути и стабильный контракт; фиктивный execution lease не вводится.

STOP автора не завершает порученную программу. Но поручение опубликовать ТЗ не разрешает самовольно менять приложение/сервер. При blocked provider можно выбрать независимую карточку, не объявляя зависимую принятой.

Большую карточку разрешено разделить на меньшие вертикали с ID и реальным эффектом; исходная остаётся открытой до полного результата. «БД сейчас, UI неизвестно когда» — не законченная feature. Cleanup/docs не становятся бесконечной предварительной программой.

## Контрольные рубежи

М1: видимы Обзор/Настройки/честные подключения/context preview; выбранные срочные stream/search исправления подтверждены в разрешённой среде.

М2: каталог, категории/classes/Seat и бюджеты реально управляют видимым/вызываемым; unknown usage не скрыт.

М3: общие функции всех providers; изображения/документы/Excel/длинный код/учебный context показаны.

М4: GPU/models, история/cleanup/summary, update preservation, качество ответов и нагрузка приняты на точном релизе. Видео явно deferred. OAuth — честное подтверждённое решение, не обещание. Обязательные download/remote ComfyUI не исчезают из scope.

# 17. Покрытие и передача

[Матрица](../REQUIREMENTS_MATRIX.md) связывает 24 пункта последнего списка, 10 прежних замечаний и 6 новых находок с R и ASAI. Старый знак ✅ не является live acceptance. «Есть код» — REUSE/VERIFY baseline, не повод создавать дубликат.

Контролёр передаёт полный TASK_CONTRACT и все поля выбранной записи каталога, связанные R/C, свежий SHA/selection/permissions/environment. Недоступные источник/ключ — конкретный blocker. Не передавать только заголовок.

Отчёт: что видно → адрес и 3–6 действий → before/after/recording → SHA → tests/review → новые дефекты/непроверенное → раздельные integration/deploy/owner statuses. Короткий отчёт не заменяет evidence. #725/#750 продолжаются без дублей, #373 остаётся программой.

Программа не принимается при декоративном dashboard, tools только у одного бренда, alt вместо пикселей, анимации вместо streaming, переименованном CSV вместо XLSX, несовпадающем preview, readiness по одному имени, проверке ключей только по наличию, потерянных findings или обязательном UI «потом».

# Исходные точки исследования

Ориентиры относятся к аудиторскому SHA `4957352d412fb532afae1830ebc9812b609a1497`; перед изменением найти актуальные symbols.

| Область | Путь |
| --- | --- |
| Stream/tools/files | apps/api/src/ai-chat.service.ts, исходные диапазоны 1250–1316, 1650–1774, 1884–1969 |
| SSE | apps/api/src/ai-chat.controller.ts, 454–524 |
| Cloud/catalog | apps/api/src/ai-model-catalog.ts |
| Auto/search/thumbs | apps/api/src/ai-web-search.ts; ai-web-search-provider.ts |
| Галерея | apps/web/src/ai/AiWebEvidence.tsx |
| Markdown/code/export | apps/web/src/ai/AiMessageContent.tsx; ai-download.ts; AiAnswerDownloads.tsx |
| Chat/actions | apps/web/src/ai/AiChatPage.tsx |
| Admin | apps/web/src/admin/AiAdminWorkspace.tsx; AdminAiPage.tsx; AdminAiGenerationPolicy.tsx |
| Tests | apps/api/src/ai-native-search.spec.ts; e2e/ai-chat.spec.ts |
| Context/history | apps/api/src/ai-text-history.ts; ai-generation-policy.ts |
| Class/Seat | apps/api/src/ai-access.service.ts; apps/web/src/components/ClassroomAiAccess.tsx |
| Cleanup | migrations/0229_ai_private_attachments.sql; apps/api/src/ai-attachments/service.ts |

[Исходный baseline](https://github.com/spikeal8-maker/asa-lab/tree/4957352d412fb532afae1830ebc9812b609a1497), [программа #373](https://github.com/spikeal8-maker/asa-lab/issues/373), [доступ #725](https://github.com/spikeal8-maker/asa-lab/issues/725), [история #750](https://github.com/spikeal8-maker/asa-lab/issues/750).

Характеристики моделей/API и официальный Cloud login перепроверяются по первичным источникам на дату реализации. Исторические source checks и серверные receipts не повышаются до новых live PASS. Замену старых нормативов описывает [DOCUMENT_MIGRATION.md](../DOCUMENT_MIGRATION.md).
