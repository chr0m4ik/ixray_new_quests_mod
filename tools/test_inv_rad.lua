-- test_inv_rad.lua — проверка расчёта радиации в рюкзаке БЕЗ запуска игры.
--
-- Запуск: powershell -File tools\test_inv_rad.ps1 (из корня аддона).
--
-- Подменяет движок заглушками и проверяет:
--   * арифметику суммы (что считаем и что пропускаем);
--   * что пояс НЕ попадает в сумму (его считает движок);
--   * что отрицательная радиация игнорируется;
--   * периодичность 100 мс и ограничение дельты времени;
--   * что подключение механики на месте (секция турера + script_binding +
--     функция bind + метод update у биндера).
--
-- Терминология: "турер" - невидимый объект-ограничитель bq_rad_tuner, чей
-- биндер движок дёргает каждый кадр (см. NOTES_radiation_research.md).

local OUT = {}
local function say(s) OUT[#OUT + 1] = s end

-- Папка самого теста (arg[0]) и папка аддона (arg[1]).
local TESTDIR = string.match(arg and arg[0] or "", "^(.*)[/\\][^/\\]*$") or "."
local ADDON = (arg and arg[1]) or "."
say("ADDON=" .. ADDON)

----------------------------------------------------------------------------
-- Заглушки движка
----------------------------------------------------------------------------
local NOW = 1000
function time_global() return NOW end

-- Конфиг: секция -> radiation_restore_speed. Секции, которой тут нет, в конфиге
-- не существует (проверка section_exist вернёт false).
local CONFIG = {
    af_eye = 0.006,
    af_compass = 0.015,
    af_ice = 0.011,
    af_fireball = 0.002,
    ["af_eye_bq_field_container"] = 0.002,
    bq_field_container = -0.004,      -- контейнер: отрицательное -> игнор
    device_pda = nil,                 -- существует, но ключа radiation нет
}
-- Секции, которые есть, но БЕЗ ключа radiation_restore_speed.
local SECTIONS_WITHOUT_KEY = { device_pda = true }

-- Фиксатор небезопасных чтений. В движке r_float на отсутствующий ключ зовёт
-- Debug.fatal, то есть МГНОВЕННО завершает игру, и pcall это НЕ ловит. В тесте
-- такую ситуацию нельзя изобразить через error() (его pcall поймает и скрипт
-- "выживет"), поэтому макет запоминает сам ФАКТ чтения без проверки line_exist,
-- а тест проверяет, что таких чтений не было.
local unsafe_reads = {}

-- ВАЖНО: макет повторяет поведение движка - r_float требует, чтобы ключ был.
function system_ini()
    return {
        section_exist = function(self, section)
            return CONFIG[section] ~= nil or SECTIONS_WITHOUT_KEY[section] == true
        end,
        line_exist = function(self, section, key)
            if not (CONFIG[section] ~= nil or SECTIONS_WITHOUT_KEY[section]) then
                return false
            end
            if key ~= "radiation_restore_speed" then return false end
            return CONFIG[section] ~= nil
        end,
        r_float = function(self, section, key)
            -- Проверяем, что вызывающий сам убедился в наличии ключа.
            if not self:line_exist(section, key) then
                unsafe_reads[#unsafe_reads + 1] = tostring(section)
            end
            local v = CONFIG[section]
            if v == nil then return 0 end
            return v
        end,
    }
end

local rad_delta_total = 0

local function mk_item(section, on_belt)
    local it = { _section = section, _belt = on_belt == true }
    function it:section() return self._section end
    return it
end

local function mk_actor(items)
    local a = { _items = items, _radiation = 0 }
    function a:iterate_inventory(fn, obj)
        for _, it in ipairs(self._items) do
            if fn(obj, it) == true then return end
        end
    end
    function a:is_on_belt(it) return it._belt == true end
    function a:position() return { x = 0, y = 0, z = 0 } end
    function a:level_vertex_id() return 1 end
    function a:game_vertex_id() return 1 end
    -- ВАЖНО: радиация - СВОЙСТВО, а не метод. В движке
    -- (script_game_object_script2.cpp:80) это .property("radiation",
    -- GetRadiation, SetRadiation), а SetRadiation -> ChangeRadiation, то есть
    -- ПРИСВАИВАНИЕ ДОБАВЛЯЕТ значение. Метода change_radiation в Lua НЕТ
    -- (игра падала: "attempt to call method 'change_radiation' (a nil value)").
    -- Поэтому макет не даёт никакого change_radiation: попытка его вызвать
    -- должна валить тест, как она валит игру.
    return setmetatable(a, {
        __index = function(t, k)
            if k == "radiation" then return rawget(t, "_radiation") end
            return nil          -- никаких change_radiation и прочих методов
        end,
        __newindex = function(t, k, v)
            if k == "radiation" then
                rawset(t, "_radiation", rawget(t, "_radiation") + v)  -- +=
                rad_delta_total = rad_delta_total + v
            else
                rawset(t, k, v)
            end
        end,
    })
end

db = { actor = nil }

-- Турер: заглушка ALife
local created_tuner = nil
function alife()
    return {
        object = function(self, id)
            if created_tuner and created_tuner.id == id then return created_tuner end
            return nil
        end,
        create = function(self, section, pos, lvid, gvid)
            created_tuner = { id = 4242, section = section }
            return created_tuner
        end,
    }
end

-- object_binder / class: повторяем поведение движка.
-- ВАЖНО: class и super обязаны быть ГЛОБАЛЬНЫМИ - скрипт вызывает их как
-- глобальные функции ("class \"Имя\" (Родитель)" и "super(obj)").
-- ctx: в движке `class "Имя" (Родитель)` создаёт класс с метатаблицей, а внутри
-- методов доступна функция super(...), которая зовёт одноимённый метод
-- родителя. Наш скрипт использует и то и другое, поэтому макет обязан это
-- уметь - иначе тест падал бы на super().
local binder_classes = {}
local class_parents = {}
local current_class = nil

_G.object_binder = {
    net_spawn = function() return true end,
    net_destroy = function() end,
    update = function() end,
}

-- class "Имя" (Родитель) - это ЦЕПОЧКА ВЫЗОВОВ: class("Имя") возвращает функцию,
-- которая получает родителя. Поэтому макет обязан возвращать функцию, а не
-- таблицу: иначе скрипт падает на строке с class.
function _G.class(name)
    local function with_parent(parent)
        parent = parent or _G.object_binder
        local cls = {}
        cls.__index = cls
        setmetatable(cls, { __index = parent })
        binder_classes[name] = cls
        class_parents[name] = parent
        current_class = name
        _G[name] = cls
        return cls
    end
    return with_parent
end

function _G.super(self, ...)
    local parent = class_parents[current_class]
    if not parent then return nil end
    local info = debug.getinfo(2, "n")
    local method = info and info.name
    local fn
    if method then fn = parent[method] end
    if type(fn) ~= "function" then fn = parent.__init end
    if type(fn) == "function" then
        return fn(self, ...)
    end
    return nil
end

----------------------------------------------------------------------------
-- Загрузка скрипта и симуляция кадров
----------------------------------------------------------------------------
local function load_script()
    local f = assert(loadfile(ADDON .. "/scripts/bq_inv_rad.script"))
    f()
end

local function reset()
    rad_delta_total = 0
    created_tuner = nil
    _G.bq_inv_rad = nil
    _G.bind = nil
    CONFIG.__reset = nil
end

-- Имитация СТАРОГО состояния в _G. В игре таблица _G переживает пересоздание
-- Lua-машины, поэтому после обновления скрипта там может лежать таблица прежней
-- версии - без новых полей. На этом игра падала:
--   attempt to perform arithmetic on field 'cycles' (a nil value)
-- Проверка 9 создаёт такое состояние намеренно.
local function set_stale_state()
    _G.bq_inv_rad = {
        -- поля прежних версий скрипта
        sum = 0.5, last_logged = 0.5, last_tick = 0, announced = true,
        -- и НЕТ cycles / accum_from / next_tick / tuner_id
    }
end

-- Создаёт экземпляр биндера и возвращает его (как это делает движок: bind(obj)).
-- ВАЖНО: время в тесте идёт ТОЛЬКО вперёд. Откатывать NOW назад нельзя: в игре
-- такого не бывает, а next_tick остался бы в будущем и начисление не наступало
-- (на этом тест сначала давал ложные ошибки в проверках 3 и 4).
local function make_binder()
    local obj = {
        _id = 4242,
        position = function() return { x = 0, y = 0, z = 0 } end,
        id = function(self) return self._id end,
    }
    local cls = binder_classes["bq_rad_tuner_binder"]
    if not cls then return nil end
    local binder = setmetatable({ object = obj }, { __index = cls })
    binder.object = obj
    -- net_spawn, как его зовёт движок
    if cls.net_spawn then binder:net_spawn(nil) end
    return binder
end

-- Прогон N кадров по step_ms. Перед этим гарантируем, что начисление вообще
-- может наступить: сдвигаем next_tick в прошлое, как будто турер живёт давно.
local function tick(binder, times, step_ms)
    step_ms = step_ms or 16
    for _ = 1, times do
        NOW = NOW + step_ms
        binder:update(0.016)
    end
end

-- Диагностика: показать состояние таблицы после прогона.
local function diag(label)
    local st = _G.bq_inv_rad or {}
    say(string.format("   [%s] now=%d accum_from=%s next_tick=%s cycles=%s sum=%s",
        label, NOW, tostring(st.accum_from), tostring(st.next_tick),
        tostring(st.cycles), tostring(st.sum)))
end

----------------------------------------------------------------------------
-- 1) Сумма: артефакт в рюкзаке даёт radiation * dt
----------------------------------------------------------------------------
do
    reset()
    db.actor = mk_actor({ mk_item("af_eye", false) })
    load_script()
    local b = make_binder()
    tick(b, 1)                       -- первый кадр: задаёт точку отсчёта
    local before = rad_delta_total
    NOW = NOW + 1000                 -- 1 секунда
    tick(b, 1)
    local expected = 0.006 * 1.0     -- 0.006 за секунду
    local got = rad_delta_total - before
    local ok = math.abs(got - expected) < 0.001
    say(string.format("1) 0.006/с за ~1 с: ожидалось ~%.4f, получено %.4f -> %s",
        expected, got, ok and "OK" or "ОШИБКА"))
end

-- 2) Артефакт НА ПОЯСЕ не учитывается
do
    reset()
    db.actor = mk_actor({ mk_item("af_eye", true) })
    load_script()
    local b = make_binder()
    tick(b, 1)
    local before = rad_delta_total
    NOW = NOW + 1000
    tick(b, 1)
    local got = rad_delta_total - before
    say(string.format("2) пояс исключён: получено %.6f (ожидалось 0) -> %s",
        got, (got == 0) and "OK" or "ОШИБКА"))
end

-- 3) Отрицательная радиация игнорируется (контейнер -0.004)
do
    reset()
    db.actor = mk_actor({
        mk_item("bq_field_container", false),   -- -0.004 -> игнор
        mk_item("af_eye", false),               -- +0.006
    })
    load_script()
    local b = make_binder()
    tick(b, 1)
    local before = rad_delta_total
    NOW = NOW + 1000
    tick(b, 1)
    local expected = 0.006
    local ok = math.abs((rad_delta_total - before) - expected) < 0.001
    say(string.format("3) отрицательные игнорируются: ожидалось ~%.4f, получено %.4f -> %s",
        expected, rad_delta_total - before, ok and "OK" or "ОШИБКА"))
end

-- 4) Предметы без радиации не считаются и НЕ роняют игру.
--    Здесь два важных случая, оба были реальными:
--      * wpn_ak74 - такой секции в конфиге нет вообще (section_exist = false);
--      * device_pda - секция ЕСТЬ, но ключа radiation_restore_speed в ней нет
--        (именно на этом падала игра: "Can't find variable ... in [device_pda]").
do
    reset()
    unsafe_reads = {}
    db.actor = mk_actor({
        mk_item("wpn_ak74", false),     -- секции нет
        mk_item("device_pda", false),   -- секция есть, ключа нет
        mk_item("af_eye", false),
    })
    load_script()
    local b = make_binder()
    tick(b, 1)
    local before = rad_delta_total
    NOW = NOW + 1000
    tick(b, 1)
    local expected = 0.006
    local ok = math.abs((rad_delta_total - before) - expected) < 0.001
    say(string.format("4) предметы без радиации (нет секции / нет ключа): ожидалось ~%.4f, получено %.4f -> %s",
        expected, rad_delta_total - before, ok and "OK" or "ОШИБКА"))

    -- Главная часть проверки: чтение ключа без проверки line_exist в движке
    -- приводит к Debug.fatal, то есть к вылету игры (pcall его не ловит).
    local safe = #unsafe_reads == 0
    say(string.format("4b) ключ не читается без проверки line_exist (иначе Debug.fatal) -> %s",
        safe and "OK" or ("ОШИБКА: небезопасные чтения: " .. table.concat(unsafe_reads, ", "))))
end

-- 5) Периодичность: за 1 секунду при 60 FPS начислений должно быть ~10, не 60
do
    reset()
    db.actor = mk_actor({ mk_item("af_compass", false) })
    load_script()
    local b = make_binder()
    tick(b, 1)
    local before = rad_delta_total
    tick(b, 60, 16)                  -- ~1 секунда кадров
    -- 0.015/с; считаем по 100 мс => примерно 10 порций по 0.0015
    local expected = 0.015
    local ok = math.abs((rad_delta_total - before) - expected) < 0.002
    say(string.format("5) порционно по 100 мс: ожидалось ~%.4f, получено %.4f -> %s",
        expected, rad_delta_total - before, ok and "OK" or "ОШИБКА"))
end

-- 6) Ограничение дельты: большой разрыв времени не даёт выброса
do
    reset()
    db.actor = mk_actor({ mk_item("af_compass", false) })
    load_script()
    local b = make_binder()
    tick(b, 1)
    local before = rad_delta_total
    NOW = NOW + 600000               -- 10 минут разрыва
    tick(b, 1)
    local got = rad_delta_total - before
    -- Ограничение 1000 мс => максимум 0.015
    local ok = got <= 0.0151
    say(string.format("6) ограничение дельты (разрыв 10 мин): получено %.6f (<= 0.015) -> %s",
        got, ok and "OK" or "ОШИБКА"))
end

-- 7) Пустой рюкзак: change_radiation не вызывается
do
    reset()
    db.actor = mk_actor({})
    load_script()
    local b = make_binder()
    tick(b, 1)
    local before = rad_delta_total
    NOW = NOW + 1000
    tick(b, 1)
    local got = rad_delta_total - before
    say(string.format("7) пустой рюкзак: получено %.6f (ожидалось 0) -> %s",
        got, (got == 0) and "OK" or "ОШИБКА"))
end

----------------------------------------------------------------------------
-- 8) Проверка ПОДКЛЮЧЕНИЯ механики (без неё скрипт в игре не заработает)
----------------------------------------------------------------------------
do
    local function read_file(path)
        local f = io.open(path, "r")
        if not f then return nil end
        local s = f:read("*a"); f:close(); return s
    end

    -- a) секция турера есть в конфиге и её родитель - space_restrictor
    local cfg = read_file(ADDON .. "/configs/misc/mod_artefacts_z_bq.ltx") or ""
    local header = cfg:match("%[bq_rad_tuner%]:([%w_]+)")
    say(string.format("8a) секция [bq_rad_tuner] с родителем -> %s",
        (header == "space_restrictor") and "OK" or ("ОШИБКА: " .. tostring(header))))

    -- b) у секции задан script_binding на наш скрипт
    local binding = cfg:match("%[bq_rad_tuner%][^%[]-script_binding%s*=%s*([%w_%.]+)")
    say(string.format("8b) script_binding = bq_inv_rad.bind -> %s",
        (binding == "bq_inv_rad.bind") and "OK" or ("ОШИБКА: " .. tostring(binding))))

    -- c) турер скрыт из спавнера (оба inv_grid_* = 0)
    local gw = cfg:match("%[bq_rad_tuner%][^%[]-inv_grid_width%s*=%s*(%d+)")
    local gh = cfg:match("%[bq_rad_tuner%][^%[]-inv_grid_height%s*=%s*(%d+)")
    say(string.format("8c) турер скрыт из спавнера (inv_grid 0/0) -> %s",
        (gw == "0" and gh == "0") and "OK" or ("ОШИБКА: " .. tostring(gw) .. "/" .. tostring(gh))))

    -- d) скрипт объявляет bind и класс биндера с методом update
    reset()
    db.actor = mk_actor({})
    load_script()
    local ok_d = type(_G.bind) == "function" and binder_classes["bq_rad_tuner_binder"] ~= nil
    say(string.format("8d) скрипт объявляет bind и класс биндера -> %s",
        ok_d and "OK" or "ОШИБКА"))

    -- e) конфиг [callbacks] ссылается на этот скрипт (иначе файл не загрузится)
    local gg = read_file(ADDON .. "/configs/mod_game_global_z_bq.ltx") or ""
    local ok_e = gg:find("bq_inv_rad%.on_key_press") ~= nil
    say(string.format("8e) mod_game_global ссылается на bq_inv_rad -> %s",
        ok_e and "OK" or "ОШИБКА"))

    -- f) механики не связаны: контейнеры не упоминают радиацию
    local cont = read_file(ADDON .. "/scripts/bq_containers.script") or ""
    local mentions = 0
    for line in cont:gmatch("[^\r\n]+") do
        if not line:match("^%s*%-%-") and line:find("bq_inv_rad") then mentions = mentions + 1 end
    end
    say(string.format("8f) bq_containers НЕ упоминает bq_inv_rad в коде -> %s",
        (mentions == 0) and "OK" or "ОШИБКА"))

    -- g) Радиация применяется ТОЛЬКО через свойство. Метода change_radiation в
    --    Lua нет - игра падала с "attempt to call method 'change_radiation'
    --    (a nil value)". Проверяем, что такого вызова в коде нет.
    local rad_src = read_file(ADDON .. "/scripts/bq_inv_rad.script") or ""
    local bad_call = false
    for line in rad_src:gmatch("[^\r\n]+") do
        if not line:match("^%s*%-%-") and line:find(":change_radiation%s*%(") then
            bad_call = true
        end
    end
    say(string.format("8g) нет вызова несуществующего метода change_radiation -> %s",
        (not bad_call) and "OK" or "ОШИБКА: в Lua такого метода нет, нужен actor.radiation = x"))
end

----------------------------------------------------------------------------
-- 9) РЕГРЕСС: старая таблица в _G (переживает пересоздание Lua-машины).
--    В игре это выглядело так: турер работает, но каждый кадр
--    "attempt to perform arithmetic on field 'cycles' (a nil value)".
--    Скрипт обязан сам до-выставить недостающие поля.
----------------------------------------------------------------------------
do
    reset()
    set_stale_state()
    db.actor = mk_actor({ mk_item("af_eye", false) })
    load_script()

    local st = _G.bq_inv_rad
    local ok_fields = type(st.cycles) == "number"
        and st.sum == nil and st.last_logged == nil and st.announced == nil
    say(string.format("9a) старая таблица в _G нормализована (cycles и т.д.) -> %s",
        ok_fields and "OK" or ("ОШИБКА: cycles=" .. tostring(st.cycles)
            .. " sum=" .. tostring(st.sum) .. " announced=" .. tostring(st.announced))))

    -- и расчёт при этом должен работать без ошибок
    local b = make_binder()
    local errors_before = 0
    tick(b, 1)
    local before = rad_delta_total
    NOW = NOW + 1000
    tick(b, 1)
    local got = rad_delta_total - before
    local ok_calc = math.abs(got - 0.006) < 0.001 and st.cycles >= 1
    say(string.format("9b) расчёт работает со старой таблицей: получено %.4f, cycles=%s -> %s",
        got, tostring(st.cycles), ok_calc and "OK" or "ОШИБКА"))
end

local f = io.open(TESTDIR .. "/test_inv_rad_out.txt", "w")
f:write(table.concat(OUT, "\n") .. "\n")
f:close()
