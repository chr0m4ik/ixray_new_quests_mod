// tools/fix_rus_localization.js — заполняет РУССКИЙ файл локализации русским текстом.
//
// ПРОБЛЕМА
//   В configs/text/rus/st_beard_quest.xml почти весь текст был английским
//   (103 строки из 115). В игре это выглядело так, будто локализация «слетела»:
//   контейнеры и пункт «достать артефакт» показывались по-английски.
//   Заодно в configs/text/eng/... лежал ровно тот же английский текст — то есть
//   строки добавляли сразу в оба файла, не переводя.
//
// ОТКУДА БЕРЁТСЯ ПЕРЕВОД
//   В ветке main лежит ПРЕДЫДУЩАЯ версия мода, и там
//   configs/text/rus/st_beard_quest.xml — настоящий русский (файл в cp1251).
//   Из него берётся текст для всех совпадающих ключей; для 26 ключей, которых
//   там нет (контейнеры и комбо), перевод задан ниже.
//
// ЗАПУСК:  node tools/fix_rus_localization.js [--check]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUS = path.join(ROOT, 'configs', 'text', 'rus', 'st_beard_quest.xml');
const ENG = path.join(ROOT, 'configs', 'text', 'eng', 'st_beard_quest.xml');
const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Перевод для ключей, которых нет в предыдущей версии (контейнеры и комбо).
// Схема имён комбо: bq_<артефакт>_<тип контейнера>_(name|descr)
// ---------------------------------------------------------------------------
const RUS_NEW = {
    bq_container_name: 'Полевой контейнер для артефактов',
    bq_container_descr: 'Контейнер, собранный своими руками. Может содержать в себе артефакт и поглощать часть его радиации: 4 единицы. Вес пустого контейнера — 2 кг.',
    bq_take_artifact: 'достать артефакт',
};

// Названия артефактов так, как они называются в игре
const ART = {
    eye: 'Глаз',
    cristall: 'Кристалл',
    compass: 'Компас',
    ice: 'Снежинка',
};
// Тип контейнера -> (имя в именительном падеже, сколько единиц радиации поглощает)
const KIND = {
    field: { name: 'Полевой', units: 4, unitsWord: 'единицы' },
    uni: { name: 'Универсальный', units: 8, unitsWord: 'единиц' },
    sci: { name: 'Научный', units: 14, unitsWord: 'единиц' },
};

// Карта «старое имя ключа -> новое» для комбо (в предыдущей версии комбо
// назывались без префикса bq_ и без типа артефакта в имени ключа).
const RENAME = {
    eye_field_name: 'bq_eye_field_name', eye_field_descr: 'bq_eye_field_descr',
    eye_uni_name: 'bq_eye_uni_name', eye_uni_descr: 'bq_eye_uni_descr',
    eye_sci_name: 'bq_eye_sci_name', eye_sci_descr: 'bq_eye_sci_descr',
    cristall_field_name: 'bq_cristall_field_name', cristall_field_descr: 'bq_cristall_field_descr',
    cristall_uni_name: 'bq_cristall_uni_name', cristall_uni_descr: 'bq_cristall_uni_descr',
    cristall_sci_name: 'bq_cristall_sci_name', cristall_sci_descr: 'bq_cristall_sci_descr',
    compass_field_name: 'bq_compass_field_name', compass_field_descr: 'bq_compass_field_descr',
    compass_uni_name: 'bq_compass_uni_name', compass_uni_descr: 'bq_compass_uni_descr',
    compass_sci_name: 'bq_compass_sci_name', compass_sci_descr: 'bq_compass_sci_descr',
    fireball_field_name: 'bq_fireball_field_name', fireball_field_descr: 'bq_fireball_field_descr',
    fireball_uni_name: 'bq_fireball_uni_name', fireball_uni_descr: 'bq_fireball_uni_descr',
    fireball_sci_name: 'bq_fireball_sci_name', fireball_sci_descr: 'bq_fireball_sci_descr',
};

// --------------- чтение предыдущей версии из ветки main ---------------------
// ВАЖНО: файл там в UTF-16LE (начинается с BOM FF FE) — русский текст двухбайтовый.
// Попытка прочитать его как cp1251/latin1 даёт пустую кириллицу.
function loadPreviousRussian() {
    let raw;
    try {
        raw = execFileSync('git', ['show', 'main:configs/text/rus/st_beard_quest.xml'],
            { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        console.error('FAIL: не удалось прочитать файл из ветки main: ' + e.message);
        process.exit(1);
    }
    const buf = Buffer.from(raw);
    const bom16le = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE;
    const bom16be = buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF;
    const bom8 = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

    let text, encoding;
    if (bom16le) {
        encoding = 'utf16le';
        // Node не принимает строку с BOM для 'utf16le' — отрезаем два байта
        text = buf.subarray(2).toString('utf16le');
    } else if (bom16be) {
        encoding = 'utf16be';
        const swapped = Buffer.from(buf.subarray(2));
        swapped.swap16();
        text = swapped.toString('utf16le');
    } else if (bom8) {
        encoding = 'utf8-bom';
        text = buf.subarray(3).toString('utf8');
    } else {
        // без BOM: пробуем utf8, при неверных байтах — cp1251
        const utf8ok = (() => {
            try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; }
            catch { return false; }
        })();
        encoding = utf8ok ? 'utf8' : 'cp1251';
        text = utf8ok ? buf.toString('utf8') : buf.toString('latin1');
    }

    const out = {};
    const re = /<string\s+id="([^"]+)"\s*>\s*<text>([\s\S]*?)<\/text>\s*<\/string>/g;
    let m;
    while ((m = re.exec(text)) !== null) out[m[1]] = m[2].trim();
    return { map: out, encoding };
}

// --------------- чтение нашего файла (UTF-8) -------------------------------
function loadKeys(file) {
    const text = fs.readFileSync(file, 'utf8');
    const keys = [];
    const re = /<string\s+id="([^"]+)"\s*>/g;
    let m;
    while ((m = re.exec(text)) !== null) keys.push(m[1]);
    return { text, keys };
}

// -------------------------------------------------------------------- main ---
console.log('=== Русская локализация: заполнение русского файла ===');

const prev = loadPreviousRussian();
console.log(`Из ветки main прочитано строк: ${Object.keys(prev.map).length}` +
    ` (кодировка ${prev.encoding})`);

const rus = loadKeys(RUS);
const eng = loadKeys(ENG);
console.log(`Наш русский файл: ${rus.keys.length} строк; английский: ${eng.keys.length}`);

// 1. ключи должны совпадать между языками
const onlyRus = rus.keys.filter((k) => !eng.keys.includes(k));
const onlyEng = eng.keys.filter((k) => !rus.keys.includes(k));
if (onlyRus.length) console.error(`FAIL: только в русском файле: ${onlyRus.join(', ')}`);
if (onlyEng.length) console.error(`FAIL: только в английском файле: ${onlyEng.join(', ')}`);
if (onlyRus.length || onlyEng.length) process.exit(1);
console.log('ok: наборы ключей в обоих языках совпадают');

// 2. английский текст русских строк (чтобы показать, что именно чиним)
const engMap = {};
{
    const re = /<string\s+id="([^"]+)"\s*>\s*<text>([\s\S]*?)<\/text>\s*<\/string>/g;
    let m;
    while ((m = re.exec(eng.text)) !== null) engMap[m[1]] = m[2].trim();
}

// 3. собираем русский текст
const result = {};
const sources = { main: 0, rename: 0, generated: 0, missing: [] };
for (const key of rus.keys) {
    if (RUS_NEW[key] !== undefined) { result[key] = RUS_NEW[key]; sources.generated++; continue; }
    if (prev.map[key] !== undefined) { result[key] = prev.map[key]; sources.main++; continue; }

    // комбо: имя/описание строим по схеме, как это было в предыдущей версии
    // ("Полевой контейнер (Глаз)")
    const cm = key.match(/^bq_([a-z]+)_(field|uni|sci)_(name|descr)$/);
    if (cm && ART[cm[1]] && KIND[cm[2]]) {
        const art = ART[cm[1]], kind = KIND[cm[2]];
        result[key] = cm[3] === 'name'
            ? `${kind.name} контейнер (${art})`
            : `Контейнер с артефактом. Содержит в себе: ${art}. ` +
              `Контейнер поглощает ${kind.units} ${kind.unitsWord} радиации артефакта.`;
        sources.generated++;
        continue;
    }

    // могло остаться старое имя ключа
    const renamed = Object.entries(RENAME).find(([, v]) => v === key);
    if (renamed && prev.map[renamed[0]] !== undefined) {
        result[key] = prev.map[renamed[0]];
        sources.rename++;
        continue;
    }

    sources.missing.push(key);
    result[key] = engMap[key] || '';       // крайний случай — оставляем как было
}

console.log(`Источники перевода: из main ${sources.main}, по схеме ${sources.generated}, ` +
    `переименованные ${sources.rename}`);
if (sources.missing.length) {
    console.error(`FAIL: не найден русский текст для ${sources.missing.length} ключей:`);
    for (const k of sources.missing) console.error(`   ${k} = ${engMap[k]}`);
    process.exit(1);
}

// 4. проверка: не осталось ли русских строк, равных английским
const same = rus.keys.filter((k) => result[k] === engMap[k]);
const withCyr = rus.keys.filter((k) => /[\u0400-\u04FF]/.test(result[k]));
console.log(`Русских строк с кириллицей: ${withCyr.length} из ${rus.keys.length}`);
if (same.length) {
    console.log(`Строк, совпадающих с английскими: ${same.length}`);
    if (same.length <= 12) for (const k of same) console.log(`   ${k} = ${result[k]}`);
}

// 5. запись: подменяем только содержимое <text>, структуру файла не трогаем
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let replaced = 0;
const out = rus.text.replace(
    /(<string\s+id="([^"]+)"\s*>\s*<text>)([\s\S]*?)(<\/text>)/g,
    (all, a, id, body, c) => {
        if (result[id] === undefined) return all;
        replaced++;
        return a + escape(result[id]) + c;
    });

if (replaced !== rus.keys.length) {
    console.error(`FAIL: заменено ${replaced} строк, а ожидалось ${rus.keys.length}`);
    process.exit(1);
}

if (CHECK_ONLY) {
    console.log(`\n(режим проверки) было бы заменено строк: ${replaced}. Файл не изменён.`);
} else {
    fs.writeFileSync(RUS, out, 'utf8');
    console.log(`\nЗаписано: ${path.relative(ROOT, RUS)} (строк заменено: ${replaced})`);
}
