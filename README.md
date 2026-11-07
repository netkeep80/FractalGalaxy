# FractalGalaxy — FractalMatter / FractalRing

Исследовательский проект фрактальной материи, в котором **процедурная структура вещества** и **физическая иерархия объектов** независимы.

- **B** — базовый фрактальный объём; **D** — разреженное *результирующее состояние изменений*, а не журнал воздействий; `M=Resolve(B,D)`.
- При фрактализации родительский генератор определяет состояние потомков. Физическое отделение **не** создаёт новых seed, а последующее уточнение может использовать исходные неизменяемые параметры процедурных соседей.
- Один независимый физический объект — `FractalRing`. Явный `Attach` двух самостоятельных объектов создаёт новый родительский FractalRing со своим пространственным кадром; контакт сам по себе не Attach.
- Грани кубических ячеек ≠ физическая поверхность вещества. Quadtree адресует 2D-параметры границы, octree — 3D-объём; оба используют одно авторитетное поле M.
- Масса, инерция и сохранённая физическая иерархия не должны зависеть от камеры/LOD.

## Что здесь делаем

У проекта две практические цели:

1. держать **примерные качественные требования на русском языке**, чтобы не потерять архитектурные идеи;
2. развивать **исполняемый прототип**, который проверяет эти идеи кодом.

Требования задают направление и язык обсуждения, а не пытаются заранее формально доказать весь будущий игровой движок.

## Web demo

После публикации GitHub Pages интерактивное демо доступно здесь:

**https://netkeep80.github.io/FractalGalaxy/**

Демо использует тот же `src/fractal-matter.mjs`, что и локальные тесты, и показывает:

- 2D-срез канонического материального поля `M(x)`;
- влияние сохранённого параметра процедурного соседа в `Γ`;
- D-правку с правилом `deepest wins`;
- координату → octree path → generator state;
- два последовательных `Split` и три непересекающихся владельца материи;
- sampled mass до/после разделения;
- Surface / Geometry Lab: reference cube и его deformed projection;
- выбор сред по обе стороны грани и решение `NONE/PRESENT/REFINE`;
- четыре incident octants для surface-driven refinement;
- live-probe выбранной octree-ячейки: реальная классификация текущего `M`, соседняя ячейка и стоимость refinement;
- recursive interface extraction: доказанные и unresolved surface patches на reference/deformed представлениях;
- каноническая SurfacePatch geometry: общие reference/deformed рёбра соседних patches совпадают до triangulation;
- детерминированная triangulation proven patches с topology-derived winding;
- vertex deformation pipeline: базовая форма, deterministic RND, boundary smoothing и persistent impact displacement;
- geometry influence threshold: подпороговые воздействия не изменяют форму и не материализуют FractalRing.

Исходники страницы находятся в [demo/](demo/). Публикация выполняется workflow [pages.yml](.github/workflows/pages.yml).

## Исполняемый прототип E0

Код: [src/fractal-matter.mjs](src/fractal-matter.mjs)  
Тесты: [tests/e0.test.mjs](tests/e0.test.mjs)  
Описание и ограничения: [docs/prototype.md](docs/prototype.md)

```bash
npm test
npm run demo
```

Прототип включает:

- каноническую octree-адресацию `bx + 2*by + 4*bz` и `Derive32`;
- процедурное поле B, контекст Γ и соседозависимую генерацию;
- D с `deepest-wins` и запрос `M=Resolve(B,D)`;
- material instance + ownership mask и повторный `Split` через пересечение текущей маски;
- `Contact`, `Attach`, `Detach` и жёсткую кинематику отделения;
- холодный `Save/Load` материальных и физических данных.

Это **не** production engine: пока нет WebGPU, production mesh/LOD, collision solver, автоматического разрушения, Fuse, деформации, самогравитации и общего точного интегратора.

## Читай сначала

1. [Концепция, границы и источники решений](docs/vision-and-scope.md)
2. [Архитектурные контракты](docs/architecture.md)
3. [Конечный профиль первого эксперимента](docs/e0-contract.md)
4. [Исполняемый прототип](docs/prototype.md)
5. [Реестр открытых вопросов](docs/research-register.md)
6. [Происхождение требований](docs/requirements-rationale.md)
7. [Матрица требований и проверок](docs/acceptance-matrix.md)
8. [План проверок E0](docs/verification-plan.md)
9. [E1: sparse FractalRing overlay](docs/e1-sparse-fractalring.md)
10. [E1: WorldStore и частичная резидентность](docs/e1-world-store.md)
11. [Иерархия требований](docs/requirements-hierarchy.md)
12. [E1: границы сред и деформированная геометрия](docs/surface-and-geometry.md)

Набор содержит 104 принятых и текущих native Requirement. Они образуют явную иерархию `derives_from` с двумя корнями: `FG-PRODUCT-000` для требований к продукту и `FG-PROJECT-000` для требований к проекту. Все `requirements/*.rg.yaml` приняты Author'ом и имеют `accepted:true/current:true/published:false`.

## Основные термины

**Начальное значение генератора (seed)** — вход исходного корня; **состояние генератора** — значение родительской/дочерней области, порождаемое при фрактализации; **исходный генеративный контекст (Γ)** — воспроизводимая родословная и неизменяемые параметры исходных соседей.

**Присоединение (Attach)** создаёт новый составной FractalRing; **отделение (Detach)** снимает физическую связь уже существующего объекта; **разделение (Split)** перераспределяет исходное M между новыми владельцами; **сращивание (Fuse)** изменяет вещество и в текущий прототип не входит.

## RepoGuard

GitHub workflow закрепляет RepoGuard v6.0.1 за точным commit `74db97791e6da8a75287164f0d0b41579108f114` и запускает точную проверку `BASE → HEAD`. Дополнительная `HEAD → HEAD` самопроверка не заменяет полный gate.

Исторический bootstrap с `BASE:LICENSE` относился к первому переходу из исходного LICENSE-only main; после merge PR #1 native-модель уже находится в `main`.

[E0 Issue #2](https://github.com/netkeep80/FractalGalaxy/issues/2) · [История требований Issue #3](https://github.com/netkeep80/FractalGalaxy/issues/3)
