# R18: независимое дополнение по стоимости thermal fixture

**APPROVE_TEST_FIX_SOURCE_ONLY.** Одобряется единственный test-file delta поверх `10298adebf11d61636465bfe4b8691b36fc23913`. Прежние source/e2e approvals и `review-index.json` сохранены побайтово.

## Точный объект

- Файл: `apps/web/src/electronics/testing/led-temporal-presentation.spec.ts`.
- Новый SHA256: `8e21e809b165b6a8dec41288b89cb66e9f5a8f54182935569173b4e548a6e6de`; Git blob: `8bea33ab8de18627622f99d3d877a52886d5338b`; размер: **15 901 B**.
- Предыдущий SHA256: `c53fe35b0156721d73dad94ac6730e6b98eac1d9d26a7ad60932f9f8f88c7a5c`; Git blob: `890ab344bd093bed0b71805798a425054665529b`.
- Patch SHA256: `7d0ae5f082090348b706ea23db524bddcdefa1ecfc815527cd0018a6cb0bb733`.

Независимое обратное побайтовое сравнение подтвердило: весь файл отличается только тремя строками комментария и добавлением настоящего `delay(3990)` в `setup()` тестового sketch. Loop с `delay(1)`, схема, все assertions, все три горизонта, returned-state continuation, остальные 27 случаев и штатный timeout **5000 ms** не изменены. E2E остаётся `092ae57fdcd0395cee667aa627542371a46519a79d0e86cd4d7e7470ab5c604b`.

## Причина и сохранённый смысл теста

Directed run **39106177040**, focused job **117612380512** завершился единственным timeout этого случая: **5561 ms** при пределе **5000 ms**. Domain имел 746 PASS; editor — 518 PASS и один timeout. Assertion failure в raw log отсутствует; browser был пропущен.

Защищённый LED теперь начинает переключаться в последние 10 ms перед границей. Overdriven LED остаётся напрямую на реальном 5 V с модельного t=0. Engine проходит полные четыре секунды; первый request действительно идёт из0, следующие продолжают фактически возвращённый state. Ни GPIO, ни температура, ни damage/brightness/clock не подставляются. Четыре полных настоящих цикла защищённого LED сохраняют причинный смысл проверки его отдельной mean через отказ соседа.

## Реальная физика на прежних горизонтах

| H, µs | C, µs | Overdriven I, A | Brightness | Health / damage / presentation | Protected projected mean |
|---|---|---|---|---|---|
| 3 999 999 | 0 | 0.397368421053 | 100 | overheated / none / destructive | 34.99253865336658 |
| 4 000 000 | 3 999 999 | 0 | 0 | failed_open / failed / failed | 34.99253865336658 |
| 4 000 001 | 4 000 000 | 0 | 0 | failed_open / failed / failed | 34.99253865336658 |

Все три ready имеют quality PASS. До порога overdriven остаётся `lit=true`, `stressState=burned`, `damageState=none`; actual `failed_open` появляется именно на4 000 000 µs. Проверки физического состояния и того, что overdriven не получает averaged override, сохранены.

Независимо извлечённый literal fixture из текущего spec точно равен fixture в raw proof. Пересчитаны все protected samples: 10 фронтов, HIGH **1002 µs**, LOW **1003 µs**, четыре полных цикла и actual peak **70.02**. Последние два полных цикла занимают **4010 µs**, их интеграл **140320.08 brightness·µs**, средняя **34.99253865336658**. Средняя по четырём полным циклам совпадает. Полная площадь первого request — **350800.2 brightness·µs**, lit duration **5010 µs**.

На трёх горизонтах последний front имеет возраст **974/975/976 µs**, поэтому сохранение fast mean соответствует существующему expiry25 ms. Следующие requests содержат мгновенный LOW защищённого LED, но отдельная средняя его реальных последних циклов сохраняется; физический отказ другого LED её не подавляет.

## Бounded validation и provenance

Одну и ту же narrow Vitest команду автор выполнил по одному разу до и после правки, с одним worker и прежним timeout: **1767 → 544 ms**, снижение локальной стоимости на **69.21%**. Оба запуска — **1 PASS /27 skipped**. Reviewer прочитал raw logs и не дублировал тест или полный suite. Эти измерения не являются гарантией будущей длительности CI.

Raw evidence находится в `r18-evidence/test-cost-fix/`: `manifest.json`, `candidate.patch`, `baseline.log`, `candidate-case.log`, `actual-boundary-proof.json`, `PROVENANCE.md`. Их размеры/SHA256 проверены и записаны в соседний JSON. Сверены hashes действительных engine source, compiled engine и projector. Extra trace создан inline probe; сам probe script отдельно не сохранён, но сохранены точный fixture, полный component/sample/quality output и письменный provenance. Решающий narrow test PASS выполнял неизменённые assertions через штатные source aliases.

Одобряется **однофайловый test-source fix**. Новый exact directed CI и browser/product acceptance остаются отдельными шагами.

Зафиксировано: 2026-10-18T07:23:29.194Z.
