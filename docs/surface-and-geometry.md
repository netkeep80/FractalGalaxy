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
