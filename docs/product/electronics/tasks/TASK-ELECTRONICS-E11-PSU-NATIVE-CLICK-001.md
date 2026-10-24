---
task_id: TASK-ELECTRONICS-E11-PSU-NATIVE-CLICK-001
kind: repair
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Programme 452 and registry 703
  - Lamp candidate PR 731 remains a separate Draft
  - Product PSU wire-layer issue 679 already technically integrated
acceptance_boundary: slice
review: independent
---

# E11 #549 — физический клик БП под видимым проводом (test-only)

Изолированный исправительный тестовый срез для оригинального E11 running-controls.
Канонический выбор находится в docs/execution/current.yaml на main.
Это НЕ ремонт Stage, Worker, solver, лампы или сохранения.

## Реальный BEFORE

Chromium 1440/390/320 подтвердил 6/6 физических переключений БП
data-output-enabled: true → false → true, включая 320px с wire-hit сверху.
Playwright locator.click отклоняет actionability до отправки pointer,
поскольку SVG-прямоугольник накрыт видимым проводом. Stage физический
pointer обрабатывает правильно. Патч находится на D2-R2:
C:\Users\spike\Projects\asa-lab-731-blockers-baseline-evidence-20261024\lamp731-psu-test-candidate\e11-native-psu-click.patch
SHA256: 05FC438C905F25C98E2158A36EC8EEFC958E16A82B799C922BB182E2F231AD3D.

## Единственный исходник

В e2e/electronics-selection-outline.spec.ts заменить старый locator.click
только для двух переключений PSU на page.mouse.move/down/up, используя
измеренный boundingBox переключателя с явной проверкой ненулевого box.
Оригинальная проверка data-output-enabled сохраняется. Ожидаемый diff +11/-5.
Сохранить старый отдельный Draft #729 и ламповый Draft #731 без изменений.

## Условия

Сверить SHA256 и git apply --check до записи, scoped preflight и
validate:electronics-agent-docs для ID этого среза, провести native Chromium
1440/390/320 со всеми E11 assertions, Stop/Reset, Save/CAS, cookies-only reopen,
Worker ready и committed SVG. Не считать отдельно пройденный PSU результат
полной приёмкой E11. Auth/MAX #135 исправляется в собственном срезе.
Никаких force clicks, timeout/skip/SDK stubs, правок Stage/Worker/физики/сохранения.
Обязательные Electronics и General CI на точном SHA плюс независимый review.
Не снимать Draft #731 и не выполнять школьный deployment до полного приёмочного PASS.
