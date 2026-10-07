// check_loc.js — сверка файлов локализации: XML-валидность, дубли id,
// совпадение набора id между языками.
// Запуск: node tools/check_loc.js
'use strict';
const fs = require('fs');
const path = require('path');

const MOD = path.join(__dirname, '..', 'configs', 'text');
const LANGS = ['rus', 'eng'];
let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };

const idsByLang = {};
for (const lang of LANGS) {
    const file = path.join(MOD, lang, 'st_beard_quest.xml');
    const raw = fs.readFileSync(file, 'utf8');

    if (raw.charCodeAt(0) === 0xFEFF) err(`${lang}: файл с BOM (нужен UTF-8 без BOM)`);
    if (raw.includes('\uFFFD')) err(`${lang}: есть символ-замена U+FFFD (битая кодировка)`);
    if (!/^<\?xml[^>]*encoding="UTF-8"/.test(raw)) err(`${lang}: в XML не объявлена кодировка UTF-8`);

    // грубая проверка парности тегов <string> ... </string>
    const open = (raw.match(/<string\b/g) || []).length;
    const close = (raw.match(/<\/string>/g) || []).length;
    if (open !== close) err(`${lang}: <string> ${open} против </string> ${close}`);
    if ((raw.match(/<string_table>/g) || []).length !== 1) err(`${lang}: должен быть один <string_table>`);
    if (!raw.trimEnd().endsWith('</string_table>')) err(`${lang}: файл не заканчивается </string_table>`);

    const ids = [];
    for (const m of raw.matchAll(/<string id="([^"]+)"/g)) ids.push(m[1]);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length) err(`${lang}: дубли id: ${[...new Set(dupes)].join(', ')}`);
    for (const id of ids) if (!/^[A-Za-z0-9_]+$/.test(id)) err(`${lang}: подозрительный id '${id}'`);
    idsByLang[lang] = ids;
    console.log(`  ${lang}: ${ids.length} строк, дублей нет`);
}

const [a, b] = LANGS;
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
