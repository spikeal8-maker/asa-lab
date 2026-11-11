# MuJoCo: механизм из трёх звеньев — результат KD R1

**Текущий результат зарегистрированного TEST_ONLY-среза: MAIN PASS, 14 миров и 186000 advances.** Независимый saved-data review: **PASS_WITH_EXPLICIT_SAVED_DATA_LIMITS**. Архив загружен, независимо скачан и проверен. Это ordinary source checkpoint; полное PHY-14/E1, D01/D02 и продуктовая приёмка остаются открыты.

Единственная behavioral delta относительно исходного failed a1 — `motor.kdNmsPerRad: 0.03 → 0.15`. Все 15 physics inputs после MAIN сохранены побайтно. В этой publication-фазе меняются только JSON/Markdown; новых native-прогонов и replay нет.

## Фактический MAIN и идентичность

- Registration: `2026-11-11T21:39:00.909Z`; attempt `mujoco-mechanism-qualification-2026-11-11T214158756Z`.
- Native identity: HEAD `306c80f03a55f70fd7d71d7311ac8396ed8325cc` плюс точные четыре mechanism input files и 11 immutable inputs. Source checkpoint добавляет только отчётную публикацию на той же базе, без convergence.
- Registered fixture SHA256: `686164ea52166952f0476198d453117a1e9ba65c62fe00827bd974062e292770`; normalized contract `c970f6b4d75630bb3c01fc865fceb644be395e912b64f7780c2a0f8fe9367b1e`.
- Начало `2026-11-11T21:41:58.757Z`, завершение `2026-11-11T21:43:42.014Z`; CLI exit0. Все миры PASS, cleanup errors0.
- Команда: `node tools/robotics-field-core/run-mujoco-mechanism.mjs --main --write-evidence --journal-dir C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mujoco-mechanism-20261111`.

| Учёт R1 | Фактически |
|---|---:|
| Module initialization | 1 |
| Model created / freed | 14 / 14 |
| Data created / freed | 14 / 14 |
| Dispatched / returned / confirmed / assessed advances | 186000 / 186000 / 186000 / 186000 |
| Temporary wrappers created / deleted | 1851752 / 1851752 |
| Stationary windows / runtime intervals | 18 / 54000 |
| Separate published-commit replay | NOT_RUN |

| Показатель по записанным runtime summaries | Результат | Зарегистрированный критерий |
|---|---:|---|
| Вычисленный overshoot: (maxAbsQ−π/6)·180/π | 0.08807073579984696° | ≤0.25° |
| Максимальный native torque | 0.08 N·m | ≤0.08 N·m |
| Diagnostic maximum wall penetration B/C | 0.00013414862375544026 m | DIAGNOSTIC_ONLY; отдельного numeric penetration gate нет |
| Минимальный B/C wall/no-wall gap | 0.017321527340452364 m | ≥0.01 m |
| Максимальная разница hard B/C event time | 250 µs | ≤10000 µs |
| Максимальная скорость в stationary aggregates | 4.114776130472549e-12 rad/s | ≤0.005 rad/s |

Все 17 comparison records прочитаны: 6 exact-repeat PASS, 4 hard B/C dt-refinement PASS, 4 wall-gap PASS; 3 A/D refinement records остаются DIAGNOSTIC_ONLY. Повторы внутри зарегистрированной матрицы не заменяют отдельный replay опубликованного commit.

## Независимая проверка сохранённых данных

Проверены все 15179 canonical U32LE frames с независимым decoder/encoder и точным round-trip binary64, signed zero и UTF-8 key order. Независимо проверены **14484 retained complete intervals**, **14408 exact POST→next-PRE links** и все 12 полных first-event windows. Проверки охватывают phase identity, PD, native torque cap, frames/anchors, fresh Jᵀλ, знаки limit reactions, wall wrench mapping и off/no-wall cases.

**Все 186000 dense states независимо не восстановлены.** Во всех 18 stationary windows runtime проверил 54000 интервалов, но сохранены только **36 полных stationary intervals**. Independent review проверил эти интервалы, границы, checkpoints и согласованность aggregates; недостающие dense trajectories из sparse journal не восстанавливаются.

Digest `60b2fd9c03d8f17264d392cd84e8d8580b15d12bb7823dde6f2eea85e034c3ec` независимо пересчитан из сохранённых per-world chains/summaries. Это проверка aggregate, не повторный hash всех недостающих состояний. Independent reconstruction overshoot 0.08807073579984696° согласуется с пересчётом сохранённых global extrema; это aggregate, а не максимум только по retained samples.

Findings JSON `532cecc48fb52a33086b0f2d44c9372269b46e6bd40cf7d937201cf806eae50f`; physical proof `bffd1895743bd60b2bd89d27657d885ea33b95852c628b1231ae67a8de7e436a`. Каталог: `C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mechanism-kd-r1-review-archive-20261111T220000Z`.

## Исторический FAIL и аналитическое исправление

Исходный a1 при kd0.03 остаётся FAIL: tick7037, J1 overshoot0.3047607536952785° >0.25°. Его 1 module / 1 Model+Data / 7037 advances, failing observation и свежий 400-tick pre-failure ring сохранены. Новый PASS не заменяет старую попытку.

KD0.15 выбран из аналитического интервала 0.14433294842134972 ≤kd<0.16418021513061556 при500µs. Causal/Schur proof, fixture-delta proof и все старые preregistrations/attempts сохранены. Доказательство имеет frozen-linear ограничения и не объявляется глобальным нелинейным доказательством.

Следующие разделы сохраняют точную topology, solver и критерии этого среза. B/C — welded L1/L2, J3-only diagnostic stands; A/D — полностью шарнирная цепочка.

## Topology и владение состоянием

Каждое звено — box `0.12 × 0.04 × 0.04 m`, масса `0.1 kg`, локальный COM `(0.06,0,0)`. Диагональ инерции в COM: `(2.6666666666666667e-5,1.3333333333333334e-4,1.3333333333333334e-4) kg·m²`. Frames тел находятся в проксимальных шарнирах: L1 — world `(0,0,0.25)`, L2/L3 — `(0.12,0,0)` относительно родителя. Геометрия и COM задаются отдельно; `inertiafromgeom=false`, `fusestatic=false`.

| Случай | Native topology | Назначение |
|---|---|---|
| A | Три hinge, `nq=nv=nu=3` | Движение всех трёх суставов к обоим пределам, bounded torque и drive-off |
| D | Та же topology, три hinge, `nq=nv=nu=3` | Начальный покой, нулевой привод, отсутствие нагруженных ограничений |
| B | L1/L2 сварены с world, J3 — единственный hinge, `nq=nv=nu=1` | Блокирование стеной до верхнего angle limit |
| C | Та же сваренная topology без стены | Достижение верхнего angle limit |

B/C не доказывают контактное блокирование полностью подвижной трёхзвенной цепочки. Положительные массы сваренных тел не делают их динамическими. Полностью подвижную topology подтверждают A/D; движение всех трёх joints — две принятые устойчивые фазы A. Отсутствие joint означает native сварку с родителем: [XML Reference](https://github.com/google-deepmind/mujoco/blob/ac60eae30fa7e0d31315c38d9476752fb81be67e/doc/XMLreference.rst#L2456).

Гравитация `(0,0,-9.81)` сохранена; оси Z и движение XY дают нулевой обобщённый гравитационный момент. Соседние пары L1–L2/L2–L3 исключены из столкновений у шарниров. Любой непредусмотренный self-contact — FAIL. Native owns qpos/qvel. JavaScript в ходе эволюции записывает только `ctrl`; ручного обновления поз, скоростей и ориентаций нет.

## Фиксированный drive, solver и limits

Native `motor`: gear1, gain1, bias-none, dynamics-none, native control/force limits `[-0.08,+0.08] N·m`. Сырой TEST_ONLY PD: `0.3*(target-q)-0.15*qvel`, sampled по native pre-state. Производная PD вычисляется снаружи; native velocity bias отсутствует. Damping, stiffness, armature, frictionloss, fluid, extra applied forces, callbacks, sensors и plugins не добавляются. Это не Arduino/DC-motor qualification. Семантика motor и force clamp: [XML motor](https://github.com/google-deepmind/mujoco/blob/ac60eae30fa7e0d31315c38d9476752fb81be67e/doc/XMLreference.rst#L6063), [native actuation](https://github.com/google-deepmind/mujoco/blob/ac60eae30fa7e0d31315c38d9476752fb81be67e/src/engine/engine_forward.c#L919).

Профиль: implicitfast500/250µs, macro5ms, dense Newton100/tolerance1e-10, elliptic, NoSlip20/tolerance1e-12, line-search50/tolerance0.01, native convex/multiccd включены, speculative/sleep/autoreset отключены. `solref=(0.004,1)`, `solimp=(0.99,0.99,0.001,0.5,2)`, margin/gap0. Единственная wall–L3 pair явно имеет `condim=1`: фрикционно свободная нормальная реакция независимо от native minimum-friction padding. NoSlip не добавляет этому контакту тангенциальных DOF.

Native hinge ranges — ±30°. Это мягкие unilateral constraints, не pose clamp. Engineering gate — выход не более **0.25° на всей траектории, включая все endpoints**. Это выбранный до данных angular gate, а не цитата о якорях из ТЗ. Anchors ≤1mm проверяются по native body transforms/xanchor; axes и COM/geom frames проверяются отдельно. См. [native limit instantiation](https://github.com/google-deepmind/mujoco/blob/ac60eae30fa7e0d31315c38d9476752fb81be67e/src/engine/engine_core_constraint.c#L1284).

## Критерии A/B/C/D

Устойчивое окно — ровно последние1s каждой заданной фазы; `|qvel|≤0.005 rad/s`, range q ≤0.1° с учётом всех pre-states и последнего post-endpoint. Force predicate относится к сохранённой PRE geometry и свежему step2 solve; дополнительного solve для последнего endpoint нет.

- A: +45°3s, −45°3s, drive-off1s. В последних1s каждой driven-фазы каждый из трёх joints находится около соответствующего ±30° предела в рамках0.25° и имеет свежую положительную native λ с правильным знаком восстанавливающего обобщённого момента на каждом интервале окна.
- B: target+45°4s, стена с center `(0.225,0.07,0.25)`, half-size `(0.275,0.01,0.15)`. В последних1s требуется нагруженный wall contact, отрицательный contact torque J3 и угол ниже верхнего range; строк J3 angle limit в этом окне нет.
- C: target+45°4s без стены. Контактов нет; в последних1s положительная λ верхнего ограничения даёт отрицательный restoring torque.
- D: весь1s — устойчивое окно, native actuator torque exactly0, нет нагруженных contacts/limit constraints. Новые численные пороги для D не вводятся.

В каждой паре B/C при одинаковом dt/repeat минимум `y_max(C)` за окно минус максимум `y_max(B)` за окно должен быть ≥10mm. Support box вычисляется из фактических native geom frames. Геометрические ориентиры `20.0886038794°`, свободное `y_max(30°)=0.0773205081m`, запас17.3205081mm и сила0.755928946N — аналитические diagnostics, не измеренный PASS и не допуск точности силы.

Сравнение500/250µs для B/C — hard gate: первое нагруженное wall/upper-limit событие по сохранённому PRE time отличается ≤10ms; конечный COM L3 — ≤1.2mm; quaternion angle L3 — ≤1°. Reference size фиксирован как authored longest L3 dimension0.12m. Сравнение q — diagnostic, без нового допуска. A/D refinement — diagnostic; все их trajectory/force/stationary gates остаются hard. Этот срез не закрывает всю PHY-14.

## Фазы, усилия, энергия

На каждом native интервале: `mj_step1` → сохранение pre-state, native body/geom frames, contact identity и dense constraint J → вычисление PD/запись ctrl → `mj_step2` → свежие `actuator_force`, `qfrc_actuator`, `efc_force`, `qfrc_constraint` и contact force → state-preserving `mj_kinematics`, `mj_comPos`, `mj_comVel` → actual endpoint kinematics.

Проверяется exact native motor cap; арифметический allowance используется только для algebra/mapping и не увеличивает cap. Native `Jᵀλ` сверяется с `qfrc_constraint`; joint-limit rows различают положительную λ и знак обобщённого момента. ID/addresses разрешаются по native именам. Данные о контактах, warnings и временные native wrappers копируются с явной ownership/cleanup accounting.

Energy ledger начинается в t0 и не сбрасывается при drive-off. Signed coordinate work — `Στ·Δq`, midpoint work — `h·Στ·(v_pre+v_post)/2`, отдельно записываются mechanical energy и constraint work. Всё это **DIAGNOSTIC_ONLY**, не energy PASS. A7s не закрывает отдельный10s drive energy test.

## Бюджет и retention

| Case | Миров | Steps500µs/мир | Steps250µs/мир | Всего advances |
|---|---:|---:|---:|---:|
| A7s ×2repeat ×2dt |4|14 000|28 000|84 000|
| B4s ×2repeat ×2dt |4|8 000|16 000|48 000|
| C4s ×2repeat ×2dt |4|8 000|16 000|48 000|
| D1s ×1repeat ×2dt |2|2 000|4 000|6 000|
| **Итого** |**14**|||**186 000**|

Один live world, одна module initialization на явный invocation, максимум28 000 advances/world. Ошибка останавливает оставшуюся матрицу и сохраняет dispatched/returned counts; отсутствующие миры не становятся PASS. Admission/probe/phase-parity worlds в этом бюджете отсутствуют.

Каждый native tick проверяется и хешируется до sparse retention. Rolling pre-window200ms и post-window200ms окружают только первое loaded событие мира. Первые upper/lower reactions каждого joint, первая wall reaction, смены фаз A и границы stationary windows дополнительно сохраняются как bounded current-tick records. Первый event не останавливает rolling ring: поздний FAIL сохраняет свои последние200ms и failing observation, без дополнительного advance.

Ring — максимум800 records ×64KiB =52 428 800B (50MiB). Journal cap —512MiB, summary cap —8MiB; нормальные записи не расходуют reserved failure trailer. Pure proof проверяет fixed schema при8contacts/16rows, exact backing allocation и отдельные размеры допустимых A/B/C записей. Журнальный envelope строится из числа миров, фиксированных окон/событий/checkpoints и failure reserve; он не обещает размещение произвольного потока64KiB записей. Точные вычисленные байты и команда proof находятся в JSON.

### Полученный pure resource proof

Все численные поля canonical binary имеют фиксированную ширину; размеры ниже получены через ту же `makeMechanismTickRecord`, которую использует executor. Synthetic caps-record содержит три DOF, все три link/native arrays, 8 contacts и 16 constraint rows. Это проверка размера структуры, а не допустимый физический результат.

| Запись | Canonical bytes | Лимит |
|---|---:|---:|
| Synthetic caps: 3 DOF, 8 contacts, 16 rows |29 118|65 536|
| A/D: 3 DOF, 0 contacts, до 3 rows |9 107|65 536|
| B: 1 DOF, 8 contacts, до 9 rows |25 449|65 536|
| C: 1 DOF, 0 contacts, до 1 row |7 385|65 536|

Exact backing proof заполнил ring 800 записями по 65 536 B и проверил сумму `bytes.buffer.byteLength`: **52 428 800 B**. Failure reserve — **53 641 216 B**. База резерва `800*(65 536+1 024)+262 144+65 536 = 53 575 680 B`; дополнительный запас — 65 536 B.

| Часть fixed 14-world envelope | Bytes |
|---|---:|
| Первые event windows: до 1 601 ticks на 12 A/B/C миров и один первый failing D |304 482 983|
| Отдельные expected event/stage ticks |1 852 544|
| 620 checkpoints по 100 ms |10 160 560|
| До 28 initial/final world metadata records |3 670 128|
| Cleanup, schema и invocation records |278 596|
| Отдельный failure reserve |53 641 216|
| **Всего** |**374 086 027**|
| Journal cap |536 870 912|
| **Запас** |**162 784 885**|

В A отдельно сохраняются первые upper и lower реакции J1/J2/J3, старты driven upper / driven lower / drive-off фаз и начала/концы двух stationary windows; final observation входит в world metadata. В B отдельно сохраняются первая loaded wall reaction, обнаруженные первые стороны limit, старт drive и границы последней секунды; C аналогично сохраняет limit events без wall. Conservative sparse bounds proof: A — 14, B — 8, C — 7, D — 10 records на мир. Они допускают failure prefix и запас по событиям; повторных плотных окон для каждого limit нет.

Late-failure test вызвал первое событие на tick 10, продолжил rolling ring до tick 1700 и получил emergency pre-window **ticks 901–1700**, плюс отдельную failing observation tick 1701. Первый положительный limit event не расходует возможность сохранить поздний отказ нижнего предела. Эта проверка не добавляет физических шагов.



## Проверенный архив

Release [442262781](https://github.com/spikeal8-maker/asa-lab/releases/tag/untagged-0bfd162ee99919f1fce2) остаётся **draft/prerelease, unpublished**, target exact `306c80f03a55f70fd7d71d7311ac8396ed8325cc`. Tag ref не создан, latest не изменён. Архивная проверка подтверждает сохранность данных и не является release acceptance.

| Asset | ID | Bytes | SHA256 |
|---|---:|---:|---|
| [archive-entries.json](https://api.github.com/repos/spikeal8-maker/asa-lab/releases/assets/737146868) | 737146868 | 203645 | `e69937515a2364b19f0f2f534a3643e214b5b6fb9233907f7f978b997df02990` |
| [INDEPENDENT_ARCHIVE_VERIFICATION-20261111T223842Z.json](https://api.github.com/repos/spikeal8-maker/asa-lab/releases/assets/737184614) | 737184614 | 53600 | `a8e5b8355c7c5f6f6c72a6e06f43793aa5d02e647a38a66aba3777a782ab0f25` |
| [LOCAL_PACKAGE_RECEIPT.json](https://api.github.com/repos/spikeal8-maker/asa-lab/releases/assets/737146965) | 737146965 | 5778 | `d4513d89d397652af875d688b5a66a356b14c339224b745f36e04bce48a1c173` |
| [mechanism-a1-r1-evidence.zip](https://api.github.com/repos/spikeal8-maker/asa-lab/releases/assets/737147042) | 737147042 | 6335964 | `3ff02026e71f51008c58ce98c78979f87b170cd9f6234e8d3ede6a9718c4f35a` |
| [mechanism-kd-r1-source-snapshot.zip](https://api.github.com/repos/spikeal8-maker/asa-lab/releases/assets/737147267) | 737147267 | 334985 | `46c5827f0bdd92868835ea31d33d09a1237bbbf5f5f2eb8229e6115503b862ed` |
| [mujoco-mechanism-qualification-2026-11-11T202234421Z.asamechraw.gz](https://api.github.com/repos/spikeal8-maker/asa-lab/releases/assets/737147325) | 737147325 | 899389 | `3d11fbb4872352f0b237ac209128799ecdae154deee22a48dbde236623b4816a` |
| [mujoco-mechanism-qualification-2026-11-11T214158756Z.asamechraw.gz](https://api.github.com/repos/spikeal8-maker/asa-lab/releases/assets/737147414) | 737147414 | 8088332 | `64787100a1dcf10f46cfed5048bf547ed2d9d9b89a591130916951c18fa19ddc` |

Независимо проверены все **442 ZIP entries**: 19 source и 423 evidence; 17 unique source/report files и 399 protected evidence files. Оба gzip полностью распакованы с проверкой CRC и побайтным сравнением с оригиналами. Review и proof asset проверены отдельным download/readback. Draft assets требуют авторизованного доступа.

R1 raw: **127278508 B**, SHA256 `acbcf84d01ae7b9668c9bb0acef96aa62df6423c1e29df124f9e22672fe3b7f8`. Исторический a1 raw: **9488554 B**, SHA256 `65bb6f5782045e893c800864c5a53eba81e8d5b5fef43bd49a38972d2faedb0d`. Исходные native receipts и их as-run `NOT_ARCHIVED` поля не переписаны; актуальные archive references находятся в отдельном `publicationMetadata.archive`.

Final audit SHA256 `2d330efd9d63dcf39998a0e9a7949761bc3c0ab6b31ff8931a79a8ccab884c25`; six-asset summary `d1779ee569a20798d10f67f8292e201edf403ca8c75636f57c8228e4c61a3b6d`; independent proof `a8e5b8355c7c5f6f6c72a6e06f43793aa5d02e647a38a66aba3777a782ab0f25`.

Архив source ZIP фиксирует snapshot **до этой публикационной правки**. Его прежний Markdown `06a9f6098648bd07cb52440a0ec3930e1d390e3b018949581801142bb9210efc` содержал pre-run `NOT_RUN` и сохранён полностью; нынешний документ отражает фактический MAIN PASS. Архивный JSON `3c89e6b482cdd69cb36e5a92c440842f06a6a4e11ce7d65bf2049611684270b3` и весь старый history также неизменны.

## Source checkpoint и границы публикации

Fresh `--scope robotics` preflight выбрал E1/#1071: execution blockers0, overlaps0, PLAN/REMOTE_REFRESH/CONTROL_PLANE PASS. HEAD306; origin/main `92377daf6db834a8fb4670598c55bf41b4fe8d2b`, divergence `4/8`. Шесть собственных untracked paths проверены по hashes; remote target ветки отсутствовал. Convergence не выполняется.

Публикационные проверки выполнены на неизменных 15 physics inputs. `NX_DAEMON=false` и `NX_SKIP_NX_CACHE=true` заданы буквально; Node22.23.3, Corepack pnpm9.15.9 и Python313 закреплены. Каждый stdout/stderr сохранён напрямую через file descriptors с командой, временем, exit code и SHA256.

| Проверка | Результат |
|---|---|
| Exact focused PURE suite | 52/52 PASS, 1 file, exit0 |
| node --check module / CLI | PASS, exit0 |
| Prettier четырёх code/fixture inputs | PASS, exit0 |
| Targeted ESLint module / CLI / spec | PASS, exit0; skipped-rule warning отсутствует |
| Governance gate | PASS, exit0 |
| Scoped verify-plan, exact6 / diff-base306 | PLAN_VALID, exit0 |
| Native / preregistration / qualification / replay в publication-фазе | 0 / 0 / 0 / 0 |

Первый governance capture был остановлен внешним 180s timeout без product verdict; после проверки отсутствия процессов повторён только governance с тем же gate/test code и без изменения их тайм-аутов. Actual recovery exit0 и исходный timeout сохранены. Focused stdout SHA256 `089d794c77459765875363bc0da9f92bf249d31e8c5d7806bd6cbfcce17ab290`. Duration  962ms (transform 133ms, setup 0ms, import 312ms, tests 445ms, environment 0ms). Markdown и docs JSON исключены из Prettier политикой `.prettierignore`; JSON прошёл parse/round-trip и проверку неизменности всей истории. Полные receipts находятся в `publication-gates-pass.json` и `verify-plan.exit.json`.

Checkpoint сохраняется обычным commit на parent306 и обычным push только `codex/robotics-field-core-mujoco-mechanism-001`. Точный SHA, remote/API/blob readback, clean tree и gate receipts фиксируются во внешнем publication receipt в `C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mujoco-mechanism-20261111\kd-r1-publication-20261111T225314Z`; commit SHA не вставляется в собственные хешируемые файлы.

PR/merge/current.yaml/UI/DB/server не изменяются. Source checkpoint не является integration, deployment, owner acceptance или закрытием полного PHY-14/E1. Следующий шаг назначает controller: fresh review опубликованного SHA и отдельный GO на ровно один `--main --verify-recorded`. Сейчас replay не разрешён.
