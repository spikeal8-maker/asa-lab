---
task_id: TASK-ELECTRONICS-L298N-P0B-001
kind: implementation
risk: medium
semantic_change: "no"
roadmap_slice: E-OPT-7
prerequisites:
  - "Issue #1199: original L298N top-wire specification v1.1"
  - "P0A exact owner SVG/catalog has been accepted on a checked main SHA"
  - "P0B scoped preflight and collision check must be renewed after that acceptance"
acceptance_boundary: slice
review: self
---

# L298N — P0B: провода поверх платы, контакты над проводами

## Назначение

Подключить **существующий** механизм отображения и интерактивного соединения
проводов в ASA Lab к оригинальной плате `l298n-motor-driver`, не создавая новый
редактор, новую физику или альтернативную систему координат.

**Норматив:** [Issue #1199](https://github.com/spikeal8-maker/asa-lab/issues/1199),
версия `TOP_WIRES v1.1`. Порядок слоёв: сетка → корпус L298N →
реальные провода и их hit paths → стандартные маркеры контактов →
ручки редактора провода. Устаревшее описание `wire path under body` из
`contracts/contacts.json` не имеет приоритета.

## Строго ограниченные исходники

- `apps/web/src/electronics/WorkbenchStage.tsx`: добавить только
  `l298n-motor-driver` в `wiresAboveComponentBody`. Сохранить существующие
  исключения breadboard, Arduino Uno и регулируемого блока питания.
- `apps/web/src/electronics/testing/l298n-top-wires.spec.ts`:
  проверка **фактического** условия редактора, последовательности слоёв,
  реальных terminal hit targets и геометрии.
- `docs/product/electronics/tasks/TASK-ELECTRONICS-L298N-P0B-001.md`:
  только нормативный контракт, фактические evidence и решения по приёмке.

Остальные 44 записи каталога, оригинальный SVG, нетлист, Arduino, электрический
решатель и моделирование не изменять в P0B. Электрические ENA/ENB при снятых
перемычках, конфигурация 5V_EN и светодиод относятся к P1/P2.

## Инварианты

1. 11 постоянных контактов с сохранением `componentId + terminalId`;
   шестёрка физических jumper pads не является шестью постоянными силовыми клеммами.
2. 43×43 мм, 5 scene units/мм. Центры контактов не двигаются из-за
   визуального порядка. Корректны 0°, 90°, 180°, 270°, mirrorX/mirrorY,
   масштаб и сдвиг камеры.
3. Свободные вершины, переподключение, wire hit-testing и Undo/Redo используют
   штатные механизмы Workbench. Провода поверх радиатора и диодов остаются
   видимыми, а маркеры выше проводов доступны.
4. Поведение других компонентов и производительность при Stop неизменны;
   не добавлять polling, таймеры, второй SVG или React-мониторинг.
5. Оригинальный SVG: 42 273 байта,
   SHA-256 `289c604c4ff4e1e74a733e2d01c18b2beab58721f6b4c5c369de37e34a425498`.

## Доказательства и приёмка

- Перед записью: точный `main`, выбранный канонический срез, отсутствие
  пересечений файлов и штатный `agent:preflight --verify-plan`.
- Focused Vitest: P0A + P0B + Workbench presentation/geometry, без ослабления
  проверок. Регрессии по breadboard, Arduino, PSU и другим двигателям.
- `pnpm nx run web:typecheck --skip-nx-cache`, Prettier, ESLint и
  `git diff --check`. Обязательные GitHub CI на **точном SHA**.
- Browser evidence в 1440/1024/390/320 при включённом компоненте после P2:
  настоящий редактор, hit points поверх проводов, видимость соединений, поворот,
  зеркалирование, сохранение проекта. До включения компонента в P2 тестировать
  только действующий алгоритм слоёв и геометрию: не создавать ложный UI PASS.
- Self-review по `docs/agent/review-protocol.md`, затем строго разрешённый merge;
  после слияния проверить `main` и post-merge CI.
- Не считать P0B принятым без P0A в `main` и записанных exact-SHA результатов.

**Не разрешено:** изменение R4/Arduino/D2–D4 тестов, изменения границ KCL,
CI gate, production, API, пользовательской БД, Docker, деплой, force-push,
административный обход защиты и Codex.

**NEXT_ALLOWED_TASK:** после технической приёмки P0B контроллер выбирает
отдельный P1 DOMAIN с обязательным независимым HIGH-RISK review. До этого
остаётся `STOP_FOR_P0B_ACCEPTANCE`.
