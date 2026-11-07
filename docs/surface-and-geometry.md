# E1 — границы сред, surface refinement и деформированная геометрия

## 1. Поверхность является интерфейсом сред

Грань procedural cell сама по себе не является материальной поверхностью.

Для двух смежных объёмных областей движок определяет effective medium по обе стороны общей топологической грани:

```text
ROCK | ROCK   → interface NONE
ROCK | EMPTY  → interface PRESENT
ROCK | ICE    → interface PRESENT
MIXED | ...   → interface REFINE
```

`EMPTY` — результат material/procedural model. Отсутствие FractalRing record не означает EMPTY.

## 2. Volume classification предшествует surface refinement

Алгоритм объёма может непосредственно доказать, что область `Homogeneous(medium)`, не раскрывая все восемь octants.

Если такого доказательства нет, область считается `Mixed` для целей определения интерфейса и требуется дальнейшее объёмное уточнение.

Если классификация строится снизу вверх из полного octree-level, восемь одинаковых homogeneous children дают homogeneous parent; наличие разных сред или MIXED child даёт MIXED.

## 3. Уточнение поверхности локально

Одна топологическая грань parent cube касается только четырёх его восьми children. Поэтому surface-driven refinement не должно автоматически раскрывать четыре противоположных octants, если алгоритму не требуется дополнительный контекст.

Surface patch параметризуется координатами `(u,v)` и при уточнении делится на четыре subpatches.

## 4. Surface quadtree производен

Surface quadtree хранит/вычисляет детализацию уже обнаруженного интерфейса. Он не является независимым источником наличия вещества.

Авторитет остаётся за volume/material model.

## 5. Reference topology и реальная геометрия

Octree работает в каноническом reference domain. Геометрическая форма получается процедурным отображением:

```text
ξ — reference coordinates
      ↓ Φ
x — deformed material coordinates
      ↓ T_ring
X — world coordinates
```

Общая вершина/ребро/грань двух смежных cells сначала имеет одну каноническую reference identity, поэтому обе стороны должны получить одну и ту же деформированную координату.

## 6. Раздутый куб как планета

`cubeToSphereDeformation` в E1 является небольшим исполняемым примером: поверхность topological cube отображается на сферу. Это не окончательный planet generator, а доказательство архитектурного разделения topology и geometry.

Octree-addressing при этом не меняется.

## 7. Visual-only detail

Texture, normal, roughness, lighting cache и прочая чисто визуальная детализация являются derived data.

Если алгоритм меняет реальное положение границы вещества так, что должны измениться collision, ownership, масса или материальные запросы, это изменение должно быть выражено volume/material model, а не только renderer'ом.

## 8. Surface / Geometry Lab в GitHub Pages

Web Studio содержит две синхронные 3D-проекции одной topology:

- reference cube — каноническое адресное пространство;
- deformed geometry — те же reference points после `Φ`.

Пользователь выбирает ось и сторону общей грани, effective media A/B и величину визуального перехода от identity к `cubeToSphereDeformation`. Studio показывает:

- решение `NONE / PRESENT / REFINE`;
- четыре incident octants стороны A;
- четыре incident octants соседней стороны B;
- четыре quadtree subpatches выбранной грани;
- одинаковую camera orientation/zoom для reference и deformed views.

Эта панель является экспериментальным представлением модели, а не отдельной реализацией surface semantics: решения интерфейса и octant selection вызывают функции `src/surface/interface.mjs`, а deformation — `src/geometry/deformation.mjs`.

## 9. Live procedural probe

Surface / Geometry Lab может работать не только с вручную заданными средами, но и с текущим E0 material experiment.

Последовательность:

```text
click on material slice
        ↓
selected reference point
        ↓
octree address at probe depth
        ↓
same-depth neighbor by axis/side
        ↓
adaptive classifyMaterialRegion(A/B)
        ↓
Homogeneous / Mixed
        ↓
NONE / PRESENT / REFINE
```

`classifyMaterialRegion` не создаёт FractalRing. Он использует виртуальное octree refinement до E0 depth 5 и прекращает уточнение раньше, если может доказать однородность:

- полный `solid` fixture;
- однозначный D override без более глубоких D;
- аналитическая высотная граница, целиком лежащая выше или ниже области;
- согласованная агрегация восьми дочерних классификаций.

Диагностика возвращает число просмотренных виртуальных узлов, число terminal nodes, максимальную достигнутую глубину и причины остановки.

Адресный сосед той же глубины вычисляется непосредственно из octree path. Если сосед выходит за пределы конечного E0 reference domain, только Web Lab трактует внешнюю сторону как EMPTY для демонстрации внешней поверхности; это не является общим правилом WorldStore.

Такой режим позволяет видеть не только итог `PRESENT/REFINE`, но и **почему** интерфейс доказан либо требует дальнейшей volume refinement.

## 10. Recursive interface extraction

После первичной классификации `MIXED → REFINE` surface layer не строит поверхность всей parent face.

`extractInterfacePatches` рекурсивно сопоставляет только четыре пары incident children:

```text
face patch
   ├── pair 0: child A₀ ↔ child B₀
   ├── pair 1: child A₁ ↔ child B₁
   ├── pair 2: child A₂ ↔ child B₂
   └── pair 3: child A₃ ↔ child B₃
```

Для каждой пары:

- одинаковые homogeneous media → patch отбрасывается;
- различные homogeneous media → patch фиксируется как proven interface;
- Mixed на любой стороне → patch делится ещё на четыре;
- достижение max depth при Mixed → patch сохраняется как `unresolved`.

Таким образом extractor не придумывает геометрию там, где volume model ещё не дал достаточной информации.

Результат содержит:

- `present[]` — доказанные interface patches;
- `unresolved[]` — участки, требующие более глубокой volume refinement;
- статистику visited pairs / discarded / present / unresolved / deepest depth.

Это ещё **не mesh extraction**. Triangulation, crack-free tessellation, LOD и GPU representation являются следующими производными слоями.

Web Studio рисует proven patches зелёным, unresolved — янтарным, используя один и тот же параметрический patch как в reference, так и в deformed view.

## 11. Каноническая SurfacePatch geometry

После доказательства interface patch ещё не является triangle mesh.

`buildSurfacePatchGeometry` переводит параметрический patch в четыре канонические reference-вершины в порядке:

```text
(u0,v0) → (u1,v0) → (u1,v1) → (u0,v1)
```

и строит четыре ребра с ключами, полученными только из координат reference-вершин.

Это даёт важный инвариант:

> два соседних patches, построенные независимо, должны получить один и тот же canonical edge key для общей кромки.

После применения одного и того же deformation `Φ` соответствующие deformed coordinates этой общей кромки также должны совпадать в пределах установленного численного контракта.

Текущий E1 использует dyadic octree/quadtree coordinates, поэтому тестовый контракт для `cubeToSphereDeformation` проверяет точное совпадение (`epsilon = 0`).

Этот слой всё ещё не определяет диагональ quad и не создаёт triangles. Он сначала фиксирует crack-free vertex/edge topology, чтобы последующая triangulation не могла скрыть расхождение общей геометрии.

Experiment Studio теперь использует этот же `buildSurfacePatchGeometry` при рисовании reference/deformed patches; отдельного вычисления corner vertices в UI нет.

## 12. Детерминированная triangulation

После того как SurfacePatch имеет канонические reference/deformed vertices и crack-free edge identity, quad можно безопасно разбить на triangles.

E1 использует фиксированную canonical diagonal:

```text
vertex 0 ↔ vertex 2
```

и два triangle records. Deformation `Φ` не меняет indices или diagonal — меняются только coordinates.

Winding определяется reference topology и направлением выбранной грани от cell A к соседу B. Поэтому orientation не зависит от camera, renderer или порядка построения patch.

Важно: triangulation применяется только к **proven interface patches**. `unresolved` patch не получает triangles, потому что само существование/форма материальной границы ещё не доказаны volume model.

Текущая triangulation пока не решает adaptive coarse/fine LOD stitching и T-junctions. Это отдельная следующая задача поверх уже канонических vertex/edge identities.

Experiment Studio может показывать canonical diagonal пунктиром. Переключатель влияет только на rendering и не изменяет interface extraction.
