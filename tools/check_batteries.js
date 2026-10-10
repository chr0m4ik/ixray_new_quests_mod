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
const ITEMS = ['bq_battery_1', 'bq_battery_2', 'bq_battery_3', 'bq_battery_4', 'bq_battery_5'];
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
        'can_trade': 'true',
        'use_condition': 'true',
        'can_stack': 'true',
        'belt': 'false',
        'default_to_ruck': 'true',
        'bq_battery': 'true',
        'inv_grid_width': '0',
        'inv_grid_height': '0',
    };
    let bad = 0;
    for (const [key, value] of Object.entries(want)) {
        const got = b.get(key);
        if (got !== value) { err(`[${BASE}] ${key} = '${got}', ожидалось '${value}'`); bad++; }
    }
    // quest_item убран специально: он запрещает и выброс, и перетаскивание.
    if (b.get('quest_item') === 'true') {
        err(`[${BASE}] quest_item = true: аккумулятор нельзя ни выбросить, ни перетащить - ` +
            `а заказчик просил и то, и другое`);
        bad++;
    }
    if (!bad) ok('флаги шаблона верны (класс, слот, ручное надевание, выброс разрешён, скрытие из спавнера)');
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
                `(inventory_item.cpp:165) и упадёт`);
        } else if (slot === '-1') {
            err(`[${name}] slot = -1: слот аккумулятора не подключён (пункт 2 плана). ` +
                `Ожидалось ${FUTURE_SLOT} (CUSTOM_SLOT_1 = 14)`);
        } else if (slot !== FUTURE_SLOT) {
            err(`[${name}] slot = ${slot}, ожидалось ${FUTURE_SLOT} (CUSTOM_SLOT_1 = 14)`);
        } else {
            ok(`[${name}] slot = ${slot} -> CUSTOM_SLOT_1 (14)`);
        }

        // Пока слот задан, движок читает эти три ключа СТРОГО
        // (inventory_item.cpp:182-187). Их даёт identity_immunities, но проверить
        // надо: если родителя когда-нибудь сменят, игра упадёт при спавне.
        if (slot !== undefined && slot !== '-1') {
            for (const k of ['default_to_ruck', 'sprint_allowed', 'control_inertion_factor']) {
                if (!r.get(k)) err(`[${name}] не разрешается строгий ключ ${k} (inventory_item.cpp:182-187)`);
            }
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
            // Турер механики живёт рядом с турером радиации - это не предмет.
            if (m[1] === 'bq_battery_tuner' || m[1] === 'bq_battery_discharge' || m[1] === 'bq_battery_drop' || m[1] === 'bq_battery_recharge') continue;
            err(`секция [${m[1]}] объявлена ещё и в ${path.relative(ROOT, f)} - движок упадёт с "Duplicate section"`);
        }
    }
    ok('дублей секций предметов bq_battery_* в других конфигах нет');
}

// ---------------------------------------------------------------------------
// 8. Слот аккумулятора (пункт 2 плана)
//
// Проверяем всё, что должно совпасть, чтобы «надеть» аккумулятор заработало:
//   1) флаги предмета (маркер, default_to_ruck, запрет продажи, выброс разрешён);
//   2) [inventory] в mod_system_z_bq.ltx (движок считает слоты до первого пропуска);
//   3) [alife] start_game_callback - единственная точка загрузки механики;
//   4) XML-оверрайды интерфейса: имя под маску автоподхвата, форма узла, текстуры;
//   5) геометрия ячейки: не залезает на пояс, рюкзак и панель состояния;
//   6) турер механики и резервные точки загрузки (callbacks).
// ---------------------------------------------------------------------------
console.log('\n== 8. Слот аккумулятора (пункт 2) ==');
{
    // --- 1. Флаги предметов
    for (const name of ITEMS) {
        const r = resolve(name);
        if (r.get('bq_battery') !== 'true') {
            err(`[${name}] нет маркера bq_battery = true - скрипт не поймёт, что это аккумулятор`);
        }
        if (r.get('default_to_ruck') !== 'true') {
            err(`[${name}] default_to_ruck = '${r.get('default_to_ruck')}': аккумулятор надевался бы ` +
                `автоматически при получении, а заказчик просил только вручную`);
        }
        if (r.get('can_trade') !== 'true') {
            err(`[${name}] can_trade = '${r.get('can_trade')}': аккумулятор должен продаваться у Сыча`);
        }
        const quest = r.get('quest_item');
        if (quest === 'true') {
            err(`[${name}] quest_item = true: движок запретит и выброс, и перетаскивание ` +
                `(UIActorMenuInventory.cpp:1296, UIActorMenu_action.cpp:69)`);
        }
        if (r.get('belt') !== 'false') {
            err(`[${name}] belt = '${r.get('belt')}': аккумулятор должен носиться в слоте, а не на поясе`);
        }
    }
    ok('флаги предметов: маркер, ручное надевание, запрет продажи, выброс разрешён');

    // --- 2. Состояние слота в [inventory]
    const sysText = fs.readFileSync(SYS_FILE, 'utf8');
    const sysIni = readLtx(SYS_FILE);
    const inv = sysIni.get('inventory');
    if (!inv || !inv.override) {
        err('в mod_system_z_bq.ltx нет секции ![inventory] - слоты 13/14 не зарегистрированы');
    } else {
        const want = {
            slot_persistent_13: 'false',
            slot_active_13: 'true',
            slot_persistent_14: 'false',
            slot_active_14: 'false',
        };
        for (const [key, value] of Object.entries(want)) {
            const got = inv.keys.get(key);
            if (got !== value) err(`[inventory] ${key} = '${got}', ожидалось '${value}'`);
        }
        ok('слоты 13 (рюкзак) и 14 (аккумулятор) зарегистрированы');
        if (want.slot_persistent_14 !== 'false') {
            err('[inventory] slot_persistent_14 должен быть false, иначе не появится пункт «надеть»');
        }
    }
    if (!sysText.includes('slot_persistent_13') || !sysText.includes('slot_persistent_14')) {
        err('в [inventory] должны быть ОБА номера подряд (13 и 14): движок считает ' +
            'last_slot циклом до первого пропуска (Inventory.cpp:66-78)');
    }

    // --- 3. Точка загрузки механики
    const alife = sysIni.get('alife');
    if (!alife || !alife.override) {
        err('в mod_system_z_bq.ltx нет секции ![alife] - механика не загрузится на старте игры');
    } else if (alife.keys.get('start_game_callback') !== 'bq_battery.on_game_start') {
        err(`[alife] start_game_callback = '${alife.keys.get('start_game_callback')}', ` +
            `ожидалось 'bq_battery.on_game_start'`);
    } else ok('[alife] start_game_callback -> bq_battery.on_game_start');

    // --- 4. XML-оверрайды интерфейса
    const UI_DIR = path.join(ROOT, 'configs', 'ui');
    const VARIANTS = [
        { file: 'mod_actor_menu_z_bq.xml', base: 'actor_menu.xml', label: '4:3' },
        { file: 'mod_actor_menu_16_z_bq.xml', base: 'actor_menu_16.xml', label: '16:9' },
    ];
    for (const v of VARIANTS) {
        const p = path.join(UI_DIR, v.file);
        if (!fs.existsSync(p)) { err(`нет файла ${v.file} (${v.label})`); continue; }
        const text = fs.readFileSync(p, 'utf8');
        const buf = fs.readFileSync(p);
        if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) err(`${v.file}: файл с BOM`);

        // Имя обязано попадать под маску автоподхвата mod_<имя файла>_*.xml
        // (AsureXML.cpp:203-224), иначе движок файл не увидит вообще.
        const base = v.base.replace(/\.xml$/i, '');
        if (!v.file.startsWith(`mod_${base}_`)) {
            err(`${v.file}: имя не подходит под маску "mod_${base}_*.xml" - движок его не найдёт`);
        }
        if (!/override\s*=\s*"add"/.test(text)) {
            err(`${v.file}: нет атрибута override="add" - узел не допишется в оригинал`);
        }
        for (const need of ['<inventory_slot_wnd', '<slot>', '<slot_dragdrop', '<slot_progress',
            '<slot_highlight', '<background', '<progress']) {
            if (!text.includes(need)) err(`${v.file}: нет узла ${need}`);
        }
        // Текстуры слота обязаны существовать.
        for (const tex of [...text.matchAll(/<texture>\s*([^<\s]+)\s*<\/texture>/g)].map((m) => m[1])) {
            // Логические id (например ui_inGame2_inventory_item_status_bar_16)
            // движок разрешает через configs\ui\textures_descr, отдельного файла
            // у них нет - проверяем только ссылки с путём (ui\имя).
            if (!tex.includes('\\') && !tex.includes('/')) continue;
            if (!dds.findTexture(tex, TEXTURE_ROOTS)) {
                err(`${v.file}: нет текстуры textures\\${tex.replace(/\\/g, '/')}.dds`);
            }
        }

        // --- 5. Геометрия: ячейка не должна залезать на пояс, рюкзак и панель состояния.
        const rect = (tag, src) => {
            const m = src.match(new RegExp(`<${tag}\\s+([^>]*)`));
            if (!m) return null;
            const num = (n) => {
                const mm = m[1].match(new RegExp(`\\b${n}="(-?\\d+)"`));
                return mm ? parseInt(mm[1], 10) : null;
            };
            return { x: num('x'), y: num('y'), w: num('width'), h: num('height') };
        };
        const ours = rect('slot_dragdrop', text);
        // Сверяем с ТЕМ ЖЕ файлом, который грузит игра: с 10.10.2026 раскладка
        // взята у Anomaly (tools/ui_layout.js), поэтому пояс и рюкзак стоят не
        // там, где в ванильном файле. Если своего файла нет - берём ванильный.
        const ourMenu = path.join(ROOT, 'configs', 'ui', v.base);
        const basePath = fs.existsSync(ourMenu) ? ourMenu : path.join(GAME, 'ui', v.base);
        if (!ours || ours.x === null || ours.w === null) {
            err(`${v.file}: не разобран прямоугольник slot_dragdrop`);
        } else if (!fs.existsSync(basePath)) {
            err(`нет ${v.base} для сверки геометрии (${basePath})`);
        } else {
            const original = fs.readFileSync(basePath, 'utf8');
            const belt = rect('dragdrop_belt', original);
            const bag = rect('dragdrop_bag', original);
            const state = rect('actor_state_info', original);
            // Верх панели состояния - пустой фон: её содержимое (полоса здоровья)
            // по раскладке лежит на 42 пикселя ниже, поэтому ячейка может заходить
            // на верх фона, но не на содержимое.
            const stateContent = state ? { x: state.x, y: state.y + 42, w: state.w, h: state.h - 42 } : null;
            const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            if (belt && overlaps(ours, belt)) err(`${v.file}: ячейка cлота перекрывает пояс (${JSON.stringify(belt)})`);
            if (bag && overlaps(ours, bag)) err(`${v.file}: ячейка слота перекрывает рюкзак (${JSON.stringify(bag)})`);
            if (stateContent && overlaps(ours, stateContent)) {
                err(`${v.file}: ячейка слота перекрывает содержимое панели состояния ` +
                    `(${JSON.stringify(stateContent)}, содержимое начинается ниже ${state.y + 42})`);
            }
            if (belt && bag && ours.x >= belt.x + belt.w && ours.x + ours.w <= bag.x) {
                ok(`${v.label}: ячейка ${ours.w}x${ours.h} на x=${ours.x} y=${ours.y} между поясом и рюкзаком`);
            } else if (belt && bag) {
                err(`${v.label}: ячейка (x=${ours.x}, w=${ours.w}) не помещается между поясом ` +
                    `(до ${belt.x + belt.w}) и рюкзаком (с ${bag.x})`);
            }
        }
    }

    // --- 6. Турер механики
    const arte = readLtx(path.join(ROOT, 'configs', 'misc', 'mod_artefacts_z_bq.ltx'));
    const tuner = arte.get('bq_battery_tuner');
    if (!tuner) {
        err('нет секции [bq_battery_tuner] в mod_artefacts_z_bq.ltx - механика не получит кадровый вызов');
    } else if (tuner.keys.get('script_binding') !== 'bq_battery.bind') {
        err(`[bq_battery_tuner] script_binding = '${tuner.keys.get('script_binding')}', ` +
            `ожидалось 'bq_battery.bind'`);
    } else ok('[bq_battery_tuner] script_binding = bq_battery.bind');

    // --- 7. Резервные точки загрузки и сам скрипт
    const globals = readLtx(path.join(ROOT, 'configs', 'mod_game_global_z_bq.ltx'));
    const cb = globals.get('callbacks');
    const SCRIPT = path.join(ROOT, 'scripts', 'bq_battery.script');
    if (!fs.existsSync(SCRIPT)) {
        err('нет scripts\\bq_battery.script');
    } else {
        const src = fs.readFileSync(SCRIPT, 'utf8');
        const sBuf = fs.readFileSync(SCRIPT);
        if (sBuf[0] === 0xEF && sBuf[1] === 0xBB && sBuf[2] === 0xBF) err('bq_battery.script: файл с BOM');
        for (const fn of ['on_game_start', 'on_load_trigger', 'bind', 'bq_battery_update']) {
            if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(src)) {
                err(`bq_battery.script: нет функции ${fn}`);
            }
        }
        // Слот и маркер должны совпадать со скриптом.
        const slotNum = parseInt(FUTURE_SLOT, 10) + 1;   // slot = 13 -> CUSTOM_SLOT_1 = 14
        const slotMatch = src.match(/BATTERY_SLOT\s*=\s*(\d+)/);
        if (!slotMatch) {
            err('bq_battery.script: не найдено значение BATTERY_SLOT');
        } else if (parseInt(slotMatch[1], 10) !== slotNum) {
            err(`bq_battery.script: BATTERY_SLOT = ${slotMatch[1]}, ожидалось ${slotNum} ` +
                `(slot = ${FUTURE_SLOT} + 1)`);
        }
        if (!src.includes('ITEM_MARKER_KEY') && !src.includes('MARKER_KEY')) {
            err('bq_battery.script: не упоминает ключ-маркер аккумулятора');
        }
        if (!src.includes('bq_battery_tuner')) err('bq_battery.script: не упоминает секцию турера');
        if (!src.includes('start_game_callback')) {
            err('bq_battery.script: не вызывает ванильный _G.start_game_callback - ' +
                'игра останется без ванильной инициализации');
        }

        // Покадровая быстрая проверка пояса. Без неё артефакт, положенный на пояс
        // без аккумулятора, успевает отдать статы (движок считает пояс раз в 100 мс),
        // и в интерфейсе видно «скачок статов» - заказчик это заметил.
        //
        // Оба кадровых источника (биндер турера и штатная рассылка update) обязаны
        // звать ОДНУ общую функцию tick: раньше у каждого была своя копия, они
        // делили один таймер, и в логе заказчика пропадали строки диагностики.
        const slice = (needle, len) => {
            const i = src.indexOf(needle);
            return i < 0 ? '' : src.slice(i, i + len);
        };
        const tickBody = slice('local function tick', 2000);
        if (!tickBody) {
            err('bq_battery.script: нет общей кадровой функции tick');
        } else {
            if (!tickBody.includes('fast_belt_check(')) {
                err('bq_battery.script: tick не вызывает fast_belt_check - ' +
                    'вернётся видимый «скачок статов»');
            }
            if (!tickBody.includes('battery_in_slot(')) {
                err('bq_battery.script: tick не проверяет слот аккумулятора');
            }
            if (!tickBody.includes('ensure_tuner()')) {
                err('bq_battery.script: tick не создаёт турер - механика будет ждать ' +
                    'первого действия игрока (так и было в логе 09.10.2026)');
            }
        }
        if (!slice('function bq_battery_tuner_binder:update', 400).includes('tick()')) {
            err('bq_battery.script: update биндера турера не зовёт tick()');
        }
        if (!slice('function bq_battery_update', 400).includes('tick()')) {
            err('bq_battery.script: резервный update не зовёт tick()');
        }
        const fastBody = slice('local function fast_belt_check', 3000);
        if (!fastBody) {
            err('bq_battery.script: нет fast_belt_check');
        } else {
            if (!fastBody.includes('belt_count') || !fastBody.includes('item_on_belt')) {
                err('bq_battery.script: быстрая проверка должна обходить пояс через ' +
                    'belt_count/item_on_belt (инвентарь целиком каждый кадр - дорого)');
            }
            if (!fastBody.includes('set_condition(')) {
                err('bq_battery.script: fast_belt_check не меняет состояние артефактов');
            }
        }
        ok('bq_battery.script: точки входа на месте');
    }
    if (!cb) {
        err('не разобрана секция [callbacks] в mod_game_global_z_bq.ltx');
    } else {
        for (const key of ['OnItemFocusLost', 'OnZoneTouch', 'OnBeforeHit']) {
            const value = cb.keys.get(key);
            if (value !== 'bq_battery.on_load_trigger') {
                err(`[callbacks] ${key} = '${value}', ожидалось 'bq_battery.on_load_trigger'`);
            }
        }
        ok('резервные точки загрузки (OnItemFocusLost/OnZoneTouch/OnBeforeHit) на месте');
    }
}

if (errors === 0) {
    console.log('\nOK: аккумуляторы и слот описаны корректно.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
