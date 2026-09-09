# Native Windows: tap после CDP touch-жеста

Это отдельная **незакрытая проверка среды**, а не реализованная возможность,
не отменённое требование и не разрешение менять геометрическое ядро.
Принятые source/integrated/merge SHA находятся в `docs/execution/current.yaml`.

## Зафиксированная среда и результат

- Windows 11 Pro, версия 10.0.26200, build 26200.
- Node.js 24.14.1, pnpm 9.15.9, Playwright 1.55.1.
- Bundled Chromium / chromium-headless-shell 140.0.7339.186, revision 1193.
- `hasTouch: true`, viewport 390×844, headless, retries 0.
- Два исходных теста `e2e/three-d-m0.spec.ts` локально **FAIL**:
  - `phone exposes shapes and avatar, routes orbit/pan/pinch without editing the model`;
  - `phone authors a cut model with touch, keeps resize frames stable, undoes and exports`.

После touch-жеста через CDP следующий `locator.tap()` даёт pointerdown/pointerup
и touchend, но не click. В первом сценарии не открывается inspector объекта;
во втором не выполняется Undo и остаётся смещение рамки. Assertions, исходные
gestures и timeout не ослаблялись; диагностические изменения тестов удалены.
Потеря click воспроизведена на пустой HTML без ASA Lab/React, включая запуск
установленного Chrome в headless. Это локализует воспроизводимый симптом,
но само по себе не доказывает отсутствие продуктовой ошибки на Windows.

На проверенном integrated candidate исходный Linux browser suite прошёл 6/6:
[3D CI evidence](https://github.com/spikeal8-maker/asa-lab/actions/runs/34293114172).
**Linux PASS не является Windows PASS.**

## Повторение двух продуктовых сценариев

Использовать изолированную тестовую БД/стек по существующему 3D browser runbook,
не production и не его переменные подключения. После подготовки стенда:

```powershell
$env:NX_SKIP_NX_CACHE = 'true'
pnpm exec playwright test e2e/three-d-m0.spec.ts --grep 'phone exposes shapes|phone authors a cut model' --workers=1 --retries=0 --trace=on
```

Trace сохранять вместе с версиями ОС/браузера и SHA проверяемого дерева. Исходная
диагностика сохранена в локальном checkpoint `asa-access-a-integrate-20260909`,
включая `local-final-pre-candidate/touch-mre.mjs` и
`diagnostics-final/touch-empty-html.log`; она не заменяет повторяемую инструкцию.

## Независимый минимальный reproducer

Запустить этот JavaScript с установленным в репозитории `@playwright/test`.
Он не обращается к ASA Lab, БД или сети; HTML существует только в памяти браузера.

```javascript
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1">
    <div style="width:380px;height:100px;overflow:auto">
      <div style="width:2000px;height:80px">Scroll me</div>
    </div><button style="width:120px;height:80px">Tap me</button>`);
  await page.evaluate(() => {
    window.probe = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchend', 'click']) {
      document.addEventListener(type, (event) => {
        window.probe.push({ type, target: event.target.tagName });
      }, true);
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: 330, y: 50 }],
  });
  for (const x of [280, 220, 160, 100]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: 50 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByRole('button').tap();
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(await page.evaluate(() => window.probe));
  await context.close();
} finally {
  await browser.close();
}
```

Ожидается click на BUTTON; в зафиксированной Windows-среде его нет.
Оригинальный сохранённый reproducer также проверял `isMobile` true/false
и задержки 0/500 мс; ожидание не исправило симптом.

## Отдельный следующий пункт проверки

- [ ] Повторить MRE и оба неизменённых продуктовых теста на native Windows;
      записать точные версии, SHA, события и traces.
- [ ] Проверить реальные touch-вводы Windows без подмены на DOM click/force click.
- [ ] Если нужна другая версия браузера, проверить её отдельно с разрешением
      на обновление зависимости; не включать такое обновление в Result A.
- [ ] Закрыть ограничение только собственным Windows evidence для обоих сценариев.

Эти пункты не запускают Result B/C или deployment.
