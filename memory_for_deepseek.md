# bq_zaton_quest — MEMO для AI-ассистента

> Рабочая памятка по моду «Документы с портовых кранов» (побочный квест Бороды).
> Если контекст чата потерян — перечитай этот файл с начала, он самодостаточен.

---

## 1. Общее

- **Проект:** S.T.A.L.K.E.R. Call of Pripyat
- **Движок:** ixRay, сборка `IX-Ray Call Of Pripyat r1.3.6` (build 10081 от 14.09.2026)
- **Рабочий путь:** `z:\games\stalkercop\gamedata\...`
- **Мод:** побочная квестовая линия по документам с портовых кранов (заказчик — Борода).
- **Архитектура мода:** все свои конфиги кладём отдельными `bq_*.xml` / `bq_*.ltx` и подключаем через `mod_system_z_bq.ltx` (`>files = ...` работает как append).
- **Локализация:** русская, кодировка XML — `windows-1251`.
- **Скрипты:** Lua, кладутся в `gamedata\scripts\`, подхватываются автоматически по имени файла (в `mod_system_z_bq.ltx` их прописывать **не нужно**).

---

## 2. Ключевые пути (внутри `gamedata`)

| Что | Путь |
|---|---|
| Главный конфиг игры | `configs\system.ltx` |
| Мод-оверрайд | `configs\mod_system_z_bq.ltx` |
| Профили NPC (id→class) | `configs\creatures\npc_profile.xml` + наш `bq_npc_profile.xml` |
| Описание конкретных NPC | `configs\creatures\character_desc_zaton.xml` + наш `bq_character_desc_zaton.xml` |
| Секции спавна | `configs\creatures\spawn_sections.ltx` (агрегатор) → `spawn_sections_zaton.ltx` + наш `bq_spawn_sections_zaton.ltx` |
| Диалоги | `configs\gameplay\dialogs_zaton.xml` + наш `bq_dialogs.xml` |
| Инфопорции | `configs\gameplay\info_zaton.xml` + наш `bq_info.xml` |
| Строки локализации | `configs\text\rus\st_*.xml` + наш `st_beard_quest.xml` |
| Логика NPC (`custom_data`) | `configs\scripts\zaton\*.ltx` + наши `bq_hmury_logic.ltx`, `bq_guard_logic.ltx` |
| Скрипты | `gamedata\scripts\*.script` |
| Скриптовые коллбеки ixRay | `gamedata\scripts\dynamic_callbacks.lua` |

---

## 3. Три обязательные точки регистрации нового NPC

В этой сборке каждый NPC регистрируется через **три файла**. При этом `id`, `class` и `character_profile` — **одно и то же имя**:

1. **`npc_profile.xml`** (через `[profiles] files = ...`):
   ```xml
   <character id="X"><class>X</class></character>
   ```

2. **`character_desc_*.xml`** (через `[profiles] specific_characters_files = ...`):
   ```xml
   <specific_character id="X">
     ...
     <class>X</class>
     ...
   </specific_character>
   ```

3. **`spawn_sections_*.ltx`** (через `#include` из `spawn_sections.ltx`):
   ```ini
   [X]:stalker
   $spawn = "respawn\X"
   character_profile = X
   community = stalker
   spec_rank = regular
   ```

⚠ Если в `npc_profile.xml` поставить `id`, который уже есть (например `sim_default_duty_0`) — движок падает с `duplicate item id`.

---

## 4. Наши файлы (актуальное состояние)

### 4.1. `configs\mod_system_z_bq.ltx`

```ini
![info_portions]
>files = bq_info

![dialogs]
>files = bq_dialogs

![profiles]
>files = bq_npc_profile
>specific_characters_files = bq_character_desc_zaton

![string_table]
>files = st_beard_quest

[bq_stash_box]:inventory_box
visual = dynamics\box\box_1a
fixed_bones = link

[bq_beard_marker]:space_restrictor
[bq_sich_marker]:space_restrictor

[bq_documents]:device_pda
$spawn              = "quest_items\bq_documents"
visual              = dynamics\equipments\quest\notes_document_case_3.ogf
inv_weight          = 0.05
inv_grid_width      = 2
inv_grid_height     = 1
inv_grid_x          = 18
inv_grid_y          = 20
$prefetch           = 16
description         = bq_item_docs_descr
inv_name            = bq_item_docs_name
inv_name_short      = bq_item_docs_name
can_trade           = false
quest_item          = true
cost                = 0
```

### 4.2. `configs\creatures\bq_npc_profile.xml`

Три записи: `bq_zaton_stalker_hmury`, `bq_zaton_hmury_guard_1`, `bq_zaton_hmury_guard_2`.

### 4.3. `configs\creatures\bq_character_desc_zaton.xml`

- **Хмурый** (`bq_zaton_stalker_hmury`) — сталкер-одиночка, `visual stalker_neutral_2`, оружие `wpn_ak74` + `wpn_beretta`, `start_dialog bq_zaton_stalker_hmury_start`.
- **Гвард-новичок** (`bq_zaton_hmury_guard_1`) — visual `neutral_1`, AK-74U + ПМ.
- **Гвард-ветеран** (`bq_zaton_hmury_guard_2`) — visual `neutral_2`, AK-74 + Beretta.

### 4.4. `configs\creatures\bq_spawn_sections_zaton.ltx`

```ini
[bq_zaton_stalker_hmury]:stalker
$spawn              = "respawn\bq_zaton_stalker_hmury"
character_profile   = bq_zaton_stalker_hmury
spec_rank           = regular
community           = stalker
story_id            = bq_zaton_stalker_hmury
custom_data         = scripts\zaton\bq_hmury_logic.ltx

[bq_zaton_hmury_guard_1]:stalker
$spawn              = "respawn\bq_zaton_hmury_guard_1"
character_profile   = bq_zaton_hmury_guard_1
spec_rank           = novice
community           = stalker
custom_data         = scripts\zaton\bq_guard_logic.ltx

[bq_zaton_hmury_guard_2]:stalker
$spawn              = "respawn\bq_zaton_hmury_guard_2"
character_profile   = bq_zaton_hmury_guard_2
spec_rank           = experienced
community           = stalker
custom_data         = scripts\zaton\bq_guard_logic.ltx
```

### 4.5. `configs\creatures\spawn_sections.ltx`

Подключаем свой файл через `#include` в конце:

```ini
#include "spawn_sections_general.ltx"
#include "spawn_sections_zaton.ltx"
#include "spawn_sections_pripyat.ltx"
#include "spawn_sections_jupiter.ltx"
#include "spawn_sections_labx8.ltx"
#include "spawn_sections_underpass.ltx"
#include "bq_spawn_sections_zaton.ltx"
```

### 4.6. `configs\scripts\zaton\bq_hmury_logic.ltx`

```ini
[logic]
active = remark@bq_hmury

[remark@bq_hmury]
meet = meet@bq_hmury

[meet@bq_hmury]
close_distance = 4
use = {=actor_enemy} false, {+bq_hmury_dialog_ready =see_actor =dist_to_actor_le(4)} self, {=see_actor} true, false
meet_dialog = bq_zaton_stalker_hmury_start
allow_break = false
trade_enable = false
meet_on_talking = true

close_anim       = nil
close_victim     = nil
close_snd_hello  = nil
close_snd_bye    = nil
far_anim         = nil
far_snd          = nil
far_victim       = nil
```

`allow_break = false` — игрок не может ESC-нуть из диалога.
`meet_on_talking = true` — диалог не срывается, если игрок чуть повернётся/отойдёт.
Заглушённые `*_anim` / `*_snd` — отключают реакцию NPC на оружие в руках игрока (`threat_na`).

### 4.7. `configs\scripts\zaton\bq_guard_logic.ltx`

```ini
[logic]
active = remark@bq_guard

[remark@bq_guard]
```

Просто `remark` — стоят на месте, диалога не открывают.

### 4.8. `configs\gameplay\bq_dialogs.xml`

- Квест Бороды: `bq_beard_start`, `bq_beard_deliver`, `bq_guide_hint`, `bq_sich_buy_docs`.
- Диалог Хмурого: `bq_zaton_stalker_hmury_start` — две фазы торга и ветка нападения.

### 4.9. `gamedata\scripts\bq_hmury.script`

Функции:
- `set_enemy(first_speaker, second_speaker)` — делает Хмурого врагом через `force_set_goodwill(-1000, db.actor)` + `xr_motivator.update_logic(npc)`.
- `set_enemy_all(...)` — делает врагами Хмурого и обоих гвардов (в т.ч. offline через `se_obj:force_set_goodwill`).
- `give_docs_2000(...)` / `give_docs_2000_armor(...)` — забирает у игрока `bq_documents` (через `alife():release`), выдаёт деньги/броник и ставит инфопорцию `bq_docs_given_to_hmury`. **Документы в инвентарь Хмурого не кладутся** — вместо этого при его смерти мы заново спавним `bq_documents` в трупе.

### 4.10. `gamedata\scripts\bq_quest.script`

Ключевые функции:
- `give_task(...)` — стартует квест, спавнит ящик `bq_stash_box` через `bq_stash.spawn_stash()`.
- `on_documents_taken()` — закрывает задачу «найти тайник», спавнит Хмурого + двух гвардов, выдаёт задачи «доставить Бороде» и «найти покупателя».
- `on_documents_delivered(...)` / `on_documents_sold(...)` — завершают квест, дают награду и вызывают `despawn_hmury_squad()`.
- `on_sich_hint_given()` — наводка от Лоцмана.
- `try_check_documents()` — вызывается из коллбека `update` (см. ниже). Проверяет, не подобрал ли игрок `bq_documents`.
- `despawn_hmury_squad()` — удаляет Хмурого и гвардов (и живых, и трупы) через `alife():release`.
- В конце файла — `level.add_call`, ловящий смерть Хмурого и спавнящий `bq_documents` в его трупе.

### 4.11. `gamedata\scripts\bq_stash.script`

Отдельный модуль, спавнит ящик `bq_stash_box` и наполняет его содержимым:
- `bq_documents` × 1
- `bread` × 2
- `medkit` × 1
- `ammo_9x18_fmj` × 32

Координаты ящика и содержимое — в этом файле.

### 4.12. `configs\gameplay\bq_info.xml`

Инфопорции: `bq_quest_started`, `bq_documents_taken`, `bq_deliver_task`, `bq_buyer_task`, `bq_docs_delivered`, `bq_docs_sold`, `bq_beard_grateful`, `bq_beard_angry`, `bq_beard_angry_seen`, `bq_sich_hint_given`, `bq_hmury_dialog_ready`, `bq_hmury_spawned`, `bq_docs_given_to_hmury`, `bq_docs_recovered`.

### 4.13. `configs\text\rus\st_beard_quest.xml`

Строки квеста + строки диалога Хмурого.

### 4.14. `gamedata\scripts\bind_stalker.script` (патченная версия)

Оригинальный ixRay-файл. В `actor_binder:load(reader)` (перед `SendScriptCallback("load", reader)`) добавлены строки для перерегистрации коллбека `bq_quest.on_game_load`.

### 4.15. `gamedata\scripts\_g.script` (патченная версия)

Оригинальный ixRay-файл. В `start_game_callback()` вызов `dialog_manager.fill_phrase_table()` обёрнут в `if dialog_manager and dialog_manager.fill_phrase_table then ... end`.

### 4.16. `gamedata\scripts\simulation_objects.script`, `xr_logic.script`, `dialog_manager.script`

Оригинальные файлы ixRay с защитными `if xr_conditions then` / `if xr_logic then` — см. раздел 8.

---

## 5. Синтаксис диалога (CoP/ixRay)

- `<dialog id="...">` → `<phrase_list>` → набор `<phrase id="N">`.
- `<text>string_id</text>` — id из `[string_table]`.
- `<next>M</next>` — следующая фраза. Если один `next` — авто-переход по клику. Если несколько — игрок выбирает.
- `<action>script.func</action>` — вызов Lua-функции. Первый аргумент — актор, второй — NPC.
- `<give_info>id</give_info>` / `<disable_info>id</disable_info>` — выдать/снять инфопорцию.
- `<has_info>` / `<dont_has_info>` — предусловия.
- `<precondition>script.func</precondition>` — Lua-предикат.
- `<is_final>1</is_final>` — конец цепочки.
- `<action>dialogs.break_dialog</action>` — закрыть окно.
- Фразы с пустым `<text />` — контейнеры для развилок, не отображаются.

---

## 6. Смена отношения NPC к игроку

`npc:set_relation(game_object.enemy, actor)` — **временная** связь, сбрасывается при пересчёте `attitude`. Персистентное отношение — через `personal_goodwill`:

```lua
npc:force_set_goodwill(-1000, actor)     -- враг
npc:force_set_goodwill(0, actor)         -- нейтрал
npc:force_set_goodwill(1000, actor)      -- друг
```

Формула (из `game_relations.script`):

```
attitude = personal_goodwill
         + community_goodwill            -- группировка NPC лично к актору
         + community_to_community        -- из [communities_relations]
         + reputation_goodwill           -- из [reputation_relations]
         + rank_goodwill                 -- из [rank_relations]
```

Пороги: `<= -999` → enemy, `>= 999` → friend, иначе neutral.

**Важно:** после `force_set_goodwill` нужно сбросить мирное поведение и пересобрать логику:

```lua
local st = db.storage[npc:id()]
if st and st.meet then st.meet.enabled = false end
xr_motivator.update_logic(npc)
if xr_meet and xr_meet.process_npc_usability then
    xr_meet.process_npc_usability(npc)
end
```

**Не ставить `combat_ignore_cond = true`** в логике NPC, если он должен драться — иначе останется врагом по статусу, но не будет стрелять.

---

## 7. Авто-старт диалога (meet-схема)

Авто-диалог реализован через meet-подсхему (`sr_meet.script`). Параметры `[meet@...]`:

| Параметр | Значение |
|---|---|
| `close_distance` | число (м) |
| `use` | `self` / `true` / `false` + условия |
| `meet_dialog` | id диалога |
| `allow_break` | true/false — можно ли ESC-нуть |
| `close_anim`, `close_snd_hello`, `close_victim` | `nil` — глушим реакцию на оружие |

Триггер срабатывает, когда `use` становится `self`:

```lua
local use = xr_logic.pick_section_from_condlist(db.actor, self.npc, self.a.use)
if self.use ~= use and use == "self" and not is_talking then
    db.actor:run_talk_dialog(self.npc, not(self.allow_break))
end
```

**Дистанция в `use` — ответственность автора логики**, а не движка. `close_distance` управляет только звуками hello/bye.

Наш паттерн:

```ini
use = {=actor_enemy} false, {+bq_hmury_dialog_ready =see_actor =dist_to_actor_le(4)} self, {=see_actor} true, false
```

Порядок: враг → false; есть инфопорция и игрок в 4 м и виден → self; виден → ручной Talk; иначе → false.

**`custom_data` (spawn_ini) применяется только при спавне.** После правки logic-файла — обязательно переспавнить NPC.

---

## 8. Состояние квеста (актуально)

**Квест полностью работает:**
1. Игрок берёт задание у Бороды.
2. Идёт к кранам, обыскивает ящик, забирает `bq_documents`.
3. Спавнится Хмурый + двое гвардов.
4. Авто-старт диалога: две фазы торга, ветка нападения.
5. При согласии — документы уходят, деньги/броник — игроку, задача остаётся.
6. При убийстве Хмурого — `bq_documents` появляются в его трупе (по `level.add_call`).
7. Игрок возвращает документы Бороде или продаёт Сычу — квест завершается, отряд удаляется.
8. Прогресс квеста сохраняется, **обычная загрузка (ESC → Load, консоль, главное меню) работает корректно**.

**Осталась одна проблема:**
- **F7 (быстрая загрузка)** — краш `failed to get start game callback` в `CALifeSimulator::CALifeSimulator`. Причина: движок конструирует alife симулятор раньше, чем `_g.script` попадает в глобальное пространство Lua. Это баг ixRay, а не мода.

---

## 9. IX-Ray: система динамических коллбеков

Файл `gamedata\scripts\dynamic_callbacks.lua` (часть ixRay) предоставляет:

- `RegisterScriptCallback(name, func)` — подписаться на событие.
- `UnregisterScriptCallback(name, func)` — отписаться.
- `SendScriptCallback(name, ...)` — вызывает движок.

События: `save`, `load`, `update`, `save_state`, `load_state`.

В `bind_stalker.script`:
- `actor_binder:update(delta)` → `SendScriptCallback("update")` — каждый кадр.
- `actor_binder:save(packet)` → `SendScriptCallback("save", packet)`.
- `actor_binder:load(reader)` → `SendScriptCallback("load", reader)`.

**Наш `bq_quest.script`** в самом верху регистрирует коллбек:

```lua
RegisterScriptCallback("update", function()
    if bq_quest and bq_quest.try_check_documents then
        bq_quest.try_check_documents()
    end
end)
```

Это позволяет ловить подбор `bq_documents` каждый кадр и переживать загрузку сейва.

**Зачем:** `level.add_call` не восстанавливается после загрузки сейва. Коллбек `"update"` вызывается каждый кадр и переживает save/load.

---

## 10. Известные баги ixRay r1.3.6 build 10081

### 10.1. Race condition при Save Reloading

При загрузке сейва **изнутри игры** через ESC → Load движок иногда вызывает `start_game_callback` из `_g.script` **до того**, как все зависимые модули (`xr_conditions`, `xr_logic`, `dialog_manager`) попали в глобальное пространство Lua. Игра падает с `attempt to index global 'X' (a nil value)`.

**Решение:** в нашем моде лежат **пропатченные версии** оригинальных файлов `_g.script`, `simulation_objects.script`, `xr_logic.script`, `dialog_manager.script`, `bind_stalker.script`. В каждом добавлена защита `if X then ... end`. Эти файлы лежат в `gamedata\scripts\` мода и **перекрывают оригиналы автоматически**, ничего в `mod_system_z_bq.ltx` прописывать не нужно.

До этих правок квест **вообще не продолжался** после загрузки сейва — Хмурый не спавнился, задачи не обновлялись. После правок **обычные способы загрузки работают полностью**: ESC → Load, консольная `load`, выход в главное меню → загрузка.

### 10.2. F7 (быстрая загрузка) — известное ограничение

Краш:

```
[error]Expression    : ai().script_engine().functor(start_game_callback,functor)
[error]Function      : CALifeSimulator::CALifeSimulator
[error]File          : alife_simulator.cpp
[error]Line          : 83
[error]Description   : failed to get start game callback
```

F7-путь в ixRay конструирует `CALifeSimulator` раньше, чем `_g.script` попадает в глобальное пространство Lua, и движок не находит функцию `start_game_callback`.

**Обход для игроков:** не использовать F7. Загружать через ESC → Load или главное меню → Загрузить. Все остальные способы работают.

### 10.3. Если в addon-папках игры лежат свои версии наших патченных файлов

В сборке с addon-папками (`ixray-*`, `zzz-*` и т.п.) может оказаться, что оригинальные версии файлов лежат **в одной из addon-папок** и грузятся позже, чем `gamedata\scripts\`. Тогда наши патчи не применятся.

**Проверка:** поиском по корню игры искать `bind_stalker.script`, `simulation_objects.script`, `dialog_manager.script`, `xr_logic.script`, `_g.script`. Если найдены в addon-папках — перенести наши версии в `zzz-bq-mod\gamedata\scripts\` (префикс `zzz-` гарантирует загрузку последним).

---

## 11. Что уже работает / TODO

**Работает:**
1. Хмурый + два гварда зарегистрированы и спавнятся.
2. Диалог с торгом, нападением и согласием.
3. Документы переходят Хмурому, при его смерти — возвращаются в труп.
4. Квест завершается через Бороду или Сыча, отряд удаляется.
5. Загрузка сейвов через ESC / консоль / главное меню.

**TODO:**
1. Найти способ обхода F7 или дождаться фикса ixRay.
2. Продумать: игрок отдал документы Хмурому и не убил его — задача висит, надо бы подсказать через PDA.
3. Возможные ветки: Сыч как «второй покупатель» уже есть в диалогах, но не тестировался после всех правок.

---

## 12. Полезные напоминания

- **Никогда не использовать существующие id** из `npc_profile.xml` — только новые (префикс `bq_`).
- Проверять, что используемые секции оружия/патронов реально есть в `weapons.ltx` (`wpn_ak47` в CoP нет, ближайшее — `wpn_ak74`).
- `windows-1251` для XML и `.ltx` с русским текстом, **без BOM**.
- Скрипты — `gamedata\scripts\`, **в `mod_system_z_bq.ltx` их не прописывать**.
- В диалоговых `<action>` первый аргумент — актор, второй — NPC.
- `spawn_sections.ltx` правится через `#include` в своей копии.
- `st_beard_quest.xml` лежит в `configs\text\rus\`.
- Отладка: любую `<action>`-функцию оборачивать в `printf("[bq] ...")`, смотреть `ixray-*.log`.
- `custom_data` для NPC применяется **только при спавне**. После правки logic-файла — переспавнить.