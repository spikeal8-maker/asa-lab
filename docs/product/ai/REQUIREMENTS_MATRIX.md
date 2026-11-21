# AI v1.1 — матрица требований владельца и аудита

[Единое ТЗ](../ASA_AI_ASSISTANT_SPEC.md) · [Задания](PROGRAM_DEFINITION.json) · [Вход](README.md)

Это трассировка требований, не текущее execution state. Столбец baseline относится к проверке SHA `4957352d412fb532afae1830ebc9812b609a1497`. «Код есть» означает REUSE/VERIFY, не новый live PASS. Фактическое исполнение — current.yaml и связанные Issues #373/#725/#750.

| ID | Требование | Историческое основание | R | ASAI | Видимая приёмка |
| --- | --- | --- | --- | --- | --- |
| OWN-A01 | Первым AI-дашборд: графики, запросы, токены | AiAdminWorkspace: отдельного Обзора нет | R19, R20 | ASAI-01, ASAI-02 | Настоящие показатели/два графика/фильтры сверены с БД |
| OWN-A02 | Настройки вторыми | Прежний SECTIONS порядок иной | R19 | ASAI-01 | Второй рабочий раздел desktop/mobile |
| OWN-A03 | Отдельные prompt/settings/search/images | Разделы существуют | R19 | ASAI-01, ASAI-03, ASAI-04 | Прежние действия сохранены после реорганизации |
| OWN-A04 | Разрешённые модели/default | Общая policy существует | R21, R22 | ASAI-03, ASAI-04, ASAI-06, ASAI-07, ASAI-08, ASAI-09, ASAI-10 | Save/reload/server deny, выключенная не ready |
| OWN-A05 | Автоматический каталог всех API | Static cloud/single local alias | R21 | ASAI-06, ASAI-07, ASAI-08, ASAI-09 | Real discovery/source/time/stale и отдельные local models |
| OWN-A06 | Модели ученикам/категориям | ai-access contract без model policy | R22 | ASAI-10, ASAI-11 | Разные списки и отказ HTTP spoof |
| OWN-A07 | Токенные бюджеты категорий | Request quota не token budget | R23 | ASAI-12 | Budget реально меняет admission/остаток/reset |
| OWN-A08 | Краткий prompt, полный код | Есть validation gap | R14, R24 | ASAI-04, ASAI-32 | Save без потерь, полнота кода не жертва краткости |
| OWN-A09 | Дата/время/пояс/имя | Default context gap | R24, R33 | ASAI-04, ASAI-05 | Default/custom и preview используют разрешённые факты |
| OWN-A10 | Info-подсказки переменных | UI foundation существует | R24, R31 | ASAI-04, ASAI-05, ASAI-18 | Hover/focus/tap, кратко и без fake values |
| OWN-A11 | Что известно обо мне | Реального preview нет | R24, R33 | ASAI-05 | Value/source/time/scope и exact context без inference |
| OWN-A12 | Пол и геопозиция | Постоянный fallback | R24, R33 | ASAI-13 | Добровольный источник, denied/missing, без догадок |
| OWN-A13 | Класс/курс/проект/аватар/устройство/профиль | Нет полного разрешённого контекста | R24, R33 | ASAI-13, ASAI-14 | Полевая матрица и выбранный объект с grants/version |
| OWN-A14 | Tool cards/conditions/limits/instructions | Карточки есть, исполнение частично | R01, R02, R19 | ASAI-03, ASAI-21, ASAI-22, ASAI-23, ASAI-24 | Карточка соответствует вызову; deny реально действует |
| OWN-A15 | Search enable/limits/domains/instructions | Код есть, historical runtime off | R06, R07 | ASAI-19, ASAI-21, ASAI-25 | Разрешённое enable, real sources, server policy |
| OWN-A16 | Image enable/sizes/daily limit | Базовый UI/контур есть | R27 | ASAI-35, ASAI-36 | Settings влияют на job, отказ до GPU |
| OWN-X01 | Comfy, message actions, code/image/docs download, previews | Foundation не полная приёмка | R16, R17, R18, R27 | ASAI-17, ASAI-18, ASAI-34, ASAI-35, ASAI-36 | Реальные bytes/pixels/source/reload, reuse без второго чата |
| OWN-X02 | Tools у всех моделей с вложениями | Native local/attachment exclusion | R01, R02, R10 | ASAI-21, ASAI-22, ASAI-23, ASAI-24, ASAI-25 | Одинаковые просьбы в четырёх providers |
| OWN-X03 | Законченные длинные ответы | Повышенные limits не закрытие | R14, R26 | ASAI-32, ASAI-40 | Контрольный код работает либо причина+continuation |
| OWN-X04 | Поиск картинок/миниатюры Bing | Early exit подтверждён в baseline | R08 | ASAI-20 | Поздняя миниатюра найдена; реальные пиксели |
| OWN-X05 | Несколько generative models/download/remote Comfy | Реализовано частично | R27, R34 | ASAI-35, ASAI-36, ASAI-37, ASAI-38 | Remote config, два recipes, реальные progress/delete |
| OWN-X06 | Ollama Cloud key/OAuth | Key path есть, delegated protocol не подтверждён | R35 | ASAI-08, ASAI-42 | Рабочий key и честное официальное решение без fake OAuth |
| OWN-X07 | Нежелательные картинки | Фильтры без абсолютной гарантии | R08, R31 | ASAI-20, ASAI-21 | SafeSearch/negative tests/понятный отказ |
| OWN-X08 | Видео — будущая возможность | Отложено, не реализовано | R29, R35 | ASAI-18, ASAI-44 | Soon без active call/расхода |
| AUD-01 | Постепенный ответ | Suppressed delta в ai-chat.service | R03 | ASAI-15 | Первая delta до done при offered-unused tools |
| AUD-02 | Рабочий Excel/CSV | Raw code export | R15 | ASAI-33 | XLSX открыт Excel, корректный CSV |
| AUD-03 | Иконки и боковое меню | UI repair по исходникам/жалобе | R17 | ASAI-17, ASAI-33 | Короткие подсказки, menu внутри mobile screen |
| AUD-04 | Реальные стадии вместо Готовлю | Busy-only indicator | R04 | ASAI-16 | Server-backed stages, спокойный accent |
| AUD-05 | Key/settings preservation | Историческое сравнение/decrypt PASS, не новый прогон | R28 | ASAI-03, ASAI-04, ASAI-43 | Новое разрешённое update сравнение без plaintext |
| AUD-06 | Большие файлы/документы | Ограниченный context | R11, R12 | ASAI-26, ASAI-27, ASAI-28 | Факт в конце прочитан с provenance |
| AUD-07 | Cloud Vision | Adapter gap | R13 | ASAI-29, ASAI-30, ASAI-31 | Реальный pixel test/no-Vision honest |
| AUD-08 | 20 диалогов/объекты | Cleanup есть, policy не закончена | R25 | ASAI-39 | Protected current, safe21, actual S3 cleanup |
| AUD-09 | Длинный context | Character trimming | R26 | ASAI-40 | Token threshold/versioned summary/original |
| AUD-10 | Код/docs/quality | Недостаточен execution contract v1.0 | R29, R30, R31, R32 | ASAI-01, ASAI-15, ASAI-18, ASAI-44 | Видимые срезы, честные состояния и findings |
| NEW-01 | Общий синтаксис {{ name }} | UI/API expression mismatch | R24 | ASAI-04 | UI/API/preview одинаково нормализуют |
| NEW-02 | Local ready не только по имени | !!localModel mapping | R19, R21 | ASAI-03, ASAI-09 | Enabled/probe/model/revision правдивы |
| NEW-03 | Default context не теряет профиль | Пустой {} в default path | R24, R33 | ASAI-05 | Имя/пояс до custom save, preview parity |
| NEW-04 | Фактические capabilities | Global false flags | R13, R21 | ASAI-06, ASAI-07, ASAI-08, ASAI-09, ASAI-29, ASAI-30, ASAI-31 | Support/adapter/permission раздельно |
| NEW-05 | Comfy graph status не постоянная надпись | Static unverified message | R19, R27 | ASAI-35, ASAI-36 | Receipt/time/revision реального smoke |
| NEW-06 | AGENTS и видимое исполнение | V1.0 противоречила direct_main и demo gate | R30, R31, R32 | ASAI-01, ASAI-44 | Actual policy, один показ за срез, новые дефекты учтены |

Все 24 пункта последнего списка представлены OWN-A01–A16 и OWN-X01–X08. AUD-01–10 сохраняют ранние замечания, NEW-01–06 — дополнительные source/process находки. Это 40 связей требований, не 40 выполненных задач.

Исходные точки и исторический SHA приведены в [главе 10](spec/10-program-and-references.md). Датированные отчёты в `docs/reports` — доказательства прежних срезов, не текущие статусы. Новое выполнение и найденные позже дефекты фиксируются по R32 в каноническом execution-контуре. Ни один старый знак готовности не заменяет свежую демонстрацию.
