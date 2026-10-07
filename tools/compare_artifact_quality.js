// tools/compare_artifact_quality.js — сравнение качества значка артефакта.
//
// Делает одну картинку-сравнение (увеличено, чтобы было видно глазами):
//   A. как сейчас: усреднение по блокам 100->24 + сжатие DXT5
//   B. точный фильтр (Ланцош) + лёгкая резкость + сжатие DXT5
//   C. то же, что B, но атлас НЕ сжат (A8R8G8B8)
//   D. исходник 100x100, сжатый до 24x24 без потерь (эталон «как должно быть»)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { decodeAuto } = require('./dds.js');
const { encodeDXT5 } = require('./dds_encode.js');
const { downscaleRGBA, sharpen } = require('./downscale.js');
const { encodePNG, upscale } = require('./png.js');

const HQ = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons\\ixray-hq-icons-v2.0' +
    '\\textures\\ui\\ui_icon_equipment_hd.dds';
const ART_SRC = 100;      // клетка иконки в HQ-атласе (inv_scale = 2.0)
const ART = 24;           // размер значка в нашей иконке

// af_eye лежит в HQ-атласе в клетке (12,4), клетка 100 px
const GX = 12, GY = 4;

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

// Простое усреднение по блокам (как было раньше)
function boxDownscale(src, srcSize, dstSize) {
    const out = new Uint8Array(dstSize * dstSize * 4);
    for (let y = 0; y < dstSize; y++) {
        const y0 = Math.floor(y * srcSize / dstSize), y1 = Math.max(y0 + 1, Math.floor((y + 1) * srcSize / dstSize));
        for (let x = 0; x < dstSize; x++) {
            const x0 = Math.floor(x * srcSize / dstSize), x1 = Math.max(x0 + 1, Math.floor((x + 1) * srcSize / dstSize));
            for (let c = 0; c < 4; c++) {
                let s = 0, n = 0;
                for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) { s += src[(sy * srcSize + sx) * 4 + c]; n++; }
                out[(y * dstSize + x) * 4 + c] = Math.round(s / n);
            }
        }
    }
    return out;
}

// Собирает из значка маленький атлас и прогоняет через сжатие
function throughCompression(img, size, compress) {
    const W = 128, H = 64;
    const atlas = new Uint8Array(W * H * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const s = (y * size + x) * 4, d = (y * W + x) * 4;
            for (let c = 0; c < 4; c++) atlas[d + c] = img[s + c];
        }
    }
    if (!compress) return { rgba: atlas, width: W, height: H };
    const dds = encodeDXT5(atlas, W, H);
    const dec = decodeAuto(dds);
    return { rgba: dec.rgba, width: W, height: H };
}

const hq = decodeAuto(fs.readFileSync(HQ));
console.log(`HQ-атлас: ${hq.width}x${hq.height}`);
const src = crop(hq, GX * ART_SRC, GY * ART_SRC, ART_SRC, ART_SRC);

const variants = [];
variants.push({ label: 'A. усреднение + DXT5 (как было)', img: throughCompression(boxDownscale(src, ART_SRC, ART), ART, true) });
const lanc = sharpen(downscaleRGBA(src, ART_SRC, ART, 3), ART, 0.45);
variants.push({ label: 'B. Ланцош + резкость + DXT5', img: throughCompression(lanc, ART, true) });
variants.push({ label: 'C. Ланцош + резкость, БЕЗ сжатия', img: throughCompression(lanc, ART, false) });
variants.push({ label: 'D. исходник 100x100 (эталон)', img: null });

// Складываем сравнение в одну картинку: каждый вариант увеличен 8x,
// варианты идут в ряд с отступом.
const ZOOM = 8, PAD = 8;
const cellW = ART * ZOOM;
const totalW = PAD + variants.length * (cellW + PAD);
const totalH = PAD + cellW + PAD;
const canvas = new Uint8Array(totalW * totalH * 4);
// фон — средний серый, чтобы было видно и прозрачные области
for (let i = 0; i < totalW * totalH; i++) {
    canvas[i * 4] = 60; canvas[i * 4 + 1] = 60; canvas[i * 4 + 2] = 60; canvas[i * 4 + 3] = 255;
}

variants.forEach((v, idx) => {
    let img;
    if (v.img === null) {
        // эталон: исходник 100x100 уменьшен ровно до ART без сжатия
        img = { rgba: downscaleRGBA(src, ART_SRC, ART, 3), width: ART, height: ART };
    } else {
        // вырезаем нужный кусок из сжатого/несжатого буфера
        const cut = new Uint8Array(ART * ART * 4);
        for (let y = 0; y < ART; y++) {
            for (let x = 0; x < ART; x++) {
                const s = (y * v.img.width + x) * 4, d = (y * ART + x) * 4;
                for (let c = 0; c < 4; c++) cut[d + c] = v.img.rgba[s + c];
            }
        }
        img = { rgba: cut, width: ART, height: ART };
    }
    const up = upscale(img.rgba, ART, ART, ZOOM);
    const ox = PAD + idx * (cellW + PAD);
    for (let y = 0; y < up.height; y++) {
        for (let x = 0; x < up.width; x++) {
            const s = (y * up.width + x) * 4;
            const d = ((PAD + y) * totalW + ox + x) * 4;
            const a = up.rgba[s + 3] / 255;
            for (let c = 0; c < 3; c++) canvas[d + c] = Math.round(up.rgba[s + c] * a + canvas[d + c] * (1 - a));
            canvas[d + 3] = 255;
        }
    }
    console.log(`  ${v.label}`);
});

const out = path.join(os.tmpdir(), 'bq_artifact_quality.png');
fs.writeFileSync(out, encodePNG(canvas, totalW, totalH));
console.log(`\nСравнение (x${ZOOM}, слева направо A B C D): ${out}`);
