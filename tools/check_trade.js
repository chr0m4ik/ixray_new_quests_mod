// tools/check_trade.js — проверка торговли контейнерами у Сыча.
//
// Моделирует РЕАЛЬНОЕ поведение движка, на котором я дважды ошибся:
//
//  1. ">[секция]" — не заголовок, а указание «дописать в список этой секции».
//     Заголовком движок считает только строку с "[" в позиции 0 или "!["
//     (Xr_ini.cpp:1277).
//  2. Префикс ">" ДОПИСЫВАЕТ значения к ключу, который УЖЕ ЕСТЬ в секции.
//     Если ключа нет, вся строка молча игнорируется (Xr_ini.cpp:314-321).
//     Поэтому НОВЫЙ ключ (наш контейнер) надо задавать обычным присваиванием.
//     Именно из-за этого цена выкупа была 100%, а товара не было вовсе.
//  3. Мод не должен объявлять секции и не должен включать базовый файл:
//     движок читает базу сам и подхватывает мод по маске имени
//     (Xr_ini.cpp:1138). Иначе — "Duplicate section 'trader'".
//
// Запуск: node tools/check_trade.js
'use strict';
const fs = require('fs');
const path = require('path');
const { loadAll, makeResolver, readLtx } = require('./ini_resolver.js');

const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const ROOT = path.join(__dirname, '..');
const TRADE_REL = 'configs/misc/trade/mod_trade_zat_b30_stalker_trader_z_bq.ltx';
const TRADE_FILE = path.join(ROOT, TRADE_REL);
const BASE_TRADE = path.join(GAME, 'misc', 'trade', 'trade_zat_b30_stalker_trader.ltx');
const MOD_ARTEFACTS = path.join(ROOT, 'configs', 'misc', 'mod_artefacts_z_bq.ltx');

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const ok = (m) => console.log('  ok: ' + m);

const CONTAINERS = {
    bq_field_container: { cost: 20000, count: 2, prob: 0.5 },
    bq_uni_container:   { cost: 32000, count: 2, prob: 0.2 },
    bq_sci_container:   { cost: 45000, count: 2, prob: 0.05 },
    // СИМК дешевле намеренно: его нельзя надеть на пояс (решение заказчика).
    // Наличие: до 3 единиц, каждая с шансом 50%.
    bq_simk_container:  { cost: 13000, count: 3, prob: 0.5 },
};
// Скидка торговца: цена = cost * condition_factor * action_factor * discount
// (trade2.cpp:270-286). Для продажи игроком берётся ветка buy, то есть первый
// фактор нашей строки, умноженный на "buy" из секции discounts торговца.
// У Сыча это [discount_3].buy = 0.8 при хороших отношениях с бандитами.
const TRADER_DISCOUNT_BUY = 0.8;
const RESALE = 0.6;
// Ожидаемая доля от cost, которую получит игрок при этой скидке.
const EXPECTED_PAYOUT_RATIO = RESALE;
const COMBOS = [
    'af_eye_bq_field_container', 'af_eye_bq_uni_container', 'af_eye_bq_sci_container',
    'af_cristall_bq_field_container', 'af_cristall_bq_uni_container', 'af_cristall_bq_sci_container',
    'af_compass_bq_field_container', 'af_compass_bq_uni_container', 'af_compass_bq_sci_container',
    'af_ice_bq_field_container', 'af_ice_bq_uni_container', 'af_ice_bq_sci_container',
];

// ---------------------------------------------------------------- 1. файл мода
if (!fs.existsSync(TRADE_FILE)) { err(`нет файла мода торговли ${TRADE_REL}`); process.exit(1); }
ok(`файл на месте: ${TRADE_REL}`);

const text = fs.readFileSync(TRADE_FILE).toString('latin1');
const lines = text.split(/\r?\n/);
const baseName = path.basename(BASE_TRADE, '.ltx');
const ownName = path.basename(TRADE_FILE, '.ltx');
if (ownName !== `mod_${baseName}_z_bq`) {
    err(`имя "${ownName}.ltx" не подпадает под маску автоподхвата "mod_${baseName}_*.ltx"`);
} else {
    ok(`имя подпадает под автоподхват mod_${baseName}_*.ltx`);
}
const includeLines = lines.filter((l) => /^\s*#\s*include\b/.test(l));
if (includeLines.length) {
    err(`директива включения базового файла недопустима (${includeLines[0].trim()}): ` +
        `движок читает базу сам, включение даёт дубликат секций`);
} else {
    ok('директивы включения базового файла нет');
}

// --------------------- 2. секции в моде должны быть помечены "!" (оверрайд)
// "[trade_generic_buy]" объявило бы секцию, которая уже есть -> движок падает
// с "Duplicate section ... wasn't marked as an override". Правильно:
// "![trade_generic_buy]" - дополнение существующей секции.
const ownHeaders = lines
    .map((l) => l.replace(/;.*$/, '').trim())
    .filter((s) => /^\[/.test(s) || /^!\[/.test(s));
for (const h of ownHeaders) {
    if (!/^!\[/.test(h)) {
        err(`секция ${h} не помечена "!": движок упадёт с "Duplicate section" ` +
            `(нужно "![имя]")`);
    }
}
if (ownHeaders.length) ok(`секции помечены "!": ${ownHeaders.join(', ')}`);

// ----------------------------- 3. разбор записей мода с учётом семантики
// Структура: { '<секция>': { plain: Map(ключ->значение), list: Map(ключ->[значения]) } }
const mod = new Map();
let target = null;                     // секция, в чью секцию пишем
for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;

    const sectionHeader = line.match(/^!\[([^\]]+)\]/);      // "![секция]"
    if (sectionHeader) { target = sectionHeader[1].trim(); continue; }
    if (/^\[/.test(line)) { err(`настоящий заголовок секции в моде: ${line}`); continue; }

    // ">[секция]" вне секции - указание дописать в список
    const listTarget = line.match(/^>\s*\[([^\]]+)\]/);
    if (listTarget) { target = listTarget[1].trim(); continue; }
    if (!target) continue;

    if (!mod.has(target)) mod.set(target, { plain: new Map(), list: new Map() });
    const bucket = mod.get(target);

    const listEntry = line.match(/^>\s*([A-Za-z0-9_.]+)\s*(?:=\s*(.*))?$/);
    if (listEntry) {
        const key = listEntry[1], val = listEntry[2];
        if (!bucket.list.has(key)) bucket.list.set(key, []);
        if (val !== undefined && val !== '') bucket.list.get(key).push(...val.split(',').map((s) => s.trim()));
        continue;
    }
    const plainEntry = line.match(/^([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
    if (plainEntry) { bucket.plain.set(plainEntry[1], plainEntry[2].trim()); continue; }
    const bareEntry = line.match(/^([A-Za-z0-9_.]+)$/);
    if (bareEntry) {
        if (!bucket.list.has(bareEntry[1])) bucket.list.set(bareEntry[1], []);
        continue;
    }
    err(`непонятная строка в моде: ${line}`);
}

// Модель движка: берём базовый файл и применяем к нему наши записи.
const baseSections = readLtx(BASE_TRADE);
function baseHasKey(section, key) {
    const s = baseSections.get(section);
    return !!s && s.keys.has(key);
}
function baseValue(section, key) {
    const s = baseSections.get(section);
    return s ? s.keys.get(key) : undefined;
}
function effective(section, key) {
    // plain-присваивание создаёт/перекрывает ключ (значение заменяется);
    // ">" дописывает ТОЛЬКО к существующему ключу, иначе строка игнорируется
    const bucket = mod.get(section);
    if (!bucket) return undefined;
    if (bucket.plain.has(key)) return { value: bucket.plain.get(key), how: 'plain' };
    if (bucket.list.has(key)) {
        if (!baseHasKey(section, key)) return { value: undefined, how: 'ignored' };
        const extra = bucket.list.get(key).join(',');
        const base = baseValue(section, key);
        return { value: base === undefined || base === '' ? extra : (base + ',' + extra), how: 'append' };
    }
    return undefined;
}

// Значение пустое или отсутствует = движок СЧИТАЕТ ПРЕДМЕТ ЗАПРЕЩЁННЫМ
// (CTradeParameters::process, trade_parameters_inline.h:125-128).
const isDisabled = (v) => v === undefined || String(v).trim() === '';

// -------------------------------------------------- 4. выкуп и наличие
for (const [sec, spec] of Object.entries(CONTAINERS)) {
    const buy = effective('trade_generic_buy', sec);
    if (!buy || buy.value === undefined) {
        err(`[trade_generic_buy] ${sec}: запись не сработает` +
            (buy && buy.how === 'ignored' ? ' - ключа нет в базовой секции, а префикс ">" ' +
                'дописывает только к существующему ключу' : ''));
    } else {
        // При продаже игроком движок берёт ветку buy: первый фактор строки,
        // умноженный на скидку торговца (trade2.cpp:270-286).
        const parts = buy.value.split(',').map((s) => s.trim());
        const factor = parseFloat(parts[0]);
        const ratio = factor * TRADER_DISCOUNT_BUY;
        const price = Math.round(spec.cost * ratio);
        if (Math.abs(ratio - EXPECTED_PAYOUT_RATIO) > 0.01) {
            err(`[trade_generic_buy] ${sec}: игрок получает ${Math.round(ratio * 100)}% цены ` +
                `(фактор ${factor} * скидка ${TRADER_DISCOUNT_BUY}), а ожидалось ` +
                `${Math.round(EXPECTED_PAYOUT_RATIO * 100)}%`);
        } else if (price >= spec.cost) {
            err(`[trade_generic_buy] ${sec}: торговец платит ${price} при цене ${spec.cost} - ` +
                `перепродажа даёт наживу`);
        } else {
            ok(`${sec}: цена ${spec.cost}, выкуп ${price} ` +
                `(фактор ${factor} * скидка ${TRADER_DISCOUNT_BUY} = ${Math.round(ratio * 100)}%)`);
        }
    }

    const sup = effective('supplies_generic', sec);
    if (!sup || sup.value === undefined) {
        err(`[supplies_generic] ${sec}: запись не сработает` +
            (sup && sup.how === 'ignored' ? ' - ключа нет в базовой секции (нужен префикс ">" ' +
                'только для существующих ключей, наш надо задавать обычным присваиванием)' : ''));
    } else {
        const [cnt, prob] = sup.value.split(',').map((s) => s.trim());
        if (parseInt(cnt, 10) !== spec.count) err(`[supplies_generic] ${sec}: количество ${cnt}, ожидалось ${spec.count}`);
        else if (Math.abs(parseFloat(prob) - spec.prob) > 1e-9) {
            err(`[supplies_generic] ${sec}: вероятность ${prob}, ожидалось ${spec.prob}`);
        } else ok(`${sec}: наличие ${cnt} шт, шанс ${prob}`);
    }

    const sell = effective('trade_generic_sell', sec);
    if (!sell) {
        err(`[trade_generic_sell] ${sec}: записи нет - торговец не продаст контейнер`);
    } else if (isDisabled(sell.value)) {
        err(`[trade_generic_sell] ${sec}: значение пустое, а пустое значение движок ` +
            `трактует как ЗАПРЕТ (CTradeParameters::process, trade_parameters_inline.h:125). ` +
            `Именно так помечены артефакты ";NO TRADE" в базовом файле. Нужно значение, ` +
            `например "= 1, 1"`);
    } else {
        ok(`${sec}: в продаже (значение ${sell.value})`);
    }
}

// -------------------------------------------------- 5. комбо и can_trade
for (const c of COMBOS) {
    for (const sec of ['trade_generic_buy', 'trade_generic_sell', 'supplies_generic']) {
        const e = effective(sec, c);
        if (e && e.value !== undefined) err(`комбо ${c} попало в ${sec}, а не должно`);
    }
}
ok('комбо-предметы в торговле отсутствуют');

const merged = loadAll([path.join(GAME, 'defines.ltx'), path.join(GAME, 'misc', 'artefacts.ltx'), MOD_ARTEFACTS]);
const resolve = makeResolver(merged);
for (const sec of Object.keys(CONTAINERS)) {
    const r = resolve(sec);
    const cost = parseInt(r.get('cost'), 10);
    if (r.get('can_trade') !== 'true') err(`[${sec}] can_trade = ${r.get('can_trade')}, нужно true`);
    else if (cost !== CONTAINERS[sec].cost) {
        err(`[${sec}] cost = ${cost}, а проверка ждёт ${CONTAINERS[sec].cost}`);
    } else ok(`[${sec}] can_trade = true, cost = ${cost}`);
}
for (const c of COMBOS) {
    const r = resolve(c);
    if (r.size && r.get('can_trade') !== 'false') err(`[${c}] can_trade = ${r.get('can_trade')}, нужно false`);
}
ok('у всех комбо can_trade = false');

if (errors === 0) {
    console.log('\nOK: торговля контейнерами настроена верно.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
