# Независимая проверка №545 R1 — REQUEST_CHANGES

Дата: 10.10.2026 Europe/Moscow. Проверен опубликованный exact SHA `16997f1697c35cdfe7e34c0e251137f008478017`, tree `308bea69bce2e62bbb495a1ad30b6c645ba08cee`, ветка `codex/electronics-ci-image-transport-545-r1`. Новый рецензент не использовал авторский отчёт или старое мнение контроллера как доказательство. Репозиторий и Git refs не изменялись; только собственные внешние proof/report файлы.

## Обязательное исправление

**[P2] Semantic guard сохраняет наличие элементов trigger, но пропускает фильтры, выключающие обязательные проверки.**

`tools/test_ci_image_transport.py:82–95`: `contains_required` рекурсивно проверяет только наличие исходных ключей и элементов списков. Дополнительные ограничения события остаются незамеченными. Собственные in-memory вызовы реального `check_offline`, с исходной receipt и без изменения checkout, приняли все три недопустимых варианта:

1. General `on.push.paths: [docs/never-this-file.zzz]` — обычный push в main с продуктовым изменением больше не запускает общий gate.
2. General `on.push.paths-ignore: ['**']` — все файловые изменения исключены.
3. Focused `on.pull_request.paths` с добавленным в конец `!**` — все обязательные положительные пути остаются в списке, но последнее отрицание исключает их.

Это противоречит обещанной защите required triggers и сохранению обязательного CI при переходе от полного hash к semantic guard. Сами текущие workflows не содержат этих фильтров; обнаружен воспроизводимый пробел нового валидатора, а не утверждение о выключенном текущем CI. Семантика path-фильтров и последовательных отрицаний подтверждена [официальной документацией GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore).

**Узкий R2:** проверять coverage обязательных событий, запрещая новые ограничивающие path/branch/event filters и отрицательные patterns относительно исходного контракта. Положительное добавление time.spec и других тестовых путей должно продолжать проходить без изменения исторической receipt. Добавить направленные отрицательные проверки трёх воспроизведений; сохранить существующие mapping, build, gate, permissions, health, timeout, frozen/cache/revision checks. Не возвращать полный исторический hash lock. Продукт, школьная установка и сетевые настройки не затрагиваются.

## Независимо подтверждено

- Read-only `pnpm agent:preflight --scope electronics-ci --check`: SAFE_TO_START; canonical TASK-ELECTRONICS-CI-IMAGE-TRANSPORT-001 / in_progress / R1 checkpoint; dirty0, overlaps0, execution blockers0, CONTROL_PLANE PASS. Прочитаны политика/start/router/delivery/review/deployment contract/full portable standard, card и исходный REQUEST_CHANGES c72.
- Фактический remote main `9ffe10100ed14dbf579bf44b91ca19fb435e80b8`; candidate remote HEAD совпадает exact16997. Divergence main...candidate `1 / 3`. Чистое рабочее дерево сохранено.
- R1 относительно parent изменяет ровно два разрешённых пути: helper и receipt; **3786** остальные mode/blob tree entries идентичны. Cumulative diff относительно canonical main selection562254ce — ровно первоначальные пять разрешённых CI путей. Нет product/Dockerfile/production Compose/package/lock/asset/test/timeout изменения.
- Все исходные поля receipt6ff сохранены побитово по распарсенным значениям, включая hashes, dates, image identities, ordered layers и provenance. Добавлен semantic contract. Full hashes вызываются только opt-in `--baseline-proof`; текущий обязательный CI их постоянно не вызывает.
- Непосредственный `python tools/test_ci_image_transport.py --self-test --baseline-proof` PASS: semantic check, 19 авторских challenges, исходная одноразовая projection/hash proof. Результаты получены при запуске, без Nx/cache и без Docker.
- Собственный challenge с **фактическим package.json a741cb4256a180cb87a69d60e8c65fd84a410f4e** плюс добавленным time.spec path PASS. Harmless metadata и workflow comment PASS. Это устраняет исходный блокер старого6ff.
- Собственные отрицательные проверки job continue-on-error / if:false / timeout, permissions, PostgreSQL health, Node buildarg/digest, Compose overlay, frozen install, Nx literaltrue и revision отклонены. Три trigger coverage проверки ошибочно приняты, поэтому общий verdict REQUEST_CHANGES.
- Самостоятельно пересчитаны **46** checksum entries исходного raw набора (три provenance файла расположены в его родительском внешнем каталоге). Для каждой из пяти пар разобраны реальные index/amd64 manifest/config bytes; unique linux/amd64 descriptor, manifest/config hashes и sizes, полные ordered layer descriptors и config rootfs diff_ids соответствуют source/transport и receipt: Node5, Caddy5, Postgres17.7 14, AccessPostgres16 14, frontend1. Большие layer blobs/signatures отдельно не скачивались.

## CI и граница приёмки

Actual General **37997430335**, exact16997, в последнем snapshot **IN_PROGRESS**:

- Governance114046932812 SUCCESS;
- Code114047235884 SUCCESS;
- Data114048049143 IN_PROGRESS;
- Access114048049062 IN_PROGRESS.

Source дефект подтверждён до завершения общего CI, поэтому ожидать зелёного результата для REQUEST_CHANGES не требуется. Все4 SUCCESS, реальные parsed Compose image-only, built Node/API revision и pulled Postgres config/rootfs proofs на исправленном финальном SHA остаются обязательными. Эти CI proof-результаты данным review **не приняты**. Старый6ff/run37994451035 не подменял R1. Workflow rerun и скачивание логов/артефактов не выполнялись; школьный/Docker/DB/backup/network сценарий не запускался. Для infrastructure-only ремонта отдельный весь Electronics browser не требуется; product candidates нуждаются в собственных ordinary gates.

Google frontend cache имеет известный риск будущей доступности/удержания pinned bytes. Fallback, смены версии и daemon/network правок нет; fail-closed. После исправления source gap нужны actual final CI build и НОВЫЙ независимый exact-SHA reviewer. Owner acceptance, T3/class/K0/backups/deployment данным review не подтверждены.

## Собственные внешние доказательства

Каталог `C:/Users/spike/.codex/temp/electronics-e01/`:

- `reviewer-545-r1-16997f16-offline-proof.json` SHA256 `f6c3809fb8f3a74715a11e46dfa39ea2d861c62a7d0a119f73a503bb6718c913`.
- `reviewer-545-r1-16997f16-own-challenges.json` SHA256 `7ec18cdae8de2b675c51d45abdd224046971491607680c4eb8bc0bddd91c72df`.
- `reviewer-545-r1-16997f16-own-checks.py` SHA256 `5c0b1fb603ba8eb1fe3b7d4e61a172dc4ff74b2d74a114ede133165f6745762c`.
- `reviewer-545-r1-16997f16-final-snapshot.json` SHA256 `cdfd2a78378ad6975994e0b05d20d7fbb1c22795176106862a284b1c02692ace`.

Первый собственный raw-check helper получил FileNotFound на трёх provenance файлах, находящихся на один каталог выше; никакие данные не изменены. Исправлен только внешний путь lookup и отдельно завершены raw/tree checks без повторного браузерного/продуктового измерения. Final offline proof включает все46 фактических успешных проверок.

**Вердикт: REQUEST_CHANGES. Рецензент STOP.** Отдельный bounded R2 и продолжение программы принадлежат контроллеру.
