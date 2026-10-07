// dump_section.js — печатает указанные секции из ltx (для сверки чисел с оригиналом).
// Запуск: node tools/dump_section.js <файл.ltx> <секция> [секция...]
'use strict';
const fs = require('fs');

const file = process.argv[2];
const wanted = process.argv.slice(3);
if (!file || !wanted.length) {
    console.error('usage: node tools/dump_section.js <file.ltx> <section> [...]');
    process.exit(2);
}

// Читаем побайтово: оригинальные файлы игры в cp1251, UTF-8 их не декодирует.
const buf = fs.readFileSync(file);
const lines = [];
let start = 0;
for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0A) { lines.push(buf.slice(start, i).toString('latin1')); start = i + 1; }
}
lines.push(buf.slice(start).toString('latin1'));

const keysOfInterest = /class|visual|\$spawn|inv_name|description|inv_weight|cost|inv_grid|restore_speed|absorbation|belt|lights_enabled|af_rank|particles_bone|additional_inventory|af_actor_properties|actor_properties/;

for (const sec of wanted) {
    const i = lines.findIndex((l) => new RegExp('^\\s*\\[' + sec + '\\]').test(l));
    if (i < 0) { console.log(`[${sec}] НЕ НАЙДЕНА`); continue; }
    let j = lines.findIndex((l, k) => k > i && /^\s*\[/.test(l));
    if (j < 0) j = lines.length;
    console.log(`--- [${sec}] строки ${i + 1}..${j} ---`);
    for (let k = i; k < j; k++) {
        const l = lines[k];
        if (keysOfInterest.test(l)) console.log(`  ${k + 1}: ${l.trim()}`);
    }
}
