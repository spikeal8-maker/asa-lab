# VSCR-M1-003A — ядро серверных разрешений Scratch

**Kind:** bounded non-exposed implementation slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-003A` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.

## Goal

Первый технический пакет движения к согласованному сохранению в ASA: проверяемое
серверное ядро краткоживущих разрешений, не новый backend и не способ сохранения.
Рабочий локальный редактор не меняется. Это подготовка внутри M1-003; не закрывает
B/E, HTTP/session wiring или M1-003 в целом и не разрешает запуск write endpoints.

## Scope

Компонент `blocks.runtime.capability`, D0-004 Capability profile/validation и Current
authority recheck. `jose` compact JWS HS256, issuer `asa-lab`, audience
`asa-blocks-runtime`, type `asa-blocks-runtime+jwt`, TTL 600s, clock tolerance 0.
Обязательны tenantId, principalId (sub), projectId, moduleKey=blocks, mode,
versionId (null у editor, UUID у player), permissions, iat/nbf/exp/jti.
Ключ: ровно 32 случайных байта из серверной композиции; без fallback/default,
генерации при импорте или записи в браузер. Constructor не доказывает энтропию.
Разрешения задаются только фиксированными серверными профилями editor/player.

Обязательный порт текущих полномочий проверяется перед выдачей и после каждой
валидной криптографической проверки. Отказ/исключение/истечение во время проверки
не дают успешного результата. Нет process-local blacklist или разрешающего default.
Порт обязателен, но DB adapter в A не реализуется и не подменяется production mock.

Предельный размер compact token 4096 символов, проверка до криптографии.
Точный Origin; route binding tenant/project/mode/version; неизвестные claims,
header fields, permissions и неверные сроки отклоняются. JWT не логируется.
Ошибки — безопасные коды без echo входа или внутренних исключений.

## Sources and tests

`apps/api/src/blocks-runtime-capability.ts`, соседний `.spec.ts`, API package/lock;
существующий `tools/blocks/gate.mjs` расширяется для новых проверок, без второго gate.
API импортирует jose динамически для совместимости NodeNext/CJS; в Web/VM его нет.
Тесты используют настоящие подписи и только синтетические идентификаторы/ключи.

## Acceptance

Действительная подпись, ошибочные alg/key/issuer/audience/type/time/claims; точные
origin/tenant/project/version; player-write и подписанные расширенные permissions
отклонены; отзыв полномочий влияет на следующий вызов, зависимость недоступна;
объекты/ключ копируются, clock и вход проверяются, лимиты до криптографии.
Focused tests/typecheck/lint, dependency/license checks, общий CI и independent review.

## Prerequisite boundary

В ответ на поручение владельца начать путь к сохранению выделено невключённое ядро A.
Это не утверждение о принятой B/E: её остаточная проверка остаётся перед подключением
HTTP-сессий и нового доверия. Полное M1-003/B endpoint wiring требует отдельного
выбора и проверок Account/StudentSeat/Project Core, Origin/CORS/CSP, rate limit,
текущих прав, logout/revocation, refresh и настоящего browser journey.
Существующий marker принятого host milestone в current.yaml сохраняется как история.

## Independent review

Другой контекст читает exact diff и тесты. Проверяет fail-closed, сроки/claims,
отсутствие default-authority, утечек ключа/токена, неподключённость HTTP/DI и границы.
Результат PASS/NEEDS_FIX/BLOCKED не подменяет CI или owner acceptance.

## Bounded self-review

Только API helper и тесты, без runtime-контейнеров, .env, AppModule, контроллеров,
CORS, cookies, глобальных ролей, новой системы проектов или миграций. Никаких
изменений принятой вёрстки, новой нижней полосы, дополнительных портов или deployment.

## Stop

Нельзя говорить «сохранение работает» или «серверные маршруты уже защищены» по
helper-тестам. Срез заканчивается проверенным ядром. Следующее — реальный adapter
существующих полномочий и parent runtime-session; assets/save/autosave позже.
