# ASA Lab — единая очередь интегрированной реализации

Объём и порядок определяет принятое [интегрированное ТЗ V1.2](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md).
Это единственная Work Queue; активная задача и checkpoint читаются из
[`current.yaml`](../../execution/current.yaml) и поручения владельца.
Строка очереди не является evidence или разрешением на production.

| Этап | Task | Полный результат | Нормативный раздел |
|---|---|---|---|
| Э1 | LRN-COURSE-01 | Библиотека, теория+проект, назначение, Account/Seat, условия, сдача, проверка/доработка, selected result, матрица, in-app и собственные настройки | [§7](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md#sec-07) |
| Э2 | LRN-COURSE-02 | Тесты и остальные виды работ, полная педагогика курса | [§8](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md#sec-08) |
| Э3 | ASA-SELF-01 | Public reading, personal learning и bilateral linking | [§9](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md#sec-09) |
| Э4 | ASA-COLLAB-01 | Команда курса, scoped приглашения и помощь | [§10](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md#sec-10) |
| Э5 | ASA-ORG-01 | Организация, группы, адаптация и сводка | [§11](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md#sec-11) |
| Э6 | ASA-EXPERIENCE-01 | Полнота настроек, данных, поддержки и модерации | [§12](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md#sec-12) |

Внутренние checkpoints выполняются самостоятельно. Ни один из них не закрывает
целый этап. Критерии Э1: INT-E1-01–18, PLAN4-E1-01–12 и связанные ADD/UIA.
Полный каталог критериев и зависимостей хранится в ТЗ, evidence — в существующем
[Requirements Ledger](../ASA_LEARNING_REQUIREMENTS_LEDGER.yaml) и одной рабочей
заметке [LRN-COURSE-01](execution/LRN-COURSE-01.md).

## Историческое соответствие

V4 сохраняет шесть ID этапов из §6 интегрированного ТЗ. V3.1 Э1 / LRN-COURSE-01
сохраняет свой ID и законченный цикл; V3.1 Э2/Э3 покрываются новым Э2,
V3.1 Э4 распределён между Э4/Э5, V3.1 release-проверки Э5 применяются к каждому
кандидату по §20. Дополнение self-study/linking находится в Э3.
Полный mapping находится в [§18.8](../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md#sec-18).

Предыдущая V3.1 сохранена в Git на baseline
`b963ef828f0e10042adacba4199bba972526c0df`.
M0/M1/VS IDs, Master requirement IDs и Result A сохраняют существующие evidence;
они не становятся вторыми активными задачами. Их исторические документы не
переписываются ради нового плана.

## Постоянные границы

Access определяет пользователей и scoped permissions; Learning Master и ADR —
академическую семантику. V1.2 уточняет интеграцию и срок поставки, а код и
миграции определяют CURRENT. Все новые writes используют существующие ядра.
Кандидат доказывается настоящим UI, API/DB negative tests и применимыми gates.
Следующий этап требует отдельного поручения; внутренние этапы Э1 — нет.
