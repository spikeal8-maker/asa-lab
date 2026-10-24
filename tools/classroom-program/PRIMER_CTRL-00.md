# Задача CTRL-00 — Принять единый v1.3-контракт: объединить v1.2+GAP-01…17, утвердить решения, создать 34-ID ledger, обновить current.yaml в main

Режим: ОДИН СРЕЗ → PREFLIGHT → IMPLEMENT → TEST → REVIEW → MAIN → STOP
Репозиторий: https://github.com/spikeal8-maker/asa-lab
Снимок origin/main для входа: `1c426cbe222e5630baccafd50eccc57452a81581` (до кода перепроверить)
Состояние задачи в реестре: `READY`
Требования: cross-cutting control
Зависимости: нет
Решения владельца: нет

## Один измеримый результат
Создать единый норматив v1.3 и canonically select only the first bounded work; unresolved owner decisions remain explicit BLOCKED gates.

## Разрешённая рабочая область (подсказка, уточняется preflight)
- `docs/product/**`
- `docs/execution/current.yaml`

Исходное описание границы: `docs/product/`, `docs/execution/current.yaml`; контролёр

## Приёмочные условия
- Текст v1.2 и GAP-01–17 reconciled; все 34 требования и 9 нерешённых продуктовых вопросов прослеживаемы; current.yaml не расширяет чужую задачу и не содержит фиктивных ACCEPTED.

## Обязательные адресные проверки
- pnpm agent:preflight --check
- pnpm control-plane:check

## Доказательства, без которых задача не принимается
- source: PASS и evidence с точным SHA (никаких NOT_RUN/скриншотов вместо PG)
- focused: PASS и evidence с точным SHA (никаких NOT_RUN/скриншотов вместо PG)
- review: PASS и evidence с точным SHA (никаких NOT_RUN/скриншотов вместо PG)
- integration: PASS и evidence с точным SHA (никаких NOT_RUN/скриншотов вместо PG)

## Ограничения и правила STOP
- Прочитать AGENTS.md, START_HERE_FOR_AI.md и docs/execution/current.yaml; запустить pnpm agent:preflight --path <путь> --check.
- Не считать этот бриф выбором канонической задачи. Выбор/согласование в main делает контролёр по правилам проекта.
- Не менять другие задачи, чужие незавершённые файлы, код активных ботов, пользовательские данные, DNS/VPN/сети.
- Не производить deployment Docker, PostgreSQL миграции на школьном сервере или продакшен без отдельного разрешения.
- Один исполнитель на пересекающийся путь; независимый рецензент проверяет финальный SHA.
- При конфликте/неопределённом API или праве/красном собственном gate — STOP и точный отчёт.
- Отдельно указать code_sha, CI URLs/conclusions, review actor+SHA, integrated main SHA, deployed=NOT_RUN, owner=NOT_ACCEPTED.
- STOP после одной карточки: следующий шаг выбирает контролёр.

## Источники требований
- sources/ASA_Lab_TZ_Classrooms_Teacher_Student_UI_v1_2_TWO_ROW_MOBILE_2026-10-24.md
- sources/ASA_Lab_TZ_v1_2_CRITICAL_AUDIT_2026-10-24.md
- sources/ASA_Lab_TZ_v1_2_EXECUTION_READINESS_REVIEW_2026-10-24.md
- https://github.com/spikeal8-maker/asa-lab/issues/589
- https://github.com/spikeal8-maker/asa-lab/issues/618
- https://github.com/spikeal8-maker/asa-lab/issues/211
