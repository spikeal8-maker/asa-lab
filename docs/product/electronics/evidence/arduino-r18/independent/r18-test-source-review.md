# Независимое R18 e2e source review

**Решение: APPROVE_TEST_SOURCE.** Оба конкретных дефекта исходной версии исправлены. Одобряется исходник четырёх новых тестов с SHA256 `092ae57fdcd0395cee667aa627542371a46519a79d0e86cd4d7e7470ab5c604b` относительно `59fb260f5533a6f536a33417fe249c60b9bf9623`. Это не результат браузерного прогона, не product PASS и не приёмка первой пользовательской вехи.

## Точный объект

| Поле | Значение |
|---|---|
| Файл | `e2e/electronics-ready-cadence.spec.ts` |
| SHA256 одобренного файла | `092ae57fdcd0395cee667aa627542371a46519a79d0e86cd4d7e7470ab5c604b` |
| Git blob | `9b79a4b569ea699d9ae88a0c3fbe5fc7a9098b49` |
| Размер | 98001 B |
| Семь прежних тестов | Побайтово сохранён исходный префикс 58 527 B |
| SHA256 префикса | `74e45a784a4880a90834a92bda1034086721bf190f0f04179427544e4b8030e5` |
| Добавление | 967 строк, четыре теста; всего 11 |
| SHA256 patch | `f1ccd8c28ca6ee7cec15d30a6ae187aa143cbde65775a6d9bc51ab602245e13f` |

Reviewer — `/root/acceptance_review`; product source имеет отдельное заключение `APPROVE_SOURCE_ONLY` в соседних `r18-source-review.json` и `r18-source-review.md`. Root сообщил размещение этих точных frozen blobs в source `d4e2bb1e23730e162afc064e0cfb01a94e423333` и candidate `10298adebf11d61636465bfe4b8691b36fc23913`; независимое одобрение привязано к хешу файла и базе 59fb260.

## Что реально проверяют новые случаи

| Случай | Физическое доказательство | Paint и lifecycle |
|---|---|---|
| Delay 2000 ms | H≥8 100 000 µs, минимум два полных цикла каждого LED; physical half 2000–2000.01 ms | Минимум два loaded-image цикла, duty 45–55%, half 1750–2250 ms, period 3750–4250 ms; каждый confirmed timestamp связан с actual preceding ready |
| Delay 1 ms | H≥1 500 000 µs, реальные резисторы 330/680/1000 Ω; ≥500 полных циклов; half 1–1.01 ms; duty 49–51% | После H≥100 000 µs средняя каждого LED отдельно сверяется с суммой brightness×held-duration за полные циклы. Every-RAF отклонение от округлённой средней ≤1, диапазон колебаний ≤1; loaded-paint span ≥1000 ms, ≥30 кадров |
| Independent millis | Самостоятельные half-periods 500/200/100 ms, первые переключения 500/125/50 ms, initial vector 101, H≥2 250 000 µs | Проверены полные циклы и различие векторов; causal whole-vector matching отвергает неправильную фазу при правильной частоте |
| Actual board Reset | Trusted click, новый generation, H0, история начинается с0; setup 010 длится 500 ms, затем fast loop | Каждый actual RAF между первым physical 010 ready +50 ms и первым loop-ready обязан exact 010 с loaded images. Дополнительно ≥8 causal confirmed witnesses; затем снова fast brightness |

Все ready проверяются на solved/quality/complete H, continuation horizon и корректные request/response generation. У optical samples проверяются непрерывность C→H, отсутствие truncation, действительные currents, пересчитанные integral/lit-duration/transitions и совпадение конечного sample с electrical component. Yielded не может публиковать optical/components. Полный сохранённый draft сравнивается после Stop.

## Устранённые ложные PASS

**E2E-1 — инверсия фазы D12.** В отвергнутом `d067f102d16f81390a92d68ebdc2c91ffa237dc1335503b7f92c93d9b8f751b4` частоты и duty были отделены от electrical phase. Независимый контрпример с полностью инвертированным D12 проходил: пять циклов, duty 0.4805194805194805, period 385 ms и все требуемые векторы присутствовали. Физические проверки при этом можно было оставить правильными.

Теперь каждый `witnessAt` внутри сжатого run сопоставляется с actual solved+quality complete ready того же source и активного generation, доставленным до paint. Полный округлённый физический вектор должен совпасть. Допускается состояние, которое ещё текущее либо было superseded не более 50 ms назад. Active generation определяется по actual request clock, поэтому поздний старый ответ не возвращает себе актуальность. Проверка всех timestamps закрывает случай, когда first/last совпали, а целая внутренняя фаза неверна.

**E2E-2 — старая средняя яркость после Reset.** Старый positive-only фильтр игнорировал неверные `[33,33,33]` в части setup, если позже набирались восемь правильных кадров. Точный контрпример отбрасывал 18 неверных кадров и засчитывал 10 правильных. Теперь проверяются все actual RAF внутри гарантированного setup interior; неверный вектор или неподготовленное изображение создают violation. Количество правильных кадров проверяется дополнительно и не скрывает неверные.

Оригинальный отвергнутый исходник, patch, manifest и воспроизводимый pure-helper контрпример сохранены в `rejected-d067/`. Это история review, не исполняемый продуктовый результат.

## Независимые проверки исправленного oracle

Выполнены **20/20 exact-helper challenges**, включая **14 отрицательных**. Проверялись точная граница 50/50.001 ms, постоянное текущее состояние, недопустимое совпадение с будущим ready, поздний старый generation и сохранение нового, чужой source, failed quality, incomplete ready, response/request mismatch, повтор старой фазы, clipping окна по всем timestamps, инверсия D12, задержка 100 ms, скрытая внутренняя фаза и ошибки всех кадров Reset. Корректный сигнал с actual ready spacing 25 ms и UI lag 20 ms принят.

Результат — `r18-independent-oracle-check.json`, воспроизводимый скрипт — `r18-independent-oracle-check.cjs`. Скрипт извлекает точные функции из файла указанного SHA256 и не запускает браузер или продукт. Author manifest дополнительно подтверждает narrow TypeScript/ESLint/Prettier и Playwright list 11 после исправления. Reviewer не запускал полный suite.

## Граница этого решения

Предел 250 ms проверяет разницу полного model span и wall span; его нельзя называть измеренным максимальным lag каждого ready. Предел 50 ms — отдельная разрешённая задержка публикации paint после superseding ready. Для 2000/millis причинность относится к подтверждённым loaded-paint witnesses; для 1 ms дополнительно проверяется каждый RAF против beat, для setup Reset — каждый RAF против неверного состояния.

Свежий exact-candidate browser/CI и review raw JSON/native pixels остаются самостоятельными следующими шагами. Эти четыре теста используют API fixture для подготовки схемы и реальные editor/Save/Run/Stop/Reset, поэтому отдельно не заменяют ручной wiring, Blockly round trip и весь первый пользовательский рубеж.

Зафиксировано: 2026-10-18T06:59:51.267Z.
