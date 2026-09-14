# VSCR-M1-002B — Оболочка ASA поверх настоящего Scratch

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** accepted VSCR-M1-002D and real editor DOM.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002B`, `docs/execution/current.yaml.task.status` is exactly `in_progress`, `docs/execution/current.yaml.primary_lane.milestone.id` is exactly `VSCR-M1-002`, and `docs/execution/current.yaml.primary_lane.milestone.owner_authorization` is exactly `accepted`.

## Goal

Не переделывать Scratch. Сохранить штатный Scratch Editor, его Settings, File/Edit, localization, Extensions, внешние сервисы и аппаратные интеграции. ASA меняет только product chrome: логотип, цвет верхней панели и parent-owned ASA avatar/account. Отдельно убрать технический D override `locale: 'en'`.

## Components

```text
blocks.host.branding
blocks.host.localization
blocks.host.theme
blocks.host.identity-shell
blocks.host.file-menu
blocks.host.extensions
```

## Minimal read set

```text
../README.md
../components/host.yaml → только перечисленные компоненты
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → mapped sections
apps/web/public/asa-lab-mark.svg
apps/web/src/components/PortalHeader.tsx
apps/web/src/brand/brand.css
accepted C/D host/editor interfaces
```

## Expected write paths

```text
infra/scratch-editor/patches/0001-host-logo-prop.patch
infra/scratch-editor/host/editor.js
infra/scratch-editor/host/host.css
infra/scratch-editor/host/main.js
infra/scratch-editor/Dockerfile
infra/scratch-editor/README.md
apps/web/src/blocks/BlocksEditorShell.tsx
apps/web/src/blocks/blocks-editor-shell.css
e2e/blocks-host-controls.spec.ts
../components/host.yaml
```

Реализация B консолидируется в существующих host/editor и parent-shell поверхностях. Не создавать отдельные `branding.js`, `editor-config.js` или `theme.css` только ради исторического плана файлов.

Не добавлять patch для скрытия Extensions или урезания File. Новый upstream patch — только после доказанного дефекта и отдельного review.

## Localization and Settings — штатный Scratch не трогать

Pinned Scratch уже имеет Settings, встроенный language selector и browser-locale detection. B не создаёт новую языковую систему.

Требуется только:

```text
удалить hard-coded locale: 'en' из D
не заменять его на locale: 'ru'
не добавлять отдельную кнопку «Язык»
не создавать ASA-переводы/список языков
не переделывать Settings
```

После удаления forced-English сам Scratch выбирает язык браузера: `ru-RU → ru`, `en-US → en`, остальные языки/fallback работают по upstream-логике Scratch.

Штатная структура Settings остаётся штатной, включая язык, цветовой режим, тему и остальные доступные настройки текущей версии Scratch.

## ASA product chrome

Меняем только внешний product layer:

```text
Scratch product logo → apps/web/public/asa-lab-mark.svg
верхняя product bar → #0877B3
hover/border reference → #076B98
правый account/avatar area → parent-owned ASA avatar/account
```

ASA logo не ведёт на `scratch.mit.edu`. Scratch origin не получает ASA cookies/account authority.

## Theme boundary

Можно стилизовать top bar и технически отделимые product-chrome акценты. Нельзя глобально заменять `$looks-secondary` или другие shared tokens, если этим меняются смысловые цвета Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables или My Blocks.

## File / Edit — сохранить штатный Scratch

B не урезает File/Edit:

```text
Settings остаётся
File остаётся
Edit остаётся
New остаётся
Load from your computer остаётся
Save to your computer остаётся
```

`canSave=false` нужен только чтобы не включать upstream Scratch-server save как ASA durable save. Native local File import/export — штатная функция Scratch.

M1-007 отвечает за безопасную ASA-интеграцию `.sb3` — validation, ZIP limits, compatibility и ASA server/product flows, а не за скрытие native local File UI.

## Extensions and external integrations — сохранить штатный Scratch

Нормальная кнопка Extensions, upstream catalogue, network-backed extensions и hardware integrations остаются.

B не вводит:

```text
ASA allowlist, вырезающий штатные extensions
blanket ban на внешние сервисы
удаление Text to Speech / Translate / micro:bit / EV3 / Makey Makey / Vernier только из-за внешней природы
отдельный ASA Extensions UI вместо Scratch
```

Разделяем:

```text
core ASA editor/project/assets
→ не должен скрытно зависеть от Scratch project/asset backend

user deliberately selects an extension requiring service/device
→ intended external integration is allowed
```

Если конкретному extension нужны дополнительные CSP/sandbox/device permissions, это отдельная bounded integration task; extension не удаляется из каталога только потому, что такая задача ещё впереди.

## Authorised upstream patches

На B подтверждён только минимальный logo patch:

```text
0001-host-logo-prop.patch
```

Settings/File/Edit/Extensions работают native upstream behaviour. Новый patch требует отдельного доказанного need/review.

## Acceptance

```text
real upstream Scratch remains the editor
ASA logo replaces Scratch product logo
ASA top bar uses ASA colour
ASA avatar/account visible and parent-owned
Scratch Settings intact
built-in language selector remains inside Settings
no second Language/Язык control
no host-forced locale='en' or locale='ru'
ru-RU/en-US use upstream Scratch detection
File/Edit/native local File commands remain
Extensions/upstream catalogue not filtered by B
existing external-service/hardware integrations not blanket-removed
explicit extension traffic is allowed as extension behaviour
core project/asset loading has no hidden Scratch Foundation fallback
semantic block/category colours unchanged
no Scratch account/community ownership substituted for ASA identity
no unreviewed upstream patches
```

## Browser/network evidence

```text
ASA logo/header/avatar visible
Settings looks like native Scratch Settings
Settings → built-in language selector
no duplicate language control
ru-RU and en-US initial locale cases pass
Russian → English → Russian via Settings
File/Edit/local File items visible
Extensions + representative native entries visible
core project/assets do not unexpectedly fetch from Scratch Foundation
explicit selected-extension traffic is distinguished from hidden core fallback
semantic category colours match upstream baseline
Docker exact-pin rebuild
node tools/validate-blocks-docs.mjs
pnpm gate:blocks
pnpm gate:blocks --browser
```

## Forbidden

```text
no Scratch rewrite
no Settings redesign/removal
no new language button/translation fork
no hard-coded locale='en' or locale='ru'
no blanket filtering of native Extensions/external integrations
no File/Edit replacement
no global semantic-colour replacement
no ASA cookies/account authority inside Scratch origin
no durable ASA save invented inside B
no S3/MinIO work
no unreviewed upstream patch
```

## Bounded self-review

Проверить, что B сохранил Settings/File/Edit/Extensions как Scratch, удалил только forced-English, изменил только ASA product chrome/identity presentation, не затронул category colours и не ослабил C/D boundary.

## Independent review

Другой агент/контекст или человек проверяет exact diff и browser/network evidence: нет скрытого урезания Scratch, второго языка, фильтра Extensions, лишнего patch; avatar остаётся parent-owned.

## Stop

STOP after B evidence and independent review. `VSCR-M1-002E` requires separate selection.
