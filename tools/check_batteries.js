// tools/check_batteries.js
//
// Проверка аккумуляторов для пояса артефактов (пункт 1 плана).
// Смысл: конфиг, модели, иконки и локализация должны быть согласованы ДО запуска
// игры, потому что почти каждая ошибка здесь либо молча ничего не делает, либо
// роняет игру без внятного сообщения.
//
// Что проверяется:
//   1. файл конфига и его структура (шаблон + предметы);
//   2. обязательные ключи, которые движок читает СТРОГО
//      (inventory_item.cpp:109-193), и флаги (quest_item, use_condition, ...);
//   3. что шаблон скрыт из debug-спавнера, а предметы в нём видны
//      (SpawnManager.cpp:159-163);
//   4. модели (visual) и их текстуры - файлы существуют;
//   5. иконки: атлас есть, ячейка в пределах атласа и не пустая;
//   6. строки локализации в rus и eng;
//   7. подключение файла через #include и отсутствие дублей секций;
//   8. кодировка: UTF-8 без BOM.
//
// Запуск из корня аддона:  node tools/check_batteries.js

'use strict';
const fs = require('fs');
const path = require('path');
const dds = require('./dds.js');
const { loadAll, makeResolver, readLtx } = require('./ini_resolver.js');

const ROOT = path.join(__dirname, '..');
const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const OUR_FILE = path.join(ROOT, 'configs', 'misc', 'mod_batteries_z_bq.ltx');
const SYS_FILE = path.join(ROOT, 'configs', 'mod_system_z_bq.ltx');
const TEXTURE_ROOTS = [
    path.join(ROOT, 'textures'),
    'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\gamedata\\textures',
    'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\textures',
];

const BASE = 'bq_battery_base';
const ITEMS = ['bq_battery_1', 'bq_battery_2'];
const EXPECTED_CLASS = 'II_ATTCH';
const CELL = 50;
// Слот под аккумулятор появится в пункте 2: CUSTOM_SLOT_1 = 14,
// в конфиге это slot = 13 (inventory_item.cpp:165-166 -> base_slot_id = slot + 1).
const FUTURE_SLOT = '13';

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const ok = (m) => console.log('  ok: ' + m);
const info = (m) => console.log('  -- ' + m);

if (!fs.existsSync(OUR_FILE)) {
    console.error(`FAIL: нет файла ${path.relative(ROOT, OUR_FILE)}`);
    process.exit(1);
}

const rawBuf = fs.readFileSync(OUR_FILE);
const raw = rawBuf.toString('utf8');
const own = readLtx(OUR_FILE);

// Разрешение наследования: ваниль -> наш файл (как в игре).
const merged = loadAll([
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'items.ltx'),
    OUR_FILE,
]);
const resolve = makeResolver(merged);

// ---------------------------------------------------------------------------
// 0. Кодировка
// ---------------------------------------------------------------------------
console.log('== 0. Кодировка ==');
{
    if (rawBuf[0] === 0xEF && rawBuf[1] === 0xBB && rawBuf[2] === 0xBF) {
        err('файл начинается с BOM (нужен UTF-8 без BOM)');
    } else ok('UTF-8 без BOM');
    if (raw.includes('\uFFFD')) err('в файле есть символ-замена U+FFFD (битая кодировка)');
    else ok('битых символов нет');
}

// ---------------------------------------------------------------------------
// 1. Структура файла
// ---------------------------------------------------------------------------
console.log('\n== 1. Структура ==');
{
    if (!own.has(BASE)) err(`нет шаблона [${BASE}]`);
    else {
        const parents = own.get(BASE).parents;
        if (!parents.includes('identity_immunities')) {
            err(`[${BASE}] должен наследоваться от identity_immunities (даёт immunities_sect, slot = -1, description)`);
        } else ok(`[${BASE}]:identity_immunities`);
    }
    for (const name of ITEMS) {
        if (!own.has(name)) err(`нет секции [${name}]`);
        else if (!own.get(name).parents.includes(BASE)) {
            err(`[${name}] должен наследоваться от [${BASE}]`);
        } else ok(`[${name}]:${BASE}`);
    }
    // В файле не должно быть лишних bq_battery_* секций, которых нет в списке ITEMS.
    for (const name of own.keys()) {
        if (name.startsWith('bq_battery_') && name !== BASE && !ITEMS.includes(name)) {
            err(`лишняя секция [${name}]: добавьте её в ITEMS в этом инструменте`);
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Шаблон: флаги и скрытие из спавнера
// ---------------------------------------------------------------------------
console.log('\n== 2. Шаблон ==');
{
    const b = resolve(BASE);
    const want = {
        class: EXPECTED_CLASS,
        'can_trade': 'false',
        'quest_item': 'true',
        'use_condition': 'true',
        'can_stack': 'false',
        'belt': 'false',
        'inv_grid_width': '0',
        'inv_grid_height': '0',
    };
    let bad = 0;
    for (const [key, value] of Object.entries(want)) {
        const got = b.get(key);
        if (got !== value) { err(`[${BASE}] ${key} = '${got}', ожидалось '${value}'`); bad++; }
    }
    if (!bad) ok('флаги шаблона верны (класс, запрет торговли/выброса, заряд, скрытие из спавнера)');
    if (!b.get('inv_name') || !b.get('description')) {
        err(`[${BASE}] без inv_name/description: если секцию всё же создадут, игра упадёт`);
    }
    if (b.get('slot') && b.get('slot') !== '-1') {
        info(`у шаблона slot = ${b.get('slot')} (обычно это наследуется из identity_immunities как -1)`);
    }
}

// ---------------------------------------------------------------------------
// 3. Предметы: строгие ключи и спавнер
// ---------------------------------------------------------------------------
console.log('\n== 3. Предметы ==');
{
    // Строго читаемые ключи (inventory_item.cpp:111-193).
    const REQUIRED = ['class', 'immunities_sect', 'inv_name', 'inv_name_short', 'description',
        'inv_weight', 'cost', 'inv_grid_x', 'inv_grid_y', 'inv_grid_width', 'inv_grid_height'];
    for (const name of ITEMS) {
        const r = resolve(name);
        if (!r.size) { err(`секция [${name}] не разрешается`); continue; }
        const missing = REQUIRED.filter((k) => !r.get(k) || r.get(k) === '');
        if (missing.length) err(`[${name}] не заданы (или пусты) обязательные ключи: ${missing.join(', ')}`);
        else ok(`[${name}] все строгие ключи на месте`);

        if (r.get('class') !== EXPECTED_CLASS) {
            err(`[${name}] class = '${r.get('class')}', ожидался '${EXPECTED_CLASS}'`);
        }
        if (r.get('immunities_sect') && !merged.has(r.get('immunities_sect'))) {
            err(`[${name}] immunities_sect = '${r.get('immunities_sect')}' - такой секции нет`);
        }
        // Спавнер: предмет виден, если есть cost + inv_weight и обе сетки > 0.
        const w = parseInt(r.get('inv_grid_width'), 10);
        const h = parseInt(r.get('inv_grid_height'), 10);
        if (!(w > 0) || !(h > 0)) {
            err(`[${name}] inv_grid_width/height = ${r.get('inv_grid_width')}x${r.get('inv_grid_height')} - ` +
                `секция исчезнет из debug-спавнера (SpawnManager.cpp:160-161)`);
        } else ok(`[${name}] виден в спавнере (${w}x${h})`);

        if (r.get('inv_scale') && r.get('inv_scale') !== '1.0') {
            err(`[${name}] inv_scale = ${r.get('inv_scale')}: наш атлас - обычная сетка 50x50, нужен 1.0`);
        }

        // Слот: до пункта 2 ключа быть не должно, но сам ключ ОБЯЗАН
        // разрешаться: движок читает slot строго (inventory_item.cpp:165).
        const slot = r.get('slot');
        if (slot === undefined || slot === '') {
            err(`[${name}] не разрешается ключ slot - движок читает его строго ` +
                `(inventory_item.cpp:165) и упадёт; до пункта 2 он должен приходить ` +
                `из identity_immunities как -1`);
        } else if (slot === '-1') {
            info(`[${name}] slot = -1 (нет слота) - это нормально до пункта 2`);
        } else if (slot !== FUTURE_SLOT) {
            err(`[${name}] slot = ${slot}, ожидалось ${FUTURE_SLOT} (CUSTOM_SLOT_1 = 14)`);
        } else {
            info(`[${name}] slot = ${slot}: убедитесь, что пункт 2 сделан целиком - ` +
                `slot_persistent_14/active_14 в [inventory] и 14-й <slot> в actor_menu.xml`);
        }
    }
}

// ---------------------------------------------------------------------------
// 4. Локализация
// ---------------------------------------------------------------------------
console.log('\n== 4. Локализация ==');
{
    const ids = {};
    for (const lang of ['rus', 'eng']) {
        const dir = path.join(ROOT, 'configs', 'text', lang);
        const set = new Set();
        if (fs.existsSync(dir)) {
            for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
                const text = fs.readFileSync(path.join(dir, f), 'utf8');
                for (const m of text.matchAll(/<string id="([^"]+)"/g)) set.add(m[1]);
            }
        }
        ids[lang] = set;
    }
    let checked = 0;
    for (const name of ITEMS) {
        const r = resolve(name);
        for (const key of ['inv_name', 'inv_name_short', 'description']) {
            const id = r.get(key);
            if (!id) continue;
            checked++;
            for (const lang of ['rus', 'eng']) {
                if (!ids[lang].has(id)) err(`[${name}] ${key} = '${id}' - нет строки в ${lang}`);
            }
        }
    }
    ok(`проверено ${checked} ссылок на строки (rus + eng)`);
}

// ---------------------------------------------------------------------------
// 5. Модели и их текстуры
// ---------------------------------------------------------------------------
console.log('\n== 5. Модели и текстуры ==');
{
    const folders = new Set();
    for (const root of TEXTURE_ROOTS) {
        if (!fs.existsSync(root)) continue;
        for (const d of fs.readdirSync(root, { withFileTypes: true })) {
            if (d.isDirectory()) folders.add(d.name.toLowerCase());
        }
    }
    for (const name of ITEMS) {
        const vis = resolve(name).get('visual');
        if (!vis) { err(`[${name}] не задан visual`); continue; }
        const file = path.join(ROOT, 'meshes', vis.replace(/\\/g, path.sep));
        if (!fs.existsSync(file)) {
            err(`[${name}] нет модели meshes\\${vis} - спавнер молча скроет секцию`);
            continue;
        }
        const data = fs.readFileSync(file);
        const found = new Set();
        for (const m of data.toString('latin1').matchAll(/[A-Za-z0-9_]{2,20}(?:\\[A-Za-z0-9_.\-]{2,40}){1,4}/g)) {
            if (!folders.has(m[0].split('\\')[0].toLowerCase())) continue;
            found.add(m[0]);
        }
        if (found.size === 0) {
            err(`[${name}] из модели ${path.basename(file)} не прочитано ни одной текстуры`);
            continue;
        }
        let missing = 0;
        for (const t of found) {
            if (!dds.findTexture(t, TEXTURE_ROOTS)) {
                err(`[${name}] нет текстуры textures\\${t}.dds`);
                missing++;
            }
        }
        if (!missing) ok(`[${name}] ${vis} -> ${[...found].join(', ')}`);
    }
}

// ---------------------------------------------------------------------------
// 6. Иконки (атлас и ячейка)
// ---------------------------------------------------------------------------
console.log('\n== 6. Иконки ==');
{
    for (const name of ITEMS) {
        const r = resolve(name);
        const tex = r.get('icons_texture');
        if (!tex) { err(`[${name}] не задан icons_texture`); continue; }
        const p = dds.findTexture(tex, TEXTURE_ROOTS);
        if (!p) { err(`[${name}] нет атласа textures\\${tex.replace(/\\/g, '/')}.dds`); continue; }
        const buf = fs.readFileSync(p);
        let hdr, decoded;
        try {
            hdr = dds.readHeader(buf);
            if (hdr.expected !== null && hdr.expected !== hdr.actual) {
                err(`[${name}] атлас ${path.basename(p)}: заголовок обещает ${hdr.expected} байт, в файле ${hdr.actual}`);
            }
            decoded = dds.decodeAuto(buf);
        } catch (e) {
            err(`[${name}] атлас ${path.basename(p)} не читается: ${e.message}`);
            continue;
        }
        const gx = parseInt(r.get('inv_grid_x'), 10) || 0;
        const gy = parseInt(r.get('inv_grid_y'), 10) || 0;
        const gw = parseInt(r.get('inv_grid_width'), 10) || 1;
        const gh = parseInt(r.get('inv_grid_height'), 10) || 1;
        if ((gx + gw) * CELL > hdr.width || (gy + gh) * CELL > hdr.height) {
            err(`[${name}] ячейка (${gx},${gy}) ${gw}x${gh} выходит за пределы атласа ` +
                `${hdr.width}x${hdr.height} (${path.basename(p)})`);
            continue;
        }
        // Пустая ячейка = невидимая иконка в инвентаре. Ловим это отдельно.
        let opaque = 0;
        for (let dy = 0; dy < gh; dy++) {
            for (let dx = 0; dx < gw; dx++) {
                opaque += dds.countOpaqueInCell(decoded, gx + dx, gy + dy, CELL).opaque;
            }
        }
        if (opaque === 0) err(`[${name}] ячейка (${gx},${gy}) в ${path.basename(p)} пустая - иконки не будет видно`);
        else ok(`[${name}] ${path.basename(p)} (${gx},${gy}) ${gw}x${gh}, непрозрачных пикселей ${opaque}`);
    }
}

// ---------------------------------------------------------------------------
// 7. Подключение файла и дубли секций
// ---------------------------------------------------------------------------
console.log('\n== 7. Подключение и дубли ==');
{
    const sys = fs.readFileSync(SYS_FILE, 'utf8');
    if (!/#include\s+"misc\\mod_batteries_z_bq\.ltx"/.test(sys)) {
        err('в configs\\mod_system_z_bq.ltx нет #include "misc\\mod_batteries_z_bq.ltx" - секции не загрузятся');
    } else ok('подключён из mod_system_z_bq.ltx');

    const others = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.ltx$/i.test(e.name) && p !== OUR_FILE) others.push(p);
        }
    })(path.join(ROOT, 'configs'));
    for (const f of others) {
        const text = fs.readFileSync(f).toString('latin1');
        for (const m of text.matchAll(/^!?\[(bq_battery[A-Za-z0-9_]*)\]/gm)) {
            err(`секция [${m[1]}] объявлена ещё и в ${path.relative(ROOT, f)} - движок упадёт с "Duplicate section"`);
        }
    }
    ok('дублей секций bq_battery_* в других конфигах нет');
}

if (errors === 0) {
    console.log('\nOK: аккумуляторы описаны корректно.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
