// tools/recompute_combos.js — пересчитать радиацию комбо по статам артефактов.
//
// Правило (MEMO 13.2): контейнер поглощает не больше, чем артефакт излучает,
//     радиация комбо = max(0, радиация артефакта - поглощение контейнера)
//
// Зачем отдельный шаг: статы артефактов и комбо лежат в одном файле и правятся
// по отдельности, поэтому после правки артефактов радиацию комбо нужно
// пересчитать. Скрипт находит все секции вида "<артефакт>_<секция контейнера>"
// и проставляет radiation_restore_speed по фактическим статам артефакта.
//
// Запуск: node tools/recompute_combos.js [--dry-run]
'use strict';
const fs = require('fs');
const path = require('path');
const { loadAll, makeResolver } = require('./ini_resolver.js');

const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const ROOT = path.join(__dirname, '..');
const MOD_FILE = path.join(ROOT, 'configs', 'misc', 'mod_artefacts_z_bq.ltx');
const HQ = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons\\ixray-hq-icons-v2.0\\configs\\mod_system_hqicons.ltx';

const dryRun = process.argv.includes('--dry-run');

const CONTAINERS = ['bq_field_container', 'bq_uni_container', 'bq_sci_container'];

// Итоговые статы: ваниль -> моды сборки -> наш мод (последний выигрывает)
const merged = loadAll([
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'artefacts.ltx'),
    HQ,
    MOD_FILE,
]);
const resolve = makeResolver(merged);

// Поглощение контейнера = -radiation_restore_speed его пустой секции
const absorb = {};
for (const c of CONTAINERS) {
    const r = resolve(c);
    const rad = parseFloat(r.get('radiation_restore_speed'));
    if (isNaN(rad)) { console.error(`FAIL: у [${c}] нет radiation_restore_speed`); process.exit(1); }
    absorb[c] = -rad;
    console.log(`[${c}] поглощает ${absorb[c]}`);
}

const text = fs.readFileSync(MOD_FILE).toString('latin1');
const lines = text.split(/\r?\n/);

// Разбираем файл на секции: имя -> строки, чтобы не путать комбо с чем-то ещё.
// Комбо определяем по ключу belt: он есть у комбо-предмета, но НЕ у артефакта
// (у артефакта belt приходит от af_base) и НЕ у таблицы защит. Проверять только
// окончание имени нельзя - переопределение "![af_ice]" оканчивается на "_ice",
// что похоже на контейнер bq_sci_container.
const sections = [];
let cur = null;
let checked = 0;
let changed = 0;
let errors = 0;
lines.forEach((line, i) => {
    const h = line.match(/^\[([^\]]+)\]/);
    if (h) {
        cur = { name: h[1].trim(), headerLine: i, keys: [] };
        sections.push(cur);
        return;
    }
    if (!cur) return;
    const kv = line.match(/^(\s*([A-Za-z0-9_]+)\s*=\s*)(.*)$/);
    if (kv) cur.keys.push({ key: kv[2], line, index: i });
});

const edits = [];
for (const sec of sections) {
    const hasBelt = sec.keys.some((k) => k.key === 'belt');
    if (!hasBelt) continue;

    let combo = null;
    for (const c of CONTAINERS) {
        const marker = '_' + c;
        if (sec.name.endsWith(marker)) {
            const artefact = sec.name.slice(0, -marker.length);
            const artRes = resolve(artefact);
            if (!artRes.size) break;
            const artRad = parseFloat(artRes.get('radiation_restore_speed') || '0');
            combo = {
                name: sec.name,
                artefact,
                artRad,
                container: c,
                want: Math.max(0, +(artRad - absorb[c]).toFixed(6)),
            };
            break;
        }
    }
    if (!combo) continue;

    const radKey = sec.keys.find((k) => k.key === 'radiation_restore_speed');
    if (!radKey) { console.error(`FAIL: у комбо [${sec.name}] нет radiation_restore_speed`); errors++; continue; }

    checked++;
    const have = parseFloat(radKey.line.match(/=\s*(\S+)/)[1]);
    if (Math.abs(have - combo.want) < 1e-9) {
        console.log(`  ok:     [${sec.name}] ${have}`);
        continue;
    }
    console.log(`  правка: [${sec.name}] ${have} -> ${combo.want} ` +
        `(артефакт ${combo.artRad}, поглощение ${absorb[combo.container]})`);
    edits.push({ index: radKey.index, line: radKey.line.replace(/=.*$/, `= ${combo.want}`) });
    changed++;
}

if (errors) { console.error(`FAIL: ${errors} ошибок, файл не изменён`); process.exit(1); }
if (checked === 0) { console.error('FAIL: не найдено ни одного комбо'); process.exit(1); }

for (const e of edits) lines[e.index] = e.line;

console.log(`\nпроверено комбо: ${checked}, изменено: ${changed}`);

if (!dryRun && changed) {
    fs.writeFileSync(MOD_FILE, lines.join('\n'), 'latin1');
    console.log(`записано: ${path.relative(ROOT, MOD_FILE)}`);
} else if (dryRun) {
    console.log('--dry-run: файл не изменён');
}
