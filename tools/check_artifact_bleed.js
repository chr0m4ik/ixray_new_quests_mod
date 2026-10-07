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
// Источник иконок — как в build_combo_icons.js: мод HQ Icons, если он есть,
// иначе штатный атлас игры. Это зависимость только инструмента, не аддона.
//
// Запуск: node tools/check_artifact_bleed.js
'use strict';
const fs = require('fs');
const { decodeAuto } = require('./dds.js');
const { fitArtifactToSquare, contentBBox } = require('./downscale.js');

const GAME = 'Z:/Games/Stalker_Call_of_Pripyat_Mod';
const ADDONS = `${GAME}/StalkerCoP_IXRAY/ixr_addons`;
const HQ_MOD = `${ADDONS}/ixray-hq-icons-v2.0`;
const VANILLA = `${GAME}/StalkerCoP_Original_gamedata/gamedata`;

const ART = 32;               // размер значка в итоговой иконке (как в генераторе)

// координаты артефактов совпадают в обоих атласах; отличается размер клетки,
// он берётся из inv_scale секции: клетка = 50 * inv_scale
const ARTS = {
    af_eye: [12, 4],
    af_cristall: [14, 4],
    af_compass: [12, 1],
    af_ice: [13, 1],
};

// Читает inv_scale секции из LTX (файлы сборки бывают в cp1251 — читаем latin1).
function sectionScale(file, section) {
    if (!fs.existsSync(file)) return 1;
    const text = fs.readFileSync(file).toString('latin1');
    const re = new RegExp(`^\\s*\\[!?${section}\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[|$)`, 'm');
    const m = text.match(re);
    if (!m) return 1;
    const s = m[1].match(/^\s*inv_scale\s*=\s*([\d.]+)/m);
    return s ? parseFloat(s[1]) : 1;
}

// Выбирает источник иконок: мод HQ Icons, иначе штатный атлас игры.
function loadSource() {
    const hqTex = `${HQ_MOD}/textures/ui/ui_icon_equipment_hd.dds`;
    const hqCfg = `${HQ_MOD}/configs/mod_system_hqicons.ltx`;
    if (fs.existsSync(hqTex) && fs.existsSync(hqCfg)) {
        return { tex: hqTex, cfg: hqCfg, label: 'мод HQ Icons' };
    }
    const vanTex = `${VANILLA}/textures/ui/ui_icon_equipment.dds`;
    const vanCfg = `${VANILLA}/configs/misc/artefacts.ltx`;
    if (fs.existsSync(vanTex)) {
        return { tex: vanTex, cfg: vanCfg, label: 'штатный атлас игры' };
    }
    console.error('FAIL: не найден ни мод HQ Icons, ни штатный атлас иконок игры.');
    console.error(`  искал: ${hqTex}`);
    console.error(`  искал: ${vanTex}`);
    process.exit(1);
}

const src = loadSource();
const dec = decodeAuto(fs.readFileSync(src.tex));
console.log(`Источник: ${src.label}`);
console.log(`Атлас: ${dec.width}x${dec.height}, значок ${ART}x${ART}\n`);

function crop(rgba, srcW, x0, y0, w, h) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const s = ((y0 + y) * srcW + (x0 + x)) * 4;
            const d = (y * w + x) * 4;
            out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
        }
    }
    return out;
}

let bad = 0;
for (const [name, [gx, gy]] of Object.entries(ARTS)) {
    const cell = Math.round(50 * sectionScale(src.cfg, name));
    if ((gx + 1) * cell > dec.width || (gy + 1) * cell > dec.height) {
        console.log(`${name}: клетка (${gx},${gy}) ${cell}px выходит за пределы атласа`);
        bad++;
        continue;
    }
    const cellImg = crop(dec.rgba, dec.width, gx * cell, gy * cell, cell, cell);
    const bbox = contentBBox(cellImg, cell, cell);
    if (!bbox) { console.log(`${name}: клетка пустая`); continue; }

    const srcTouch = [];
    if (bbox.x === 0) srcTouch.push('левый');
    if (bbox.y === 0) srcTouch.push('верхний');
    if (bbox.x + bbox.w === cell) srcTouch.push('правый');
    if (bbox.y + bbox.h === cell) srcTouch.push('нижний');

    const fitted = fitArtifactToSquare(cellImg, cell, cell, ART, 1, 3);
    const fb = contentBBox(fitted, ART, ART);
    if (!fb) { console.log(`${name}: после вписывания значок пустой`); bad++; continue; }

    const margins = {
        left: fb.x, top: fb.y,
        right: ART - (fb.x + fb.w), bottom: ART - (fb.y + fb.h),
    };
    const zero = Object.entries(margins).filter(([, v]) => v === 0).map(([k]) => k);
    if (zero.length) bad++;

    console.log(`${name}: клетка ${cell} px, содержимое ${bbox.w}x${bbox.h} px` +
        (srcTouch.length ? `, упирается в край (${srcTouch.join(', ')})` : '') +
        `\n    после вписывания: ${fb.w}x${fb.h} px, отступы ` +
        `слева ${margins.left}, справа ${margins.right}, сверху ${margins.top}, снизу ${margins.bottom}` +
        (zero.length ? `  <-- ОБРЫВ: ${zero.join(', ')}` : '  ok'));
}

console.log(bad === 0
    ? '\nOK: значки артефактов вписаны со свободным полем — обрыва по краю не будет.'
    : `\nFAIL: у ${bad} значков содержимое доходит до края — будет виден прямоугольный рез.`);
process.exit(bad === 0 ? 0 : 1);
