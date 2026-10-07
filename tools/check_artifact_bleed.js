// tools/check_artifact_bleed.js — проверяет, что значок артефакта в итоговой
// иконке не обрывается по краю.
//
// ЗАЧЕМ
//   У части артефактов картинка в атласе упирается в край своей клетки
//   (у «Кристалла» содержимое 66x100 при клетке 100 — отступы сверху и снизу
//   равны нулю). Если уменьшать всю клетку целиком, изображение обрывается
//   ровной линией по границе клетки, и на иконке контейнера это выглядит как
//   прямоугольный рез.
//
//   Поэтому значок вписывается по границам содержимого со свободным полем
//   (tools/downscale.js, fitArtifactToSquare). Этот инструмент проверяет, что
//   после вписывания у содержимого остался отступ со всех сторон, то есть
//   обрыва не будет.
//
// Запуск: node tools/check_artifact_bleed.js
'use strict';
const fs = require('fs');
const path = require('path');
const { decodeAuto } = require('./dds.js');
const { fitArtifactToSquare, contentBBox } = require('./downscale.js');

const GAME = 'Z:/Games/Stalker_Call_of_Pripyat_Mod';
const HQ = `${GAME}/StalkerCoP_IXRAY/ixr_addons/ixray-hq-icons-v2.0/textures/ui/ui_icon_equipment_hd.dds`;
const CELL = 100;             // клетка иконки в HQ-атласе (inv_scale = 2.0)
const ART = 32;               // размер значка в итоговой иконке

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
console.log(`HQ-атлас: ${dec.width}x${dec.height}, клетка ${CELL} px, значок ${ART}x${ART}\n`);

function crop(src, srcW, x0, y0, w, h) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const s = ((y0 + y) * srcW + (x0 + x)) * 4;
            const d = (y * w + x) * 4;
            out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
        }
    }
    return out;
}

let bad = 0;
for (const [name, [gx, gy]] of Object.entries(ARTS)) {
    const cellImg = crop(dec.rgba, dec.width, gx * CELL, gy * CELL, CELL, CELL);
    const bbox = contentBBox(cellImg, CELL, CELL);
    if (!bbox) { console.log(`${name}: клетка пустая`); continue; }

    const srcTouch = [];
    if (bbox.x === 0) srcTouch.push('левый');
    if (bbox.y === 0) srcTouch.push('верхний');
    if (bbox.x + bbox.w === CELL) srcTouch.push('правый');
    if (bbox.y + bbox.h === CELL) srcTouch.push('нижний');

    // что получилось после вписывания
    const fitted = fitArtifactToSquare(cellImg, CELL, CELL, ART, 1, 3);
    const fb = contentBBox(fitted, ART, ART);
    if (!fb) { console.log(`${name}: после вписывания значок пустой`); bad++; continue; }

    const margins = {
        left: fb.x, top: fb.y,
        right: ART - (fb.x + fb.w), bottom: ART - (fb.y + fb.h),
    };
    const zero = Object.entries(margins).filter(([, v]) => v === 0).map(([k]) => k);
    if (zero.length) bad++;

    console.log(`${name}: в атласе содержимое ${bbox.w}x${bbox.h} px` +
        (srcTouch.length ? `, упирается в край (${srcTouch.join(', ')})` : '') +
        `\n    после вписывания: ${fb.w}x${fb.h} px, отступы ` +
        `слева ${margins.left}, справа ${margins.right}, сверху ${margins.top}, снизу ${margins.bottom}` +
        (zero.length ? `  <-- ОБРЫВ: ${zero.join(', ')}` : '  ok'));
}

console.log(bad === 0
    ? '\nOK: значки артефактов вписаны со свободным полем — обрыва по краю не будет.'
    : `\nFAIL: у ${bad} значков содержимое доходит до края — будет виден прямоугольный рез.`);
process.exit(bad === 0 ? 0 : 1);
