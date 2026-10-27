# R7-03A — контракт данных для публичного просмотра

Программа #211. Основная страница принята #780; активный срез только current.yaml.
Основание: Implementation Micro Iterations §4, Implementation Spec §19–21,
DEC117/118/119. Цель — настоящие просмотрщики электроники, Scratch и3D.

## Один срез

Только module-neutral versioned read-only envelope, типы capabilities, жёсткие
лимиты и исполнимая валидация со schema tests. Это общий контракт между будущим
серверным sanitizer и браузерным viewer. Он не выдаёт raw Project/Draft/editor
DTO и не включает classroom/private metadata, токены, секреты или write права.

Использовать существующие contracts/Projects patterns. Минимальные публичные
provenance поля связывают envelope с публикацией и её точной ревизией, без
раскрытия владельца, класса, tenant или внутренних сессионных идентификаторов.
Проверить version support, безопасную сериализацию, конечные числовые bounds,
размер/глубину, запрещённые и неизвестные поля, неизменяемое read-only состояние.
Static-only/unsupported outcome должен быть явным и не обещать запуск/скачивание.

Никаких3D/Electronics/Scratch payload пока: их module-specific sanitizer следует
после registry/service. Не добавлять generic raw JSON payload, разрешающий утечку
произвольных редакторских данных под видом проверенного публичного контракта.

## Границы

Без SQL, HTTP endpoint, frontend-подключения, runtime, экспорта, социальных
функций или изменений Games. Отложенный f41afd4c не брать в branch. Новая
миграция0260 из него не опубликована и не является обязательной зависимостью.

## Проверка и продолжение

Позитивные/негативные schema/unit, реальные лимиты, unsupported version,
write/private injection, malformed/non-finite/oversized/nested input. Проверять
выходной shape, не только TypeScript assertions; не снижать существующие bounds.
Focused test/typecheck, независимые Code и Security review, обязательные
проектные gates по применимой policy. Не запускать локальный Docker/build при
неполных shared dependencies; реальное CI выполняется GitHub-first.

Один автор завершает проверенный срез и останавливается. Контроллер продолжает
03B adapter registry/static fallback →03C exact-revision service/auth/cache
→03D security integration → реальные module viewers. До этого изображение
остаётся честной обложкой. Рабочий сайт/база не обновляются.
