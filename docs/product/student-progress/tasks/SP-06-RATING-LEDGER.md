# SP-06 — журнал зачтённых вкладов

**Зависимость:** принятая версия правил SP-05. **Класс:** L3 данные.\
**Нормы:** DATA_AND_RATING_CONTRACT; identity/learning invariants.

## Результат

Общий рейтинг рассчитывается сервером по проверяемым источникам. Каждый вклад и исправление имеют происхождение; повтор запроса, новая форма входа или повторная проекция не увеличивают баланс.

## Scope

Новая additive schema и restricted functions для зачётов; source adapters; reconciliation и read projection. Никакой записи обратно в Gradebook, Completion или Result. Не переделывать tenant/RLS архитектуру: новые таблицы защищаются в существующей модели. Номера миграций выбираются после свежего frontier check.

## Обязательное поведение

Уникальный semantic source key, owner/identity proof, rule version, source time, recorded time, delta и основание. Коррекции append-only со ссылкой на исходный зачёт. Повторная отмена не вычитает вклад повторно. Projection rebuild даёт тот же результат. Transaction rollback не оставляет баллы.

Реализация выбирает атомарную запись либо существующий надёжный transactional event механизм; volatile in-memory event и чтение «последних N» не являются надёжной доставкой. Никакого нового отдельного сервиса для этого не требуется.

Исторический импорт использует только доказанные источники; raw copies без получателя не превращаются в unique-recipient XP. Изменение формулы не молча переписывает баланс при запуске приложения. Link/revoke/correction обновляют разрешённую проекцию без уничтожения исходной истории.

## Приёмка

100 повторов, lost response, параллельные записи, rollback, повторная публикация, unlike/re-like, поздний identity link, отменённый результат и raw self copies не дают лишних баллов. Любая попытка клиента назначить себе delta отклоняется. Миграция проверена на существующей базе fixtures и restricted application role; есть recovery/reconciliation proof и независимый review.

## Выход

Server total и история совпадают с точными SP-05 fixtures. Product activation и безопасное отображение выполняются SP-07; рабочая БД и deployment в этот этап не входят.
