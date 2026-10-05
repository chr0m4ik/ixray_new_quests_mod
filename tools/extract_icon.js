// tools/extract_icon.js
// Инструмент для извлечения иконок предметов из атласа ui_anomaly_icons.dds
// (атлас взят из Stalker Anomaly, лежит в аддоне локально и в гит не коммитится).
//
// Зачем: картинки в атласе крупнее ячейки инвентаря 50x50, поэтому их нужно
// вырезать по точным границам и вписать в кадр. Логика движка IX-Ray:
//   область текстуры = (inv_grid_x * 50, inv_grid_y * 50) + (inv_grid_width * 50, inv_grid_height * 50)
// то есть при inv_grid_width = 1 берётся ровно 50x50 пикселей из левого верхнего угла.
//
// Использование (нужен Node.js, zlib и fs — встроенные):
//
//   1) Найти границы иконок рядом с нужной ячейкой:
//      node tools/extract_icon.js scan <атлас.dds> <окноX0> <окноY0> <окноX1> <окноY1>
//      Пример: node tools/extract_icon.js scan textures/ui/ui_anomaly_icons.dds 50 1350 250 1560
//
//   2) Вырезать найденную иконку в отдельный файл (PNG — для проверки глазами,
//      DDS — то, что кладём в игру):
//      node tools/extract_icon.js make <атлас.dds> <выход.png> <выход.dds> <x0> <y0> <x1> <y1>
//
// Результат (DDS) кладётся в textures/ui/<имя>.dds, а в секции предмета пишется:
//      icons_texture  = ui\<имя>
//      inv_grid_x     = 0
//      inv_grid_y     = 0
//      inv_grid_width = 1
//      inv_grid_height= 1

const fs = require("fs");
const zlib = require("zlib");

// ---------- чтение DXT5 ----------
function loadAtlas(path) {
    const b = fs.readFileSync(path);
    if (b.toString("ascii", 0, 4) !== "DDS ") throw new Error("это не DDS");
    const H = b.readUInt32LE(12), W = b.readUInt32LE(16);
    const fourCC = b.toString("ascii", 84, 88);
    if (fourCC !== "DXT5") throw new Error("поддерживается только DXT5, а тут " + fourCC);
    const bw = Math.ceil(W / 4), bh = Math.ceil(H / 4);
    const rgba = new Uint8Array(W * H * 4);
    let off = 128;
    const c565 = c => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        const a0 = b[off], a1 = b[off + 1];
        let acc = 0n;
        for (let i = 0; i < 6; i++) acc |= BigInt(b[off + 2 + i]) << BigInt(8 * i);
        const apal = [a0, a1];
        for (let i = 1; i <= 6; i++) apal.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        const c0 = b.readUInt16LE(off + 8), c1 = b.readUInt16LE(off + 10), cb = b.readUInt32LE(off + 12);
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
    return { W, H, rgba };
}

// ---------- поиск связных иконок в окне ----------
function scan(atlas, X0, Y0, X1, Y1) {
    const { W, rgba } = atlas;
    const CW = X1 - X0, CH = Y1 - Y0;
    const A = new Uint8Array(CW * CH);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        A[y * CW + x] = rgba[((Y0 + y) * W + (X0 + x)) * 4 + 3];
    }
    const seen = new Uint8Array(CW * CH);
    const comps = [];
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        if (seen[y * CW + x] || A[y * CW + x] <= 8) continue;
        const st = [[x, y]]; seen[y * CW + x] = 1;
        let minX = x, maxX = x, minY = y, maxY = y, n = 0;
        while (st.length) {
            const [cx, cy] = st.pop(); n++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
                if (seen[ny * CW + nx] || A[ny * CW + nx] <= 8) continue;
                seen[ny * CW + nx] = 1; st.push([nx, ny]);
            }
        }
        comps.push({ minX: minX + X0, maxX: maxX + X0, minY: minY + Y0, maxY: maxY + Y0, n });
    }
    comps.sort((a, b) => b.n - a.n);
    console.log("найдено компонент: " + comps.length);
    for (const c of comps) {
        const w = c.maxX - c.minX + 1, h = c.maxY - c.minY + 1;
        console.log("  x=" + c.minX + ".." + c.maxX + " y=" + c.minY + ".." + c.maxY +
            "  (" + w + "x" + h + ") пикселей=" + c.n +
            "  ячейка(" + Math.floor(c.minX / 50) + "," + Math.floor(c.minY / 50) + ")");
    }
}

// ---------- сборка иконки ----------
function make(atlas, outPng, outDds, RG) {
    const { W, rgba } = atlas;
    const iw = RG.x1 - RG.x0 + 1, ih = RG.y1 - RG.y0 + 1;
    const S = 50, OUT = 64;           // кадр 64x64 (степень двойки), движок берёт 50x50
    const scale = Math.min(S / iw, S / ih);
    const tw = Math.max(1, Math.round(iw * scale)), th = Math.max(1, Math.round(ih * scale));
    const ox = Math.floor((S - tw) / 2), oy = Math.floor((S - th) / 2);
    const img = new Uint8Array(OUT * OUT * 4);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
        const sx0 = RG.x0 + Math.floor(tx * iw / tw);
        const sx1 = RG.x0 + Math.max(Math.floor((tx + 1) * iw / tw), Math.floor(tx * iw / tw) + 1);
        const sy0 = RG.y0 + Math.floor(ty * ih / th);
        const sy1 = RG.y0 + Math.max(Math.floor((ty + 1) * ih / th), Math.floor(ty * ih / th) + 1);
        let r = 0, g = 0, bl = 0, a = 0, n = 0;
        for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
            const o = (sy * W + sx) * 4, pa = rgba[o + 3];
            r += rgba[o] * pa; g += rgba[o + 1] * pa; bl += rgba[o + 2] * pa; a += pa; n++;
        }
        const o = ((oy + ty) * OUT + (ox + tx)) * 4;
        if (a > 0) { img[o] = (r / a) | 0; img[o + 1] = (g / a) | 0; img[o + 2] = (bl / a) | 0; }
        img[o + 3] = n ? Math.round(a / n) : 0;
    }
    let mx = 0;
    for (let i = 3; i < img.length; i += 4) if (img[i] > mx) mx = img[i];
    if (mx > 0 && mx < 255) { const k = 255 / mx; for (let i = 3; i < img.length; i += 4) img[i] = Math.min(255, Math.round(img[i] * k)); }
    for (let i = 3; i < img.length; i += 4) if (img[i] < 12) img[i] = 0;
    console.log("исходная область " + iw + "x" + ih + " -> вписано " + tw + "x" + th + ", смещение (" + ox + "," + oy + ")");

    // PNG (только для визуальной проверки)
    const raw = Buffer.alloc((OUT * 4 + 1) * OUT);
    for (let y = 0; y < OUT; y++) {
        raw[y * (OUT * 4 + 1)] = 0;
        Buffer.from(img.buffer, img.byteOffset + y * OUT * 4, OUT * 4).copy(raw, y * (OUT * 4 + 1) + 1);
    }
    const crcT = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = buf => { let c = 0xFFFFFFFF; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const t = Buffer.from(type, "ascii");
        const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(Buffer.concat([t, data])));
        return Buffer.concat([len, t, data, cr]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(OUT, 0); ihdr.writeUInt32BE(OUT, 4); ihdr[8] = 8; ihdr[9] = 6;
    fs.writeFileSync(outPng, Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));

    // DXT5
    const p565 = (r, g, bl) => (((r * 31 / 255 + 0.5) | 0) << 11 | ((g * 63 / 255 + 0.5) | 0) << 5 | ((bl * 31 / 255 + 0.5) | 0));
    const u565 = c => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
    const blocks = [];
    for (let by = 0; by < OUT / 4; by++) for (let bx = 0; bx < OUT / 4; bx++) {
        const P = [];
        for (let i = 0; i < 16; i++) {
            const o = ((by * 4 + Math.floor(i / 4)) * OUT + (bx * 4 + (i % 4))) * 4;
            P.push([img[o], img[o + 1], img[o + 2], img[o + 3]]);
        }
        let ma = 0, mi = 255;
        for (const p of P) { ma = Math.max(ma, p[3]); mi = Math.min(mi, p[3]); }
        let a0 = ma, a1 = mi;
        if (a0 === a1) { if (a0 < 255) a0 = Math.min(255, a0 + 1); else a1 = 0; }
        const ap = [a0, a1];
        for (let i = 1; i <= 6; i++) ap.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        let acc = 0n;
        for (let i = 0; i < 16; i++) {
            let bs = 0, bd = 1e9;
            for (let k = 0; k < 8; k++) { const d = Math.abs(ap[k] - P[i][3]); if (d < bd) { bd = d; bs = k; } }
            acc |= BigInt(bs) << BigInt(3 * i);
        }
        const ab = Buffer.alloc(8); ab[0] = a0; ab[1] = a1;
        for (let i = 0; i < 6; i++) ab[2 + i] = Number((acc >> BigInt(8 * i)) & 0xFFn);
        const op = P.filter(p => p[3] > 0);
        let e0, e1;
        if (!op.length) { e0 = 0; e1 = 0; }
        else {
            const L = p => p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114;
            let lo = op[0], hi = op[0];
            for (const p of op) { if (L(p) < L(lo)) lo = p; if (L(p) > L(hi)) hi = p; }
            e0 = p565(hi[0], hi[1], hi[2]); e1 = p565(lo[0], lo[1], lo[2]);
            if (e0 < e1) { const t = e0; e0 = e1; e1 = t; }
            if (e0 === e1) e1 = Math.max(0, e0 - 1);
        }
        const E0 = u565(e0), E1 = u565(e1);
        const cp = [E0, E1,
            [(2 * E0[0] + E1[0]) / 3, (2 * E0[1] + E1[1]) / 3, (2 * E0[2] + E1[2]) / 3],
            [(E0[0] + 2 * E1[0]) / 3, (E0[1] + 2 * E1[1]) / 3, (E0[2] + 2 * E1[2]) / 3]];
        let cb = 0;
        for (let i = 0; i < 16; i++) {
            let bs = 0, bd = 1e9;
            for (let k = 0; k < 4; k++) {
                const d = (cp[k][0] - P[i][0]) ** 2 + (cp[k][1] - P[i][1]) ** 2 + (cp[k][2] - P[i][2]) ** 2;
                if (d < bd) { bd = d; bs = k; }
            }
            cb |= bs << (2 * i);
        }
        const blk = Buffer.alloc(16); ab.copy(blk, 0);
        blk.writeUInt16LE(e0, 8); blk.writeUInt16LE(e1, 10); blk.writeUInt32LE(cb >>> 0, 12);
        blocks.push(blk);
    }
    const data = Buffer.concat(blocks), hdr = Buffer.alloc(128);
    hdr.write("DDS ", 0, "ascii"); hdr.writeUInt32LE(124, 4);
    hdr.writeUInt32LE(0x1007 | 0x80000, 8);
    hdr.writeUInt32LE(OUT, 12); hdr.writeUInt32LE(OUT, 16); hdr.writeUInt32LE(data.length, 20);
    hdr.writeUInt32LE(1, 28); hdr.writeUInt32LE(32, 76); hdr.writeUInt32LE(0x4, 80);
    hdr.write("DXT5", 84, "ascii"); hdr.writeUInt32LE(0x1000, 108);
    fs.writeFileSync(outDds, Buffer.concat([hdr, data]));
    console.log("PNG превью: " + outPng);
    console.log("DDS: " + outDds + " (" + (128 + data.length) + " байт)");
}

// ---------- точка входа ----------
const mode = process.argv[2];
if (mode === "scan") {
    scan(loadAtlas(process.argv[3]), +process.argv[4], +process.argv[5], +process.argv[6], +process.argv[7]);
} else if (mode === "make") {
    make(loadAtlas(process.argv[3]), process.argv[4], process.argv[5],
        { x0: +process.argv[6], y0: +process.argv[7], x1: +process.argv[8], y1: +process.argv[9] });
} else {
    console.log("Использование:");
    console.log("  node tools/extract_icon.js scan <атлас.dds> <X0> <Y0> <X1> <Y1>");
    console.log("  node tools/extract_icon.js make <атлас.dds> <выход.png> <выход.dds> <x0> <y0> <x1> <y1>");
}
