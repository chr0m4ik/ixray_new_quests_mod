// tools/png.js — минимальный экспорт RGBA в PNG (только для визуальной проверки).
//
// Зачем: сгенерированные иконки надо посмотреть глазами. В Node нет встроенного
// кодировщика PNG, но есть zlib, а PNG несжатого типа собирается вручную:
// сигнатура + IHDR + IDAT (строки с фильтром 0) + IEND.
'use strict';
const zlib = require('zlib');

function crc32(buf) {
    let c, crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c = (crc ^ buf[i]) & 0xFF;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

// rgba: Uint8Array длиной w*h*4
function encodePNG(rgba, w, h) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;      // бит на канал
    ihdr[9] = 6;      // тип цвета: RGBA
    ihdr[10] = 0;     // сжатие
    ihdr[11] = 0;     // фильтрация
    ihdr[12] = 0;     // без интерлейса

    const stride = w * 4;
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (stride + 1)] = 0;    // фильтр None
        Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
            .copy(raw, y * (stride + 1) + 1);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// Увеличение картинки целым множителем (чтобы мелкие иконки было видно).
function upscale(rgba, w, h, factor) {
    const W = w * factor, H = h * factor;
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const s = (Math.floor(y / factor) * w + Math.floor(x / factor)) * 4;
            const d = (y * W + x) * 4;
            out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
        }
    }
    return { rgba: out, width: W, height: H };
}

module.exports = { encodePNG, upscale };
