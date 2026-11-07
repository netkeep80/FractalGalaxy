# S2 — локальная доказанная поверхность (draft)

Статус: **Candidate**, Author acceptance отсутствует. Issue #7. База: `a788dfc599b123dfcf4312dee260c7d14034bffb`.

## Пользовательская задача
Исследователь должен видеть заполненную 3D-поверхность выбранного материального интерфейса вместо набора технических линий, отличать доказанную геометрию от неразрешённой области и сопоставлять Reference/Deformed без изменения `M=Resolve(B,D)`.

## Контракт геометрии S2-A
1. Источник: `extractInterfacePatches` или `extractMaterialInterface` — только `present[]` с решением `PRESENT`.
2. `assembleProvenSurfaceMesh` преобразует каждый patch в `buildSurfacePatchGeometry`, затем `triangulateSurfacePatchGeometry` с фиксированной канонической диагональю.
3. Координаты по shared canonical vertex key дедуплицируются. Различные позиции одного ключа — ошибка, а не щель.
4. `unresolved[]` возвращается отдельно, ни один такой элемент не получает треугольников.
5. Продукт S2 — **только локальная выбранная грань**, не региональная замкнутая поверхность. Сшивка разных LOD и regional mesh отложены.

## Контракт Studio S2-B
- Основной режим Surface: заполненные и освещённые треугольники; второстепенные линии доступны в отдельном Debug.
- Статус proof gap не отображается как доказанная материя; диагностический контур и legend имеют явную семантику.
- Режимы Reference/Deformed/Split и редактирование вершин сохраняются; переключение Surface/Debug не меняет выбор, камеру, WorldStore, классификацию и массу.
- Инспектор показывает `proven patches / unresolved patches / triangles / canonical vertices`.
- Русская и английская подписи согласованы.

## Проверки
- `ROCK|ROCK→0 triangles`, `ROCK|EMPTY→2 triangles`, `MIXED→unresolved,0 triangles`.
- Соседние patches используют одинаковые вершинные индексы после RND+smoothing+interaction.
- После Split FractalRing полная структура mesh и значения деформированных координат неизменны.
- Браузерный тест проверяет изменения пикселей заливки при манипуляции вершиной, отсутствие фиктивных треугольников, неизменность WorldStore от смены режима.
- Проверки RepoGuard точного SHA не заменяют доказательств поведения.

## Границы
Нет доказательства watertight closed mesh, T-junction/coarse-fine stitching, WebGL/WebGPU, global world surface, mesh collision solver. Спецификация не делает эти утверждения.
