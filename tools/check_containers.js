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
];

// Артефакты, для которых есть комбо. `radiation` - абсолютное значение
// radiation_restore_speed артефакта в оригинальном artefacts.ltx (проверять
// по файлу, не по памяти!), `bleeding` - его bleeding_restore_speed.
// Комбо обязано НЕ переопределять ничего, кроме радиации, - остальные статы
// (включая замедление кровотечения) наследуются от артефакта.
const TESTED_ARTEFACTS = [
    {
        artefact: 'af_eye',
        radiation: 0.002,
        bleeding: 0.004,
        combos: {
            bq_field_container: 'af_eye_bq_field_container',
            bq_uni_container:   'af_eye_bq_uni_container',
            bq_sci_container:   'af_eye_bq_sci_container',
        },
    },
    {
        artefact: 'af_cristall',
        radiation: 0.001,
        bleeding: 0,
        combos: {
            bq_field_container: 'af_cristall_bq_field_container',
            bq_uni_container:   'af_cristall_bq_uni_container',
            bq_sci_container:   'af_cristall_bq_sci_container',
        },
    },
];

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
// Таблицы иммунитетов — это не предметы: у них нет и не должно быть
// ключей предмета (hud, inv_name, inv_grid_* и т.д.).
const isItemSection = (r) => ![...r.keys()].some((k) => k.endsWith('_immunity'));
for (const name of ours.keys()) {
    const r = resolve(name);
    if (isItemSection(r)) {
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
        // артефакта (CUIArtefactParams::Check, ui_af_params.cpp:195)
        if (r.get('af_actor_properties') !== 'on') {
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

        // защита: должна остаться таблица артефакта
        if (r.get('hit_absorbation_sect') !== artAbs) {
            err(`[${combo}] hit_absorbation_sect='${r.get('hit_absorbation_sect')}', ожидалось '${artAbs}'`);
        } else ok(`[${combo}] защита от артефакта (${artAbs})`);

        // радиация: combo = artefact + min(-absorb, artefact), то есть
        // контейнер поглощает не больше, чем артефакт излучает (MEMO 13.2).
        const exact = +(artRad - c.absorb).toFixed(6);
        const want = comboRadiation(artRad, c.absorb);
        const got = parseFloat(r.get('radiation_restore_speed'));
        if (Math.abs(want - got) > 0.0000005) {
            err(`[${combo}] radiation_restore_speed=${got}, ожидалось ${want} ` +
                `(${artRad} + min(${-c.absorb}, ${artRad})` +
                (exact < 0 ? `; без ограничения получилось бы ${exact}` : '') + ')');
        } else {
            ok(`[${combo}] radiation=${got} (артефакт ${artRad}, поглощение ${c.absorb})`);
        }

        // остальные статы должны приходить от артефакта, а не переписываться
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

        // belt у комбо ОБЯЗАН быть true. Тонкость наследования в X-Ray:
        // последний родитель важнее, а bq_container_base задаёт belt = false
        // (он идёт вторым родителем) - без явного belt = true в комбо предмет
        // нельзя положить на пояс, и он не даёт никаких эффектов.
        if (r.get('belt') !== 'true') {
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
    // Ожидаемая раскладка атласа: три непустые ячейки в верхнем ряду.
    for (let i = 0; i < CONTAINERS.length; i++) {
        const { opaque } = dds.countOpaqueInCell(decoded, i, 0, CELL);
        if (opaque === 0) err(`верхний ряд атласа: ячейка (${i},0) пустая, а это контейнер ${CONTAINERS[i].section}`);
    }
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

if (errors === 0) {
    console.log('\nOK: конфиг контейнеров согласован, обязательные ключи на месте.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
