// check_ltx_syntax.js — проверка синтаксиса DLTX-переопределений.
//
// ВАЖНО: в этой сборке переопределение секции пишется "![ИмяСекции]" -
// восклицательный знак ПЕРЕД открывающей скобкой (см. configs\mod_system_z_bq.ltx
// и configs\game_global.ltx). Вариант "[!ИмяСекции]" движок НЕ понимает:
// он прочитает его как обычную секцию с именем "!ИмяСекции".
//
// Эта проверка ловит такую ошибку и заодно сверяет, что каждая секция с "!"
// действительно переопределяет существующую секцию, а не создаёт новую.
//
// Запуск: node tools/check_ltx_syntax.js [файл ...]
// Без аргументов проверяет все .ltx нашего аддона.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\configs';
const ADDONS = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons';

function collect(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collect(p, out);
        else if (e.name.endsWith('.ltx')) out.push(p);
    }
    return out;
}

function sectionsOf(file) {
    const text = fs.readFileSync(file).toString('latin1');
    const out = [];
    text.split(/\r?\n/).forEach((raw, i) => {
        const line = raw.replace(/;.*$/, '').trim();
        if (!line) return;
        // правильный вариант: ![Имя]  |  старый неверный: [!Имя]
        const good = line.match(/^!\[([^\]]+)\](?:\s*:\s*(.*))?$/);
        if (good) { out.push({ name: good[1].trim(), override: true, line: i + 1, bad: null }); return; }
        const bad = line.match(/^\[!([^\]]+)\](?:\s*:\s*(.*))?$/);
        if (bad) { out.push({ name: bad[1].trim(), override: true, line: i + 1, bad: '[!Имя]' }); return; }
        const plain = line.match(/^\[([^\]]+)\](?:\s*:\s*(.*))?$/);
        if (plain) { out.push({ name: plain[1].trim(), override: false, line: i + 1, bad: null }); }
    });
    return out;
}

// Известные секции: ванильные файлы + ВСЕ ltx аддонов сборки (в них лежат
// секции, которые мы переопределяем, например списки торговли).
const known = new Set();
function addKnown(file) {
    if (!fs.existsSync(file)) return;
    for (const s of sectionsOf(file)) known.add(s.name);
}
// оригинальная gamedata
addKnown(path.join(GAME, 'defines.ltx'));
addKnown(path.join(GAME, 'misc', 'artefacts.ltx'));
addKnown(path.join(GAME, 'system.ltx'));
addKnown(path.join(GAME, 'game_global.ltx'));
addKnown(path.join(GAME, 'misc', 'devices.ltx'));
// все файлы аддонов сборки (рекурсивно: торговля и прочее лежат в подпапках)
function addKnownTree(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) addKnownTree(p);
        else if (e.name.endsWith('.ltx')) addKnown(p);
    }
}
for (const addon of fs.readdirSync(ADDONS, { withFileTypes: true })) {
    if (!addon.isDirectory()) continue;
    addKnownTree(path.join(ADDONS, addon.name, 'configs'));
}

const files = process.argv.length > 2
    ? process.argv.slice(2)
    : collect(path.join(ROOT, 'configs'), []);

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };

for (const file of files) {
    const rel = path.relative(ROOT, file);
    for (const s of sectionsOf(file)) {
        if (s.bad) {
            err(`${rel}:${s.line}: секция записана как ${s.bad} — движок поймёт это как ` +
                `секцию с именем "!${s.name}". Правильно: ![${s.name}]`);
        } else if (s.override && !known.has(s.name)) {
            // не ошибка движка, но почти всегда это опечатка в имени
            err(`${rel}:${s.line}: "![${s.name}]" переопределяет несуществующую секцию ` +
                `(движок напишет DLTX ERROR в лог)`);
        }
    }
}

if (errors === 0) {
    console.log(`OK: синтаксис переопределений верный (проверено файлов: ${files.length}).`);
    process.exit(0);
}
console.error(`FAIL: ${errors} ошибок`);
process.exit(1);
