# WIN-04B1 — план изолированного целевого проекта

Это первый безопасный этап подготовки **целевой** инсталляции для полного
переноса PostgreSQL, MinIO и исходных приватных ключей. В отличие от
WIN-04A (проверка источника), этот этап проверяет, что новый проект не
перехватит существующие порты, Docker volumes, networks или исходный архив.

## Только чтение

Из чистого проверенного checkout ASA Lab, размещённого **отдельно** от
архива и других установок:

```powershell
python tools/asa_manager.py import-target-plan --backup "D:\ASA-Archive\complete-backup" --root "D:\ASA-New-Checkout" --profile production --install-project asa-lab-new-transfer --install-web-port 28780 --install-blocks-port 28783
```

Пути и порты в команде служат примером. Выбирайте реальные новые значения,
не повторяйте имена действующих Docker-проектов. Каталог целевого проекта
должен быть **явно** задан аргументом `--root` (значение по умолчанию
запрещено), уже содержать **чистый официальный Git checkout текущего
`main`**, но ещё не иметь `.env` и состояния установленной ASA Lab.
Требуется доступ к официальному GitHub HTTPS API: при его недоступности
проверка блокирует операцию и не принимает SHA из локального checkout.
Любая непубликованная PR-ветка не является доверенной целевой версией.

Проверка вызывает WIN-04A, независимую `attest_target_checkout`
и существующий `assert_clean_install_destination` (чтение Docker
ps/volumes/networks и проверка доступности localhost-портов).
`attest_target_checkout` проверяет фактический Git root, URL `origin`
`https://github.com/spikeal8-maker/asa-lab.git` без URL-rewrite,
независимо получает текущий SHA `main` из
`https://api.github.com/repos/spikeal8-maker/asa-lab/branches/main`,
проверяет пустой Git status и хеши десяти критических установочных
файлов непосредственно по рабочим байтам и Git-объектам SHA. Подменённые
`assume-unchanged` файлы также блокируются. При этом не создаются и не
запускаются контейнеры, не записываются ключи, не изменяются тома,
базы данных, Docker Engine, Windows, WSL, VPN или брандмауэр.

## Блокирующие условия

- Исходный архив отсутствует или не прошёл полную проверку SHA-256.
- Целевой каталог совпадает с источником, содержит архив или расположен внутри него.
- Исходный проект совпадает с целевым, исходный/целевой профиль различаются.
- Целевой профиль не `production` или `staging`.
- Цель или родительские пути проходят через symlink/junction.
- Цель содержит `.env`, установочный receipt, operation markers или
  существующие Docker-контейнеры/volumes/networks выбранного проекта.
- Целевой Git не принадлежит официальному origin, не является текущим
  опубликованным `main`, имеет изменённые или незарегистрированные файлы
  либо критический файл отличается от закреплённого Git blob.
  Дополнительно отклоняются даже **без Docker labels** контейнеры и сети,
  чьи имена начинаются с префикса целевого проекта (варианты `-` и `_`).
- Новые порты Web/API/Scratch пересекаются или уже прослушиваются.

Положительный статус `TARGET_PREFLIGHT_ONLY` — **не бронь порта**:
между планом и установкой порт может занять другое приложение. До
создания нового проекта проверки должны быть повторены под отдельной
эксклюзивной блокировкой.

Отчёт содержит подтверждённые поля `officialTargetOriginVerified`,
`officialTargetCommitVerified`, `cleanTargetVerified`,
`targetCriticalFilesVerified` и точный `targetCommit`.
Это не Authenticode-подпись издателя; `publisherSignatureVerified=false`.

Отчёт явно содержит:
`targetReserved=false`, `targetProvisioned=false`,
`postgresRestored=false`, `minioRestored=false`,
`secretsImported=false`, `writesPerformed=false`,
`publisherSignatureVerified=false` и
`operatorCutoverApprovalRequired=true`.

## Дальнейший исполнитель

WIN-04B2 должен изолированно создать новые PostgreSQL и MinIO volumes,
перенести оригинальный `private.env` без замены ключей, восстановить
данные в **новую** БД и новый S3-контейнер, сверить ACL/RLS, keyring,
число записей и SHA всех объектов. Старый Docker project/тома/порты
оставляются без изменений. При отказе кандидат карантинируется без
автоматического удаления; перенос не считается успешным.

WIN-04C — подтверждённые пользовательские входы, сохранение и открытие
Scratch/3D, проверка Student Code и явное разрешение cutover владельцем.
Ни WIN-04B1, ни WIN-04A не выполняют эти операции.

## Приёмка

`tools/deployment/test_import_target_plan.py` — отрицательные тесты
на совпадение проекта, посторонний том, недопустимые порты, чужой профиль,
пересечение путей, symlink и попытку обратиться к Installation/Docker.
Все тестовые каталоги временные; никаких реальных установок не создают.
