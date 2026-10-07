// tools/atlas_cells.js — показать, что лежит в атласе иконок.
//
// Атлас нарезается движком так: область = (inv_grid_x * 50, inv_grid_y * 50)
// размером (inv_grid_width * 50, inv_grid_height * 50). Поэтому здесь мы режем
// файл на ячейки 50x50 и сохраняем каждую в PNG, чтобы проверить картинки
// глазами (PNG рисует любой просмотрщик, DDS - нет).
//
// Запуск: node tools/atlas_cells.js <атлас.dds> <папка-вывода> [размер ячейки]
// Поддерживается DXT5/BC3 (как требует движок для иконок с прозрачностью).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const file = process.argv[2];
const outDir = process.argv[3];
const cell = parseInt(process.argv[4] || '50', 10);
if (!file || !outDir) {
    console.error('usage: node tools/atlas_cells.js <atlas.dds> <outDir> [cellSize]');
    process.exit(2);
}

// ---------------- чтение DXT5 ----------------
function decodeDXT5(buf) {
    if (buf.toString('ascii', 0, 4) !== 'DDS ') throw new Error('не DDS');
    const H = buf.readUInt32LE(12), W = buf.readUInt32LE(16);
    const fourCC = buf.toString('ascii', 84, 88);
    if (fourCC !== 'DXT5') throw new Error('поддерживается только DXT5, а тут "' + fourCC + '"');
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
    return { W, H, rgba };
}

// ---------------- запись PNG ----------------
function writePNG(filePath, W, H, rgba) {
    const raw = Buffer.alloc((W * 4 + 1) * H);
    for (let y = 0; y < H; y++) {
        raw[y * (W * 4 + 1)] = 0;                       // фильтр None
        Buffer.from(rgba.buffer, rgba.byteOffset + y * W * 4, W * 4)
            .copy(raw, y * (W * 4 + 1) + 1);
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 бит, RGBA
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
    fs.writeFileSync(filePath, png);
}

let crcTable = null;
function crc32(buf) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c;
        }
    }
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return c ^ -1;
}

// ---------------- нарезка ----------------
const { W, H, rgba } = decodeDXT5(fs.readFileSync(file));
console.log(`атлас: ${W}x${H}, ячейка ${cell}x${cell}, колонок ${Math.floor(W / cell)}, строк ${Math.floor(H / cell)}`);
fs.mkdirSync(outDir, { recursive: true });

for (let gy = 0; gy < Math.floor(H / cell); gy++) {
    for (let gx = 0; gx < Math.floor(W / cell); gx++) {
        const tile = new Uint8Array(cell * cell * 4);
        let opaque = 0;
        for (let y = 0; y < cell; y++) {
            for (let x = 0; x < cell; x++) {
                const s = ((gy * cell + y) * W + (gx * cell + x)) * 4;
                const d = (y * cell + x) * 4;
                tile[d] = rgba[s]; tile[d + 1] = rgba[s + 1]; tile[d + 2] = rgba[s + 2]; tile[d + 3] = rgba[s + 3];
                if (rgba[s + 3] > 8) opaque++;
            }
        }
        const name = `cell_${gx}_${gy}.png`;
        writePNG(path.join(outDir, name), cell, cell, tile);
        console.log(`  (${gx},${gy}) -> ${name}  непрозрачных пикселей: ${opaque}/${cell * cell}`);
    }
}
