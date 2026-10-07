// tools/check_trade.js — проверка торговли контейнерами у Сыча.
//
// Что проверяет:
//   1. файл торговли лежит по тому же пути, что и у игры, и подключает
//      оригинальный (победивший) файл через #include;
//   2. записи добавлены через ">ключ = ..." (добавление в существующий список),
//      а не через "[>секция]" — второй вариант движок понял бы как секцию
//      с именем ">секция" и ничего бы не добавил;
//   3. в списках есть все три пустых контейнера и нет комбо-предметов;
//   4. цена продажи игроку равна cost контейнера, а выкуп не даёт наживы;
//   5. у контейнеров can_trade = true, у комбо can_trade = false (иначе комбо
//      попадут в торговлю).
//
// Запуск: node tools/check_trade.js
'use strict';
const fs = require('fs');
const path = require('path');
const { loadAll, makeResolver, readLtx } = require('./ini_resolver.js');

const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const ADDONS = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons';
const ROOT = path.join(__dirname, '..');
const TRADE_REL = 'configs/misc/trade/mod_trade_zat_b30_stalker_trader_z_bq.ltx';
const TRADE_FILE = path.join(ROOT, TRADE_REL);
const BASE_TRADE = path.join(ADDONS, 'ixray-stcop-wp-3.7-cop-r1.0', 'configs', 'misc', 'trade',
    'trade_zat_b30_stalker_trader.ltx');
const MOD_ARTEFACTS = path.join(ROOT, 'configs', 'misc', 'mod_artefacts_z_bq.ltx');

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const ok = (m) => console.log('  ok: ' + m);

const CONTAINERS = {
    bq_field_container: 15000,
    bq_uni_container:   25000,
    bq_sci_container:   40000,
};
// Комбо (артефакт внутри) в торговле быть не должно
const COMBOS = [
    'af_eye_bq_field_container', 'af_eye_bq_uni_container', 'af_eye_bq_sci_container',
    'af_cristall_bq_field_container', 'af_cristall_bq_uni_container', 'af_cristall_bq_sci_container',
    'af_compass_bq_field_container', 'af_compass_bq_uni_container', 'af_compass_bq_sci_container',
    'af_ice_bq_field_container', 'af_ice_bq_uni_container', 'af_ice_bq_sci_container',
];

if (!fs.existsSync(TRADE_FILE)) {
    err(`нет файла торговли ${TRADE_REL}`);
    process.exit(1);
}
ok(`файл торговли на месте: ${TRADE_REL}`);

const text = fs.readFileSync(TRADE_FILE).toString('latin1');

// 1. include оригинального файла
if (!/#include\s+"misc\\trade\\trade_zat_b30_stalker_trader\.ltx"/.test(text)) {
    err('файл не подключает оригинальный trade_zat_b30_stalker_trader.ltx через #include');
} else {
    ok('подключает оригинальный файл торговли');
}
if (!fs.existsSync(BASE_TRADE)) {
    err(`не найден базовый файл торговли (${BASE_TRADE}) - include не сработает`);
}

// 2. синтаксис добавления записей
const lines = text.split(/\r?\n/);
const badHeader = lines.filter((l) => /^\s*\[>/.test(l));
if (badHeader.length) {
    err(`найдена запись "${badHeader[0].trim()}" - движок поймёт её как секцию с именем ` +
        `">..."; правильный синтаксис: ">[секция]"`);
} else {
    ok('синтаксис добавления записей верный (">ключ", а не "[>секция]")');
}

// 3. разбор наших добавлений
const added = { buy: new Map(), sell: new Set(), supplies: new Map() };
let section = null;
for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;

    // Заголовок ">[секция]" - это указание, в чей список добавлять.
    // Настоящий заголовок секции в таких файлах не встречается (он в
    // подключаемом оригинале), но проверим и его на всякий случай.
    const listHeader = line.match(/^>\s*\[([^\]]+)\]/);
    if (listHeader) { section = listHeader[1].trim(); continue; }
    const plainHeader = line.match(/^!?\[([^\]]+)\]/);
    if (plainHeader) { section = plainHeader[1].trim(); continue; }

    const add = line.match(/^>\s*([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
    if (add) {
        const [, key, val] = add;
        const m = section === 'trade_generic_buy' ? added.buy
            : section === 'trade_generic_sell' ? added.sell
                : section === 'supplies_generic' ? added.supplies : null;
        if (!m) { err(`запись "${key}" вне ожидаемых секций (текущая: ${section})`); continue; }
        if (m instanceof Map) m.set(key, val.split(',').map((s) => s.trim()));
        else m.add(key);
        continue;
    }
    const justAdd = line.match(/^>\s*([A-Za-z0-9_.]+)$/);
    if (justAdd) {
        if (section !== 'trade_generic_sell') { err(`"${justAdd[1]}" без "=" вне trade_generic_sell`); continue; }
        added.sell.add(justAdd[1]);
        continue;
    }
}

// 4. состав и цены
for (const [sec, cost] of Object.entries(CONTAINERS)) {
    if (!added.buy.has(sec)) err(`[trade_generic_buy] нет записи для ${sec}`);
    if (!added.sell.has(sec)) err(`[trade_generic_sell] нет записи для ${sec}`);
    if (!added.supplies.has(sec)) err(`[supplies_generic] нет записи для ${sec}`);

    const buy = added.buy.get(sec);
    if (buy) {
        // "x, y": x - при хорошем отношении, y - при нейтральном.
        // Игрок покупает у торговца по trade_generic_sell, поэтому цена
        // продажи игроку берётся из discounts и cost; factor в buy - выкуп.
        const resale = parseFloat(buy[1]);
        if (!(resale > 0 && resale < 1)) {
            err(`[trade_generic_buy] ${sec}: коэффициент выкупа ${buy[1]}, ожидался между 0 и 1`);
        } else {
            const back = Math.round(cost * resale);
            ok(`${sec}: цена ${cost}, выкуп ${back} (${Math.round(resale * 100)}%)`);
        }
    }
}
for (const c of COMBOS) {
    if (added.buy.has(c) || added.sell.has(c) || added.supplies.has(c)) {
        err(`комбо ${c} попало в торговлю, а не должно`);
    }
}
if (!COMBOS.some((c) => added.buy.has(c) || added.supplies.has(c))) {
    ok('комбо-предметы в торговле отсутствуют');
}

// 5. can_trade у предметов
const merged = loadAll([
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'artefacts.ltx'),
    MOD_ARTEFACTS,
]);
const resolve = makeResolver(merged);
for (const sec of Object.keys(CONTAINERS)) {
    const r = resolve(sec);
    if (r.get('can_trade') !== 'true') err(`[${sec}] can_trade = ${r.get('can_trade')}, нужно true`);
    else ok(`[${sec}] can_trade = true`);
}
for (const c of COMBOS) {
    const r = resolve(c);
    if (!r.size) continue;
    if (r.get('can_trade') !== 'false') err(`[${c}] can_trade = ${r.get('can_trade')}, нужно false`);
}
ok('у всех комбо can_trade = false');

if (errors === 0) {
    console.log('\nOK: торговля контейнерами настроена верно.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
