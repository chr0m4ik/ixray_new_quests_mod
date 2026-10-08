// tools/add_artifact_combos.js — добавить комбо-секции для артефактов.
//
// Делает всё автоматически, чтобы не плодить ошибки руками:
//   1. читает статы артефакта из оригинального artefacts.ltx и САМ считает
//      radiation_restore_speed комбо по правилу из MEMO 13.2:
//          combo = max(0, радиация артефакта - поглощение контейнера)
//      (контейнер поглощает не больше, чем артефакт излучает);
//   2. дописывает секции комбо в configs\misc\mod_artefacts_z_bq.ltx, если их
//      там ещё нет (существующие НЕ трогает);
//   3. дописывает строки локализации (rus + eng), если их ещё нет;
//   4. печатает готовый блок для tools/check_containers.js.
//
// Ячейка иконки комбо = ячейка её контейнера в атласе ui_bq_field_container
// (верхний ряд): полевой (0,0), универсальный (1,0), научный (2,0).
//
// Файлы конфигов читаются/пишутся побайтово (latin1) - cp1251 не портится.
//
// ВАЖНО: после запуска имеет смысл выполнить `node tools/recompute_combos.js`,
// если статы артефактов правились переопределениями - этот скрипт читает
// оригинальный artefacts.ltx, а не наши переопределения, поэтому для артефактов
// с изменённой радиацией значения надо пересчитать (recompute берёт итоговые).
//
// Запуск: node tools/add_artifact_combos.js [--dry-run] <artifact_section> ...
'use strict';
const fs = require('fs');
const path = require('path');
const { loadAll, makeResolver } = require('./ini_resolver.js');

const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const ROOT = path.join(__dirname, '..');
const MOD_FILE = path.join(ROOT, 'configs', 'misc', 'mod_artefacts_z_bq.ltx');
const RUS = path.join(ROOT, 'configs', 'text', 'rus', 'st_beard_quest.xml');
const ENG = path.join(ROOT, 'configs', 'text', 'eng', 'st_beard_quest.xml');

// Названия артефактов для строк локализации. Секции в конфиге называются
// латиницей (af_ice), а игроку нужно русское название, поэтому соответствие
// задаётся явно. Новый артефакт - добавьте строку сюда.
const ARTEFACT_NAMES = {
    af_eye: 'Глаз',
    af_cristall: 'Кристалл',
    af_compass: 'Компас',
    af_ice: 'Снежинка',
    af_fireball: 'Огненный шар',
};

// Поглощение контейнера и его особенности.
//   absorb - сколько радиации снимает (в единицах конфига);
//   belt   - можно ли надеть комбо на пояс. У СИМК false: заказчик решил, что
//            этот контейнер носится только в рюкзаке;
//   total  - поглощает ВСЮ радиацию артефакта, сколько бы её ни было. Для нашей
//            механики это radiation_restore_speed = 0 у комбо (она игнорирует
//            отрицательные значения), а absorb здесь нужен только для текста.
const CONTAINERS = [
    { section: 'bq_field_container', absorb: 0.004, cellX: 0, belt: true,  ru: 'полевом', en: 'a field' },
    { section: 'bq_uni_container',   absorb: 0.008, cellX: 1, belt: true,  ru: 'универсальном', en: 'a universal' },
    { section: 'bq_sci_container',   absorb: 0.014, cellX: 2, belt: true,  ru: 'научном', en: 'a scientific' },
    { section: 'bq_simk_container',  absorb: 0,     cellX: 3, belt: false, total: true,
      ru: 'контейнере СИМК', en: 'a SIMK container' },
];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const artefacts = argv.filter((a) => !a.startsWith('--'));
if (!artefacts.length) {
    console.error('usage: node tools/add_artifact_combos.js [--dry-run] <artifact_section> ...');
    process.exit(2);
}

const merged = loadAll([path.join(GAME, 'defines.ltx'), path.join(GAME, 'misc', 'artefacts.ltx')]);
const resolve = makeResolver(merged);

let modText = fs.readFileSync(MOD_FILE).toString('latin1');
const rusText = fs.readFileSync(RUS, 'utf8');
const engText = fs.readFileSync(ENG, 'utf8');

// id считаем ОТДЕЛЬНО для каждого языка: наборы совпадают, но наличие строки
// в русском файле не значит, что она есть в английском.
const existingIds = { rus: new Set(), eng: new Set() };
for (const m of rusText.matchAll(/<string id="([^"]+)"/g)) existingIds.rus.add(m[1]);
for (const m of engText.matchAll(/<string id="([^"]+)"/g)) existingIds.eng.add(m[1]);

const newSections = [];
const newLoc = { rus: [], eng: [] };
const tableRows = [];
let skipped = 0;

// Выравнивание как в остальном файле: имя ключа + пробелы до 28 символов,
// затем " = значение".
const pad = (k) => (k + ' '.repeat(28)).slice(0, 28);

function addLoc(lang, id, text) {
    if (existingIds[lang].has(id)) return;
    existingIds[lang].add(id);
    newLoc[lang].push(`    <string id="${id}">\n        <text>${text}</text>\n    </string>`);
}

for (const art of artefacts) {
    const r = resolve(art);
    if (!r.size) { console.error(`FAIL: секция [${art}] не найдена`); process.exit(1); }

    const artRad = parseFloat(r.get('radiation_restore_speed') || '0');
    const artBleed = parseFloat(r.get('bleeding_restore_speed') || '0');
    const artName = ARTEFACT_NAMES[art];
    if (!artName) {
        console.error(`FAIL: для [${art}] не задано название в ARTEFACT_NAMES`);
        process.exit(1);
    }

    console.log(`\n[${art}] «${artName}»: класс ${r.get('class')}, радиация ${artRad}, ` +
        `кровотечение ${artBleed}, защита ${r.get('hit_absorbation_sect')}`);

    for (const c of CONTAINERS) {
        const combo = `${art}_${c.section}`;
        // total (СИМК) => радиация комбо ровно 0: поглощается всё.
        const rad = c.total ? 0 : Math.max(0, +(artRad - c.absorb).toFixed(6));
        const short = `${art.replace(/^af_/, '')}_${c.section.replace('bq_', '').replace('_container', '')}`;

        if (modText.includes(`[${combo}]`)) {
            skipped++;
            console.log(`  есть:  [${combo}] - не трогаю`);
        } else {
            const section = [
                `[${combo}]:${art}, bq_container_base`,
                `${pad('description')} = bq_${short}_descr`,
                `${pad('inv_name')} = bq_${short}_name`,
                `${pad('inv_name_short')} = bq_${short}_name`,
                `${pad('belt')} = ${c.belt ? 'true' : 'false'}`,
                `${pad('can_trade')} = false`,
                `${pad('icons_texture')} = ui\\ui_bq_field_container`,
                `${pad('inv_grid_width')} = 1`,
                `${pad('inv_grid_height')} = 1`,
                `${pad('inv_grid_x')} = ${c.cellX}`,
                `${pad('inv_grid_y')} = 0`,
                `${pad('radiation_restore_speed')} = ${rad}`,
            ];
            // СИМК: своя нейтральная таблица защит (у артефакта её взять нельзя -
            // комбо на пояс не надевается, а в рюкзаке защита не работает).
            if (c.total) section.push(`${pad('hit_absorbation_sect')} = bq_simk_container_absorbation`);
            section.push(
                `${pad('use1_text')} = bq_take_artifact`,
                `${pad('use1_functor')} = bq_containers.take_artifact`,
                '',
            );
            newSections.push(section.join('\n'));
            console.log(`  новая: [${combo}] радиация ${rad}, belt=${c.belt}` +
                (c.total ? ' (поглощает всё)' : ` = max(0, ${artRad} - ${c.absorb})`));
        }

        addLoc('rus', `bq_${short}_name`, `${artName} в ${c.ru} контейнере`);
        addLoc('eng', `bq_${short}_name`, `${artName} in ${c.en} container`);
        if (c.total) {
            // Для СИМК текст другой: он поглощает всё и на пояс не надевается.
            // Эти строки в файле уже есть (добавлены вручную) - addLoc их не
            // тронет, но при генерации для НОВОГО артефакта текст будет верным.
            addLoc('rus', `bq_${short}_descr`,
                `Артефакт «${artName}» в контейнере СИМК. Контейнер поглощает ` +
                `всю радиацию артефакта, поэтому фона нет. На пояс не надевается.`);
            addLoc('eng', `bq_${short}_descr`,
                `The "${artName}" artefact inside a SIMK container. The container absorbs ` +
                `all of the artefact radiation, so there is no background. Cannot be worn on the belt.`);
        } else {
            addLoc('rus', `bq_${short}_descr`,
                `Артефакт «${artName}» в ${c.ru} контейнере. Контейнер поглощает ` +
                `${Math.round(c.absorb * 1000)} единиц радиации артефакта.`);
            addLoc('eng', `bq_${short}_descr`,
                `The "${artName}" artefact inside ${c.en} container. The container absorbs ` +
                `${Math.round(c.absorb * 1000)} units of the artefact radiation.`);
        }
    }

    tableRows.push({ artefact: art, radiation: artRad, bleeding: artBleed });
}

console.log(`\nновых секций: ${newSections.length} (уже было: ${skipped})`);
console.log(`новых строк локализации: rus ${newLoc.rus.length}, eng ${newLoc.eng.length}`);

if (dryRun) { console.log('\n--dry-run: файлы не изменены'); process.exit(0); }

if (newSections.length) {
    const marker = 'use1_functor                = bq_containers.take_artifact';
    const at = modText.lastIndexOf(marker);
    if (at < 0) { console.error('FAIL: не найдено место вставки в mod_artefacts_z_bq.ltx'); process.exit(1); }
    modText = modText.slice(0, at + marker.length) + '\n\n' + newSections.join('\n') +
        modText.slice(at + marker.length);
    fs.writeFileSync(MOD_FILE, modText, 'latin1');
    console.log(`записано: ${path.relative(ROOT, MOD_FILE)}`);
}

for (const [lang, file, list] of [['rus', RUS, newLoc.rus], ['eng', ENG, newLoc.eng]]) {
    if (!list.length) continue;
    let text = fs.readFileSync(file, 'utf8');
    const close = '\n</string_table>';
    if (!text.includes(close)) { console.error(`FAIL: в ${file} нет </string_table>`); process.exit(1); }
    text = text.replace(close, '\n' + list.join('\n') + close);
    fs.writeFileSync(file, text, 'utf8');
    console.log(`записано: локализация ${lang}, ${list.length} строк`);
}

console.log('\n--- для tools/check_containers.js, TESTED_ARTEFACTS ---');
for (const row of tableRows) {
    const combos = CONTAINERS
        .map((c) => `            ${c.section}: '${row.artefact}_${c.section}',`)
        .join('\n');
    console.log(`    {\n        artefact: '${row.artefact}',\n        radiation: ${row.radiation},\n` +
        `        bleeding: ${row.bleeding},\n        combos: {\n${combos}\n        },\n    },`);
}
