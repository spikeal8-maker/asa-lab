# VSCR-D0-001 — ASA Scratch host contract

**Status:** canonical accepted host design  
**Master:** `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`  
**Component routing:** `COMPONENT_MAP.yaml`  
**Upstream lock:** `infra/scratch-editor/upstream.env`

Этот контракт фиксирует границу Scratch host. Главное правило: **ASA не переписывает Scratch и не урезает его знакомую оболочку без отдельной доказанной причины**.

## Upstream provenance

Reviewed profile:

```text
official tag v15.1.1 → 99bcc17e0580588f181f8a87577a2f676537a487
ASA exact pin        → 82c5fea6d3e60c781f25c09b375045f9b46a43f7
Scratch package      → 15.1.1
```

Pin immutable. Обновление Scratch требует diff/dependency/license/security/compatibility review и browser/Docker evidence. Бот не обновляет Scratch сам только потому, что появился новый upstream.

## Upstream integration surface

M1 использует поддерживаемые/проверенные поверхности pinned Scratch:

```text
EditorState
createStandaloneRoot
setAppElement
GUIConfig / GUIStorage
ScratchStorage
buildDefaultProject
onVmInit(vm)
onProjectLoaded()
projectId
isPlayerOnly
upstream Settings/locales reducers
VM PROJECT_CHANGED
vm.toJSON()
vm.assets
```

Если будущий pin ломает эти интерфейсы — STOP и отдельный review.

## Host layout

Целевая структура M1-002:

```text
infra/scratch-editor/
├── upstream.env
├── Dockerfile
├── nginx.conf.template
├── README.md
├── patches/
│   └── 0001-host-logo-prop.patch
└── host/
    ├── index.html
    ├── main.js
    ├── protocol.js
    ├── editor.js
    ├── editor-config.js
    ├── branding.js
    ├── storage.js
    ├── status.js
    ├── theme.css
    └── host.css
```

Responsibilities:

```text
main.js          composition/lifecycle only
protocol.js      parent/iframe protocol only
editor.js        real Scratch mount/lifecycle
editor-config.js host configuration; must not reinvent Scratch UI
branding.js      ASA logo/product-brand input
theme.css        ASA product-chrome colours only
storage.js       ASA ScratchStorage/GUIStorage adapter
status.js        child status/errors
host.css         runtime shell presentation
```

Scratch GUI/VM stays outside `apps/web` dependency graph. ASA avatar/account presentation lives in parent Web, not in Scratch origin.

## Branding

Product name: **ASA Lab — Визуальное программирование**.

Canonical logo:

```text
apps/web/public/asa-lab-mark.svg
```

Required result:

```text
Scratch product logo → replaced by canonical ASA logo
ASA logo click → never navigates to scratch.mit.edu
Scratch editor UI/runtime → preserved
upstream license/NOTICE → preserved
```

Allowed patch:

```text
0001-host-logo-prop.patch
```

Its only purpose is to let pinned MenuBar render the supplied ASA logo instead of the Scratch product logo. Не использовать patch для массового rebrand upstream строк.

## Localization

Scratch localization and Scratch Settings are authoritative.

Pinned upstream already has:

```text
canChangeLanguage default = true
built-in language selector inside Settings
EditorState browser locale detection when host does not force locale
regional normalization where supported, e.g. ru-RU → ru
upstream-defined fallback for unsupported locale
```

ASA B не реализует собственную локализацию. Требуется только убрать технический D override:

```text
locale: 'en'  → удалить
```

Не заменять его на `locale: 'ru'` или другой forced locale.

Запрещено:

```text
новая кнопка «Язык»
второй language menu
ASA-копия Scratch переводов
ASA-список поддерживаемых Scratch языков
перестройка Settings ради брендинга
```

После удаления forced-English сам Scratch определяет стартовый язык браузера. Смена языка остаётся внутри штатного Settings.

## ASA theme boundary

ASA меняет только продуктовую оболочку.

Canonical current colours:

```text
primary: #0877B3
darker/border/hover reference: #076B98
brand tokens: apps/web/src/brand/brand.css
```

Можно стилизовать только технически отделимый product chrome:

```text
верхняя product bar
служебные ASA/product акценты
sprite/backdrop add controls, если это не меняет язык категорий
selected sprite/product accent states
```

Нельзя глобально заменять `$looks-secondary` или другие shared upstream tokens, если это меняет смысловые цвета Scratch. Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables, My Blocks сохраняют upstream colours.

## ASA identity shell

ASA-owned avatar/account находится справа в общей визуальной шапке, но authority остаётся у parent Web:

```text
avatar / initials / ASA account menu → ASA parent Web
Scratch iframe                       → editor/runtime
ASA account cookies                  → never exposed to Scratch origin
Scratch account/community identity   → not used as ASA identity
```

Предпочтителен parent-owned overlay/shell, визуально совмещённый с Scratch top bar.

## Product controls

**Сохраняем штатную оболочку Scratch.** B не должен вырезать Settings/File/Edit или локальные File-команды только ради ASA branding.

Baseline B behaviour:

```text
Settings                    = штатный Scratch
language selector           = внутри Settings
File                        = штатный Scratch
Edit                        = штатный Scratch
New                         = штатный Scratch
Load from your computer     = штатный Scratch
Save to your computer       = штатный Scratch
Extensions                  = штатный Scratch entry point/catalogue
canSave                     = false  # не включать Scratch-server save как ASA durable save
canShare/canRemix/community = false  # не подменять ASA product/account flows
backpack/cloud              = не подключать как ASA-owned backend без отдельного решения
```

Локальный `Load/Save to computer` — нормальная функция Scratch и не равна ASA durable save. M1-007 отвечает за безопасную **ASA-интеграцию** `.sb3` (validation/ZIP limits/compatibility/server flows), а не за удаление native local File UI.

Для B не нужен File-menu patch. Если реальный pinned upstream позже не позволяет сохранить требуемую штатную поверхность без patch — STOP и отдельное architecture decision.

## Extensions

Штатный Scratch Extensions entry point, upstream catalogue, network-backed extensions и hardware integrations сохраняются.

B не вводит глобальный ASA allowlist и не удаляет расширение только потому, что оно использует интернет или оборудование.

Принцип:

```text
core ASA project/asset/editor loading
→ не должен скрытно зависеть от Scratch project/asset backend

user explicitly chooses an upstream extension
→ intended external service/device integration may operate normally
```

Если конкретному расширению нужны дополнительные CSP/sandbox/browser permissions или российская/локальная альтернатива, это отдельная интеграционная задача. До неё расширение не вырезается из каталога «для порядка».

ASA позже может добавлять свои extensions рядом с upstream-механикой, не создавая второй несовместимый редактор.

## Host startup and authority

`index.html` loads pinned standalone Scratch bundle and ASA host entry.

Project identity/API authority never come from URL query/hash. Runtime token, project ID, mode and revision metadata arrive only through parent/iframe protocol.

One iframe lifetime → one editor root. Editor does not mount authorised project before valid INIT.

## Parent/iframe protocol

Protocol v1 remains finite; generic RPC/eval forbidden.

Child accepts INIT only when:

```text
event.source === window.parent
protocolVersion === 1
messageType === ASA_BLOCKS_INIT
projectId valid
sessionNonce non-empty
runtimeToken valid for authorised bootstrap
event.origin equals exact expected ASA parent origin
```

Required parent → child:

```text
ASA_BLOCKS_INIT
ASA_BLOCKS_TOKEN_UPDATE
ASA_BLOCKS_FLUSH_REQUEST
ASA_BLOCKS_STOP
```

Required child → parent:

```text
ASA_BLOCKS_READY
ASA_BLOCKS_STATUS
ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
ASA_BLOCKS_FLUSH_RESULT
ASA_BLOCKS_FATAL
```

Every post-init message binds protocolVersion/projectId/sessionNonce; flush additionally binds requestId. `postMessage('*')` forbidden. ASA cookies, signing keys and object-store credentials never enter messages.

Bounded dirty/save payloads reuse the finite v1 message types:

```text
ASA_BLOCKS_STATUS:
  status = project-dirty
  generation = non-negative safe integer

successful ASA_BLOCKS_FLUSH_RESULT:
  revision = confirmed Project Core revision
  snapshotGeneration = non-negative safe integer captured when FLUSH begins
```

`project-dirty` is a memory-only UI correctness signal, not autosave or generic RPC. Parent may show `Сохранено` only when the successful `snapshotGeneration` is not older than the latest accepted dirty generation for the same bound iframe session.

## Scratch storage adapter

Host creates ASA-controlled `ScratchStorage`/`GUIStorage` for ASA project/runtime data.

Core adapter:

```text
scratchStorage
saveProject()        # defensive failure until ASA durable save exists
getLibraryAssetUrl() # explicit ASA/local project/library behaviour; no accidental core fallback
```

D fixture must not fake durable save. New technical fixture may use Scratch internal ID `0`; ASA UUID must not be sent into upstream ProjectFetcher semantics.

Important network distinction: this restriction concerns **core project/asset loading**. It does not prohibit an explicitly selected Scratch extension from contacting the service/device it was designed to use.

## VM and save boundary

M1-002 obtains VM through supported `onVmInit(vm)` and observes `PROJECT_CHANGED`, but performs no ASA durable server write.

M1-005/M1-006 later own:

```text
ASA durable save/load
change generation
asset durability
optimistic revision
conflict handling
autosave/recovery
snapshot/status
```

Never enable upstream Scratch server-save as a substitute for ASA persistence.

## Thumbnail boundary

Use supported Scratch thumbnail/stage-capture callback when available. Do not scrape arbitrary canvas/DOM internals.

## Runtime headers and sandbox

Core runtime starts with the accepted isolated iframe/security boundary. Do not broaden sandbox/CSP globally merely to make one extension work.

When a specific native extension legitimately requires extra network/device permissions, handle that integration narrowly in a separately selected task with browser evidence. The correct response is not to delete the extension catalogue and not to grant universal permissions.

## M1-002 acceptance

M1-002E must prove:

```text
1. exact pinned Scratch provenance
2. real editor mounts only after valid INIT
3. workspace/stage/run/stop still work
4. only reviewed ASA logo patch is present unless a separately accepted decision added another
5. canonical ASA logo rendered; Scratch product logo replaced
6. ASA top product colour applied without changing semantic block colours
7. Scratch Settings remains intact
8. built-in language selector remains inside Settings
9. no second Language/Язык control
10. no forced host locale; ru-RU/en-US follow upstream Scratch detection
11. File/Edit/native local File commands remain
12. Extensions/native catalogue remain; no blanket external-integration filter
13. explicit extension external traffic is distinguished from hidden core fallback
14. core ASA project/asset loading does not silently use Scratch Foundation backend
15. ASA avatar/account is parent-owned; no ASA cookies in Scratch origin
16. wrong origin/source/project/nonce/protocol rejected
17. runtime token absent from URL/persistent storage/logs
18. PROJECT_CHANGED reaches ASA host after stable load
19. player mode read-only
20. Scratch failure does not crash unrelated ASA parent
```

Actual browser DOM/network inspection is required.

## Upstream update coupling

Future pin updates recheck at least:

```text
standalone exports
EditorState/browser locale detection
Settings/language menu
File/Edit menu behaviour
Extensions entry point/catalogue
ScratchStorage hooks
player mode
VM PROJECT_CHANGED
vm.toJSON/vm.assets
ASA logo patch context
product-chrome CSS isolation
```

If native upstream now provides a needed host control, prefer it over growing patches. A new patch requires explicit reviewed need.
