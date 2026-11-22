# ASA LAB — SP-AVATAR-CHOOSER-P1: удобный выбор изображения профиля

**Приоритет:** P1, отдельный UI-срез после P0 или согласованного независимого пути.  
**Основание:** [owner correction](../OWNER_PLATFORM_PROFILE_UX_2026-11-16.md).  
**Цель:** существующий диалог выбора аватара удобен мышью, клавиатурой и касанием, без цепочки «сетка → отдельная картинка → назад».

## Изменения

- Переиспользовать `apps/web/src/components/AvatarChooser.tsx`, `AvatarSelection.tsx`, `AvatarDialog.tsx`, `avatar-chooser.css` и другие **фактически используемые** компоненты.
- Сетка остаётся видимой при preview. На hover/focus миниатюры показать увеличенное изображение в панели рядом/над сеткой, не меняя selected avatar.
- Один click/Enter по миниатюре выбирает вариант; явное **Сохранить** подтверждает через действующий API. Наведение ничего не сохраняет.
- На touch первый tap выбирает и показывает inline preview; сохранение явно по кнопке. Не требовать закрытия отдельного экранного preview.
- «Текущий» и «Выбранный» хорошо различимы, отмена не меняет серверное состояние. Поддержать upload + fallback + server failure/retry.
- Диалог/preview удерживаются внутри viewport, не заставляют сетку перескакивать, keyboard focus не теряется, Escape закрывает, tooltip не является единственным пояснением.
- На hover используется мягкий scale без layout reflow; `prefers-reduced-motion` отключает движение. Нет скачков изображения после load; touch target от 44px.
- Не изменять формат хранения аватара, правила Seat/Account, default avatars, права и network protocol.

## Проверки

Desktop pointer hover (preview, **no save**); keyboard Tab/Enter/Space/Escape/focus return; touch tap/save; current vs selected; cancel/failed save/upload; смена пользователя; 1440/1024/390/320; 200% zoom; light/dark; long content. Browser screenshots и aria assertions обязательны. Переходы должны быть короче: из сетки достаточно выбрать и нажать «Сохранить», без экрана «назад к сетке».

**Не объединять с P0 без явного coordination и точного плана shared CSS.** Нет самостоятельного merge без owner acceptance.
