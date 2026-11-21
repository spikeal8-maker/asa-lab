# Коллектор Linux под управлением 1Panel

`collectorManager: "1panel-supervisor"` выбирает нативный процесс **1Panel →
Инструменты → Supervisor** для уже подготовленной установки ASA. Его владелец,
корень, проект и режим `system-root` сохраняются. Управление процессом выполняет
проверенный локальный API bridge из репозитория
[Server-setings](https://github.com/spikeal8-maker/Server-setings).

## Граница управления

| Объект | Кто им управляет |
| --- | --- |
| Коллектор `asa-log-collector-<project>` | Нативный Supervisor в 1Panel; start/stop/restart/config/logs через API панели |
| Канонический post-update reconcile ASA | Вызывает `/usr/local/sbin/asa-1panel-collector reconcile`; проверяет результат именно своего проекта |
| Supervisor как системный пакет | Официальная предпосылка 1Panel для Ubuntu/Debian; инициализация через панель |
| Прежний systemd collector | Отключается при принятом переходе; сохраняется для контролируемого восстановления |
| История, private index, курсоры | Существующие файлы ASA; bridge их не пересоздаёт и не очищает |

Системный пакет Supervisor использует штатную Linux-службу. Это не отдельная
скрытая служба ASA: программа коллектора и её жизненный цикл видны в панели.
Сам факт отображения внешнего Compose-проекта в списке 1Panel не доказывает,
что он был создан или принят под управление панелью.

## Контракт выбора менеджера

Одинаковое значение менеджера требуется в `.asa/installation.json` и
`.asa/collector-runner.json`. Режим должен быть явно выбран как `system-root`
на Linux, с существующим root-владельцем и установленной группой чтения API.
Неизвестный менеджер или односторонняя запись выбора дают явную ошибку.
Прямое ручное редактирование этих двух файлов не заменяет процедуру adoption.

При недоступном bridge/API, неверных правах пути, несовпадающей регистрации или
неподтверждённом ответе canonical reconcile возвращает degraded. Он не создаёт
systemd-коллектор вместо выбранного менеджера. Отключённый оператором autostart
также не включается обходным путём.

Регистрация содержит актуальные `revision` и `scriptDigest` канонических
исходников. Принятый handover требует нового process heartbeat/nonce; старая
свежая запись каталога сама по себе не доказывает запуск нового процесса.

## Установка и принятие

Используйте точный принятый Git commit Server-setings и его документ
`docs/55-SCHOOL-1PANEL-LOGGING.md`. Installer принимает явные canonical root,
loopback URL панели и путь приватного ключа; проект и instanceId проверяет
по существующему `.asa/installation.json`. Ключ не передаётся аргументом.
Поддерживаемая версия API в этом пакете — 1Panel **v2.3.2**.

На новой установке сначала штатно подготовьте root collector metadata,
read-only API group и diagnostic directories через `tools/log_collector.py
prepare`. Этот этап не запускает отдельный collector. Installer умеет записать
отсутствующую runner identity без создания временной systemd-службы. Затем он
создаёт нативную программу Supervisor с `autostart=false`.

Команды ниже выполняются в 1Panel Terminal после установки bridge. Сначала
просмотрите план; `--apply` требуется только для выбранного изменения:

```sh
/usr/local/sbin/asa-1panel-collector status
/usr/local/sbin/asa-1panel-collector adopt
/usr/local/sbin/asa-1panel-collector adopt --apply
/usr/local/sbin/asa-1panel-collector status
```

Bridge берёт каноническую maintenance lock, сохраняет приватный handover
receipt, отключает только прежний collector, подтверждает его остановку,
сохраняет manager и свежую source identity, включает нативный процесс и ждёт
его heartbeat. UID/GID/mode заменяемых metadata-файлов сохраняются. Существующие
индекс, log segments и cursors не входят в список заменяемых файлов.

В fileSources добавляется один источник `linux:1panel-supervisor` с каталогом
логов, полученным из фактической native Supervisor configuration. Это точное
разрешённое имя host-источника; произвольные namespace-имена не разрешаются.
Прежние настройки и источники остаются. Доставка нового источника подтверждается
отдельно: marker → normalized event → host ZIP; один успешный процесс не является
доказательством доставки. Required-source catalog проверяется заново после
добавления источника.

## Восстановление прерванного handover

```sh
/usr/local/sbin/asa-1panel-collector recover
/usr/local/sbin/asa-1panel-collector recover --apply
```

Recovery принимает только сохранённый receipt `prepared` или `rolled_back` и
точно исходные/целевые metadata. Прежде чем вернуть прежнюю службу, он требует
нативный STOPPED readback. При неопределённом результате API прежний writer
остаётся выключенным: второй writer не запускается. Состояния STARTING,
BACKOFF, STOPPING и отсутствие ответа не считаются подтверждённой остановкой.

Успешно принятый `accepted` handover эта команда автоматически не откатывает.
Receipt не удаляется. После восстановления оператор проверяет факты и отдельно
архивирует receipt перед новым adoption. Повторный canonical reconcile при
непринятом receipt блокируется до этой явной процедуры.

## Source-only обновление и границы проверки

Для ремонта host tools допустим отдельно проверенный чистый fast-forward
canonical checkout на принятый Git commit. Это не обновляет работающие app
images, schema или application build label. Source revision коллектора тогда
отличается от application runtime revision; обе величины указываются явно.
Нельзя подменять отдельные live-файлы, объявлять старые images новой версией или
пускать автоматический app updater вместо ограниченного source-only этапа.

Focused tests проверяют fail-closed делегирование и identity контракт. Они не
заменяют реальную приёмку 1Panel process, fresh heartbeat, сохранности index,
исторических gap windows, normalized marker и восстановленного архива.
Чистая установка Linux+1Panel считается проверенной только после отдельного
реального прогона.
