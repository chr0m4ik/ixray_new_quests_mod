// tools/check_containers.js
//
// Полная проверка контейнеров и комбо. Ожидания ВЫВОДЯТСЯ ИЗ БАЛАНСА
// (tools/artifact_balance.js), а не из рукописных таблиц: если поменять баланс,
// проверка сразу скажет, что разошлось в конфиге, атласе или локализации.
//
// Проверяет:
//   1. структуру файла мода: шаблон, контейнеры, маркеры генерируемых блоков;
//   2. пустые контейнеры: обязательные ключи, поглощение, ячейка атласа;
//   3. ВСЕ комбо: существование, координаты, belt, радиацию, защиту, модель;
//   4. иконки: ячейка в атласе заполнена и не совпадает с соседями;
//   5. соответствие bq_containers.script <-> конфиг (суффиксы комбо);
//   6. модели (visual) и их текстуры - файлы существуют;
//   7. регрессы на вылеты: particles_bone, inv_scale;
//   8. локализацию: у каждого комбо есть строки имени и описания.
//
// Запуск из корня аддона:  node tools/check_containers.js

'use strict';
const fs = require('fs');
const path = require('path');
const dds = require('./dds.js');
const { readLtx, loadAll, makeResolver } = require('./ini_resolver.js');
const B = require('./artifact_balance.js');

const ROOT = path.join(__dirname, '..');
const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const HQ_ICONS = path.join(ROOT, '..', 'ixray-hq-icons-v2.0', 'configs', 'mod_system_hqicons.ltx');
const OWN_FILE = path.join(ROOT, 'configs', 'misc', 'mod_artefacts_z_bq.ltx');
const ATLAS = path.join(ROOT, 'textures', 'ui', 'ui_bq_field_container.dds');
const CELL = 50;

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const ok = (m) => console.log('  ok: ' + m);

// Разрешение наследования: ваниль -> HQ Icons -> наш файл.
const merged = loadAll([
    path.join(GAME, 'defines.ltx'),
    path.join(GAME, 'misc', 'artefacts.ltx'),
    HQ_ICONS,
    OWN_FILE,
]);
const resolve = makeResolver(merged);
const own = readLtx(OWN_FILE);
const ownText = fs.readFileSync(OWN_FILE, 'utf8');
const ownLines = ownText.split(/\r?\n/);

// Наши секции предметов: контейнеры + все комбо.
const comboName = (sec, container) => `${sec}_${container}`;
const ALL_SECTIONS = [];
for (const a of B.ARTIFACTS) {
    for (const sec of a.map) {
        for (const c of B.CONTAINERS) ALL_SECTIONS.push(comboName(sec, c));
    }
}

// ---------------------------------------------------------------------------
// 1. Структура файла
// ---------------------------------------------------------------------------
console.log('== 1. Структура файла мода ==');
{
    const required = ['bq_container_base', 'bq_field_container', 'bq_uni_container',
        'bq_sci_container', 'bq_simk_container', 'bq_rad_tuner'];
    for (const sec of required) {
        if (!own.has(sec)) err(`нет секции [${sec}]`);
    }
    ok(`секции на месте: ${required.join(', ')}`);

    const markers = [
        'BEGIN ARTIFACT COMBOS', 'END ARTIFACT COMBOS',
        'BEGIN ARTEFACT STATS', 'END ARTEFACT STATS',
    ];
    for (const m of markers) {
        if (!ownText.includes(m)) {
            err(`нет маркера "${m}" - генератор tools/gen_artifacts.js не сможет обновить файл`);
        }
    }
    ok('маркеры генерируемых блоков на месте');

    // Дубли секций ломают загрузку конфига.
    const heads = [...ownText.matchAll(/^\s*!?\[([^\]]+)\]/gm)].map((m) => m[1].trim());
    const dup = heads.filter((v, i) => heads.indexOf(v) !== i);
    if (dup.length) err(`дубли секций: ${[...new Set(dup)].join(', ')}`);
    else ok(`секций ${heads.length}, дублей нет`);
}

// ---------------------------------------------------------------------------
// 2. Пустые контейнеры
// ---------------------------------------------------------------------------
console.log('\n== 2. Пустые контейнеры ==');
const EMPTY = {
    bq_field_container: { absorb: 4, cell: [0, 0] },
    bq_uni_container: { absorb: 8, cell: [1, 0] },
    bq_sci_container: { absorb: 14, cell: [2, 0] },
    bq_simk_container: { absorb: 0, cell: [0, B.ARTIFACTS.length + 1] },
};
{
    const REQUIRED = ['class', 'inv_name', 'inv_name_short', 'inv_weight', 'cost', 'description',
        'inv_grid_x', 'inv_grid_y', 'inv_grid_width', 'inv_grid_height', 'icons_texture',
        'hit_absorbation_sect', 'can_trade', 'belt'];
    for (const [sec, spec] of Object.entries(EMPTY)) {
        const r = resolve(sec);
        if (!r.size) { err(`[${sec}] секция не найдена`); continue; }
        const missing = REQUIRED.filter((k) => !r.has(k));
        if (missing.length) err(`[${sec}] нет ключей: ${missing.join(', ')}`);

        // Поглощение: radiation_restore_speed пустого контейнера = -absorb/1000.
        // У СИМК 0 - он нейтрален сам, поглощает только через комбо.
        const rad = parseFloat(r.get('radiation_restore_speed'));
        const wantAbsorb = -spec.absorb / 1000;
        if (sec === 'bq_simk_container') {
            if (rad !== 0) err(`[${sec}] radiation_restore_speed=${rad}, у СИМК должно быть 0`);
            else ok(`[${sec}] нейтрален (radiation_restore_speed = 0)`);
        } else if (Math.abs(rad - wantAbsorb) > 1e-9) {
            err(`[${sec}] radiation_restore_speed=${rad}, ожидалось ${wantAbsorb} ` +
                `(поглощение ${spec.absorb})`);
        } else {
            ok(`[${sec}] поглощает ${spec.absorb} (radiation_restore_speed = ${rad})`);
        }

        // Ячейка атласа
        const gx = parseInt(r.get('inv_grid_x'), 10);
        const gy = parseInt(r.get('inv_grid_y'), 10);
        if (gx !== spec.cell[0] || gy !== spec.cell[1]) {
            err(`[${sec}] ячейка (${gx},${gy}), ожидалось (${spec.cell[0]},${spec.cell[1]})`);
        } else ok(`[${sec}] ячейка (${gx},${gy})`);

        // У СИМК иконка в 2 клетки, у остальных в 1.
        const gh = parseInt(r.get('inv_grid_height'), 10);
        const wantGh = sec === 'bq_simk_container' ? 2 : 1;
        if (gh !== wantGh) err(`[${sec}] inv_grid_height=${gh}, ожидалось ${wantGh}`);
        else ok(`[${sec}] высота иконки ${gh} клетки`);

        // Пустой контейнер на пояс не надевается (иначе он давал бы эффекты).
        if (r.get('belt') !== 'false') {
            err(`[${sec}] belt='${r.get('belt')}', пустой контейнер не должен надеваться`);
        }
    }
}

// ---------------------------------------------------------------------------
// 3. Все комбо
// ---------------------------------------------------------------------------
console.log('\n== 3. Комбо (артефакт в контейнере) ==');
const ATLAS_ROWS = 5;   // столбцов в атласе
{
    let checked = 0;
    const coords = new Map();      // "x,y" -> секция, для поиска наложений
    for (const a of B.ARTIFACTS) {
        for (const sec of a.map) {
            const rad = a.stats.rad || 0;
            for (const container of B.CONTAINERS) {
                const name = comboName(sec, container);
                const r = resolve(name);
                if (!r.size) { err(`[${name}] секции комбо нет в конфиге`); continue; }
                checked++;

                const isSimk = container === 'bq_simk_container';
                const label = `${a.ru} / ${container.replace('bq_', '').replace('_container', '')}`;

                // Модель контейнера
                const wantVis = isSimk ? 'lead_box_closed'
                    : (container === 'bq_field_container' ? 'aac'
                        : container === 'bq_uni_container' ? 'iam' : 'aam');
                const vis = r.get('visual') || '';
                if (!vis.includes(wantVis)) err(`[${name}] visual='${vis}', ожидалась модель ${wantVis}`);

                // belt: у СИМК false (на пояс нельзя), у остальных true
                const belt = r.get('belt');
                if (belt !== (isSimk ? 'false' : 'true')) {
                    err(`[${name}] belt='${belt}', ожидалось '${isSimk ? 'false' : 'true'}'`);
                }

                // inv_scale обязан быть 1.0: HQ Icons задаёт артефактам 2.0
                if (r.get('inv_scale') !== '1.0') {
                    err(`[${name}] inv_scale='${r.get('inv_scale')}', нужно 1.0 ` +
                        `(иначе иконка вырежется 2x2 клетки)`);
                }

                // Радиация комбо: max(0, радиация артефакта - поглощение).
                // В СИМК всегда 0 (поглощает всё).
                const absorb = B.ABSORB[container] || 0;
                const wantRad = isSimk ? 0 : Math.max(0, rad - absorb);
                const gotRad = parseFloat(r.get('radiation_restore_speed'));
                if (Math.abs(gotRad - wantRad / 1000) > 1e-9) {
                    err(`[${name}] radiation=${gotRad}, ожидалось ${wantRad / 1000} ` +
                        `(артефакт ${rad}, поглощение ${absorb})`);
                }

                // Защита берётся у АРТЕФАКТА (его свойства продолжают работать)
                const wantAbs = `${sec}_absorbation`;
                if (r.get('hit_absorbation_sect') !== wantAbs) {
                    err(`[${name}] hit_absorbation_sect='${r.get('hit_absorbation_sect')}', ` +
                        `ожидалось '${wantAbs}'`);
                }

                // Координаты: обычные комбо - столбец контейнера, строка артефакта;
                // СИМК - по 5 в ряд парами строк.
                const gx = parseInt(r.get('inv_grid_x'), 10);
                const gy = parseInt(r.get('inv_grid_y'), 10);
                const gh = parseInt(r.get('inv_grid_height'), 10);
                if (gh !== (isSimk ? 2 : 1)) {
                    err(`[${name}] inv_grid_height=${gh}, ожидалось ${isSimk ? 2 : 1}`);
                }
                const key = `${gx},${gy}`;
                if (coords.has(key)) {
                    err(`[${name}] ячейка (${key}) уже занята секцией [${coords.get(key)}]`);
                }
                coords.set(key, name);

                if (checked <= 8) {
                    ok(`${label}: радиация ${gotRad}, belt=${belt}, модель ${wantVis}, ` +
                        `ячейка (${gx},${gy})${isSimk ? '+' + (gy + 1) : ''}`);
                }
            }
        }
    }
    ok(`проверено комбо: ${checked} из ${ALL_SECTIONS.length}`);
    if (checked !== ALL_SECTIONS.length) {
        err(`комбо в конфиге ${checked}, а по балансу должно быть ${ALL_SECTIONS.length}`);
    }
    if (coords.size !== ALL_SECTIONS.length) {
        err(`уникальных ячеек ${coords.size}, а комбо ${ALL_SECTIONS.length} - есть наложения`);
    } else {
        ok(`ячейки не пересекаются (${coords.size} шт)`);
    }
}

// ---------------------------------------------------------------------------
// 4. Атлас иконок
// ---------------------------------------------------------------------------
console.log('\n== 4. Атлас иконок ==');
{
    const buf = fs.readFileSync(ATLAS);
    const hdr = dds.readHeader(buf);
    const decoded = dds.decodeAuto(buf);
    console.log(`  атлас: ${hdr.width}x${hdr.height}, ${hdr.fourCC}, ` +
        `${(buf.length / 1024).toFixed(0)} КБ`);

    // Размеры атласа обязаны быть степенью двойки и кратны 4 (требования DDS).
    for (const [dim, v] of [['ширина', hdr.width], ['высота', hdr.height]]) {
        if (v % 4 !== 0) err(`атлас: ${dim} ${v} не кратна 4`);
        else if ((v & (v - 1)) !== 0) err(`атлас: ${dim} ${v} не степень двойки`);
    }

    // Пустые контейнеры: три в верхнем ряду плюс СИМК отдельно.
    for (const [sec, spec] of Object.entries(EMPTY)) {
        const [gx, gy] = spec.cell;
        const gh = sec === 'bq_simk_container' ? 2 : 1;
        for (let k = 0; k < gh; k++) {
            const { opaque } = dds.countOpaqueInCell(decoded, gx, gy + k, CELL);
            if (opaque === 0) err(`[${sec}] ячейка (${gx},${gy + k}) в атласе пустая`);
        }
    }
    ok('иконки пустых контейнеров в атласе есть');

    // Все комбо: ячейка непустая; у СИМК обе клетки пары.
    let emptyCells = 0, checkedCells = 0;
    for (const a of B.ARTIFACTS) {
        for (const sec of a.map) {
            for (const container of B.CONTAINERS) {
                const name = comboName(sec, container);
                const r = resolve(name);
                if (!r.size) continue;
                const gx = parseInt(r.get('inv_grid_x'), 10);
                const gy = parseInt(r.get('inv_grid_y'), 10);
                const isSimk = container === 'bq_simk_container';
                const cells = isSimk ? [gy, gy + 1] : [gy];
                for (const y of cells) {
                    checkedCells++;
                    if (y >= hdr.height / CELL) {
                        err(`[${name}] ячейка (${gx},${y}) за пределами атласа`);
                        continue;
                    }
                    const { opaque } = dds.countOpaqueInCell(decoded, gx, y, CELL);
                    if (opaque === 0) {
                        emptyCells++;
                        err(`[${name}] ячейка (${gx},${y}) пустая - иконки не будет ` +
                            `(запустите node tools/build_combo_icons.js)`);
                    }
                }
            }
        }
    }
    if (emptyCells === 0) ok(`все ячейки комбо заполнены (проверено ${checkedCells})`);

    // Требуемая высота атласа по раскладке.
    const needRows = B.ARTIFACTS.length + 1 + 2 + Math.ceil(B.ARTIFACTS.length / ATLAS_ROWS) * 2;
    if (hdr.height / CELL < needRows) {
        err(`атлас ${hdr.height}px мал: по раскладке нужно ${needRows * CELL}px`);
    } else {
        ok(`высоты хватает: нужно ${needRows} строк, есть ${hdr.height / CELL}`);
    }
}

// ---------------------------------------------------------------------------
// 5. Артефакты: статы и защита (по балансу)
// ---------------------------------------------------------------------------
console.log('\n== 5. Статы артефактов ==');
{
    // ВАЖНО ПРО ЕДИНИЦЫ. Статы "за секунду" в конфиге в 1000 раз меньше, чем
    // числа, которые видит игрок (интерфейс показывает *1000). НО additional_
    // inventory_weight - это КИЛОГРАММЫ, у них своя шкала и деления нет.
    const MAP = {
        hp: 'health_restore_speed',
        bleed: 'bleeding_restore_speed',
        power: 'power_restore_speed',
        rad: 'radiation_restore_speed',
        satiety: 'satiety_restore_speed',
    };
    const WEIGHT_KEY = 'additional_inventory_weight';
    const IMM = {
        radimm: 'radiation_immunity',
        burn: 'burn_immunity',
        chem: 'chemical_burn_immunity',
        psi: 'telepatic_immunity',
        shock: 'shock_immunity',
    };
    // Ключи, которые обязаны быть записаны явно: незаписанные останутся
    // ванильными и сложатся с нашими.
    const MUST = ['health_restore_speed', 'bleeding_restore_speed', 'power_restore_speed',
        'additional_inventory_weight', 'radiation_restore_speed', 'satiety_restore_speed',
        'thirst_restore_speed', 'cost', 'hit_absorbation_sect'];

    let n = 0;
    for (const a of B.ARTIFACTS) {
        for (const sec of a.map) {
            const r = resolve(sec);
            if (!r.size) { err(`[${sec}] секции артефакта нет`); continue; }
            n++;

            const missing = MUST.filter((k) => !r.has(k));
            if (missing.length) err(`[${sec}] нет ключей: ${missing.join(', ')}`);

            for (const [stat, key] of Object.entries(MAP)) {
                const want = (a.stats[stat] || 0) / 1000;
                const got = parseFloat(r.get(key));
                if (Math.abs(got - want) > 1e-9) {
                    err(`[${sec}] ${key}=${got}, ожидалось ${want} (${stat} ${a.stats[stat] || 0})`);
                }
            }
            // Вес - в килограммах, без деления.
            const wantW = a.stats.weight || 0;
            const gotW = parseFloat(r.get(WEIGHT_KEY) || '0');
            if (Math.abs(gotW - wantW) > 1e-9) {
                err(`[${sec}] ${WEIGHT_KEY}=${gotW}, ожидалось ${wantW} кг (weight ${wantW})`);
            }

            // Защита живёт в отдельной таблице.
            const abs = resolve(`${sec}_absorbation`);
            if (!abs.size) { err(`[${sec}] нет таблицы ${sec}_absorbation`); continue; }
            for (const [stat, key] of Object.entries(IMM)) {
                const want = (a.stats[stat] || 0) / 1000;
                const got = parseFloat(abs.get(key) || '0');
                if (Math.abs(got - want) > 1e-9) {
                    err(`[${sec}_absorbation] ${key}=${got}, ожидалось ${want} (${stat})`);
                }
            }
            // Незаписанные иммунитеты остались бы ванильными (например у
            // Кристалла было burn 0.02) и сложились бы с нашими.
            const IMM_KEYS = ['burn_immunity', 'strike_immunity', 'shock_immunity',
                'wound_immunity', 'radiation_immunity', 'telepatic_immunity',
                'chemical_burn_immunity', 'explosion_immunity', 'fire_wound_immunity'];
            const absMissing = IMM_KEYS.filter((k) => !abs.has(k));
            if (absMissing.length) err(`[${sec}_absorbation] нет ключей: ${absMissing.join(', ')}`);

            if (n <= 5) {
                const props = Object.entries(a.stats)
                    .map(([k, v]) => `${k}=${v}`).join(', ');
                ok(`${a.ru} (${sec}): ${props}`);
            }
        }
    }
    ok(`артефактов проверено: ${n}`);
}

// ---------------------------------------------------------------------------
// 6. Соответствие скрипта и конфига
// ---------------------------------------------------------------------------
console.log('\n== 6. Скрипт bq_containers.script и конфиг ==');
{
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bq_containers.script'), 'utf8');
    const found = [...src.matchAll(/\{\s*section\s*=\s*"([^"]+)"\s*,\s*combo\s*=\s*"([^"]+)"\s*\}/g)]
        .map((m) => ({ section: m[1], combo: m[2] }));
    if (found.length !== B.CONTAINERS.length) {
        err(`в скрипте ${found.length} контейнеров, в балансе ${B.CONTAINERS.length}`);
    }
    for (const f of found) {
        if (!B.CONTAINERS.includes(f.section)) err(`скрипт знает лишний контейнер ${f.section}`);
        // Суффикс комбо должен давать РЕАЛЬНУЮ секцию: именно на этом ломалось
        // вложение в полевой контейнер.
        const probe = comboName('af_eye', f.combo);
        if (!own.has(probe)) {
            err(`суффикс ${f.combo} из скрипта не даёт секцию (проверено на ${probe})`);
        }
    }
    ok(`скрипт и конфиг согласованы по ${found.length} контейнерам`);
}

// ---------------------------------------------------------------------------
// 7. Модели и их текстуры
// ---------------------------------------------------------------------------
console.log('\n== 7. Модели и текстуры ==');
{
    let cur = null;
    const visMap = new Map();
    for (const line of ownLines) {
        const bare = line.replace(/;.*$/, '').trim();
        const h = bare.match(/^!?\[([^\]]+)\]/);
        if (h) { cur = h[1].trim(); continue; }
        const kv = bare.match(/^visual\s*=\s*(\S+)/);
        if (kv && cur) {
            if (!visMap.has(kv[1])) visMap.set(kv[1], []);
            visMap.get(kv[1]).push(cur);
        }
    }
    for (const [vis, sections] of visMap) {
        const file = path.join(ROOT, 'meshes', vis.replace(/\\/g, path.sep));
        if (!fs.existsSync(file)) {
            err(`нет файла модели meshes\\${vis} (${sections.length} секц.)`);
            continue;
        }
        ok(`meshes\\${vis} (${sections.length} секц.)`);

        // Текстуры модели: имя лежит в меше строкой "папка\имя". Мусорные пути
        // SDK отсекаем по первому сегменту - он обязан быть папкой в textures.
        const data = fs.readFileSync(file);
        const roots = [
            path.join(ROOT, 'textures'),
            'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\gamedata\\textures',
            'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\textures',
        ];
        const folders = new Set();
        for (const root of roots) {
            if (!fs.existsSync(root)) continue;
            for (const d of fs.readdirSync(root, { withFileTypes: true })) {
                if (d.isDirectory()) folders.add(d.name.toLowerCase());
            }
        }
        const found = new Set();
        for (const m of data.toString('latin1').matchAll(/[A-Za-z0-9_]{2,20}(?:\\[A-Za-z0-9_.\-]{2,40}){1,4}/g)) {
            const t = m[0];
            if (!folders.has(t.split('\\')[0].toLowerCase())) continue;
            found.add(t);
        }
        if (found.size === 0) {
            err(`из модели ${vis.split('\\').pop()} не прочитано ни одной текстуры ` +
                `(нет папки textures с нужным именем?)`);
            continue;
        }
        for (const t of found) {
            const rel = t.replace(/\\/g, path.sep);
            const hit = roots.some((r) => fs.existsSync(path.join(r, rel + '.dds')));
            if (!hit) {
                err(`нет текстуры для ${vis.split('\\').pop()}: textures\\${t}.dds ` +
                    `(в игре будет "Can't find texture")`);
            }
        }
        ok(`  текстуры: ${[...found].join(', ')}`);
    }
}

// ---------------------------------------------------------------------------
// 8. Регрессы на вылеты
// ---------------------------------------------------------------------------
console.log('\n== 8. Регрессы на вылеты ==');
{
    // particles_bone = link наследуется от af_base, а модели контейнеров -
    // статические меши без костей: движок падал с "Can't find particle bone".
    // Спасает ключ particles_bones (множественное число).
    let cur = null;
    const plural = [], singular = [];
    for (const line of ownLines) {
        const bare = line.replace(/;.*$/, '').trim();
        const h = bare.match(/^!?\[([^\]]+)\]/);
        if (h) { cur = h[1].trim(); continue; }
        if (!cur) continue;
        if (/^particles_bones\s*=/.test(bare)) plural.push(cur);
        if (/^particles_bone\s*=\s*\S/.test(bare)) singular.push(cur);
    }
    if (!plural.includes('bq_container_base')) {
        err('в [bq_container_base] нет particles_bones - комбо получат ' +
            'particles_bone = link от af_base и игра упадёт при получении контейнера');
    } else ok('particles_bones задан в [bq_container_base]');
    if (singular.length) {
        err(`непустой particles_bone у: ${singular.join(', ')} - движок будет искать ` +
            `эту кость в модели и упадёт`);
    } else ok('непустого particles_bone нет');

    // inv_scale: HQ Icons задаёт артефактам 2.0, у комбо обязан быть 1.0,
    // иначе из атласа вырезается область 100x100 (2x2 клетки).
    const bad = [];
    for (const name of ALL_SECTIONS) {
        const r = resolve(name);
        if (r.size && r.get('inv_scale') !== '1.0') bad.push(name);
    }
    if (bad.length) err(`inv_scale != 1.0 у: ${bad.slice(0, 5).join(', ')}` +
        (bad.length > 5 ? ` и ещё ${bad.length - 5}` : ''));
    else ok('у всех комбо inv_scale = 1.0');
}

// ---------------------------------------------------------------------------
// 9. Локализация комбо
// ---------------------------------------------------------------------------
console.log('\n== 9. Локализация комбо ==');
{
    const locales = {};
    for (const lang of ['rus', 'eng']) {
        const dir = path.join(ROOT, 'configs', 'text', lang);
        const ids = new Set();
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
            const raw = fs.readFileSync(path.join(dir, f), 'utf8');
            for (const m of raw.matchAll(/<string id="([^"]+)"/g)) ids.add(m[1]);
        }
        locales[lang] = ids;
    }
    const missing = [];
    for (let i = 0; i < ALL_SECTIONS.length; i += 4) {
        const r = resolve(ALL_SECTIONS[i]);
        if (!r.size) continue;
        for (const key of ['inv_name', 'description']) {
            const id = r.get(key);
            if (!id) { missing.push(`${ALL_SECTIONS[i]}: нет ключа ${key}`); continue; }
            for (const lang of ['rus', 'eng']) {
                if (!locales[lang].has(id)) missing.push(`${lang}: нет строки ${id}`);
            }
        }
    }
    if (missing.length) {
        err(`проблемы локализации (${missing.length}), первые: ${missing.slice(0, 5).join('; ')}`);
    } else {
        ok('у всех комбо есть названия и описания в rus и eng');
    }
}

// ---------------------------------------------------------------------------
if (errors === 0) {
    console.log('\nOK: контейнеры, комбо, атлас и локализация согласованы.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
