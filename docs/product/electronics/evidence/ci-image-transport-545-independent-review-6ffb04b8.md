# Независимая проверка №545 — REQUEST_CHANGES

Дата: 2026-10-09 UTC / 2026-10-10 Europe/Moscow.

Проверен ровно опубликованный SHA `6ffb04b878f85c19c052379f434f9f927a480812`, tree `ff9af43a1f2c16b80cb8d340ec3c0c493005bc0d`, относительно actual remote main `f9300d8b12627c01c27a77d037bac9ff2acefa15`. Ветка `codex/electronics-ci-image-transport-545`; Issue545 OPEN; canonical child `electronics-ci` выбрал TASK-ELECTRONICS-CI-IMAGE-TRANSPORT-001 / in_progress до авторского коммита. Авторский отчёт и мнение контроллера доказательствами не использованы.

## Обязательное исправление

**[P2] Постоянный transport guard запрещает независимые допустимые изменения всего package.json и обоих workflows.**

`tools/test_ci_image_transport.py:63–64` сверяет полные historical hashes package.json, lockfile, Dockerfiles, Compose и governance script. `:95–96` сверяет полный восстановленный текст обоих workflows. Проверка вызывается постоянно из `.github/workflows/spec-validation.yml:130`, затем повторно при проверке образов. Поэтому даже законное добавление нового браузерного теста останавливает General Data до сборки/проверок, хотя транспорт, версии образов, обязательные gates и их безопасность не изменились.

Причина подтверждена собственными in-memory вызовами реального guard, без изменения checkout:

- Подстановка **фактического package.json кандидата №541 a741cb4256a180cb87a69d60e8c65fd84a410f4e**: единственное семантическое изменение — добавление `e2e/electronics-simulation-time.spec.ts` в две существующие e2e-команды. Результат: `Production default drift: package.json`.
- Только добавление фактического №541 workflow path trigger для этого файла, при сохранении всех команд/аргументов №545 и исходного package.json: `Unreviewed workflow command, gate, timeout, security or dependency drift: .github/workflows/electronics-r4-m1-focused.yml`.
- Даже комментарий workflow или безвредное metadata-поле package.json дают тот же отказ. Отрицательный контроль: испорченный postgres overlay также корректно отклоняется.

Указание «обновлять receipt при намеренном изменении» не устраняет эту связность: каждый последующий автор чужой области обязан менять историческое доказательство №545. Для уже сохранённого №541 это конкретный воспроизводимый блокер, а не гипотеза о будущей разработке.

**Ограниченный ремонт:** отделить одноразовое доказательство неизменности baseline именно diff №545 от постоянной semantic-проверки transport. Исторические hashes можно сохранить как dated evidence. Постоянная проверка должна сохранять immutable mapping, полные связанные identity/layer данные, обязательные build arguments/overlay, запрет дополнительных изменений effective Compose, исходные производственные image defaults и действующие gate/security/frozen/cache-инварианты, позволяя независимую additive test registration без переписывания старой receipt. Нужны направленные positive/negative challenges: реальное добавление №541 проходит, неверный digest/пропущенный аргумент или overlay/изменённая семантика сервиса отклоняются. Нельзя исправлять это отключением guard, ослаблением gates или сменой версий образов.

## Независимо подтверждено

- Read-only preflight `pnpm agent:preflight --scope electronics-ci --check`: SAFE_TO_START; CONTROL_PLANE PASS; dirty0; overlaps0; применимых execution blockers0.
- Remote task HEAD и main получены через `git ls-remote`, divergence `0 / 1`. Ровно пять разрешённых изменённых путей; **3782** остальные tree entries идентичны baseline. Продукт, owner assets, Dockerfiles, production Compose/defaults, package/lock, тестовые тела и timeout в самом diff №545 не изменены.
- Прочитаны root policy/start/router, delivery protocols, exact task card, review protocol, полный portable standard/compact deployment contract, actual workflow diff, guard, receipt, Dockerfiles/test Compose и canonical state. Нет UI/layout изменения или школьного действия.
- Guard непосредственно выполнен: исходный кандидат PASS; результат не взят из кеша. Никакие Nx/product/browser gates локально не запускались.
- Пересчитаны **все 46** SHA256 из сохранённого raw manifest набора. Для каждой из пяти пар source/transport независимо разобраны tag index, unique linux/amd64 descriptor, actual manifest/config bytes, descriptors/sizes и config rootfs. Все index/manifest/config byte hashes идентичны; ordered layer descriptors и rootfs diff_ids совпадают: Node5, Caddy5, Postgres17.7 14, Access Postgres16 14, frontend1. Receipt соответствует именно этим raw данным. Крупные layer blobs и signatures отдельно не скачивались/не проверялись.
- CI-only overlay содержит только `services.postgres.image`; workflow diff сохраняет существующие gates, permissions, health/timeouts, literaltrue, frozen installs, labels и производственные defaults. Изменения сетевых настроек или daemon отсутствуют.

## CI и граница вердикта

Actual General run **37994451035**, `headSha=6ffb04b878f85c19c052379f434f9f927a480812`, на момент последнего snapshot **IN_PROGRESS**: Governance `114036776916` SUCCESS; Code `114037019291` IN_PROGRESS; Data/Access ещё не запущены. Это **не PASS**, не release acceptance и не продуктовый FAIL. Старые f930/e761 conclusions не подменяли текущий CI.

REQUEST_CHANGES выдан по подтверждённому source дефекту до завершения CI. Поэтому actual parsed Compose/model-only-image proof, Node built-base/revision и pulled Postgres proof **ещё не приняты**; успешных Data/build логов пока нет. Не делались CI reruns, скачивания старых логов/артефактов, local Docker/network/DB/install операции. Для исправленного финального SHA остаются обязательными General ALL4 SUCCESS, actual model/build/identity evidence и НОВЫЙ независимый review. Целые pupil browser suites ради инфраструктуры не запускались.

## Остаточные ограничения

Официальный Google frontend cache дал идентичные pinned bytes; гарантии будущего удержания/доступности прямого cache endpoint нет. При отсутствии сервиса сборка завершится fail-closed, без version fallback. Это допустимый явно обозначенный infrastructure residual для данного минимального CI-only transport при условии настоящего успешного final GitHub build; само по себе не доказывает такую сборку. K0/backups, T3/classroom, deployment и owner acceptance не проверялись и не принимаются.

## Собственные доказательства

Все файлы внешние, в `C:/Users/spike/.codex/temp/electronics-e01/`:

- `reviewer-545-6ffb04b8-offline-proof.json` SHA256 `19390f0aee0d9814ef7863e087ac31bc7d7b653ae0a4b0542166820f7b70a5c1`: 46 checksum checks, пять raw пар, самостоятельные challenges.
- `reviewer-545-541-real-composition-challenge.json` SHA256 `d78948ac5eccbd7f6facee93977fd23bc4e59a297ac7c05c13bd0c17e7c24a89`: фактический №541 package и FAIL.
- `reviewer-545-541-workflow-only-challenge.json` SHA256 `a20d6c4c1b5cb7b1e381d47bb6c7e00faef7997827d2a5059251054a5022ca1d`: независимое additive workflow изменение и FAIL.
- `reviewer-545-6ffb04b8-final-snapshot.json` SHA256 `cb2d0e6534178f6f777be43813ecf9f4f25b85c98a455ae99232396641ff196c`: actual remote/tree/paths/CI pending.

Вердикт: **REQUEST_CHANGES**. Независимый рецензент STOP; отдельный bounded repair и последующее продолжение программы принадлежат контроллеру.
