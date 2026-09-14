# VSCR-M1-002B — Оболочка ASA поверх настоящего Scratch

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** accepted VSCR-M1-002D and real editor DOM.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002B` and `docs/execution/current.yaml.task.status` is exactly `in_progress`; milestone `VSCR-M1-002` must remain owner-authorised.

## Goal

Не переделывать Scratch. Сохранить штатный Scratch Editor, его меню, настройки, локализацию, File/Edit, каталог Extensions, внешние сервисы и аппаратные интеграции. ASA меняет только продуктовую оболочку там, где это действительно нужно: логотип, фирменный цвет верхней панели и ASA-owned аватар/аккаунт справа.

Отдельно убрать техническую ошибку D: принудительный `locale: 'en'`.

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
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → Branding / Localization / ASA theme boundary / ASA identity shell / Product controls / Extensions
apps/web/public/asa-lab-mark.svg
apps/web/src/components/PortalHeader.tsx
apps/web/src/brand/brand.css
accepted C/D host/editor interfaces
```

## Expected write paths

```text
infra/scratch-editor/patches/0001-host-logo-prop.patch
infra/scratch-editor/host/branding.js
infra/scratch-editor/host/editor-config.js
infra/scratch-editor/host/theme.css
infra/scratch-editor/host/main.js                 # только композиция
infra/scratch-editor/Dockerfile
infra/scratch-editor/README.md
apps/web/src/blocks/**                            # parent-owned ASA avatar/account shell
e2e/blocks-host-controls.spec.ts
../components/host.yaml
```

Не добавлять patch для скрытия Extensions или урезания File. Новый upstream patch допускается только после отдельного доказанного дефекта и архитектурного решения.

## Localization and Settings — штатный Scratch не трогать

В pinned Scratch уже есть Settings и встроенный выбор языка. `canChangeLanguage` по умолчанию включён. Если host не навязывает `locale`, Scratch сам определяет язык браузера и использует собственную систему переводов.

B делает только это:

```text
удалить hard-coded locale: 'en' из D
не ставить вместо него locale: 'ru'
не добавлять кнопку «Язык»
не создавать ASA-переводы Scratch
не создавать второй список языков
не переделывать Settings
```

После удаления принудительного английского язык выбирает сам Scratch. `ru-RU` штатно приводит к `ru`, `en-US` — к `en`, другие языки и fallback работают так, как определено upstream Scratch.

Нормальная структура остаётся такой:

```text
Настройки Scratch
├── Язык
├── цветовой режим
├── тема
└── другие штатные настройки текущей версии Scratch
```

## ASA product chrome

Меняем только продуктовый внешний слой:

```text
Scratch logo → канонический ASA Lab logo
верхняя фиолетовая продуктовая панель → основной цвет ASA Lab
правый account/avatar участок → parent-owned ASA avatar/account
```

Канонические источники:

```text
logo: apps/web/public/asa-lab-mark.svg
header primary: #0877B3
header darker/border: #076B98
brand tokens: apps/web/src/brand/brand.css
```

ASA logo не ведёт на `scratch.mit.edu`. ASA avatar/account остаётся в parent Web; Scratch origin не получает ASA cookies и не становится второй системой аккаунтов.

## Theme boundary

Можно менять фирменный цвет только у продуктовой оболочки, например:

```text
верхняя продуктовая панель
служебные product-chrome акценты
кнопки добавления спрайта/фона, если их цвет технически отделён от языка блоков
ASA-owned selection/focus chrome
```

Нельзя глобально заменять `$looks-secondary` или другие общие переменные, если этим меняются смысловые цвета категорий Scratch. Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables и My Blocks сохраняют штатные цвета Scratch.

## File / Edit — сохранить штатный Scratch

B не урезает и не переписывает File/Edit.

```text
Settings остаётся
File остаётся
Edit остаётся
New / Load from computer / Save to computer остаются штатными функциями Scratch
```

`canSave=false` сохраняется только для того, чтобы не включать чужой Scratch-server save как будто это ASA durable save. Локальный File import/export не является ASA server-save и не должен скрываться B.

M1-007 по-прежнему отвечает за безопасную ASA-интеграцию `.sb3`: серверную проверку, границы ZIP/контента, совместимость и использование `.sb3` в ASA-потоках. Он не является причиной ломать или скрывать штатное локальное меню Scratch на этапе B.

## Extensions and external integrations — сохранить штатный Scratch

Нормальная кнопка Extensions, штатный каталог и существующие upstream-интеграции остаются.

Не вводить в B:

```text
ASA allowlist, которая вырезает штатные расширения
глобальный запрет внешних сервисов
удаление Text to Speech / Translate / micro:bit / EV3 / Makey Makey / Vernier и подобных интеграций только потому, что они внешние
отдельный ASA Extensions UI вместо Scratch
```

Важно разделять два вида сети:

```text
ядро ASA/Scratch: загрузка ASA-проекта, ASA-assets, запуск editor
→ не должно скрытно зависеть от Scratch project/asset backend

пользователь сам выбирает штатное расширение, которому нужен интернет/устройство
→ его нормальный внешний сервис или аппаратная интеграция разрешены по логике самого расширения
```

Если конкретному расширению позже нужны дополнительные CSP/sandbox/permission настройки, это отдельная интеграционная задача. Расширение не удаляется из продукта лишь из-за того, что эта задача ещё не выполнена.

ASA позже может добавлять собственные расширения и альтернативные сервисы, не ломая upstream-каталог.

## Authorised upstream patches

На B нужен только подтверждённый минимальный patch для ASA logo:

```text
0001-host-logo-prop.patch
```

File/Edit/Settings/Extensions должны по возможности работать штатным upstream-кодом. Второй patch не добавлять «на всякий случай».

## Acceptance

```text
настоящий upstream Scratch остаётся редактором
ASA logo заменяет Scratch product logo
верхняя продуктовая панель использует цвет ASA
ASA avatar/account виден справа и остаётся parent-owned
Scratch Settings остаётся штатным
встроенный выбор языка остаётся внутри Settings
нет отдельной кнопки Language/Язык
нет host-forced locale='en' или locale='ru'
ru-RU открывает русский через штатный Scratch detection
en-US открывает английский через штатный Scratch detection
File/Edit и штатные локальные File-команды не удалены
Extensions и штатный каталог не отфильтрованы B
внешние upstream-интеграции не удалены только из-за сетевой/аппаратной природы
ожидаемый трафик явно выбранного расширения не считается скрытым core fallback
core project/asset loading не уходит незаметно в Scratch Foundation backend
смысловые цвета категорий блоков не изменены
Scratch account/community ownership не подменяет ASA identity
нет лишних upstream patches
```

## Browser/network evidence

```text
ASA logo/header/avatar визуально присутствуют
Settings выглядит как штатный Scratch Settings
Settings → встроенный выбор языка
нет второй кнопки языка
ru-RU и en-US используют upstream detection
Russian → English → Russian работает через Settings
File/Edit и локальные File items видимы
Extensions и representative upstream entries видимы
core host не получает project/assets неожиданно от Scratch Foundation
явно запущенное внешнее расширение не блокируется тестом только за факт внешнего обращения
semantic category colours совпадают с upstream baseline
Docker exact-pin rebuild
node tools/validate-blocks-docs.mjs
pnpm gate:blocks
pnpm gate:blocks --browser
```

## Forbidden

```text
no Scratch rewrite
no redesign/removal of Scratch Settings
no new language button
no ASA translation fork
no hard-coded locale='en' or locale='ru'
no blanket removal/filtering of native Scratch Extensions
no blanket ban on intended external extension services/hardware
no File/Edit replacement
no global semantic-colour replacement
no ASA cookies/account authority inside Scratch origin
no durable ASA save invented inside B
no S3/MinIO work
no upstream patch without concrete reviewed need
```

## Bounded self-review

Проверить только B diff. Подтвердить, что Settings/File/Edit/Extensions сохранены как Scratch, язык не переизобретён, D forced-English удалён, ASA меняет только product chrome/identity presentation, category colours не затронуты и C/D boundary не ослаблена.

## Independent review

Другой агент/контекст или человек проверяет exact diff и browser/network evidence. Особое внимание: отсутствие скрытого урезания Scratch, отсутствие нового языка/переводов, сохранность внешних интеграций, parent-owned avatar и отсутствие лишних upstream patches.

## Stop

STOP after B evidence and independent review. `VSCR-M1-002E` requires separate selection.
