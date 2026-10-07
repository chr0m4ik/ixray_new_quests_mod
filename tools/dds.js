// tools/dds.js — разбор DDS-текстур (общий модуль для инструментов).
//
// Зачем: иконки в этой сборке обязаны быть DXT5/BC3 (нужна альфа для вырезки
// иконки), размеры — степень двойки и кратны 4, мипмапы выключены (MEMO 15.4).
// Проверять это глазами бессмысленно, поэтому разбираем заголовок и данные.
'use strict';
const fs = require('fs');

// Читает заголовок DDS и возвращает параметры. Бросает при грубых ошибках.
function readHeader(buf) {
    if (buf.length < 128) throw new Error('файл короче заголовка DDS (128 байт)');
    if (buf.toString('ascii', 0, 4) !== 'DDS ') throw new Error('это не DDS');
    const height = buf.readUInt32LE(12);
    const width = buf.readUInt32LE(16);
    const mipMaps = buf.readUInt32LE(28);
    const fourCC = buf.toString('ascii', 84, 88);
    const expected = fourCC === 'DXT5' ? 128 + (width / 4) * (height / 4) * 16
        : fourCC === 'DXT1' ? 128 + (width / 4) * (height / 4) * 8
            : null;
    return { width, height, fourCC, mipMaps, expected, actual: buf.length };
}

// Декодирует DXT5/BC3 в RGBA (по одному цвету на пиксель).
function decodeDXT5(buf) {
    const hdr = readHeader(buf);
    if (hdr.fourCC !== 'DXT5') throw new Error('поддерживается только DXT5, а тут "' + hdr.fourCC + '"');
    const W = hdr.width, H = hdr.height;
    const rgba = new Uint8Array(W * H * 4);
    let off = 128;
    const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
    for (let by = 0; by < Math.ceil(H / 4); by++) {
        for (let bx = 0; bx < Math.ceil(W / 4); bx++) {
            const a0 = buf[off], a1 = buf[off + 1];
            let acc = 0n;
            for (let i = 0; i < 6; i++) acc |= BigInt(buf[off + 2 + i]) << BigInt(8 * i);
            const apal = [a0, a1];
            for (let i = 1; i <= 6; i++) apal.push(Math.round(((7 - i) * a0 + i * a1) / 7));
            const c0 = buf.readUInt16LE(off + 8), c1 = buf.readUInt16LE(off + 10), cb = buf.readUInt32LE(off + 12);
            const e0 = c565(c0), e1 = c565(c1);
            const cpal = [e0, e1,
                [(2 * e0[0] + e1[0]) / 3, (2 * e0[1] + e1[1]) / 3, (2 * e0[2] + e1[2]) / 3],
                [(e0[0] + 2 * e1[0]) / 3, (e0[1] + 2 * e1[1]) / 3, (e0[2] + 2 * e1[2]) / 3]];
            for (let i = 0; i < 16; i++) {
                const x = bx * 4 + (i % 4), y = by * 4 + Math.floor(i / 4);
                if (x >= W || y >= H) continue;
                const a = apal[Number((acc >> BigInt(3 * i)) & 7n)];
                const c = cpal[(cb >> (2 * i)) & 3];
                const o = (y * W + x) * 4;
                rgba[o] = c[0] | 0; rgba[o + 1] = c[1] | 0; rgba[o + 2] = c[2] | 0; rgba[o + 3] = a;
            }
            off += 16;
        }
    }
    return { width: W, height: H, rgba };
}

// Сколько пикселей в ячейке (x,y) размером cell x cell реально непрозрачны.
function countOpaqueInCell(decoded, gx, gy, cell) {
    let opaque = 0, total = 0;
    for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
            const px = gx * cell + x, py = gy * cell + y;
            if (px >= decoded.width || py >= decoded.height) continue;
            total++;
            if (decoded.rgba[(py * decoded.width + px) * 4 + 3] > 8) opaque++;
        }
    }
    return { opaque, total };
}

// Ищет текстуру по логическому имени (ui\имя) в доступных каталогах игры.
function findTexture(logicalName, roots) {
    const rel = logicalName.replace(/\\/g, '/') + '.dds';
    for (const root of roots) {
        const p = root.replace(/\\/g, '/') + '/' + rel;
        if (fs.existsSync(p)) return p;
    }
    return null;
}

module.exports = { readHeader, decodeDXT5, countOpaqueInCell, findTexture };
