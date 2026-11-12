# SP-08 — публикация после достижения порога

**Зависимость:** SP-00; существующий рейтинг группы; SP-02 для progress explanations. **Класс:** L3 permissions.\
**Нормы:** ACCESS_CONTRACT; MASTER SP-D15…SP-D21.

## Результат

Учительское условие публикации может опираться на рейтинг конкретной группы. После достижения сохраняется grant; интерфейс получает то же effective decision, которое проверяет реальная публикация.

## Scope

Версионированная policy модель allow/deny/after-achievement, хранение grant/revoke, единый resolver и подключение к существующему публикационному admission. Новая additive migration сохраняет поведение всех прежних boolean/overrides. Игры и ИИ не меняются.

## Обязательные случаи

- Рейтинг точно равен порогу: условие выполнено.
- После выдачи score уменьшился или порог повысился: grant сохраняется при отсутствии запрета.
- Индивидуальный deny, policy deny, отзыв scope и platform/author ограничения закрывают действие.
- Явный revoke не переоткрывается ближайшим пересчётом того же условия.
- Отзыв доступа не снимает прежние публикации автоматически.
- Account private work проверяется в своей области; учебная работа — по доверенному учебному lineage.
- UI-selected group и высокий общий рейтинг не позволяют обойти условие.
- Old-client write не может перезаписать новый mode старым boolean.
- Settings revision conflict не завершается silent overwrite.

## Приёмка

Настоящие publish/update API проверяются после изменения policy между показом кнопки и нажатием. Replay сначала соблюдает актуальную авторизацию. Тестируются policy/override/grant/revoke/threshold/null combinations, две группы с противоположными правилами, cross-tenant, revoked links и существующие historical publications.

Нужны migration compatibility, restricted PostgreSQL и independent challenge review. До принятого resolver нельзя выпускать обещание «ещё N — и можно публиковать».

## Выход

Effective-access ответ и actual admission совпадают; первая публикация достижима через учебные источники. Веса общего рейтинга и его публичное включение не являются зависимостью этого этапа.
