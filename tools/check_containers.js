// check_containers.js — проверка конфига контейнеров для аддона.
//
// Читает исходные ltx в cp1251 побайтово, строит ИТОГОВОЕ дерево секций
// (с учётом наследования) и проверяет:
//   1) каждый родитель существует;
//   2) все ключи, которые движок читает СТРОГО, присутствуют;
//   3) у каждого комбо свои inv_grid_x/y и icons_texture;
//   4) у каждого комбо hit_absorbation_sect указывает на таблицу артефакта
//      (защита артефакта сохраняется);
//   5) radiation_restore_speed комбо = радиация артефакта - поглощение;
//   6) все inv_name/description/use1_text есть в русской локализации;
//   7) нет дублей секций и ключей в нашем файле.
//
// Запуск: node tools/check_containers.js
'use strict';
const fs = require('fs');
const path = require('path');

const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const MOD = path.join(__dirname, '..', 'configs');
const OUR_FILE = path.join(MOD, 'misc', 'mod_artefacts_z_bq.ltx');

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const ok = (m) => console.log('  ok: ' + m);

// ---------------------------------------------------------------- чтение ltx
// Разбор конфигов - в общем модуле (tools/ini_resolver.js): там учтён синтаксис
// переопределений "![Имя]" и то, что переопределение ДОПОЛНЯЕТ секцию.
// Своя копия парсера здесь уже один раз разошлась с настоящим поведением
// движка и скрыла проблему с inv_scale.
const { readLtx, readLtxInto, makeResolver } = require('./ini_resolver.js');

// Порядок как в игре: оригинальная gamedata, затем моды сборки, затем наш файл.
// Моды сборки обязательны: ixray-hq-icons-v2.0 переопределяет секции артефактов
// и задаёт им inv_scale = 2.0 - без этого файла не видно, откуда у комбо
// берётся двойной размер иконки (2x2 ячейки вместо одной).
const ADDONS_DIR = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons';
const HQ_ICONS = path.join(ADDONS_DIR, 'ixray-hq-icons-v2.0', 'configs', 'mod_system_hqicons.ltx');

const merged = new Map();
const loadOrder = [
    // system.ltx обязателен: в нём объявлены базовые секции движка, например
    // [space_restrictor] (system.ltx:621), от которой наследуется наш
    // внутренний объект-турер радиации.
    path.join(GAME, 'system.ltx'),
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'artefacts.ltx'),
    HQ_ICONS,
    OUR_FILE,
].filter((f) => fs.existsSync(f));
if (!fs.existsSync(HQ_ICONS)) {
    console.warn('ВНИМАНИЕ: не найден мод HQ Icons, проверка inv_scale будет неполной');
}
for (const f of loadOrder) readLtxInto(f, merged);

// Секции НАШЕГО файла - отдельно: нужны для проверки дублей ключей и для
// поиска секций, которые задаём именно мы.
const ours = readLtx(OUR_FILE);

// ------------------------------------------------- вычисление наследования
const resolve = makeResolver(merged);

// Дубли ключей внутри наших секций: движок берёт ПОСЛЕДНЕЕ значение, поэтому
// дубль молча теряет одну из правок.
{
    const seenBySection = new Map();
    let curSection = null;
    for (const raw of fs.readFileSync(OUR_FILE).toString('latin1').split(/\r?\n/)) {
        const line = raw.replace(/;.*$/, '').trim();
        const h = line.match(/^(!?)\[([^\]]+)\]/);
        if (h) { curSection = h[2].trim(); continue; }
        const kv = line.match(/^([A-Za-z0-9_.$]+)\s*=/);
        if (kv && curSection) {
            if (!seenBySection.has(curSection)) seenBySection.set(curSection, new Set());
            const seen = seenBySection.get(curSection);
            if (seen.has(kv[1])) err(`дубль ключа '${kv[1]}' в [${curSection}]`);
            seen.add(kv[1]);
        }
    }
}

// ------------------------------------------------ обязательные ключи движка
// Артефакт (Artefact.cpp:64-116) + предмет (inventory_item.cpp:111-193).
const REQUIRED = [
    'immunities_sect', 'sprint_allowed', 'control_inertion_factor',
    'hud', 'animation_slot', 'lights_enabled', 'particles_bone',
    'attach_angle_offset', 'attach_position_offset', 'attach_bone_name',
    'slot', 'inv_name', 'inv_name_short', 'inv_weight', 'cost', 'description',
    'inv_grid_x', 'inv_grid_y', 'inv_grid_width', 'inv_grid_height',
    'health_restore_speed', 'radiation_restore_speed', 'satiety_restore_speed',
    'power_restore_speed', 'bleeding_restore_speed',
    'additional_inventory_weight', 'af_rank', 'hit_absorbation_sect',
];

// class проверяется отдельно и ОБЯЗАТЕЛЬНО: движок читает его через
// pSettings->r_clsid (SpawnManager.cpp:137 и создание объекта), а в
// оригинальном artefacts.ltx ключа class НЕТ ни у af_base, ни у
// identity_immunities - его задаёт каждый конкретный артефакт.
// Пропуск этого ключа дал вылет "Can't find variable class in [bq_uni_container]".

const CONTAINERS = [
    { section: 'bq_field_container', combo: 'af_eye_bq_field_container', absorb: 0.004 },
    { section: 'bq_uni_container', combo: 'af_eye_bq_uni_container', absorb: 0.008 },
    { section: 'bq_sci_container', combo: 'af_eye_bq_sci_container', absorb: 0.014 },
    // СИМК: поглощает ВСЮ радиацию (комбо всегда 0) и НЕ надевается на пояс.
    // absorb тут не используется - для него работает отдельная проверка ниже.
    { section: 'bq_simk_container', combo: 'af_eye_bq_simk_container', absorb: 0, total: true, belt: false },
];

// Артефакты, для которых есть комбо. `radiation` - ИТОГОВОЕ значение
// radiation_restore_speed артефакта (с учётом наших переопределений статов),
// `bleeding` - его bleeding_restore_speed в единицах конфига.
// Радиация по редкости (тир-лист): 1 тир +11 -> 0.011, 2 тир +6 -> 0.006,
// 3 тир +3 -> 0.003, уникальный +15 -> 0.015.
// Комбо обязано НЕ переопределять статы артефакта (кроме радиации).
const TESTED_ARTEFACTS = [
    {
        artefact: 'af_ice',
        radiation: 0.011,
        bleeding: 0,
        absorbation: 'af_ice_absorbation',
        combos: {
            bq_field_container: 'af_ice_bq_field_container',
            bq_uni_container:   'af_ice_bq_uni_container',
            bq_sci_container:   'af_ice_bq_sci_container',
            bq_simk_container:  'af_ice_bq_simk_container',
        },
    },
    {
        artefact: 'af_eye',
        radiation: 0.006,
        bleeding: 0.005,
        absorbation: 'af_eye_absorbation',
        combos: {
            bq_field_container: 'af_eye_bq_field_container',
            bq_uni_container:   'af_eye_bq_uni_container',
            bq_sci_container:   'af_eye_bq_sci_container',
            bq_simk_container:  'af_eye_bq_simk_container',
        },
    },
    {
        artefact: 'af_cristall',
        radiation: 0.003,
        bleeding: 0,
        absorbation: 'af_cristall_absorbation',
        combos: {
            bq_field_container: 'af_cristall_bq_field_container',
            bq_uni_container:   'af_cristall_bq_uni_container',
            bq_sci_container:   'af_cristall_bq_sci_container',
            bq_simk_container:  'af_cristall_bq_simk_container',
        },
    },
    {
        // В оригинале у Компаса class = SCRPTART (не ARTEFACT!), и этот класс в
        // сборке не зарегистрирован. Комбо получает class = ARTEFACT от
        // bq_container_base, а script_binding наследует от af_base.
        artefact: 'af_compass',
        radiation: 0.015,
        bleeding: 0,
        absorbation: 'af_compass_absorbation',
        combos: {
            bq_field_container: 'af_compass_bq_field_container',
            bq_uni_container:   'af_compass_bq_uni_container',
            bq_sci_container:   'af_compass_bq_sci_container',
            bq_simk_container:  'af_compass_bq_simk_container',
        },
    },
    {
        // Огненный шар. Радиация 0.002 - как у Глаза в оригинале, поэтому все
        // три обычных комбо дают 0 (контейнер поглощает больше, чем артефакт
        // излучает), а СИМК даёт 0 всегда - он поглощает всё.
        artefact: 'af_fireball',
        radiation: 0.002,
        bleeding: 0,
        absorbation: 'af_fireball_absorbation',
        combos: {
            bq_field_container: 'af_fireball_bq_field_container',
            bq_uni_container:   'af_fireball_bq_uni_container',
            bq_sci_container:   'af_fireball_bq_sci_container',
            bq_simk_container:  'af_fireball_bq_simk_container',
        },
    },
];

// Секции НАШЕГО аддона, которые являются предметами и должны иметь полный
// набор ключей: пустые контейнеры и комбо. Переопределения ванильных
// артефактов ("![af_eye]" и т.п.) сюда НЕ входят: у них свои наборы ключей,
// а class может быть SCRPTART (Компас).
const OUR_ITEM_SECTIONS = [
    ...CONTAINERS.map((c) => c.section),
    ...TESTED_ARTEFACTS.flatMap((a) => Object.values(a.combos)),
];

// ВНУТРЕННИЕ секции аддона: это НЕ предметы, игрок их получить не должен.
// Проверять у них набор ключей предмета и требовать inv_grid > 0 бессмысленно
// и вредно: наоборот, они обязаны быть скрыты из спавнера
// (inv_grid_width/height = 0, SpawnManager.cpp:160-161).
// [bq_rad_tuner] - невидимый объект-ограничитель (space_restrictor), чей
// Lua-биндер движок дёргает каждый кадр; на нём держится радиация в рюкзаке
// (см. NOTES_radiation_research.md).
const INTERNAL_SECTIONS = new Set(['bq_rad_tuner']);
// Формула, подтверждённая заказчиком в игре: контейнер поглощает НЕ БОЛЬШЕ,
// чем артефакт излучает, поэтому результат никогда не отрицательный.
const comboRadiation = (artRad, absorb) => Math.max(0, artRad - absorb);

// Статы, которые комбо НЕ должно переопределять: они должны приходить от
// артефакта как есть (радиация сюда не входит - она пересчитывается).
const INHERITED_FROM_ARTEFACT = [
    'health_restore_speed', 'satiety_restore_speed', 'power_restore_speed',
    'bleeding_restore_speed', 'additional_inventory_weight',
    'hit_absorbation_sect',
];

// Шаблонные секции: не самостоятельные предметы, у них намеренно нет
// inv_grid_x/y и hit_absorbation_sect (их задают наследники).
const TEMPLATES = new Set(['bq_container_base', 'bq_combo_base']);

console.log('== 1. Наши секции и их родители ==');
// Проверяем ПОЛНЫЙ набор ключей только у своих предметов (контейнеры и комбо)
// и у шаблона. Переопределения ванильных артефактов проверяются отдельно:
// у них другой набор ключей, а class у Компаса вообще SCRPTART.
const isItemSection = (r) => ![...r.keys()].some((k) => k.endsWith('_immunity'));
for (const name of ours.keys()) {
    const r = resolve(name);
    const isOurs = OUR_ITEM_SECTIONS.includes(name) || TEMPLATES.has(name);
    // Внутренние объекты (турер) не предметы: у них другой набор ключей и они
    // намеренно скрыты из спавнера. Проверяем только родителя.
    if (INTERNAL_SECTIONS.has(name)) {
        const parents = ours.get(name).parents;
        for (const p of parents) if (!merged.has(p)) err(`[${name}] родитель [${p}] не найден`);
        const b = r.get('script_binding');
        if (!b) err(`[${name}] нет script_binding — биндер не заработает`);
        ok(`[${name}] внутренний объект, script_binding=${b}`);
        continue;
    }
    if (isItemSection(r) && isOurs) {
        // class обязателен: без него движок падает в r_clsid
        if (!r.has('class')) {
            err(`[${name}] нет ключа 'class' — движок упадёт: Can't find variable class`);
        } else if (r.get('class') !== 'ARTEFACT') {
            err(`[${name}] class='${r.get('class')}', ожидалось ARTEFACT` +
                (r.get('class') === 'SCRPTART' ? ' (SCRPTART в этой сборке не зарегистрирован: object_factory_register.cpp:446)' : ''));
        }
        // inv_grid_x/y читаются СТРОГО (inventory_item.cpp:190 и др.) и нужны
        // даже шаблону: он тоже попадает в UI-списки (проверено вылетом
        // "Can't find variable inv_grid_x in [bq_container_base]").
        if (!r.has('inv_grid_x') || !r.has('inv_grid_y')) {
            err(`[${name}] нет inv_grid_x/inv_grid_y — движок упадёт при работе с UI`);
        }
        // по этому ключу движок решает, показывать ли окно характеристик
        // артефакта: CUIArtefactParams::Check (ui_af_params.cpp:193-195) - это
        // ровно line_exist, значение не читается.
        //
        // ИСКЛЮЧЕНИЕ - СИМК: заказчик решил, что у него показываются только
        // название и описание, без таблицы характеристик. Значит у СИМК и его
        // комбо ключ обязан быть 'off' (ключ унаследован от bq_container_base,
        // убрать его нельзя, но проверка смотрит на наличие, а не на значение).
        const isSimk = name === 'bq_simk_container'
            || name.endsWith('_bq_simk_container');
        if (isSimk) {
            if (r.get('af_actor_properties') !== 'off') {
                err(`[${name}] af_actor_properties = '${r.get('af_actor_properties')}', ` +
                    `нужно 'off' - у СИМК статистика артефакта не показывается`);
            }
        } else if (r.get('af_actor_properties') !== 'on') {
            err(`[${name}] af_actor_properties = '${r.get('af_actor_properties')}', нужно 'on' ` +
                `(иначе не будет окна характеристик)`);
        }
    }
    if (isItemSection(r) && !TEMPLATES.has(name)) {
        const missing = REQUIRED.filter((k) => !r.has(k));
        if (missing.length) err(`[${name}] нет обязательных ключей: ${missing.join(', ')}`);
        // настоящий предмет обязан быть виден в спавнере: оба размера > 0,
        // иначе SpawnManager считает секцию фиктивной (SpawnManager.cpp:160-161)
        const gw = parseInt(r.get('inv_grid_width'), 10);
        const gh = parseInt(r.get('inv_grid_height'), 10);
        if (!(gw > 0) || !(gh > 0)) {
            err(`[${name}] inv_grid_width/height = ${gw}/${gh} — предмет исчезнет из спавнера`);
        }
    }
    if (TEMPLATES.has(name)) {
        // шаблон НЕ должен быть виден в спавнере: раньше bq_container_base
        // появлялся в списке, и его спавн падал
        const gw = parseInt(r.get('inv_grid_width'), 10);
        const gh = parseInt(r.get('inv_grid_height'), 10);
        if (gw > 0 || gh > 0) {
            err(`[${name}] шаблон виден в спавнере (inv_grid_width/height = ${gw}/${gh}) — ` +
                `должны быть 0, иначе игрок сможет его заспавнить`);
        }
        // И ГЛАВНОЕ для шаблона: он идёт ПОСЛЕДНИМ родителем комбо, поэтому
        // любой его ключ важнее статов артефакта. Задавать здесь belt и
        // *_restore_speed нельзя — это уже приводило к потере всех эффектов
        // артефакта в комбо (пропадало замедление кровотечения у Глаза).
        const SHADOWING = [
            'belt', 'additional_inventory_weight',
            'health_restore_speed', 'satiety_restore_speed',
            'power_restore_speed', 'bleeding_restore_speed',
        ];
        for (const key of SHADOWING) {
            if (ours.get(name).keys.has(key)) {
                err(`[${name}] задаёт '${key}' — он перебьёт статы артефакта в комбо ` +
                    `(шаблон идёт последним родителем). Задавайте это в наследниках.`);
            }
        }
    }
    const parents = ours.get(name).parents;
    for (const p of parents) if (!merged.has(p)) err(`[${name}] родитель [${p}] не найден`);
    ok(`[${name}] ключей ${r.size}, родителей ${parents.length}` +
       (isItemSection(r) ? `, class=${r.get('class')}` : '') +
       (TEMPLATES.has(name) ? ' (шаблон)' : ''));
}

console.log('== 2. Комбо: иконка, защита, радиация ==');
const locIds = new Set();
const rusXml = fs.readFileSync(path.join(MOD, 'text', 'rus', 'st_beard_quest.xml'), 'utf8');
for (const m of rusXml.matchAll(/<string id="([^"]+)"/g)) {
    if (locIds.has(m[1])) err(`дубль строки локализации '${m[1]}'`);
    locIds.add(m[1]);
}

for (const spec of TESTED_ARTEFACTS) {
    const art = spec.artefact;
    const artRes = resolve(art);
    if (!artRes.size) continue;
    const artRad = parseFloat(artRes.get('radiation_restore_speed'));
    const artAbs = artRes.get('hit_absorbation_sect');
    const artBurn = parseFloat(resolve(artAbs).get('burn_immunity') || '0');
    const artBleed = parseFloat(artRes.get('bleeding_restore_speed'));
    // сверка ожидаемых чисел с оригиналом: если артефакт изменят, проверка
    // заставит обновить таблицу, а не молча считать по устаревшим числам
    if (Math.abs(artRad - spec.radiation) > 1e-9) {
        err(`${art}: radiation в конфиге ${artRad}, в проверке указано ${spec.radiation}`);
    }
    if (Math.abs(artBleed - spec.bleeding) > 1e-9) {
        err(`${art}: bleeding_restore_speed в конфиге ${artBleed}, в проверке указано ${spec.bleeding}`);
    }
    console.log(`  артефакт ${art}: radiation=${artRad}, bleeding=${artBleed}, ` +
                `absorbation=${artAbs} (burn ${artBurn})`);
    for (const c of CONTAINERS) {
        const combo = spec.combos[c.section];
        if (!combo) { err(`для ${art} не задано имя комбо для ${c.section}`); continue; }
        const r = resolve(combo);
        if (!r.size) { err(`[${combo}] секция не найдена`); continue; }
        const m = merged.get(combo);

        // иконка: свои координаты, не унаследованные от артефакта
        const own = (k) => m.keys.has(k);
        if (!own('inv_grid_x') || !own('inv_grid_y')) err(`[${combo}] inv_grid_x/y не заданы явно`);
        if (!own('icons_texture')) err(`[${combo}] icons_texture не задан явно`);
        if (!own('radiation_restore_speed')) err(`[${combo}] radiation_restore_speed не задан явно`);

        // защита: таблица иммунитетов артефакта, заданная в проверке явно
        // (а не выведенная из того же конфига - иначе проверка бессмысленна).
        //
        // ИСКЛЮЧЕНИЕ - СИМК (total): у него СВОЯ нейтральная таблица. Защита
        // артефакта работает только на поясе, а СИМК на пояс не надевается
        // (belt = false), поэтому наследовать её незачем.
        if (c.total) {
            if (r.get('hit_absorbation_sect') !== 'bq_simk_container_absorbation') {
                err(`[${combo}] hit_absorbation_sect='${r.get('hit_absorbation_sect')}', ` +
                    `ожидалось 'bq_simk_container_absorbation' (у СИМК своя нейтральная таблица)`);
            } else ok(`[${combo}] защита: своя нейтральная таблица СИМК`);
        } else if (r.get('hit_absorbation_sect') !== spec.absorbation) {
            err(`[${combo}] hit_absorbation_sect='${r.get('hit_absorbation_sect')}', ` +
                `ожидалось '${spec.absorbation}'`);
        } else ok(`[${combo}] защита от артефакта (${spec.absorbation})`);

        // радиация: combo = artefact + min(-absorb, artefact), то есть
        // контейнер поглощает не больше, чем артефакт излучает (MEMO 13.2).
        //
        // ДЛЯ СИМК правило другое: он поглощает ВСЁ, поэтому радиация комбо
        // равна 0 при любой радиации артефакта. Формулу к нему применять
        // нельзя - его "поглощение" в конфиге равно 0 (контейнер нейтрален
        // сам по себе), и формула вернула бы радиацию артефакта.
        const exact = +(artRad - c.absorb).toFixed(6);
        const want = c.total ? 0 : comboRadiation(artRad, c.absorb);
        const got = parseFloat(r.get('radiation_restore_speed'));
        if (Math.abs(want - got) > 0.0000005) {
            err(`[${combo}] radiation_restore_speed=${got}, ожидалось ${want} ` +
                (c.total
                    ? '(СИМК: поглощает всю радиацию, всегда 0)'
                    : `(${artRad} + min(${-c.absorb}, ${artRad})` +
                      (exact < 0 ? `; без ограничения получилось бы ${exact}` : '') + ')'));
        } else {
            ok(`[${combo}] radiation=${got} ` +
                (c.total ? '(СИМК: поглощает всё)' : `(артефакт ${artRad}, поглощение ${c.absorb})`));
        }

        // СИМК НЕЛЬЗЯ надеть на пояс - это его главное отличие. Движок решает по
        // ключу belt (CInventory::CanPutInBelt, Inventory.cpp:1295-1303;
        // флаг читается из секции в inventory_item.cpp:170).
        if (c.total) {
            const belt = r.get('belt');
            if (belt !== 'false') {
                err(`[${combo}] belt='${belt}', у СИМК должно быть false - ` +
                    `иначе контейнер можно надеть на пояс, а он переносной`);
            } else ok(`[${combo}] belt=false (на пояс не надевается)`);
        }

        // Обычные комбо НАСЛЕДУЮТ статы артефакта, а не переписывают их.
        //
        // ИСКЛЮЧЕНИЕ - СИМК: у него все статы ОБНУЛЕНЫ (решение заказчика -
        // показывать только название и описание). Поэтому обычные правила к
        // нему не применяются, а вместо них работает отдельная проверка
        // "все статы равны нулю" ниже.
        if (c.total) {
            // Окно характеристик читает восстановление из СЕКЦИИ предмета
            // (ui_af_params.cpp:256) и пропускает нулевые строки (:257-260);
            // иммунитеты читаются из hit_absorbation_sect (:231-232) с той же
            // проверкой на ноль (:233). Значит для пустого окна нужно, чтобы
            // ВСЁ было нулём - и статы комбо, и таблица защит.
            const ZEROED = [
                'health_restore_speed', 'satiety_restore_speed', 'thirst_restore_speed',
                'power_restore_speed', 'bleeding_restore_speed', 'radiation_restore_speed',
                'additional_inventory_weight',
            ];
            const nonZero = ZEROED.filter((k) => {
                const v = parseFloat(r.get(k));
                return isNaN(v) || Math.abs(v) > 1e-9;
            });
            if (nonZero.length) {
                err(`[${combo}] у СИМК должны быть обнулены статы, но не нули: ` +
                    nonZero.map((k) => `${k}=${r.get(k)}`).join(', '));
            } else {
                ok(`[${combo}] все статы обнулены (окно покажет только название и описание)`);
            }
            // таблица защит должна быть нейтральной: все иммунитеты 0
            const absRes = resolve(r.get('hit_absorbation_sect'));
            const IMM = [
                'radiation_immunity', 'burn_immunity', 'chemical_burn_immunity',
                'telepatic_immunity', 'shock_immunity', 'wound_immunity',
                'fire_wound_immunity', 'explosion_immunity', 'strike_immunity',
            ];
            const badImm = IMM.filter((k) => Math.abs(parseFloat(absRes.get(k) || 0)) > 1e-9);
            if (badImm.length) {
                err(`[${combo}] таблица защит не нейтральна, ненулевые: ${badImm.join(', ')}`);
            }
        } else {
        for (const key of INHERITED_FROM_ARTEFACT) {
            if (m.keys.has(key)) {
                err(`[${combo}] переопределяет '${key}' — должен наследовать от артефакта`);
            }
        }

        // И ГЛАВНОЕ: итоговое значение этих статов у комбо должно совпадать с
        // артефактом. Проверки "комбо не переопределяет ключ" недостаточно:
        // bq_container_base идёт ВТОРЫМ родителем (он важнее), и его нули
        // перебивали статы артефакта. Так пропадало замедление кровотечения
        // (af_eye: bleeding_restore_speed = 0.004).
        for (const key of INHERITED_FROM_ARTEFACT) {
            const want = artRes.get(key);
            const have = r.get(key);
            if (want !== have) {
                err(`[${combo}] ${key} = '${have}', а у артефакта '${want}' — ` +
                    `стат артефакта потерян (bq_container_base важнее как последний родитель)`);
            }
        }
        // отдельно и явно — то, что заказчик проверяет в игре
        if (Math.abs(parseFloat(r.get('bleeding_restore_speed')) - spec.bleeding) > 1e-9) {
            err(`[${combo}] bleeding_restore_speed = ${r.get('bleeding_restore_speed')}, ` +
                `ожидалось ${spec.bleeding} (как у ${art})`);
        } else {
            ok(`[${combo}] bleeding_restore_speed = ${r.get('bleeding_restore_speed')} (от ${art})`);
        }
        }   // конец ветки "обычное комбо" (у СИМК статы обнулены)

        // belt у комбо ОБЯЗАН быть true. Тонкость наследования в X-Ray:
        // последний родитель важнее, а bq_container_base задаёт belt = false
        // (он идёт вторым родителем) - без явного belt = true в комбо предмет
        // нельзя положить на пояс, и он не даёт никаких эффектов.
        //
        // ИСКЛЮЧЕНИЕ - СИМК: ему на пояс НЕЛЬЗЯ, это его смысл (переносной
        // контейнер). Проверка belt=false для него сделана выше.
        if (!c.total && r.get('belt') !== 'true') {
            err(`[${combo}] belt = '${r.get('belt')}', нужно 'true': ` +
                `bq_container_base идёт последним родителем и перебивает belt от артефакта`);
        }
        // пустой контейнер, наоборот, на пояс надевать нельзя
        if (r.get('can_trade') !== 'false') {
            err(`[${combo}] can_trade = '${r.get('can_trade')}', нужно 'false' ` +
                `(комбо не должно попадать в торговлю)`);
        }

        // локализация
        for (const k of ['inv_name', 'description', 'use1_text']) {
            const v = r.get(k);
            if (!v) err(`[${combo}] нет ключа ${k}`);
            else if (k !== 'use1_text' && !locIds.has(v)) err(`[${combo}] строка '${v}' (${k}) не найдена в rus`);
        }
    }
}

console.log('== 3. Пустые контейнеры ==');
for (const c of CONTAINERS) {
    const r = resolve(c.section);
    const rad = parseFloat(r.get('radiation_restore_speed'));
    if (Math.abs(rad + c.absorb) > 1e-9) err(`[${c.section}] radiation=${rad}, ожидалось ${-c.absorb}`);
    else ok(`[${c.section}] поглощает ${-rad}`);
    if (!locIds.has(r.get('inv_name'))) err(`[${c.section}] имя '${r.get('inv_name')}' не найдено в rus`);
    if (!locIds.has(r.get('description'))) err(`[${c.section}] описание '${r.get('description')}' не найдено в rus`);
}
if (!locIds.has('bq_take_artifact')) err(`строка 'bq_take_artifact' не найдена в rus`);
if (!locIds.has('bq_container_name')) err(`строка 'bq_container_name' не найдена в rus`);
if (locIds.has('bq_take_artifact')) ok(`строка кнопки 'bq_take_artifact' есть`);

// ---------------------------------------------------------------------------
// 4. Icons against the real atlas file.
//    Container atlas: textures/ui/ui_bq_field_container.dds, cells 50x50,
//    top row = empty containers (0,0) field, (1,0) universal, (2,0) scientific.
//    A combo must point at the cell of ITS container, and the cell must not be
//    empty - an empty cell means a wrong or missing icon in game.
// ---------------------------------------------------------------------------
console.log('== 4. Иконки: атлас и ячейки ==');
const dds = require('./dds.js');
const ICONS_DIR = path.join(MOD, '..', 'textures', 'ui');
const ATLAS_NAME = 'ui\\ui_bq_field_container';
const ATLAS_PATH = path.join(ICONS_DIR, 'ui_bq_field_container.dds');
const CELL = 50;
if (!fs.existsSync(ATLAS_PATH)) {
    err(`нет файла атласа ${ATLAS_PATH}`);
} else {
    const buf = fs.readFileSync(ATLAS_PATH);
    const hdr = dds.readHeader(buf);
    console.log(`  атлас ${hdr.width}x${hdr.height}, ${hdr.fourCC}, мипмапы ${hdr.mipMaps}, ${hdr.actual} байт`);
    if (hdr.fourCC !== 'DXT5') err(`атлас должен быть DXT5 (нужна альфа), а он ${hdr.fourCC}`);
    if (hdr.expected !== null && hdr.expected !== hdr.actual) {
        err(`размер атласа не совпадает с заголовком: данных ${hdr.actual}, ожидалось ${hdr.expected}`);
    }
    if (hdr.mipMaps > 1) err(`мипмапы включены (${hdr.mipMaps}) - иконки портятся, должно быть 1`);
    if (hdr.width % 4 || hdr.height % 4) err('стороны атласа должны быть кратны 4 (блок DXT 4x4)');

    const decoded = dds.decodeDXT5(buf);
    // Проверяем и пустые контейнеры, и комбо.
    const expectations = [];
    for (const c of CONTAINERS) {
        expectations.push({ section: c.section, texture: ATLAS_NAME });
    }
    for (const spec of TESTED_ARTEFACTS) {
        for (const c of CONTAINERS) expectations.push({ section: spec.combos[c.section], texture: ATLAS_NAME });
    }
    for (const e of expectations) {
        const r = resolve(e.section);
        if (!r.size) continue;
        const tex = r.get('icons_texture');
        const gx = parseInt(r.get('inv_grid_x'), 10);
        const gy = parseInt(r.get('inv_grid_y'), 10);
        const gw = parseInt(r.get('inv_grid_width'), 10);
        const gh = parseInt(r.get('inv_grid_height'), 10);
        // inv_scale обязан быть 1.0: наш атлас - сетка 50x50. Мод HQ Icons
        // задаёт артефактам inv_scale = 2.0, и комбо наследует его от
        // артефакта-родителя; тогда область иконки считается как 50*2 = 100 px,
        // то есть 2x2 ячейки (проверено в игре).
        const scl = parseFloat(r.get('inv_scale') || '1');
        if (Math.abs(scl - 1) > 1e-9) {
            err(`[${e.section}] inv_scale = ${scl}, нужно 1.0: атлас контейнеров это ` +
                `сетка 50x50, а унаследованный от артефакта inv_scale = 2.0 даёт область 100 px (2x2 ячейки)`);
        }
        if (tex !== e.texture) {
            err(`[${e.section}] icons_texture = '${tex}', ожидалось '${e.texture}'`);
            continue;
        }
        if (gx * CELL + gw * CELL > hdr.width || gy * CELL + gh * CELL > hdr.height) {
            err(`[${e.section}] ячейка (${gx},${gy}) ${gw}x${gh} выходит за пределы атласа ` +
                `${hdr.width}x${hdr.height}`);
            continue;
        }
        const { opaque, total } = dds.countOpaqueInCell(decoded, gx, gy, CELL);
        if (opaque === 0) {
            err(`[${e.section}] ячейка (${gx},${gy}) в атласе пустая - иконки не будет`);
        } else if (opaque < total * 0.05) {
            err(`[${e.section}] в ячейке (${gx},${gy}) почти нет картинки (${opaque}/${total} пикселей)`);
        } else {
            ok(`[${e.section}] атлас, ячейка (${gx},${gy}), пикселей ${opaque}/${total}`);
        }
    }
    // Ожидаемая раскладка атласа. Три обычных контейнера занимают непустые
    // ячейки верхнего ряда (0,0), (1,0), (2,0).
    //
    // СИМК в верхний ряд НЕ влезает: атлас 256 px = 5 ячеек по 50, а расширять
    // его нельзя - от размеров считаются UV-координаты (x / ширина), и сдвиг
    // сломал бы иконки в существующих сейвах. Поэтому СИМК вынесен вниз, и он
    // ЗАНИМАЕТ ДВЕ КЛЕТКИ В ВЫСОТУ (так нарисованы текстуры заказчика):
    //   пустой (открытый):  (0,6) + (0,7)
    //   комбо af_eye (закрытый + значок артефакта): (0,8) + (0,9)
    for (let i = 0; i < CONTAINERS.length; i++) {
        const c = CONTAINERS[i];
        if (c.total) continue;              // у СИМК своя ячейка, проверяем ниже
        const { opaque } = dds.countOpaqueInCell(decoded, i, 0, CELL);
        if (opaque === 0) err(`верхний ряд атласа: ячейка (${i},0) пустая, а это контейнер ${c.section}`);
    }

    // Ячейки СИМК. И у пустого, и у каждого комбо - ДВЕ клетки в высоту
    // (так нарисованы текстуры заказчика), поэтому атлас поднят до 1024:
    //   пустой (открытый):        (0,6) + (0,7)
    //   комбо аp_eye:             (0,8) + (0,9)
    //   комбо af_cristall:        (0,10) + (0,11)
    //   ... и так далее, по паре строк на артефакт.
    // Порядок строк задаётся ARTIFACTS в build_combo_icons.js.
    const SIMK_ORDER = ['af_eye', 'af_cristall', 'af_compass', 'af_ice', 'af_fireball'];
    const SIMK_CELLS = { bq_simk_container: { x: 0, y: 6 } };
    SIMK_ORDER.forEach((art, i) => {
        SIMK_CELLS[`${art}_bq_simk_container`] = { x: 0, y: 8 + 2 * i };
    });
    for (const [section, want] of Object.entries(SIMK_CELLS)) {
        const r = resolve(section);
        if (!r.size) { err(`[${section}] секция СИМК не найдена`); continue; }
        const gh = parseInt(r.get('inv_grid_height'), 10);
        const gx = parseInt(r.get('inv_grid_x'), 10);
        const gy = parseInt(r.get('inv_grid_y'), 10);
        if (gh !== 2) {
            err(`[${section}] inv_grid_height=${r.get('inv_grid_height')}, у СИМК должно быть 2 ` +
                `(иконка занимает две клетки в высоту)`);
        }
        if (gx !== want.x || gy !== want.y) {
            err(`[${section}] ячейка (${gx},${gy}), ожидалось (${want.x},${want.y})`);
        }
        // картинка должна быть в ОБЕИХ клетках: и верхней, и нижней
        const top = dds.countOpaqueInCell(decoded, gx, gy, CELL).opaque;
        const bot = dds.countOpaqueInCell(decoded, gx, gy + 1, CELL).opaque;
        if (top === 0 || bot === 0) {
            err(`[${section}] иконка 1x2 не заполнена: клетка (${gx},${gy}) ${top} px, ` +
                `(${gx},${gy + 1}) ${bot} px - пустая половина иконки`);
        } else {
            ok(`[${section}] иконка 1x2 в (${gx},${gy})+( ${gx},${gy + 1}), ` +
                `пикселей ${top}+${bot}`);
        }
    }

    // КЛЮЧЕВАЯ проверка: заполненный контейнер ОБЯЗАН ссылаться не на ту же
    // ячейку, что пустой, иначе игрок не отличит их визуально. Именно эта
    // ошибка была в первой версии: все 12 комбо указывали на inv_grid_y = 0,
    // то есть на иконки пустых контейнеров.
    for (const spec of TESTED_ARTEFACTS) {
        for (const c of CONTAINERS) {
            // СИМК проверяется отдельно выше: у него пустой и заполненный лежат
            // в РАЗНЫХ строках (0,6) и (0,8), и это уже проверено явно.
            if (c.total) continue;
            const combo = resolve(spec.combos[c.section]);
            const empty = resolve(c.section);
            if (!combo.size || !empty.size) continue;
            const cgx = parseInt(combo.get('inv_grid_x'), 10);
            const cgy = parseInt(combo.get('inv_grid_y'), 10);
            const egx = parseInt(empty.get('inv_grid_x'), 10);
            const egy = parseInt(empty.get('inv_grid_y'), 10);
            if (cgx === egx && cgy === egy) {
                err(`[${spec.combos[c.section]}] ячейка (${cgx},${cgy}) совпадает с пустым ` +
                    `контейнером [${c.section}] — заполненный будет выглядеть как пустой ` +
                    `(запустите tools/build_combo_icons.js)`);
            }
        }
    }
    ok('заполненные контейнеры ссылаются на свои ячейки, не на иконки пустых');
}

// ---------------------------------------------------------------------------
// 5. Сверка скрипта с конфигом: суффиксы комбо из bq_containers.script должны
//    давать те же имена секций, что есть в конфиге.
// ---------------------------------------------------------------------------
console.log('== 5. Соответствие скрипт <-> конфиг ==');

// ---------------------------------------------------------------------------
// 4. Сверка скрипта с конфигом: суффиксы комбо из bq_containers.script должны
//    давать ровно те имена секций, что есть в конфиге. Именно это
//    рассогласование (в скрипте 'field_container', в конфиге
//    'bq_field_container') ломало вложение в полевой контейнер и доставание
//    из него: имя, которое строил скрипт, не существовало.
// ---------------------------------------------------------------------------
const scriptPath = path.join(__dirname, '..', 'scripts', 'bq_containers.script');
const scriptSrc = fs.readFileSync(scriptPath, 'utf8');
const scriptContainers = [];
for (const m of scriptSrc.matchAll(/\{\s*section\s*=\s*"([^"]+)"\s*,\s*combo\s*=\s*"([^"]+)"\s*\}/g)) {
    scriptContainers.push({ section: m[1], combo: m[2] });
}
if (!scriptContainers.length) err('в скрипте не найдена таблица CONTAINERS (section/combo)');
for (const sc of scriptContainers) {
    if (!merged.has(sc.section)) {
        err(`скрипт ссылается на секцию '${sc.section}', которой нет в конфиге`);
        continue;
    }
    if (!CONTAINERS.some((c) => c.section === sc.section)) {
        err(`контейнер '${sc.section}' есть в скрипте, но не в списке проверки`);
        continue;
    }
    for (const spec of TESTED_ARTEFACTS) {
        const combo = spec.combos[sc.section];
        if (!combo) continue;
        const expected = `${spec.artefact}_${sc.combo}`;
        if (combo !== expected) {
            err(`скрипт для '${sc.section}' строит имя '${expected}', а в проверке '${combo}'`);
        }
        if (!merged.has(expected)) {
            err(`секция '${expected}' (имя по данным скрипта) отсутствует в конфиге - ` +
                `вложение и доставание для '${sc.section}' работать не будут`);
        }
    }
    ok(`'${sc.section}' -> суффикс комбо '${sc.combo}'`);
}

// ---------------------------------------------------------------------------
// 6. Статы артефактов: наши переопределения должны давать ровно задуманное.
//
// Самая коварная ошибка этого этапа: переопределение "![Секция]" ДОПОЛНЯЕТ
// секцию, а не заменяет её. Если в переопределении не назвать ключ, останется
// ванильное значение и сложится с нашим (у Снежинки так осталась выносливость
// 0.003, у Глаза - кровотечение 0.004). Поэтому здесь проверяется ИТОГОВОЕ
// значение каждого стата, а не наличие ключа.
// ---------------------------------------------------------------------------
console.log('== 6. Статы артефактов (по тир-листу) ==');
// factor: множитель "значение в конфиге -> показ в интерфейсе" (MEMO 13.3)
const ARTEFACT_STATS = {
    af_ice: {
        tier: 1, stats: {
            radiation_restore_speed: [1000, 11], power_restore_speed: [1000, 6],
            health_restore_speed: [1 / 0.00015, 0], bleeding_restore_speed: [1000, 0],
            satiety_restore_speed: [1000, 0], additional_inventory_weight: [1, 0],
        },
        immunities: { shock_immunity: [1 / 0.01667, 5], burn_immunity: [1 / 0.00667, 0] },
    },
    af_eye: {
        tier: 2, stats: {
            radiation_restore_speed: [1000, 6], power_restore_speed: [1000, 2],
            health_restore_speed: [1 / 0.00015, 0], bleeding_restore_speed: [1000, 5],
            satiety_restore_speed: [1000, 0], additional_inventory_weight: [1, 0],
        },
        immunities: { burn_immunity: [1 / 0.00667, 4], shock_immunity: [1 / 0.01667, 0] },
    },
    af_cristall: {
        tier: 3, stats: {
            radiation_restore_speed: [1000, 3], power_restore_speed: [1000, 0],
            health_restore_speed: [1 / 0.00015, 1], bleeding_restore_speed: [1000, 0],
            satiety_restore_speed: [1000, 0], additional_inventory_weight: [1, 0],
        },
        immunities: { burn_immunity: [1 / 0.00667, 4] },
    },
    af_compass: {
        tier: 'unique', stats: {
            radiation_restore_speed: [1000, 15], power_restore_speed: [1000, 4],
            health_restore_speed: [1 / 0.00015, 3], bleeding_restore_speed: [1000, 0],
            satiety_restore_speed: [1000, 0], additional_inventory_weight: [1, 0],
        },
        immunities: {
            burn_immunity: [1 / 0.00667, 4], shock_immunity: [1 / 0.01667, 4],
            chemical_burn_immunity: [1 / 0.005, 4], telepatic_immunity: [1 / 0.0025, 4],
        },
    },
};

for (const [art, spec] of Object.entries(ARTEFACT_STATS)) {
    const r = resolve(art);
    if (!r.size) { err(`[${art}] секция не найдена`); continue; }
    const shown = [];
    for (const [key, [factor, want]] of Object.entries(spec.stats)) {
        if (!r.has(key)) { err(`[${art}] нет ключа ${key} - ванильное значение останется и сложится`); continue; }
        const got = Math.round(parseFloat(r.get(key)) * factor);
        if (Math.abs(got - want) > 1) {
            err(`[${art}] ${key}: в интерфейсе ${got}, ожидалось ${want} ` +
                `(частый случай: ключ не назван в переопределении, и ванильное значение сложилось)`);
        } else if (want !== 0) shown.push(`${key.replace(/_restore_speed|_immunity/, '')}=${got}`);
    }
    const absSec = r.get('hit_absorbation_sect');
    if (!absSec) { err(`[${art}] нет hit_absorbation_sect`); continue; }
    const abs = resolve(absSec);
    for (const [key, [factor, want]] of Object.entries(spec.immunities)) {
        if (!abs.has(key)) { err(`[${absSec}] нет ключа ${key} - ванильное значение сложится`); continue; }
        const got = Math.round(parseFloat(abs.get(key)) * factor);
        if (Math.abs(got - want) > 1) {
            err(`[${absSec}] ${key}: в интерфейсе ${got}, ожидалось ${want}`);
        } else if (want !== 0) shown.push(`${key.replace('_immunity', '')}=${got}`);
    }
    ok(`${art} (тир ${spec.tier}): ${shown.join(', ')}`);
}

// Обратная проверка: если ключ есть в ванили и не назван в нашем
// переопределении, его значение протечёт в игру. Требуем полноты.
for (const art of Object.keys(ARTEFACT_STATS)) {
    const ourKeys = ours.get(art)?.keys;
    if (!ourKeys) continue;
    for (const k of ['radiation_restore_speed', 'health_restore_speed', 'power_restore_speed',
        'bleeding_restore_speed', 'satiety_restore_speed']) {
        if (!ourKeys.has(k)) {
            err(`[${art}] переопределение не называет ${k} - останется ванильное значение`);
        }
    }
}

// ---------------------------------------------------------------------------
// 9. Звуки: каждый путь из SOUND_BY_CONTAINER / SOUND_TAKE_BY_CONTAINER должен
//    существовать файлом в аддоне. Ошибка тут не видна в игре как вылет - просто
//    не будет звука, и заметить это можно только на слух.
// ---------------------------------------------------------------------------
console.log('== 9. Звуки контейнеров ==');
{
    const sndSrc = fs.readFileSync(scriptPath, 'utf8');
    const found = new Set();
    for (const m of sndSrc.matchAll(/"(interface\\\\[A-Za-z0-9_\\]+)"/g)) {
        found.add(m[1].replace(/\\\\/g, '\\'));
    }
    if (found.size === 0) err('в скрипте не найдено ни одного пути к звуку');
    for (const rel of found) {
        const file = path.join(__dirname, '..', 'sounds', rel + '.ogg');
        if (!fs.existsSync(file)) {
            err(`нет файла звука: sounds\\${rel}.ogg (скрипт ссылается, но файла нет)`);
        } else {
            const size = fs.statSync(file).size;
            if (size < 1000) {
                err(`звук sounds\\${rel}.ogg подозрительно мал (${size} байт) - возможно, битый`);
            } else {
                ok(`sounds\\${rel}.ogg (${(size / 1024).toFixed(0)} КБ)`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 10. Модели (visual): каждый путь должен существовать файлом в meshes аддона.
//     Ошибка тут не видна как вылет - предмет просто станет невидимым в руках
//     и в слоте, и заметить это можно только в игре.
// ---------------------------------------------------------------------------
console.log('== 10. Модели предметов (visual) ==');
{
    const artSrc = fs.readFileSync(OUR_FILE, 'utf8');
    const lines = artSrc.split(/\r?\n/);
    let current = null;
    const seen = new Map();          // visual -> [секции]
    for (const line of lines) {
        const bare = line.replace(/;.*$/, '').trim();
        const h = bare.match(/^!?\[([^\]]+)\]/);
        if (h) { current = h[1].trim(); continue; }
        const kv = bare.match(/^visual\s*=\s*(\S+)/);
        if (!kv || !current) continue;
        if (!seen.has(kv[1])) seen.set(kv[1], []);
        seen.get(kv[1]).push(current);
    }
    if (seen.size === 0) err('в конфиге не найдено ни одной строки visual');
    for (const [vis, sections] of seen) {
        const file = path.join(__dirname, '..', 'meshes', vis.replace(/\\/g, path.sep));
        if (!fs.existsSync(file)) {
            err(`нет файла модели: meshes\\${vis} (используется в: ${sections.join(', ')})`);
        } else {
            const size = fs.statSync(file).size;
            if (size < 100) {
                err(`модель meshes\\${vis} подозрительно мала (${size} байт)`);
            } else {
                ok(`meshes\\${vis} (${(size / 1024).toFixed(0)} КБ) — ${sections.length} секц.`);
            }
        }
    }

    // У комбо СИМК модель ОБЯЗАНА быть закрытой: иначе они унаследуют открытую
    // от bq_container_base, и заполненный контейнер будет выглядеть пустым.
    for (const spec of TESTED_ARTEFACTS) {
        const combo = resolve(`${spec.artefact}_bq_simk_container`);
        if (!combo.size) continue;
        const vis = combo.get('visual');
        if (!vis || !vis.includes('closed')) {
            err(`[${spec.artefact}_bq_simk_container] visual='${vis}', а нужна ЗАКРЫТАЯ ` +
                `модель СИМК (lead_box_closed) - иначе заполненный выглядит как пустой`);
        }
    }
    const emptyVis = resolve('bq_simk_container').get('visual');
    if (!emptyVis || !emptyVis.includes('open')) {
        err(`[bq_simk_container] visual='${emptyVis}', а нужна ОТКРЫТАЯ модель ` +
            `(lead_box_open) - пустой контейнер показывается открытым`);
    }
}

// ---------------------------------------------------------------------------
// 11. Кость частиц. Регресс на вылет "Can't find particle bone [link]".
//
// Ванильный af_base задаёт particles_bone = link, и это наследуется комбо от
// артефакта. CArtefact::Load (Artefact.cpp:64-91) читает кость и ЖЁСТКО требует
// её в модели (R_ASSERT2). Наши модели контейнеров - статические меши без
// костей, поэтому игра падала при получении предмета.
//
// Спасает ключ particles_bones (МНОЖЕСТВЕННОЕ число): он уводит движок в ветку,
// где particles_bone не читается вообще. Проверяем, что он есть у шаблона и что
// ни у одной нашей секции не осталось непустого particles_bone.
// ---------------------------------------------------------------------------
console.log('== 11. Кость частиц (регресс на вылет) ==');
{
    const artSrc = fs.readFileSync(OUR_FILE, 'utf8');
    const lines = artSrc.split(/\r?\n/);
    let current = null;
    const found = { plural: [], singular: [] };
    for (const line of lines) {
        const bare = line.replace(/;.*$/, '').trim();
        const h = bare.match(/^!?\[([^\]]+)\]/);
        if (h) { current = h[1].trim(); continue; }
        if (!current) continue;
        if (/^particles_bones\s*=/.test(bare)) found.plural.push(current);
        if (/^particles_bone\s*=\s*\S/.test(bare)) found.singular.push(current);
    }

    // шаблон обязан задавать множественный ключ, иначе он не дойдёт до комбо
    if (!found.plural.includes('bq_container_base')) {
        err('в [bq_container_base] нет ключа particles_bones - комбо снова получат ' +
            'particles_bone = link от af_base и игра упадёт при получении контейнера');
    } else {
        ok('particles_bones задан в [bq_container_base] (уводит движок от particles_bone)');
    }

    // непустой одиночный ключ у наших секций = потенциальный вылет
    if (found.singular.length) {
        err('непустой particles_bone у секций: ' + found.singular.join(', ') +
            ' - движок будет искать эту кость в модели и упадёт');
    } else {
        ok('непустого particles_bone нет ни у одной нашей секции');
    }

    // модели без костей: если у модели нет блока BoneNames, любая кость частиц
    // приведёт к вылету. Предупреждаем заранее.
    const visuals = new Set();
    for (const line of lines) {
        const bare = line.replace(/;.*$/, '').trim();
        const kv = bare.match(/^visual\s*=\s*(\S+)/);
        if (kv) visuals.add(kv[1]);
    }
    for (const vis of visuals) {
        const file = path.join(__dirname, '..', 'meshes', vis.replace(/\\/g, path.sep));
        if (!fs.existsSync(file)) continue;
        const data = fs.readFileSync(file);
        if (data.indexOf('BoneNames', 0, 'latin1') === -1) {
            ok(`модель без костей: ${vis.split('\\').pop()} (particles_bones это учитывает)`);
        }
    }
}

if (errors === 0) {
    console.log('\nOK: конфиг контейнеров согласован, обязательные ключи на месте.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
