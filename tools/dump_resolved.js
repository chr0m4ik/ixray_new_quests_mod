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

// Разбор конфигов - в общем модуле (tools/ini_resolver.js). Своя копия парсера
// здесь уже приводила к неверным выводам: она не дополняла секцию при
// переопределении, из-за чего статы артефакта "терялись".
const { readLtxInto, makeResolver } = require('./ini_resolver.js');

const merged = new Map();
const loadOrder = [
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'artefacts.ltx'),
    ...DLTX_MODS.filter((f) => fs.existsSync(f)),
    path.join(MOD, 'misc', 'mod_artefacts_z_bq.ltx'),
];
for (const f of loadOrder) readLtxInto(f, merged);

const resolve = makeResolver(merged);

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
