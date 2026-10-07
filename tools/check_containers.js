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
function readLtx(file) {
    const buf = fs.readFileSync(file);
    const text = buf.toString('latin1');           // побайтово, cp1251 не портим
    const sections = new Map();
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/;.*$/, '').trim();
        if (!line) continue;
        const m = line.match(/^\[(!?)([^\]]+)\](?:\s*:\s*(.*))?$/);
        if (m) {
            const isOverride = m[1] === '!';
            const name = m[2].trim();
            const parents = (m[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
            if (sections.has(name) && !isOverride) {
                // в одном файле дубль без "!" — движок падает (Xr_ini.cpp:1071)
                const prev = sections.get(name);
                if (prev.file === file) err(`дубль секции [${name}] в ${path.basename(file)}`);
            }
            cur = { name, parents, keys: new Map(), file, override: isOverride };
            sections.set(name, cur);
            continue;
        }
        const kv = line.match(/^([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
        if (kv && cur) {
            if (cur.keys.has(kv[1])) err(`дубль ключа '${kv[1]}' в [${cur.name}]`);
            cur.keys.set(kv[1], kv[2].trim());
        }
    }
    return sections;
}

// Порядок как в игре: сначала оригинальная gamedata, затем наш файл
// (он подключается к system.ltx как mod_artefacts_*.ltx).
const merged = new Map();
for (const f of [
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'artefacts.ltx'),
]) {
    for (const [k, v] of readLtx(f)) merged.set(k, v);
}
const ours = readLtx(OUR_FILE);
for (const [k, v] of ours) merged.set(k, v);

// ------------------------------------------------- вычисление наследования
const resolved = new Map();
const resolving = new Set();
function resolve(name) {
    if (resolved.has(name)) return resolved.get(name);
    if (resolving.has(name)) { err(`циклическое наследование: ${name}`); return new Map(); }
    const sec = merged.get(name);
    if (!sec) { err(`секция [${name}] не существует`); return new Map(); }
    resolving.add(name);
    const acc = new Map();
    for (const p of sec.parents) {                 // порядок: последний родитель важнее
        for (const [k, v] of resolve(p)) acc.set(k, v);
    }
    for (const [k, v] of sec.keys) acc.set(k, v);  // свои ключи важнее родителей
    resolving.delete(name);
    resolved.set(name, acc);
    return acc;
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

// Артефакты, для которых есть комбо. Каждая запись: артефакт + имена комбо по
// контейнерам. Держать в согласии с mod_artefacts_z_bq.ltx.
const TESTED_ARTEFACTS = [
    {
        artefact: 'af_eye',
        combos: {
            bq_field_container: 'af_eye_bq_field_container',
            bq_uni_container:   'af_eye_bq_uni_container',
            bq_sci_container:   'af_eye_bq_sci_container',
        },
    },
    {
        artefact: 'af_cristall',
        combos: {
            bq_field_container: 'af_cristall_bq_field_container',
            bq_uni_container:   'af_cristall_bq_uni_container',
            bq_sci_container:   'af_cristall_bq_sci_container',
        },
    },
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
    }
    if (isItemSection(r) && !TEMPLATES.has(name)) {
        const missing = REQUIRED.filter((k) => !r.has(k));
        if (missing.length) err(`[${name}] нет обязательных ключей: ${missing.join(', ')}`);
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
    console.log(`  артефакт ${art}: radiation=${artRad}, absorbation=${artAbs} (burn ${artBurn})`);
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

        // радиация: правило "артефакт минус поглощение", проверенное заказчиком
        // в игре (MEMO 13.2). Для полевого контейнера разница (-0.002 при
        // af_eye = 0.002) в интерфейсе отображается как 0, поэтому допускаем
        // и точное значение формулы, и 0 в пределах поглощения контейнера.
        const exact = +(artRad - c.absorb).toFixed(6);
        const got = parseFloat(r.get('radiation_restore_speed'));
        const near = Math.abs(exact - got) < 0.0000005;
        const roundedToZero = got === 0 && exact < 0 && Math.abs(exact) <= c.absorb + 1e-9;
        if (!near && !roundedToZero) {
            err(`[${combo}] radiation_restore_speed=${got}, ожидалось ${exact} (${artRad} - ${c.absorb}) или 0`);
        } else ok(`[${combo}] radiation=${got} = ${artRad} - ${c.absorb}${roundedToZero ? ' (в UI округляется до 0)' : ''}`);

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

if (errors === 0) {
    console.log('\nOK: конфиг контейнеров согласован, обязательные ключи на месте.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
