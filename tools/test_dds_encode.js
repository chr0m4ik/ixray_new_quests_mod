// tools/test_dds_encode.js — проверка кодировщика DXT5 на реальных иконках.
//
// Кодируем -> декодируем -> сравниваем с оригиналом. Если средняя ошибка на
// канал мала (иконки не «плывут»), кодировщик годится для генератора.
//
// ВАЖНО: кодировать надо ЦЕЛЫЙ атлас (256x128), а не отдельные клетки 50x50 —
// DXT5 работает блоками 4x4, и сторона 50 не кратна 4. Атлас 256x128 кратен,
// поэтому проблем нет.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { decodeDXT5, decodeAuto } = require('./dds.js');
const { encodeDXT5 } = require('./dds_encode.js');

const CONTAINER_ATLAS = path.join(ROOT, 'textures', 'ui', 'ui_bq_field_container.dds');
const HQ_ATLAS = path.join('Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\ixr_addons',
    'ixray-hq-icons-v2.0', 'textures', 'ui', 'ui_icon_equipment_hd.dds');

const CELL = 50;          // клетка иконки в атласе
const ART = 24;           // размер уменьшенного артефакта (кратен 4 — требование DXT5)

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

// Уменьшение с усреднением: srcSize -> dstSize (любое соотношение).
function downscale(src, srcSize, dstSize) {
    const out = new Uint8Array(dstSize * dstSize * 4);
    for (let y = 0; y < dstSize; y++) {
        const y0 = Math.floor(y * srcSize / dstSize);
        const y1 = Math.max(y0 + 1, Math.floor((y + 1) * srcSize / dstSize));
        for (let x = 0; x < dstSize; x++) {
            const x0 = Math.floor(x * srcSize / dstSize);
            const x1 = Math.max(x0 + 1, Math.floor((x + 1) * srcSize / dstSize));
            for (let c = 0; c < 4; c++) {
                let s = 0, n = 0;
                for (let sy = y0; sy < y1; sy++) {
                    for (let sx = x0; sx < x1; sx++) { s += src[(sy * srcSize + sx) * 4 + c]; n++; }
                }
                out[(y * dstSize + x) * 4 + c] = Math.round(s / n);
            }
        }
    }
    return out;
}

// Накладывает картинку (с альфой) в атлас в позицию клетки (gx,gy).
function blit(atlas, atlasW, img, w, h, px, py) {
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = ((py + y) * atlasW + (px + x)) * 4;
            const i = (y * w + x) * 4;
            const a = img[i + 3] / 255;
            if (a <= 0) continue;
            for (let c = 0; c < 3; c++) {
                atlas[o + c] = Math.round(img[i + c] * a + atlas[o + c] * (1 - a));
            }
            atlas[o + 3] = Math.max(atlas[o + 3], img[i + 3]);
        }
    }
}

function compare(a, b) {
    let sum = 0, max = 0;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        sum += d;
        if (d > max) max = d;
    }
    return { mean: sum / a.length, max };
}

let fails = 0;
function testAtlas(label, rgba, w, h) {
    const enc = encodeDXT5(rgba, w, h);
    const dec = decodeDXT5(enc);
    if (dec.width !== w || dec.height !== h) {
        console.error(`FAIL ${label}: после круга ${dec.width}x${dec.height}, ожидалось ${w}x${h}`);
        fails++;
        return;
    }
    const c = compare(rgba, dec.rgba);
    const good = c.mean < 6 && c.max < 120;
    if (!good) fails++;
    console.log(`  ${good ? 'ok' : 'ПЛОХО'}: ${label} — средняя ошибка ${c.mean.toFixed(2)}, ` +
        `максимальная ${c.max}, размер ${(enc.length / 1024).toFixed(1)} КБ`);
}

// ---- 1. Оригинальный атлас контейнеров: круг целиком ----
const cont = decodeDXT5(fs.readFileSync(CONTAINER_ATLAS));
console.log(`Атлас контейнеров: ${cont.width}x${cont.height}`);
testAtlas('наш атлас как есть', cont.rgba, cont.width, cont.height);

// ---- 2. Собранный атлас: пустые + 4 заполненных строки ----
const ATLAS_W = 256, ATLAS_H = 256;   // 5 столбцов, 5 строк по 50 px (с запасом)
const atlas = new Uint8Array(ATLAS_W * ATLAS_H * 4);
// пустые контейнеры в строке 0
for (let gx = 0; gx < 3; gx++) {
    const cell = crop(cont, gx * CELL, 0, CELL, CELL);
    blit(atlas, ATLAS_W, cell, CELL, CELL, gx * CELL, 0);
}

// ---- 3. Артефакты из HQ-атласа (100x100) уменьшаем до 24x24 ----
if (fs.existsSync(HQ_ATLAS)) {
    const hq = decodeAuto(fs.readFileSync(HQ_ATLAS));
    console.log(`HQ-атлас: ${hq.width}x${hq.height}, иконка артефакта 100x100`);
    // af_eye лежит в (0,0) — берём как образец
    const art = crop(hq, 0, 0, 100, 100);
    const small = downscale(art, 100, ART);
    for (let row = 1; row <= 4; row++) {
        for (let gx = 0; gx < 3; gx++) {
            const cell = crop(cont, gx * CELL, 0, CELL, CELL);
            const offX = (CELL - ART) - 1;      // правый нижний угол, отступ 1 px
            const offY = (CELL - ART) - 1;
            blit(cell, CELL, small, ART, ART, offX, offY);
            blit(atlas, ATLAS_W, cell, CELL, CELL, gx * CELL, row * CELL);
        }
    }
} else {
    console.log('  HQ-атлас не найден');
}
testAtlas(`собранный атлас ${ATLAS_W}x${ATLAS_H} (пустые + заполненные)`, atlas, ATLAS_W, ATLAS_H);

// Средняя ошибка именно в зоне артефакта (там мелкие детали — самое уязвимое место)
{
    const enc = encodeDXT5(atlas, ATLAS_W, ATLAS_H);
    const dec = decodeDXT5(enc);
    let sum = 0, n = 0;
    const offX = (CELL - ART) - 1, offY = (CELL - ART) - 1;
    for (let row = 1; row <= 4; row++) {
        for (let gx = 0; gx < 3; gx++) {
            for (let y = 0; y < ART; y++) {
                for (let x = 0; x < ART; x++) {
                    const o = ((row * CELL + offY + y) * ATLAS_W + gx * CELL + offX + x) * 4;
                    for (let c = 0; c < 4; c++) { sum += Math.abs(atlas[o + c] - dec.rgba[o + c]); n++; }
                }
            }
        }
    }
    console.log(`  ошибка в зоне артефакта: средняя ${(sum / n).toFixed(2)} (мелкие детали — самое уязвимое место)`);
}

console.log(fails === 0 ? '\nOK: кодировщик DXT5 пригоден для генератора.'
    : `\nFAIL: проблемных изображений ${fails}`);
process.exit(fails === 0 ? 0 : 1);
