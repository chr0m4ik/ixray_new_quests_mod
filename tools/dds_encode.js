// tools/dds_encode.js — запись DDS (DXT5/BC3) для сгенерированных иконок.
//
// Зачем: иконки заполненных контейнеров рисуются заранее (контейнер на всю
// клетку + уменьшенный артефакт поверх). Готовую картинку надо сохранить в
// формат, который понимает движок.
//
// Формат (MEMO 15.4): DXT5/BC3, размеры кратны 4, БЕЗ мипмапов.
// DXT5 обязателен, потому что иконкам нужна альфа для вырезки.
//
// Кодировщик намеренно простой: диапазон альфы и цвета считаются по блоку
// 4x4. Для UI-иконок этого достаточно, а сложные варианты (кластеризация,
// подбор палитры) нам не нужны.
'use strict';

const DDS_HEADER_SIZE = 128;

// ---------- вспомогательное: выбрать две крайние точки в блоке ----------
// Для альфы: возвращает 8 индексов и две опорные величины (a0 > a1).
function encodeAlphaBlock(rgba, width, bx, by) {
    const a = [];
    for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4), y = by * 4 + Math.floor(i / 4);
        a.push(rgba[(y * width + x) * 4 + 3]);
    }
    let min = 255, max = 0;
    for (const v of a) { if (v < min) min = v; if (v > max) max = v; }

    // 8-уровневая палитра: a0, a1 и шесть промежуточных (как в BC3)
    let a0 = max, a1 = min;
    const pal = [a0, a1];
    for (let i = 1; i <= 6; i++) pal.push(Math.round(((7 - i) * a0 + i * a1) / 7));

    let bits = 0n;
    for (let i = 0; i < 16; i++) {
        let best = 0, bestd = Infinity;
        for (let j = 0; j < 8; j++) {
            const d = Math.abs(pal[j] - a[i]);
            if (d < bestd) { bestd = d; best = j; }
        }
        bits |= BigInt(best) << BigInt(3 * i);
    }
    const out = Buffer.alloc(8);
    out[0] = a0; out[1] = a1;
    for (let i = 0; i < 6; i++) out[2 + i] = Number((bits >> BigInt(8 * i)) & 0xffn);
    return out;
}

// Для цвета: подбираем две опорные точки (RGB565) по крайним яркостям.
function encodeColorBlock(rgba, width, bx, by) {
    const px = [];
    for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4), y = by * 4 + Math.floor(i / 4);
        const o = (y * width + x) * 4;
        px.push([rgba[o], rgba[o + 1], rgba[o + 2]]);
    }
    // крайние по «яркости» пиксели дают лучшие опорные цвета
    const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    let lo = 0, hi = 0;
    for (let i = 1; i < 16; i++) {
        if (lum(px[i]) < lum(px[lo])) lo = i;
        if (lum(px[i]) > lum(px[hi])) hi = i;
    }
    const to565 = (c) => ((c[0] >> 3) << 11) | ((c[1] >> 2) << 5) | (c[2] >> 3);
    const from565 = (v) => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];

    let c0 = to565(px[hi]), c1 = to565(px[lo]);
    if (c0 === c1) c1 = c0 > 0 ? c0 - 1 : 1;         // опорные должны различаться
    if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }  // в BC3 c0 > c1 для 4-цветного режима

    const e0 = from565(c0), e1 = from565(c1);
    const pal = [e0, e1,
        [(2 * e0[0] + e1[0]) / 3, (2 * e0[1] + e1[1]) / 3, (2 * e0[2] + e1[2]) / 3],
        [(e0[0] + 2 * e1[0]) / 3, (e0[1] + 2 * e1[1]) / 3, (e0[2] + 2 * e1[2]) / 3]];

    let bits = 0;
    for (let i = 0; i < 16; i++) {
        let best = 0, bestd = Infinity;
        for (let j = 0; j < 4; j++) {
            const d = (pal[j][0] - px[i][0]) ** 2 + (pal[j][1] - px[i][1]) ** 2 + (pal[j][2] - px[i][2]) ** 2;
            if (d < bestd) { bestd = d; best = j; }
        }
        bits |= best << (2 * i);
    }
    const out = Buffer.alloc(8);
    out.writeUInt16LE(c0, 0);
    out.writeUInt16LE(c1, 2);
    out.writeUInt32LE(bits >>> 0, 4);
    return out;
}

// ---------- собрать DDS-файл из RGBA ----------
function encodeDXT5(rgba, width, height) {
    if (width % 4 || height % 4) {
        throw new Error(`размеры должны быть кратны 4 (DXT5 кодирует блоками 4x4), а тут ${width}x${height}`);
    }
    const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
    const data = Buffer.alloc(bw * bh * 16);
    let off = 0;
    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            encodeAlphaBlock(rgba, width, bx, by).copy(data, off);
            encodeColorBlock(rgba, width, bx, by).copy(data, off + 8);
            off += 16;
        }
    }
    const header = Buffer.alloc(DDS_HEADER_SIZE);
    header.write('DDS ', 0, 'ascii');
    header.writeUInt32LE(124, 4);                  // dwSize
    header.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8); // CAPS|HEIGHT|WIDTH|PIXELFORMAT|LINEARSIZE
    header.writeUInt32LE(height, 12);
    header.writeUInt32LE(width, 16);
    header.writeUInt32LE(bw * bh * 16, 20);        // dwPitchOrLinearSize
    header.writeUInt32LE(0, 24);                   // dwDepth
    header.writeUInt32LE(0, 28);                   // dwMipMapCount = 0 (мипмапы не нужны)
    header.writeUInt32LE(32, 76);                  // ddspf.dwSize
    header.writeUInt32LE(0x4, 80);                 // DDPF_FOURCC
    header.write('DXT5', 84, 'ascii');
    header.writeUInt32LE(0x1000, 108);             // dwCaps = TEXTURE
    return Buffer.concat([header, data]);
}

module.exports = { encodeDXT5 };
