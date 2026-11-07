# E1 — WorldStore и частичная резидентность

Статус: рабочий E1-контракт хранения sparse FractalRing overlay.

## 1. Логический мир и RAM — разные вещи

Персистентный мир состоит из FractalRing-записей, но движок не должен требовать одновременной загрузки всех записей в оперативную память.

Для конкретного FractalRing ID различаются три состояния:

```text
ABSENT
    persistent записи нет

UNLOADED
    persistent запись существует, но payload сейчас не resident в RAM

RESIDENT
    persistent запись существует и payload доступен вычислительному runtime
```

`UNLOADED` не является вариантом `ABSENT`.

## 2. Индексы принадлежат хранилищу

WorldStore должен позволять найти persistent ring по:

- собственному ID;
- procedural source identity;
- текущему physical parent.

Поиск не должен требовать предварительной загрузки payload всех найденных rings.

E1 memory backend моделирует это отдельными persistent records, transient residency и индексами.

## 3. Procedural source identity

Source index учитывает не только `rootId + address`, но и identity/version алгоритма. Одинаковый адрес, интерпретируемый другой версией генератора, является другим процедурным источником.

Человекочитаемый location key `Planet:/5/2/7` и полная versioned source identity являются разными понятиями.

## 4. Load / unload

`loadFractalRingRecord` переводит существующую запись из UNLOADED в RESIDENT.

`unloadFractalRingRecord` удаляет только transient residency. Persistent запись, индексы, procedural source и physical relationships остаются неизменными.

Следовательно unload не является удалением объекта мира.

## 5. Persistence и cold load

Persistent snapshot хранит записи FractalRing, но не обязан сохранять transient-набор resident records. При холодной загрузке допустимо начать с нулевой резидентностью и подгружать payload по требованию.

Это соответствует будущим backend'ам:

```text
WorldStore API
   ├── in-memory test backend
   ├── paged file
   ├── memory-mapped store
   └── database/object store
```

Конкретный backend не должен менять семантику procedural source, FractalRing identity или результата material query.

## 6. Удаление записи

Удаление persistent FractalRing отличается от unload. Минимальный E1 backend не позволяет удалить ring, пока на него ссылаются persistent physical children.

Процедурные ссылки не требуют существования FractalRing-записи процедурного предка: поэтому они не создают аналогичного ограничения.

## 7. Текущий E1 implementation slice

`src/storage/world-store.mjs` предоставляет memory backend с тем же логическим контрактом, который позже можно реализовать поверх mmap/paged storage.

Это пока не production database: нет транзакций между процессами, журналирования, page cache eviction policy, mmap-файла и crash recovery. Эти механизмы не должны протекать в семантику ядра.
