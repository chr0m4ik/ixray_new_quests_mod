// tools/dump_resolved.js — показать, что движок реально увидит в секциях.
//
// Читает defines.ltx + misc\artefacts.ltx + наш mod_artefacts_z_bq.ltx, применяет
// наследование (важнее последний родитель) и печатает итоговые значения ключей.
// Нужен, чтобы отличать "ключ не задан" от "ключ перебит родителем" - именно
// такие ошибки ломали иконки комбо.
//
// Запуск: node tools/dump_resolved.js [ключи через запятую] <секция> [секция...]
// Пример: node tools/dump_resolved.js inv_grid_x,inv_grid_y,inv_grid_width,inv_grid_height,icons_texture af_eye_bq_field_container
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_KEYS = ['inv_grid_x', 'inv_grid_y', 'inv_grid_width', 'inv_grid_height',
    'icons_texture', 'class', 'belt', 'can_trade'];

// Первый аргумент со словом '=' считается списком ключей
let keys = DEFAULT_KEYS;
let sections = process.argv.slice(2);
if (sections[0] && sections[0].includes(',')) {
    keys = sections.shift().split(',').map((s) => s.trim()).filter(Boolean);
}
if (!sections.length) {
    console.error('usage: node tools/dump_resolved.js [key,key,...] <section> [...]');
    process.exit(2);
}

// Ванильные файлы берём из распакованной оригинальной gamedata (в рабочей
// сборке каталога gamedata нет - конфиги идут из аддонов и архивов).
const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const MOD = path.join(__dirname, '..', 'configs');
const ADDONS = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons';

// Порядок как в игре: оригинальная gamedata, затем аддоны сборки (последний
// выигрывает), затем наш аддон. Важно: мод HQ Icons переопределяет артефакты
// и ставит им inv_scale = 2.0 - без учёта этого файла не видно, откуда у комбо
// берётся двойной размер иконки.
const DLTX_MODS = [path.join(ADDONS, 'ixray-hq-icons-v2.0', 'configs', 'mod_system_hqicons.ltx')];

function readLtx(file) {
    const text = fs.readFileSync(file).toString('latin1');   // побайтово, cp1251 цел
    const map = new Map();
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/;.*$/, '').trim();
        if (!line) continue;
        // ВНИМАНИЕ на синтаксис: переопределение пишется "![Имя]", то есть
        // восклицательный знак ПЕРЕД скобкой. Вариант "[!Имя]" движок понимает
        // как обычную секцию с именем "!Имя" - так терялись переопределения
        // мода HQ Icons (он задаёт артефактам inv_scale = 2.0).
        const h = line.match(/^(!?)\[([^\]]+)\](?:\s*:\s*(.*))?$/);
        if (h) {
            const isOverride = h[1] === '!';
            const name = h[2].trim();
            const parents = (h[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
            // Секция с "!" ДОПОЛНЯЕТ существующую, а не заменяет её
            // (так же ведёт себя движок: Xr_ini.cpp, insert_item).
            if (isOverride && map.has(name)) {
                const prev = map.get(name);
                prev.parents = parents.length ? parents : prev.parents;
                prev.overriddenBy = path.basename(file);
                cur = prev;
                continue;
            }
            cur = {
                name,
                parents,
                keys: new Map(),
                file: path.basename(file),
                overriddenBy: null,
            };
            map.set(name, cur);
            continue;
        }
        const kv = line.match(/^([A-Za-z0-9_.$]+)\s*=\s*(.*)$/);
        if (kv && cur) cur.keys.set(kv[1], kv[2].trim());
    }
    return map;
}

const merged = new Map();
const loadOrder = [
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'artefacts.ltx'),
    ...DLTX_MODS.filter((f) => fs.existsSync(f)),
    path.join(MOD, 'misc', 'mod_artefacts_z_bq.ltx'),
];
for (const f of loadOrder) {
    for (const [k, v] of readLtx(f)) merged.set(k, v);
}

const cache = new Map();
function resolve(name) {
    if (cache.has(name)) return cache.get(name);
    const sec = merged.get(name);
    if (!sec) return new Map();
    const acc = new Map();
    for (const p of sec.parents) for (const [k, v] of resolve(p)) acc.set(k, v);
    for (const [k, v] of sec.keys) acc.set(k, v);
    cache.set(name, acc);
    return acc;
}

for (const sec of sections) {
    const src = merged.get(sec);
    if (!src) { console.log(`[${sec}] НЕ НАЙДЕНА`); continue; }
    const r = resolve(sec);
    console.log(`[${sec}]  (${src.file}, родители: ${src.parents.join(', ') || 'нет'})`);
    for (const k of keys) {
        const own = src.keys.has(k) ? 'свой' : 'унаследован';
        const from = src.keys.has(k) ? '' : ' <-- ПРИШЁЛ ОТ РОДИТЕЛЯ';
        console.log(`    ${k.padEnd(20)} = ${String(r.get(k)).padEnd(22)} [${own}]${from}`);
    }
}
