// check_loc.js — сверка файлов локализации: XML-валидность, дубли id,
// совпадение набора id между языками, кодировка.
// Запуск: node tools/check_loc.js
'use strict';
const fs = require('fs');
const path = require('path');

const MOD = path.join(__dirname, '..', 'configs', 'text');
const LANGS = ['rus', 'eng'];
let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };

const idsByLang = {};
const filesByLang = {};
for (const lang of LANGS) {
    const dir = path.join(MOD, lang);
    // Читаем ВСЕ xml языка, а не только квестовый файл: локализация комбо лежит
    // отдельно (st_bq_containers.xml), и раньше проверка её просто не видела.
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xml')).sort();
    filesByLang[lang] = files;
    const ids = [];
    for (const name of files) {
        const file = path.join(dir, name);
        const raw = fs.readFileSync(file, 'utf8');
        const where = `${lang}/${name}`;

        if (raw.charCodeAt(0) === 0xFEFF) err(`${where}: файл с BOM (нужен UTF-8 без BOM)`);
        if (raw.includes('\uFFFD')) err(`${where}: есть символ-замена U+FFFD (битая кодировка)`);
        if (!/^<\?xml[^>]*encoding="UTF-8"/.test(raw)) err(`${where}: в XML не объявлена кодировка UTF-8`);

        // грубая проверка парности тегов <string> ... </string>
        const open = (raw.match(/<string\b/g) || []).length;
        const close = (raw.match(/<\/string>/g) || []).length;
        if (open !== close) err(`${where}: <string> ${open} против </string> ${close}`);
        if ((raw.match(/<string_table>/g) || []).length !== 1) err(`${where}: должен быть один <string_table>`);
        if (!raw.trimEnd().endsWith('</string_table>')) err(`${where}: файл не заканчивается </string_table>`);

        for (const m of raw.matchAll(/<string id="([^"]+)"/g)) ids.push(m[1]);
    }
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length) err(`${lang}: дубли id (в т.ч. между файлами): ${[...new Set(dupes)].join(', ')}`);
    for (const id of ids) if (!/^[A-Za-z0-9_]+$/.test(id)) err(`${lang}: подозрительный id '${id}'`);
    idsByLang[lang] = ids;
    console.log(`  ${lang}: ${ids.length} строк в ${files.length} файлах ` +
        `(${files.join(', ')}), дублей нет`);
}

// Наборы ФАЙЛОВ тоже должны совпадать: если строка есть в rus, но её файла нет
// в eng, игрок увидит пустое название при английском языке.
const [a, b] = LANGS;
const onlyFileA = filesByLang[a].filter((f) => !filesByLang[b].includes(f));
const onlyFileB = filesByLang[b].filter((f) => !filesByLang[a].includes(f));
if (onlyFileA.length) err(`файлы только в ${a}: ${onlyFileA.join(', ')}`);
if (onlyFileB.length) err(`файлы только в ${b}: ${onlyFileB.join(', ')}`);
const onlyA = idsByLang[a].filter((x) => !idsByLang[b].includes(x));
const onlyB = idsByLang[b].filter((x) => !idsByLang[a].includes(x));
if (onlyA.length) err(`только в ${a}: ${onlyA.join(', ')}`);
if (onlyB.length) err(`только в ${b}: ${onlyB.join(', ')}`);
if (!onlyA.length && !onlyB.length) console.log(`  наборы id совпадают в ${a} и ${b}`);

if (errors === 0) {
    console.log('OK: локализация согласована.');
    process.exit(0);
}
console.error(`FAIL: ${errors} ошибок`);
process.exit(1);
