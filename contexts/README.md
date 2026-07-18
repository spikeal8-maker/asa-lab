# contexts/

Bounded contexts of the Classroom Core (Identity, Organization, Classroom,
Projects, Activities, Assessment, Module Registry, Billing, Safety & Audit).

Intentionally empty in the Bootstrap iteration (TASK-BOOT-001). Each context is
introduced by its own vertical-slice task with its own `domain`, `application`,
`infrastructure`, `presentation` and `testing` layers and a single public entry
point. Classroom Core never imports subject modules.
