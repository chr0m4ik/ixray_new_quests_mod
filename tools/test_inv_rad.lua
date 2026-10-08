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
    -- СИМК: комбо поглощает ВСЮ радиацию артефакта, поэтому у него ровно 0.
    -- Эти секции добавлены специально для проверки 10, чтобы отличить "ноль из
    -- конфига" от "ноль, потому что секция не нашлась".
    bq_simk_container = 0,
    ["af_eye_bq_simk_container"] = 0,
}
-- Секции, которых в этом макете НЕТ: обращение к ним должно быть видно.
local SECTIONS_WITHOUT_KEY = { device_pda = true }

-- Фиксатор обращений к секциям, которых нет в макете. Нужен, чтобы проверка
-- СИМК была честной: если бы af_eye_bq_simk_container не существовала, то
-- "доза = 0" получилась бы из-за ошибки конфига, а не из-за поглощения.
-- Такой тест ничего не доказывает, поэтому такие обращения запоминаем и валим.
local unknown_sections = {}

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
            local known = CONFIG[section] ~= nil or SECTIONS_WITHOUT_KEY[section] == true
            if not known then
                unknown_sections[#unknown_sections + 1] = tostring(section)
            end
            return known
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
-- Читает файл целиком. Вынесено на уровень файла: используется и в блоке 8,
-- и в блоке 10 (проверка подключения СИМК).
local function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local s = f:read("*a"); f:close(); return s
end

do
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

----------------------------------------------------------------------------
-- 10) СИМК: поглощает ВСЮ радиацию артефакта.
--     Комбо СИМК имеет radiation_restore_speed = 0, поэтому артефакт внутри
--     не даёт фона вообще. Проверяем арифметику и, отдельно, само подключение
--     контейнера (секция в конфиге, таблица в скрипте, запрет пояса).
----------------------------------------------------------------------------
do
    -- a) артефакт В СИМК не даёт фона
    reset()
    unknown_sections = {}
    db.actor = mk_actor({ mk_item("af_eye_bq_simk_container", false) })
    load_script()
    local b = make_binder()
    tick(b, 1)
    local before = rad_delta_total
    NOW = NOW + 1000
    tick(b, 1)
    local got = rad_delta_total - before
    -- Секция обязана существовать: иначе ноль получился бы из-за ошибки, а не
    -- из-за поглощения (см. фиксатор unknown_sections).
    local known = #unknown_sections == 0
    say(string.format("10a) артефакт в СИМК: доза %.6f (ожидалось 0) -> %s",
        got, (got == 0 and known) and "OK"
            or ("ОШИБКА" .. (known and "" or (": неизвестные секции " ..
                table.concat(unknown_sections, ", "))))))

    -- b) для сравнения: тот же артефакт в поле даёт фон (af_eye 0.006, поле 0.004 -> 0.002)
    reset()
    db.actor = mk_actor({ mk_item("af_eye_bq_field_container", false) })
    load_script()
    local b2 = make_binder()
    tick(b2, 1)
    local before2 = rad_delta_total
    NOW = NOW + 1000
    tick(b2, 1)
    local got2 = rad_delta_total - before2
    say(string.format("10b) для сравнения, тот же артефакт в поле: доза %.6f (должна быть > 0) -> %s",
        got2, (got2 > 0) and "OK" or "ОШИБКА: полевой контейнер не фонит"))

    -- c) подключение контейнера: секция в конфиге + таблица в скрипте
    local cfg = read_file(ADDON .. "/configs/misc/mod_artefacts_z_bq.ltx") or ""
    local script = read_file(ADDON .. "/scripts/bq_containers.script") or ""

    local has_empty = cfg:find("%[bq_simk_container%]") ~= nil
    local has_combo = cfg:find("%[af_eye_bq_simk_container%]") ~= nil
    local has_absorb = cfg:find("%[bq_simk_container_absorbation%]") ~= nil
    say(string.format("10c) секции СИМК в конфиге (пустой, комбо, защиты) -> %s",
        (has_empty and has_combo and has_absorb) and "OK"
            or ("ОШИБКА: " .. tostring(has_empty) .. "/" .. tostring(has_combo)
                .. "/" .. tostring(has_absorb))))

    local in_script = script:find("bq_simk_container") ~= nil
    local clean_only = script:find("CLEAN_ARTIFACT_ONLY") ~= nil
        and script:find("is_clean_artifact") ~= nil
    say(string.format("10d) контейнер описан в скрипте -> %s", in_script and "OK" or "ОШИБКА"))
    say(string.format("10e) есть правило 'только чистые артефакты' -> %s",
        clean_only and "OK" or "ОШИБКА: нет CLEAN_ARTIFACT_ONLY/is_clean_artifact"))

    -- f) belt = false у комбо: движок по этому ключу не пускает предмет на пояс
    --    (CInventory::CanPutInBelt, Inventory.cpp:1295-1303)
    local beltFalse = false
    for block in cfg:gmatch("%[af_%w+_bq_simk_container%](.-)\n%[") do
        if block:find("belt%s*=%s*false") then beltFalse = true end
    end
    -- последний блок в файле может не иметь следующего "[", проверим и так
    if not beltFalse then
        local tail = cfg:match("%[af_%w+_bq_simk_container%][^%[]*$")
        if tail and tail:find("belt%s*=%s*false") then beltFalse = true end
    end
    say(string.format("10f) у комбо СИМК belt = false (нельзя на пояс) -> %s",
        beltFalse and "OK" or "ОШИБКА: комбо СИМК должно быть belt = false"))

    -- g) у СИМК отключено окно статистики артефакта. Движок смотрит на НАЛИЧИЕ
    --    ключа af_actor_properties (CUIArtefactParams::Check, ui_af_params.cpp:193),
    --    поэтому нужен именно 'off' - убрать ключ нельзя, он наследуется от
    --    bq_container_base, который идёт вторым родителем комбо.
    --
    --    ВАЖНО: читаем ПРАВИЛО, а не ищем слово в тексте. Сначала я разбирал
    --    секции жадным шаблоном, и проверка проходила даже со сломанным
    --    конфигом: в комментарии рядом есть слова "af_actor_properties = off",
    --    они и подставлялись вместо настоящего значения. Теперь берём значение
    --    из последней строки "af_actor_properties = X" ВНУТРИ секции.
    local function section_body(text, header)
        -- от заголовка секции до следующего заголовка.
        -- ВАЖНО: заголовком считается и "[x]", и "![x]" - восклицательный знак
        -- ставится у переопределений ванильных секций. Если его не учесть,
        -- "хвост" секции захватывает следующие секции, и проверка начинает
        -- читать чужие статы (на этом уже ошибся дважды).
        local start = text:find(header, 1, true)
        if not start then return nil end
        local from = start + #header
        local stopA = text:find("\n[", from, true)
        local stopB = text:find("\n![", from, true)
        local stop = stopA
        if stopB and (not stop or stopB < stop) then stop = stopB end
        return text:sub(from, (stop and stop - 1) or #text)
    end
    local function key_in_section(text, header, key)
        local body = section_body(text, header)
        if not body then return nil, "нет секции" end
        -- берём ПОСЛЕДНЕЕ присваивание ключа в секции (оно и побеждает)
        local value = nil
        for line in body:gmatch("[^\r\n]+") do
            local bare = line:gsub(";.*$", "")          -- отбрасываем комментарий
            local v = bare:match("^%s*" .. key .. "%s*=%s*(%S+)")
            if v then value = v end
        end
        return value, nil
    end

    local v, err2 = key_in_section(cfg, "[bq_simk_container]", "af_actor_properties")
    say(string.format("10g) у пустого СИМК af_actor_properties = off -> %s",
        (v == "off") and "OK" or ("ОШИБКА: получено " .. tostring(v or err2))))

    -- j) ГЛАВНОЕ для окна характеристик: у комбо СИМК должны быть ОБНУЛЕНЫ все
    --    статы. Ключ af_actor_properties на видимость не влияет (проверено в
    --    игре), а SetInfo читает восстановление из секции предмета
    --    (ui_af_params.cpp:256) и пропускает нулевые строки (:257-260).
    --    Иммунитеты читаются из hit_absorbation_sect (:231-232).
    local RESTORE = {
        "health_restore_speed", "satiety_restore_speed", "thirst_restore_speed",
        "power_restore_speed", "bleeding_restore_speed", "radiation_restore_speed",
        "additional_inventory_weight",
    }
    local comboProblems = {}
    for _, art in ipairs({ "af_eye", "af_ice", "af_cristall", "af_compass", "af_fireball" }) do
        local header = "[" .. art .. "_bq_simk_container]"
        local bad = {}
        for _, k in ipairs(RESTORE) do
            local kv = key_in_section(cfg, header, k)
            if kv ~= "0" then bad[#bad + 1] = k .. "=" .. tostring(kv) end
        end
        local abs = key_in_section(cfg, header, "hit_absorbation_sect")
        if abs ~= "bq_simk_container_absorbation" then
            bad[#bad + 1] = "защита=" .. tostring(abs)
        end
        if #bad > 0 then comboProblems[#comboProblems + 1] = art .. "(" .. table.concat(bad, ",") .. ")" end
    end
    say(string.format("10j) у всех комбо СИМК статы обнулены -> %s",
        (#comboProblems == 0) and "OK" or ("ОШИБКА: " .. table.concat(comboProblems, " "))))

    -- k) таблица защит СИМК нейтральна: все девять иммунитетов нули. Иначе окно
    --    покажет строки защиты (нулевые строки оно пропускает, :233).
    local IMM = {
        "radiation_immunity", "burn_immunity", "chemical_burn_immunity",
        "telepatic_immunity", "shock_immunity", "wound_immunity",
        "fire_wound_immunity", "explosion_immunity", "strike_immunity",
    }
    local immBad = {}
    for _, k in ipairs(IMM) do
        local kv = key_in_section(cfg, "[bq_simk_container_absorbation]", k)
        if kv ~= "0" then immBad[#immBad + 1] = k .. "=" .. tostring(kv) end
    end
    say(string.format("10k) таблица защит СИМК нейтральна (9 иммунитетов = 0) -> %s",
        (#immBad == 0) and "OK" or ("ОШИБКА: " .. table.concat(immBad, ", "))))

    local bad = {}
    for _, art in ipairs({ "af_eye", "af_ice", "af_cristall", "af_compass", "af_fireball" }) do
        local header = "[" .. art .. "_bq_simk_container]"
        local vv = key_in_section(cfg, header, "af_actor_properties")
        if vv ~= "off" then bad[#bad + 1] = art .. "=" .. tostring(vv) end
    end
    say(string.format("10h) у всех комбо СИМК af_actor_properties = off -> %s",
        (#bad == 0) and "OK" or ("ОШИБКА: " .. table.concat(bad, ", "))))

    -- i) в описании СИМК фраза про пояс отделена пустой строкой (\n\n), то есть
    --    вынесена на две строки вниз. Проверяем по факту: находим фразу и
    --    смотрим два символа ПЕРЕД ней. Без Lua-паттернов - в них "-" не ленивый,
    --    и на этом я уже ошибся один раз.
    local rus = read_file(ADDON .. "/configs/text/rus/st_beard_quest.xml") or ""
    local pos = rus:find("Камера контейнера глушит", 1, true)
    local before = pos and rus:sub(pos - 2, pos - 1)
    local twoLines = before == "\n\n"
    say(string.format("10i) в описании СИМК абзац перед фразой про пояс (\\n\\n) -> %s",
        twoLines and "OK" or ("ОШИБКА: перед фразой " .. tostring(before and before:gsub("\n", "<LF>")))))

    -- l) СИМК занимает ДВЕ клетки в высоту. Так нарисованы текстуры заказчика
    --    (открытый: крышка сверху, корпус снизу), и от этого зависит и раскладка
    --    атласа, и размер иконки в инвентаре.
    local emptyH = key_in_section(cfg, "[bq_simk_container]", "inv_grid_height")
    say(string.format("10l) у пустого СИМК inv_grid_height = 2 -> %s",
        (emptyH == "2") and "OK" or ("ОШИБКА: получено " .. tostring(emptyH))))

    -- m) У комбо со глазом настроен слой значка артефакта. Слой рисует ДВИЖОК
    --    по ключу 1icon_layer (наш патч ui\UICellCustomItems.cpp,
    --    InitLayer/UpdateLayer); ключи читаются из секции ПРЕДМЕТА, то есть из
    --    комбо. Значок 25x25 с отступом 1 px: scale = 25/64, отступ = 50-25-1.
    local eyeHeader = "[af_eye_bq_simk_container]"
    local eyeH = key_in_section(cfg, eyeHeader, "inv_grid_height")
    local layerSect = key_in_section(cfg, eyeHeader, "1icon_layer")
    local layerScale = tonumber(key_in_section(cfg, eyeHeader, "1icon_layer_scale") or "0")
    local layerX = tonumber(key_in_section(cfg, eyeHeader, "1icon_layer_x") or "-1")
    local layerY = tonumber(key_in_section(cfg, eyeHeader, "1icon_layer_y") or "-1")
    local layerOk = layerSect == "af_eye"
        and math.abs(layerScale - 25 / 64) < 1e-9
        and layerX == 24 and layerY == 24
    say(string.format("10m) слой значка 25x25 у комбо с глазом (height=%s scale=%.6f x=%s y=%s) -> %s",
        tostring(eyeH), layerScale, tostring(layerX), tostring(layerY),
        (eyeH == "2" and layerOk) and "OK"
            or ("ОШИБКА: 1icon_layer=" .. tostring(layerSect))))
end

local f = io.open(TESTDIR .. "/test_inv_rad_out.txt", "w")
f:write(table.concat(OUT, "\n") .. "\n")
f:close()
