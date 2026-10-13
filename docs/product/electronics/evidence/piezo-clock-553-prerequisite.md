# Подтверждённая зависимость №552: canonical piezo clock

Программа №452; отдельный bounded product repair [№553](https://github.com/spikeal8-maker/asa-lab/issues/553). Это классификация существующего дефекта, не исправление и не приёмка №552/№553.

## Точная исходная версия и механизм

Source7f0ececa77bb5738ea4a2e6ee986887ca1ab3a65, tree293b3df1585b2107a438e1996557fe42342d5d7b. Все18 релевантных оригинальных исходников совпадают с последующим runtime baseline c8545ceca6690b7314a857aef606cd24397edd80; его General38135902291 завершился SUCCESS по всем4 jobs. Это не CI будущего ремонта.

- model-identity.ts100–101: обе piezo-passive-buzzer/piezo-disc имеют piezo-transducer.
- arduino-circuit-scheduler.ts83–94/199–232: installed ID отсутствует в обоих допустимых наборах.402–408: fault clocked_profile_unsupported до исполнения плат, включая H0 и отсутствие Arduino.
- Canonical controller не публикует preflight как runtime ready, fault останавливает generation. Audio hook создаёт голоса только из работающего solved piezo result. Поэтому замена детали резистором или непосредственный DC presenter не выполняет полный native tone journey.
- Существующие solver/piezo/waveform модели уже описывают алгебраическую нагрузку и tone/noTone; новое физическое предположение для этого сопряжения не требуется. Простого whitelist diff недостаточно без временного conformance.

## Сохранённые оригиналы и независимая проверка

Actual controller original552-piezo-clock-dependency-actual.json SHA2569b5d53211389446c125706f0b4958eeeab9539ce90574f5ac34033f448e1f082 содержит полный normalized schema4 fixture5parts7wires и requests/responses. Последовательность: preflight solved=true, finite/passed=true, maxKclResidualAmp7e-12; advance requested=committed0, executionStatus=fault/result:null/clocked_profile_unsupported; status stopped, saved=[]; requests preflight→advance→cancel-generation.

Новый независимый read-only checker проверил original Git sources и прежний log; classification report SHA2560cc8e7d699bc81fd1fdb3d5d233f3d7091b65f41a6578620107d4a0cba69d7b4, manifestb9a44397b237c4ba0eae9c01ac7a7b3172009324a323f3f789ba2d4eeacf67de (20 файлов). Его отдельный design проверил полный новый controller original: reporte647941efe01fe0c57c8ab7b7f08d58f17440a640efe3b31cdbe7a7f1e6d58c3, manifest65a014efccb08de0e9c95a35526bac000484c7215ffebef970ccd19c59abc8c1 (21 файл). Контроллер самостоятельно сверил все hashes, original Git bytes, реальные preflight/fault/Stop/0Save; повторных измерений для классификации не запускал.

Оригиналы хранятся у контроллера в C:/Users/spike/.codex/temp/electronics-e01; raw JSON, logs, manifests и исходники сохранены. Документ не подменяет доступ к оригиналам для review или одинаковый production-browser BEFORE/AFTER будущего ремонта.

## Границы

Частота на школьных устройствах и исходная ученическая схема не доказаны. Native PCM требование №552 остаётся acceptance blocker до отдельного принятого №553 и нового exact composition/review. Controlled startup tests и отдельный DC audio-presenter test не заменяют canonical pupil tone/noTone/Stop.

DC cache после прекращения быстрых digitalWrite — отдельная статическая гипотеза, не измеренный дефект. Проверять направленно; изменять только после доказательства. Timeout/physics/quantum/budget/state/schema и fail-closed не ослаблять. Никаких изменений установки/БД/сети/backups; школьные T3/класс/физическая слышимость остаются pending.
