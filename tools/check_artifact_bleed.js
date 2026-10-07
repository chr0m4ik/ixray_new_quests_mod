// tools/check_artifact_bleed.js — проверяет, упирается ли иконка артефакта
// в границы своей клетки в атласе.
//
// ЗАЧЕМ
//   Если непрозрачные пиксели доходят до края клетки, то при наложении на
//   иконку контейнера картинка обрывается ровной линией по границе клетки —
//   это и выглядит как «границы режутся квадратами».
//   Лечится тем, что перед уменьшением вписываем картинку в квадрат со
//   свободным полем, а не растягиваем на всю клетку.
'use strict';
const fs = require('fs');
const path = require('path');
const { decodeAuto } = require('./dds.js');

const GAME = 'Z:/Games/Stalker_Call_of_Pripyat_Mod';
const HQ = `${GAME}/StalkerCoP_IXRAY/ixr_addons/ixray-hq-icons-v2.0/textures/ui/ui_icon_equipment_hd.dds`;
const CELL = 100;                     // клетка иконки в HQ-атласе (inv_scale = 2.0)

// координаты в HQ-атласе: (grid_x, grid_y) при клетке 100 px
const ARTS = {
    af_eye: [12, 4],
    af_cristall: [14, 4],
    af_compass: [12, 1],
    af_ice: [13, 1],
};

if (!fs.existsSync(HQ)) {
    console.error('FAIL: не найден HQ-атлас: ' + HQ);
    process.exit(1);
}
const dec = decodeAuto(fs.readFileSync(HQ));
console.log(`HQ-атлас: ${dec.width}x${dec.height}, клетка ${CELL} px\n`);

let bleed = 0;
for (const [name, [gx, gy]] of Object.entries(ARTS)) {
    const x0 = gx * CELL, y0 = gy * CELL;
    let minX = CELL, maxX = -1, minY = CELL, maxY = -1, opaque = 0;
    for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
            const a = dec.rgba[((y0 + y) * dec.width + (x0 + x)) * 4 + 3];
            if (a > 8) {
                opaque++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) { console.log(`${name}: клетка пустая`); continue; }
    const touch = [];
    if (minX === 0) touch.push('левый');
    if (maxX === CELL - 1) touch.push('правый');
    if (minY === 0) touch.push('верхний');
    if (maxY === CELL - 1) touch.push('нижний');
    if (touch.length) bleed++;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    console.log(`${name}: содержимое ${w}x${h} px, отступы ` +
        `слева ${minX}, справа ${CELL - 1 - maxX}, сверху ${minY}, снизу ${CELL - 1 - maxY}` +
        (touch.length ? `  <-- УПИРАЕТСЯ В КРАЙ: ${touch.join(', ')}` : ''));
}

console.log(bleed === 0
    ? '\nOK: иконки артефактов не упираются в края клеток.'
    : `\nВНИМАНИЕ: ${bleed} иконок упираются в край — при наложении будет виден прямоугольный рез.`);
