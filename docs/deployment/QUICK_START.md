# Быстрый запуск ASA Lab на другом компьютере

Для обычного запуска нужны только:

- Git;
- Docker Desktop для Windows либо Docker Engine с Compose для Linux/WSL2;
- рекомендуется 8 ГБ оперативной памяти и не менее 10 ГБ свободного места для
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
4. собирает и запускает PostgreSQL, миграции, API и Web;
5. ждёт готовности приложения и печатает локальный адрес и данные тестового
   педагога.

Первая сборка занимает заметно больше времени, чем повторные запуски: Docker
скачивает базовые образы и устанавливает workspace-зависимости. Прогресс сборки
остаётся видимым в терминале, а проверка готовности после сборки ограничена пятью
минутами и при ошибке автоматически показывает состояние и последние логи.

Откройте <http://127.0.0.1:4610>. API доступен локально на
<http://127.0.0.1:4611>. PostgreSQL наружу не публикуется.

## Управление

| Действие | Windows | Linux/WSL2 |
| --- | --- | --- |
| Проверить компьютер без запуска | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 doctor` | `./tools/asa-lab.sh doctor` |
| Запустить или обновить | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 up` | `./tools/asa-lab.sh up` |
| Проверить готовность | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 health` | `./tools/asa-lab.sh health` |
| Показать состояние | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 status` | `./tools/asa-lab.sh status` |
| Показать последние логи | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 logs` | `./tools/asa-lab.sh logs` |
| Остановить без удаления данных | `powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 down` | `./tools/asa-lab.sh down` |

Повторный `up` не пересоздаёт `.env` и не удаляет данные. Команда `down`
останавливает только Compose-проект `asa-lab-dev` и сохраняет PostgreSQL volume.

## Обновление

Перед обновлением сделайте резервную копию по инструкции
[`DOCKER_BACKUP_RESTORE.md`](DOCKER_BACKUP_RESTORE.md), затем выполните:

```bash
git pull --ff-only
./tools/asa-lab.sh up
```

В Windows последняя команда выглядит так:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\asa-lab.ps1 up
```

## Доступ из локальной сети или интернета

По умолчанию порты привязаны только к `127.0.0.1`, поэтому установка безопасно
доступна лишь на том же компьютере. Для удалённого доступа не публикуйте
PostgreSQL и не включайте host networking. Используйте отдельный TLS reverse
proxy и собственные production-секреты; подробности приведены в
[`LINUX_DOCKER_DEPLOYMENT.md`](LINUX_DOCKER_DEPLOYMENT.md).

Если запуск не прошёл, выполните команду `logs`, затем используйте
[`DOCKER_TROUBLESHOOTING.md`](DOCKER_TROUBLESHOOTING.md).
