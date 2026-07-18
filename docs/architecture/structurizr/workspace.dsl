workspace "ASA Lab" "Модульная образовательная платформа для классов и виртуальных лабораторий" {

    !identifiers hierarchical

    model {
        student = person "Ученик" "Выполняет задания и работает с учебными проектами."
        teacher = person "Педагог" "Создаёт классы, выдаёт задания и проверяет работы."
        schoolAdmin = person "Администратор школы" "Управляет школой, педагогами и политиками."
        platformAdmin = person "Администратор платформы" "Управляет tenants, эксплуатацией и коммерческими возможностями."

        asa = softwareSystem "ASA Lab" "Classroom Core и подключаемые предметные модули." {
            web = container "Web / PWA" "Ученический и педагогический интерфейс." "React, TypeScript, Vite"
            admin = container "Admin Console" "Административный интерфейс школы и платформы." "React, TypeScript, Vite"
            api = container "Core API" "Строгий модульный монолит Control Plane." "NestJS, Fastify, TypeScript"
            realtime = container "Realtime Gateway" "WebSocket-синхронизация и присутствие." "TypeScript"
            dispatcher = container "Job Dispatcher" "Передаёт ресурсоёмкие задачи в Compute Plane." "TypeScript"
            workers = container "Compute Workers" "Компиляция, симуляция, автопроверка, рендер и робототехника." "Rust native, isolated runtimes"
            database = container "PostgreSQL" "Транзакционные tenant-owned данные." "PostgreSQL 16+" {
                tags "Database"
            }
            redis = container "Redis" "Кэш, rate limits и ephemeral coordination." "Redis" {
                tags "Database"
            }
            objectStorage = container "Object Storage" "Версии проектов, assets, exports и preview." "S3-compatible" {
                tags "Database"
            }
            telemetry = container "Telemetry Collector" "Traces, metrics и logs без детского содержимого." "OpenTelemetry Collector"
        }

        identityProvider = softwareSystem "External Identity Provider" "OIDC/SAML/LDAP для взрослых пользователей."
        paymentProvider = softwareSystem "Payment Provider" "Будущий внешний платёжный провайдер."

        student -> asa.web "Работает с проектами и заданиями"
        teacher -> asa.web "Управляет классами и проверяет работы"
        schoolAdmin -> asa.admin "Администрирует школу"
        platformAdmin -> asa.admin "Администрирует платформу"

        asa.web -> asa.api "Использует" "HTTPS/REST"
        asa.web -> asa.realtime "Синхронизируется" "WebSocket"
        asa.admin -> asa.api "Использует Admin API" "HTTPS/REST"
        asa.realtime -> asa.api "Проверяет session и policies" "Internal API"
        asa.api -> asa.database "Читает и изменяет транзакционные данные" "SQL"
        asa.api -> asa.redis "Использует ephemeral state"
        asa.api -> asa.objectStorage "Читает и записывает project payloads"
        asa.api -> asa.dispatcher "Создаёт durable jobs"
        asa.dispatcher -> asa.workers "Передаёт изолированные задания"
        asa.workers -> asa.objectStorage "Читает inputs и записывает outputs"
        asa.workers -> asa.database "Записывает статус и метаданные результата"
        asa.api -> asa.telemetry "Экспортирует telemetry" "OTLP"
        asa.realtime -> asa.telemetry "Экспортирует telemetry" "OTLP"
        asa.workers -> asa.telemetry "Экспортирует telemetry" "OTLP"
        asa.api -> identityProvider "Аутентифицирует взрослых" "OIDC/SAML"
        asa.api -> paymentProvider "Использует provider adapter" "HTTPS/Webhooks"
    }

    views {
        systemContext asa "ASA-SystemContext" {
            include *
            autoLayout lr
        }

        container asa "ASA-Containers" {
            include *
            autoLayout lr
        }

        styles {
            element "Person" {
                shape Person
            }
            element "Database" {
                shape Cylinder
            }
        }
    }

    configuration {
        scope softwaresystem
    }
}
