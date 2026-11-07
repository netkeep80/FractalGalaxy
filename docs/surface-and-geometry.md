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
