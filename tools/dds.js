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
    // FourCC читаем как 4 байта и оставляем только печатные символы: у несжатых
    // текстур (A8R8G8B8) там нули, а обрезка строки по первому нулю даёт пустоту,
    // из-за чего формат не опознавался.
    const fourCC = buf.toString('latin1', 84, 88).replace(/[^\x20-\x7E]/g, '');
    const expected = fourCC === 'DXT5' ? 128 + (width / 4) * (height / 4) * 16
        : fourCC === 'DXT3' ? 128 + (width / 4) * (height / 4) * 16
            : fourCC === 'DXT1' ? 128 + (width / 4) * (height / 4) * 8
                : fourCC === '' ? 128 + width * height * 4
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

// Декодирует DXT1/BC1 в RGBA.
//
// Нужен, потому что атлас HD-иконок (ixray-hq-icons-v2.0) лежит именно в DXT1.
// У DXT1 альфа не отдельная, а однобитная: если c0 <= c1, то индекс 3 означает
// полностью прозрачный пиксель. Для иконок это важно — иначе вырезка фона
// превратится в чёрный квадрат.
function decodeDXT1(buf) {
    const hdr = readHeader(buf);
    if (hdr.fourCC !== 'DXT1') throw new Error('ожидался DXT1, а тут "' + hdr.fourCC + '"');
    const W = hdr.width, H = hdr.height;
    const rgba = new Uint8Array(W * H * 4);
    let off = 128;
    const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
    for (let by = 0; by < Math.ceil(H / 4); by++) {
        for (let bx = 0; bx < Math.ceil(W / 4); bx++) {
            const c0 = buf.readUInt16LE(off), c1 = buf.readUInt16LE(off + 2), cb = buf.readUInt32LE(off + 4);
            const e0 = c565(c0), e1 = c565(c1);
            let cpal, apal;
            if (c0 > c1) {
                cpal = [e0, e1,
                    [(2 * e0[0] + e1[0]) / 3, (2 * e0[1] + e1[1]) / 3, (2 * e0[2] + e1[2]) / 3],
                    [(e0[0] + 2 * e1[0]) / 3, (e0[1] + 2 * e1[1]) / 3, (e0[2] + 2 * e1[2]) / 3]];
                apal = [255, 255, 255, 255];
            } else {
                cpal = [e0, e1,
                    [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2, (e0[2] + e1[2]) / 2],
                    [0, 0, 0]];
                apal = [255, 255, 255, 0];      // индекс 3 — прозрачный
            }
            for (let i = 0; i < 16; i++) {
                const x = bx * 4 + (i % 4), y = by * 4 + Math.floor(i / 4);
                if (x >= W || y >= H) continue;
                const idx = (cb >> (2 * i)) & 3;
                const c = cpal[idx];
                const o = (y * W + x) * 4;
                rgba[o] = c[0] | 0; rgba[o + 1] = c[1] | 0; rgba[o + 2] = c[2] | 0; rgba[o + 3] = apal[idx];
            }
            off += 8;
        }
    }
    return { width: W, height: H, rgba };
}

// Декодирует DXT3/BC2 в RGBA.
//
// Нужен для атласа боковых панелей Anomaly (ui_actor_widescreen_sidepanels.dds
// лежит в DXT3). Отличие от DXT5: альфа не интерполируется, а лежит явно, по
// 4 бита на пиксель (8 байт на блок), цвета считаются всегда по 4-цветной
// палитре (как в DXT1 при c0 > c1).
function decodeDXT3(buf) {
    const hdr = readHeader(buf);
    if (hdr.fourCC !== 'DXT3') throw new Error('ожидался DXT3, а тут "' + hdr.fourCC + '"');
    const W = hdr.width, H = hdr.height;
    const rgba = new Uint8Array(W * H * 4);
    let off = 128;
    const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
    for (let by = 0; by < Math.ceil(H / 4); by++) {
        for (let bx = 0; bx < Math.ceil(W / 4); bx++) {
            // сначала 8 байт альфы: по 4 бита на пиксель
            const alpha = new Uint8Array(16);
            for (let i = 0; i < 8; i++) {
                const b = buf[off + i];
                alpha[i * 2] = (b & 0x0f) * 17;
                alpha[i * 2 + 1] = ((b >> 4) & 0x0f) * 17;
            }
            const c0 = buf.readUInt16LE(off + 8), c1 = buf.readUInt16LE(off + 10);
            const cb = buf.readUInt32LE(off + 12);
            const e0 = c565(c0), e1 = c565(c1);
            const cpal = [e0, e1,
                [(2 * e0[0] + e1[0]) / 3, (2 * e0[1] + e1[1]) / 3, (2 * e0[2] + e1[2]) / 3],
                [(e0[0] + 2 * e1[0]) / 3, (e0[1] + 2 * e1[1]) / 3, (e0[2] + 2 * e1[2]) / 3]];
            for (let i = 0; i < 16; i++) {
                const x = bx * 4 + (i % 4), y = by * 4 + Math.floor(i / 4);
                if (x >= W || y >= H) continue;
                const c = cpal[(cb >> (2 * i)) & 3];
                const o = (y * W + x) * 4;
                rgba[o] = c[0] | 0; rgba[o + 1] = c[1] | 0; rgba[o + 2] = c[2] | 0;
                rgba[o + 3] = alpha[i];
            }
            off += 16;
        }
    }
    return { width: W, height: H, rgba };
}

// Декодирует несжатый DDS (A8R8G8B8, он же BGRA с альфой).
//
// Нужен, потому что атлас HD-иконок в этой сборке НЕ сжат: dwFourCC пустой,
// dwRGBBitCount = 32, маски R=0x00FF0000, G=0x0000FF00, B=0x000000FF,
// A=0xFF000000 (проверено на ui_icon_equipment_hd.dds, 2048x4096). Это значит,
// что иконки артефактов можно брать без потерь от сжатия.
function decodeA8R8G8B8(buf) {
    const hdr = readHeader(buf);
    if (hdr.fourCC !== '' && hdr.fourCC !== '    ') {
        throw new Error('это не несжатый формат (FourCC "' + hdr.fourCC + '")');
    }
    const W = hdr.width, H = hdr.height;
    const bpp = buf.readUInt32LE(88);
    if (bpp !== 32) throw new Error('ожидалось 32 бита на пиксель, а тут ' + bpp);
    const rgba = new Uint8Array(W * H * 4);
    let off = 128;
    for (let i = 0; i < W * H; i++) {
        // в файле порядок BGRA
        rgba[i * 4] = buf[off + 2];
        rgba[i * 4 + 1] = buf[off + 1];
        rgba[i * 4 + 2] = buf[off];
        rgba[i * 4 + 3] = buf[off + 3];
        off += 4;
    }
    return { width: W, height: H, rgba };
}

// Декодирует DDS в RGBA, сам определяя формат.
function decodeAuto(buf) {
    const hdr = readHeader(buf);
    if (hdr.fourCC === 'DXT5') return decodeDXT5(buf);
    if (hdr.fourCC === 'DXT3') return decodeDXT3(buf);
    if (hdr.fourCC === 'DXT1') return decodeDXT1(buf);
    if (hdr.fourCC === '' || hdr.fourCC === '    ') return decodeA8R8G8B8(buf);
    throw new Error('поддерживаются DXT1, DXT3, DXT5 и A8R8G8B8, а тут "' + hdr.fourCC + '"');
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

module.exports = { readHeader, decodeDXT5, decodeDXT3, decodeDXT1, decodeA8R8G8B8, decodeAuto, countOpaqueInCell, findTexture };
