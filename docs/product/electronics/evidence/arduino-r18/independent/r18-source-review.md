# Независимое R18 source/math review

**Решение: APPROVE_SOURCE_ONLY.** Проверены 15 замороженных путей относительно `59fb260f5533a6f536a33417fe249c60b9bf9623`. Это заключение об исходном коде, тестах и контрактах; оно не является приёмкой продукта или результатом браузерного прогона. Reviewer: `/root/acceptance_review`.

## Точная граница review

| Артефакт | SHA256 |
|---|---|
| Source manifest | `0281b0ca452b744b6c34e0bfeb68899231601dd078d6da7934d0a2d8b159bb02` |
| Product/tests/contracts patch | `f187a819b4ccdd2ab272fa21129489bead3faccb6c07e1d135a639ea990012db` |
| Fresh focused log | `a80c2971420bdc05be0b7fe18e014b5baae3413f8a9ec639698d9823be53792a` |

Все 15 файлов повторно совпали по размеру, SHA256 и Git blob. Полный список находится в соседнем JSON. E2E-файл исключён из source manifest и имеет отдельного автора.

## Проверенная математика и границы

Collector использует уже существующие quality-checked physical commits, seed и final ready. Held area интегрируется как сумма фактической brightness на длительность состояния; seed клипируется к C, даже если physical checkpoint старше C. Same-time GPIO не создаёт энергию нулевой длительности и после обратного перехода не оставляет ложный фронт, в том числе у полного ring. Дополнительных solve/barrier/пропущенных инструкций не введено. Приватная история сохраняется через yield и отбрасывается при fault/cancel; наружу выходит только complete ready.

У каждого LED отдельная история. Fast mean требует двух полных циклов с четырьмя полупериодами строго меньше 25 ms, учитывает изменение амплитуды внутри светлой фазы и истекает строго в 25,000 us после последнего фронта. История 125 ms с предшественником и пределом 513 samples сохраняет необходимую площадь возле порога. Delay2000/100/50 сохраняют реальные фазы.

Physical current и actual health определяют допустимость света. Disconnected, reversed и фактически failed LED не получают среднюю яркость. Публикация result и map атомарна; generation/Stop/Reset/fault/cleanup обнуляют историю, stale callback не восстанавливает её. Metadata `ordinary-led-held-v1` остаётся optional presentation evidence и не меняет canonical saved physical state.

## Найденные и исправленные дефекты

1. История 100 ms теряла необходимый первый фронт при 24-ms полупериодах и ready143 ms. Исправлена на 125 ms плюс предшественник; сохранён expiry25 ms.
2. `stressState=burned` ошибочно трактовался как фактический разрыв. Реальный engine до 4,000,000 us ещё даёт I≈0.397126 A, brightness100, lit=true, damage=none и presentation=destructive. Теперь guard использует только actual failure; до него разрешённое root отображение — существующий overcurrent, после него — burned и 0.

Прочитан реальный mixed regression на 3999999/4000000/4000001 us: отдельный защищённый fast LED сохраняет среднюю величину около 50% собственного physical peak на всех трёх ready; failed LED получает 0. Mounted tests проверяют до/после failure, приоритет actual failure над reverse, atomic publication, Reset и игнорирование старого callback.

## Проверки

Свежий неизменённый author log содержит 746/746 domain tests в 45 файлах и 519/519 web tests в 49 файлах, успешные typecheck27 проектов с 15 зависимыми задачами и build27 проектов. Три cache-skipped segment подтверждены по raw log. Reviewer не перезапускал полный suite и браузер; independently прочитаны точные assertions и выполнены небольшие in-memory математические проверки. Ранний `focused-attempt1.log` с тремя test-only TypeScript ошибками заменён финальным успешным логом. Narrow lint/format/routing и bundle200247/209000 B дополнительно подтверждены автором.

## Что остаётся вне решения

Отдельное e2e-source review, реальные exact-candidate CI/browser/raw artifacts и пользовательская первая веха ещё требуют своих результатов. Source approval не подтверждает ручное создание схемы, Blockly round trip, сохранение и повторное открытие в полном пользовательском сценарии, школьный T3 или нагрузку 15+15. Старые R17 и baseline General не используются как доказательство нового R18 PASS.

Зафиксировано: 2026-10-18T06:51:30.617Z.
