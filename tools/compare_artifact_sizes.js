// tools/compare_artifact_sizes.js — подбор размера значка артефакта.
//
// Сравнивает уменьшение исходника 100x100 до разных размеров (слева направо):
//   24 (как сейчас), 28, 32, 40, и исходник 100 целиком — как эталон.
// Всё увеличено, чтобы разница была видна глазами. Плюс считает, сколько
// полупрозрачных пикселей потеряно при уменьшении (это и есть «обрезка» края).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { decodeAuto } = require('./dds.js');
const { downscaleRGBA } = require('./downscale.js');
const { encodePNG, upscale } = require('./png.js');

const ROOT = path.join(__dirname, '..');
const HQ = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons\\ixray-hq-icons-v2.0' +
    '\\textures\\ui\\ui_icon_equipment_hd.dds';
const SRC = 100;
const GX = 12, GY = 4;                     // af_eye в HQ-атласе, клетка 100 px
const SIZES = [24, 28, 32, 40];

function crop(dec, x0, y0, w, h) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const s = ((y0 + y) * dec.width + (x0 + x)) * 4;
            const d = (y * w + x) * 4;
            out[d] = dec.rgba[s]; out[d + 1] = dec.rgba[s + 1];
            out[d + 2] = dec.rgba[s + 2]; out[d + 3] = dec.rgba[s + 3];
        }
    }
    return out;
}

// Насколько «живой» край: доля пикселей с частичной прозрачностью
function edgeStats(img, size) {
    let partial = 0, opaque = 0;
    for (let i = 0; i < size * size; i++) {
        const a = img[i * 4 + 3];
        if (a > 0 && a < 255) partial++;
        if (a === 255) opaque++;
    }
    return { partial, opaque, total: size * size };
}

const hq = decodeAuto(fs.readFileSync(HQ));
const src = crop(hq, GX * SRC, GY * SRC, SRC, SRC);

console.log('Варианты уменьшения (Ланцош, без резкости):');
const variants = [];
for (const size of SIZES) {
    const img = downscaleRGBA(src, SRC, size, 3);
    const st = edgeStats(img, size);
    console.log(`  ${size}x${size}: полупрозрачных пикселей ${st.partial} ` +
        `(${(100 * st.partial / st.total).toFixed(1)}%), непрозрачных ${st.opaque}`);
    variants.push({ size, img, label: `${size}x${size}` });
}
{
    const st = edgeStats(src, SRC);
    console.log(`  эталон 100x100: полупрозрачных ${st.partial} ` +
        `(${(100 * st.partial / st.total).toFixed(1)}%)`);
    variants.push({ size: SRC, img: src, label: '100 (эталон)' });
}

// Собираем сравнение: каждый вариант приведён к одному экранному размеру,
// поэтому разница видна как разница в детализации.
const SCREEN = 160;                        // во столько пикселей рисуем каждый вариант
const PAD = 10;
const totalW = PAD + variants.length * (SCREEN + PAD);
const totalH = PAD + SCREEN + PAD;
const canvas = new Uint8Array(totalW * totalH * 4);
for (let i = 0; i < totalW * totalH; i++) {
    canvas[i * 4] = 55; canvas[i * 4 + 1] = 55; canvas[i * 4 + 2] = 55; canvas[i * 4 + 3] = 255;
}

variants.forEach((v, idx) => {
    const up = upscale(v.img, v.size, v.size, Math.max(1, Math.round(SCREEN / v.size)));
    const ox = PAD + idx * (SCREEN + PAD);
    const oy = PAD;
    for (let y = 0; y < Math.min(up.height, SCREEN); y++) {
        for (let x = 0; x < Math.min(up.width, SCREEN); x++) {
            const s = (y * up.width + x) * 4;
            const d = ((oy + y) * totalW + ox + x) * 4;
            const a = up.rgba[s + 3] / 255;
            for (let c = 0; c < 3; c++) canvas[d + c] = Math.round(up.rgba[s + c] * a + canvas[d + c] * (1 - a));
            canvas[d + 3] = 255;
        }
    }
});

const out = path.join(os.tmpdir(), 'bq_artifact_sizes.png');
fs.writeFileSync(out, encodePNG(canvas, totalW, totalH));
console.log(`\nСравнение (слева направо ${variants.map((v) => v.label).join(', ')}): ${out}`);
