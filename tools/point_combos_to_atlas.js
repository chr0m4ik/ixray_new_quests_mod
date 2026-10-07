// tools/point_combos_to_atlas.js — направить иконки комбо на атлас контейнеров.
//
// Комбо-предмет (артефакт в контейнере) обязан иметь СВОИ inv_grid_x/y и
// icons_texture: если их не задать, движок возьмёт их у артефакта-родителя и
// вырежет иконку из чужого атласа (баг 2x2, MEMO 15.3).
//
// Ячейки атласа ui\ui_bq_field_container (верхний ряд, 50x50 без отступов):
//   (0,0) полевой, (1,0) универсальный, (2,0) научный.
//
// Файл читается и пишется в latin1 (побайтово), поэтому cp1251-комментарии
// не портятся. Запуск: node tools/point_combos_to_atlas.js
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'configs', 'misc', 'mod_artefacts_z_bq.ltx');
const ATLAS = 'ui\\ui_bq_field_container';
const CELL = {
    bq_field_container: [0, 0],
    bq_uni_container: [1, 0],
    bq_sci_container: [2, 0],
};

const text = fs.readFileSync(FILE).toString('latin1');
const lines = text.split(/\r?\n/);

let currentSection = null;
let comboOf = null;          // { artefact, container } если мы внутри комбо
let changed = { icons: 0, x: 0, y: 0 };
const combos = [];

const out = lines.map((line) => {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
        currentSection = header[1].trim();
        comboOf = null;
        // комбо: <артефакт>_<секция контейнера>
        for (const container of Object.keys(CELL)) {
            const marker = '_' + container;
            if (currentSection.length > marker.length &&
                currentSection.slice(-marker.length) === marker) {
                comboOf = { artefact: currentSection.slice(0, -marker.length), container };
                combos.push({ section: currentSection, ...comboOf });
                break;
            }
        }
        return line;
    }
    if (!comboOf) return line;

    if (/^\s*icons_texture\s*=/.test(line)) {
        changed.icons++;
        return line.replace(/=.*$/, '= ' + ATLAS);
    }
    if (/^\s*inv_grid_x\s*=/.test(line)) {
        changed.x++;
        return line.replace(/=.*$/, '= ' + CELL[comboOf.container][0]);
    }
    if (/^\s*inv_grid_y\s*=/.test(line)) {
        changed.y++;
        return line.replace(/=.*$/, '= ' + CELL[comboOf.container][1]);
    }
    return line;
});

fs.writeFileSync(FILE, out.join('\n'), 'latin1');
console.log(`найдено комбо: ${combos.length}`);
for (const c of combos) {
    console.log(`  ${c.section} -> атлас ${ATLAS}, ячейка (${CELL[c.container][0]},${CELL[c.container][1]})`);
}
console.log(`изменено строк: icons_texture=${changed.icons}, inv_grid_x=${changed.x}, inv_grid_y=${changed.y}`);
if (changed.icons !== combos.length || changed.x !== combos.length || changed.y !== combos.length) {
    console.error('FAIL: число изменённых строк не совпало с числом комбо');
    process.exit(1);
}
