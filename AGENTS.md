# AGENTS.md — обязательный контракт ASA Lab

## 1. Каноническое состояние

```text
canonical branch:        main
product merge SHA:       67b4f8eea3804d750684dd1c6dce929f5f1f9bfa
active task:             TASK-ELECTRONICS-M1-001
active issue:            #63
active branch:           agent/r4-electronics-m1
active PR:               #72
status:                  in_progress
execution mode:          assistant_recovery
coding bot:              STOP — do not modify or push
execution manifest:      docs/delivery/EXECUTION_MANIFEST.yaml
rejected runtime SHA:    e779e634a25e040108ba3d5447fb8d3d986a07fb
recovery baseline SHA:   817d8eab2e54cbace0339d2c031b171e770fc0cb
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml` остаётся каноническим execution
contract. Текущий task сохраняет нормативный статус `in_progress`, но его
исполнение временно передано текущему assistant для recovery-прохода.

До отдельного изменения этого файла coding-агент обязан остановиться. Нельзя
pull/rebase/merge локальной незапушенной работы, продолжать архивный аудит,
перерисовывать компоненты, менять UI, запускать Docker или публиковать отчёты.
Ветку восстанавливает текущий assistant напрямую через GitHub.

## 2. Что уже установлено

Ваши исходные материалы не удалены. Они сохраняются в:

```text
apps/web/public/assets/electronics/owner-supplied/
apps/web/public/assets/electronics/owner-audit/components/
```

Отклонённый runtime использовал generated-слой из `production/` и отдельные
auto-traced SVG. В recovery-проходе:

- runtime catalog переведён на явный allowlist owner SVG;
- LED state family переведён напрямую на owner-audit SVG;
- hard-coded подмена резистора удалена;
- invented resistor body/preview удалены;
- PNG auto-trace generator удалён;
- generated production builder удалён;
- auto-traced tool vectors и соответствующие generated runtime replacements удалены;
- добавлены fail-closed проверки owner runtime paths.

## 3. Неприкосновенные данные

Запрещено удалять или менять:

- `owner-supplied/**`;
- `owner-audit/**`;
- локальные owner ZIP и их backups;
- PostgreSQL volume и рабочую БД;
- backup dumps;
- `main`;
- PR №29 и ветку `assistant/map-ux-owner-view`.

## 4. Разрешённый recovery scope

Только существующая ветка `agent/r4-electronics-m1` и PR №72.

Разрешено:

- восстановить прямую цепочку `owner SVG → runtime`;
- удалить generated/auto-traced runtime replacements;
- отключить компонент без подтверждённого owner SVG;
- исправить tests, которые требовали auto-trace или invented artwork;
- подготовить один настоящий editor checkpoint с owner components.

Запрещено:

- новые SVG и ручная перерисовка;
- PNG tracing/vectorization;
- генерация `production/components`;
- новые компоненты, solver/API/persistence features;
- UI-polish поверх неподтверждённых assets;
- новая ветка;
- full matrix;
- merge PR №72;
- R4-M2.

## 5. Обязательная runtime-политика

Каждая отображаемая деталь должна иметь явный путь из:

```text
/assets/electronics/owner-supplied/
/assets/electronics/owner-audit/components/
```

Запрещён runtime asset, если путь содержит:

```text
/production/components/
/source-reference/
.png
.jpg
.webp
.gif
```

Компонент без подтверждённого owner SVG не получает придуманную картинку. Он
может быть только disabled/missing с нейтральной надписью `нет SVG владельца`.

## 6. Проверка перед следующим owner checkpoint

До визуального показа необходимо проверить только:

```text
owner-runtime-assets.spec.ts
production-assets.spec.ts
production-state-contracts.spec.ts
production-editor-integration.spec.ts
resistor-visual.spec.ts
web lint
typecheck
один actual-editor browser smoke
```

Full repository matrix остаётся запрещена. PR остаётся Draft. Любой новый
coding-агент должен остановиться на чтении этого файла.
