# Быстрый запуск ASA Lab на другом компьютере

**Только для первой установки.** Если на компьютере уже работает ASA Lab,
не выполняйте повторный clone/up из нового каталога. Найдите существующую
установку по [правилам единого состава](SCRATCH_INSTALLATION.md) и используйте
[защищённое обновление](GUARDED_UPDATE.md). Scratch устанавливается вместе с ASA,
не отдельной командой, проектом или выбранным заново портом.

Для обычного запуска нужны только:

- Git;
- Docker Desktop для Windows либо Docker Engine с Compose для Linux/WSL2;
- для сборки рекомендуется 16 ГБ оперативной памяти и не менее 20 ГБ свободного места для
  Docker-образов и первой сборки.

Node.js, pnpm и локальная PostgreSQL для Docker-запуска не требуются: они уже
находятся внутри собираемых контейнеров.

## Windows 11

Docker Desktop должен работать в режиме Linux containers.

```powershell
git clone https://github.com/spikeal8-maker/asa-lab.git
cd asa-lab
powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 up
```

## Linux или WSL2

```bash
git clone https://github.com/spikeal8-maker/asa-lab.git
cd asa-lab
./tools/asa-lab.sh up
```

Первый запуск:

1. проверяет доступность Docker и Docker Compose;
2. создаёт игнорируемый Git файл `.env` с криптографически случайными
   URL-safe паролями;
3. проверяет итоговую Compose-конфигурацию;
4. последовательно собирает Scratch, API и Web, затем запускает их с PostgreSQL и миграциями;
5. сверяет готовность и ревизии Web, API и Scratch и печатает локальный адрес и данные тестового
   педагога.

Первая сборка занимает заметно больше времени, чем повторные запуски: Docker
скачивает базовые образы и устанавливает workspace-зависимости. Прогресс сборки
остаётся видимым в терминале, а проверка готовности после сборки ограничена пятью
минутами и при ошибке автоматически показывает состояние и последние логи.

Откройте <http://127.0.0.1:4610>. API доступен локально на
<http://127.0.0.1:4611>. PostgreSQL наружу не публикуется.

## Управление

| Действие                               | Windows                                                               | Linux/WSL2                  |
| -------------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| Проверить компьютер без запуска        | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 doctor` | `./tools/asa-lab.sh doctor` |
| Собрать или запустить текущий checkout | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 up`     | `./tools/asa-lab.sh up`     |
| Проверить готовность                   | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 health` | `./tools/asa-lab.sh health` |
| Показать состояние                     | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 status` | `./tools/asa-lab.sh status` |
| Показать последние логи                | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 logs`   | `./tools/asa-lab.sh logs`   |
| Остановить без удаления данных         | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 down`   | `./tools/asa-lab.sh down`   |

Повторный `up` не пересоздаёт `.env` и не удаляет данные. Команда `down`
останавливает только Compose-проект `asa-lab-dev` и сохраняет PostgreSQL volume.

Для production используется отдельный профиль. Он включает `NODE_ENV=production`,
запрещает тестовое наполнение БД. Наружу опубликованы только loopback-порты Web
`127.0.0.1:4610` и Scratch `127.0.0.1:4613`, не API или PostgreSQL:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 -Action up -Profile production
```

```bash
ASA_COMPOSE_PROFILE=production ./tools/asa-lab.sh up
```

На уже работающей установке не меняйте `COMPOSE_PROJECT_NAME`: имя определяет,
какой PostgreSQL volume подключит Compose. Для production в `.env` обязательно
должно быть `ASA_SEED_DEV=false`.

## Обновление

`up` не загружает код из GitHub. Для уже работающей установки используйте
отдельный защищённый updater. Сначала можно выполнить preflight без изменений:

```bash
ASA_COMPOSE_PROFILE=production ./tools/docker-update.sh --check
ASA_COMPOSE_PROFILE=production ./tools/docker-update.sh
```

В Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-update.ps1 -Profile production -CheckOnly
powershell -ExecutionPolicy Bypass -File .\tools\docker-update.ps1 -Profile production
```

Команда требует чистый `main`, допускает только fast-forward, создаёт и проверяет
backup до изменения checkout, сохраняет rollback-образы с SHA, затем сверяет
точную revision API, Web и Scratch, обе версии схемы и `synchronized: true`. Команда
также требует запуск из каталога работающей PostgreSQL и блокирует смешение
контейнеров, созданных из разных копий репозитория. При ошибке она не
удаляет volume и не восстанавливает дамп автоматически. Полный контракт и
действия при остановке: [`GUARDED_UPDATE.md`](GUARDED_UPDATE.md).

## Доступ из локальной сети или интернета

По умолчанию порты привязаны только к `127.0.0.1`, поэтому установка безопасно
доступна лишь на том же компьютере. Для удалённого доступа не публикуйте
PostgreSQL и не включайте host networking. Используйте отдельный TLS reverse
proxy и собственные production-секреты; подробности приведены в
[`LINUX_DOCKER_DEPLOYMENT.md`](LINUX_DOCKER_DEPLOYMENT.md).

Если запуск не прошёл, выполните команду `logs`, затем используйте
[`DOCKER_TROUBLESHOOTING.md`](DOCKER_TROUBLESHOOTING.md).

## Scratch входит в обычную установку

Раздел «Программирование · Scratch» доступен после стандартного `up` без preview.
Локальный вход: `http://127.0.0.1:4610`, встроенный редактор:
`http://localhost:4613`. Разные имена узла нужны для изоляции; не заменяйте
их одним origin и не подставляйте loopback-адреса внешним пользователям.
Порты и внешние origin настраиваются до сборки. Подробности и миграция старого
артефактного override: [SCRATCH_INSTALLATION.md](SCRATCH_INSTALLATION.md).

Загрузка исходников через ZIP поддерживает первичный локальный запуск, но без
`.git` ревизия отображается как `unknown`, а guarded update недоступен. Для
обновляемой установки используйте `git clone` и сохраняйте каталог установки.
Повторный `up` не меняет существующие пароли и не удаляет работы.
