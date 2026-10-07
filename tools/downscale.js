// tools/downscale.js — качественное уменьшение картинок для генератора иконок.
//
// ПОЧЕМУ НЕ ПРОСТОЕ УСРЕДНЕНИЕ
//   Значок артефакта уменьшается со 100 px до 24 px, и движок рисует его
//   ПИКСЕЛЬ В ПИКСЕЛЬ (источник 24 px кладётся в прямоугольник 24 px).
//   Значит всё, что потеряно при уменьшении, видно на экране напрямую:
//   простое усреднение по блокам даёт мыло и ступеньки.
//
//   Поэтому считаем честный фильтр (Ланцоша по умолчанию) с правильными
//   весами и обрезкой на краях, а не среднее по прямоугольнику.
'use strict';

// Вес фильтра Ланцоша порядка a.
function lanczos(x, a) {
    if (x === 0) return 1;
    if (x < 0) x = -x;
    if (x >= a) return 0;
    const px = Math.PI * x;
    return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

// Уменьшение RGBA-картинки srcW x srcH до dstW x dstH.
// a — порядок фильтра (2 или 3); a=1 даёт почти линейный фильтр (мягче).
//
// Работает с НЕквадратными картинками: это нужно, потому что значок артефакта
// сначала обрезается по границам содержимого, а такие границы почти всегда
// не квадрат (например 66x100).
function downscaleRGBA(src, srcW, dstW, a = 3, srcH = srcW, dstH = dstW) {
    if (srcH === undefined) srcH = srcW;
    if (dstH === undefined) dstH = dstW;
    const scaleX = dstW / srcW, scaleY = dstH / srcH;
    const supportX = a / scaleX, supportY = a / scaleY;
    const tmp = new Float32Array(dstW * srcH * 4);
    const out = new Uint8Array(dstW * dstH * 4);

    // проход по X: srcW -> dstW
    for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < dstW; x++) {
            const center = (x + 0.5) / scaleX;
            const left = Math.max(0, Math.floor(center - supportX));
            const right = Math.min(srcW - 1, Math.ceil(center + supportX));
            let r = 0, g = 0, b = 0, al = 0, wsum = 0, asum = 0;
            for (let sx = left; sx <= right; sx++) {
                const w = lanczos((sx + 0.5 - center) * scaleX, a);
                if (w === 0) continue;
                const o = (y * srcW + sx) * 4;
                // цвет считаем с весом по альфе, иначе прозрачный фон
                // «подмешивает» свой цвет и портит край
                const ww = w * (src[o + 3] / 255);
                r += src[o] * ww; g += src[o + 1] * ww; b += src[o + 2] * ww;
                al += src[o + 3] * w;
                wsum += ww; asum += w;
            }
            const t = (y * dstW + x) * 4;
            if (wsum > 0) {
                tmp[t] = r / wsum; tmp[t + 1] = g / wsum; tmp[t + 2] = b / wsum;
            }
            tmp[t + 3] = asum !== 0 ? Math.max(0, Math.min(255, al / asum)) : 0;
        }
    }

    // проход по Y: srcH -> dstH
    for (let y = 0; y < dstH; y++) {
        const center = (y + 0.5) / scaleY;
        const top = Math.max(0, Math.floor(center - supportY));
        const bottom = Math.min(srcH - 1, Math.ceil(center + supportY));
        for (let x = 0; x < dstW; x++) {
            let r = 0, g = 0, b = 0, al = 0, wsum = 0, asum = 0;
            for (let sy = top; sy <= bottom; sy++) {
                const w = lanczos((sy + 0.5 - center) * scaleY, a);
                if (w === 0) continue;
                const o = (sy * dstW + x) * 4;
                const ww = w * (tmp[o + 3] / 255);
                r += tmp[o] * ww; g += tmp[o + 1] * ww; b += tmp[o + 2] * ww;
                al += tmp[o + 3] * w;
                wsum += ww; asum += w;
            }
            const t = (y * dstW + x) * 4;
            out[t] = wsum > 0 ? Math.max(0, Math.min(255, Math.round(r / wsum))) : 0;
            out[t + 1] = wsum > 0 ? Math.max(0, Math.min(255, Math.round(g / wsum))) : 0;
            out[t + 2] = wsum > 0 ? Math.max(0, Math.min(255, Math.round(b / wsum))) : 0;
            out[t + 3] = asum !== 0 ? Math.max(0, Math.min(255, Math.round(al / asum))) : 0;
        }
    }
    return out;
}

// Лёгкое повышение резкости (unsharp mask) — возвращает детали, которые
// неизбежно теряются при уменьшении. amount ~0.3..0.6.
function sharpen(rgba, size, amount = 0.4) {
    const out = new Uint8Array(rgba);
    const at = (x, y, c) => {
        const xx = Math.max(0, Math.min(size - 1, x));
        const yy = Math.max(0, Math.min(size - 1, y));
        return rgba[(yy * size + xx) * 4 + c];
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const o = (y * size + x) * 4;
            if (rgba[o + 3] === 0) continue;
            for (let c = 0; c < 3; c++) {
                const blur = (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c)) / 4;
                const v = rgba[o + c] + amount * (rgba[o + c] - blur);
                out[o + c] = Math.max(0, Math.min(255, Math.round(v)));
            }
        }
    }
    return out;
}

// Границы непрозрачного содержимого картинки (по альфе > порога).
function contentBBox(rgba, w, h, threshold = 8) {
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (rgba[(y * w + x) * 4 + 3] > threshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Готовит значок артефакта размера size x size: обрезает по содержимому,
// вписывает в квадрат со свободным полем margin и уменьшает точным фильтром.
//
// ЗАЧЕМ ТАК: у некоторых артефактов картинка упирается в край клетки атласа
// (у «Кристалла» содержимое 66x100 при клетке 100 — сверху и снизу отступ 0).
// Если просто уменьшить всю клетку, картинка обрывается ровной линией по
// границе клетки, и на иконке контейнера это выглядит как прямоугольный рез.
// Поэтому сначала обрезаем по содержимому и оставляем поле.
function fitArtifactToSquare(src, srcW, srcH, dstSize, margin = 1, a = 3) {
    const bbox = contentBBox(src, srcW, srcH);
    if (!bbox) return new Uint8Array(dstSize * dstSize * 4);      // пустая картинка

    const inner = Math.max(1, dstSize - margin * 2);
    const scale = Math.min(inner / bbox.w, inner / bbox.h);
    const dw = Math.max(1, Math.round(bbox.w * scale));
    const dh = Math.max(1, Math.round(bbox.h * scale));

    // вырезаем содержимое
    const cut = new Uint8Array(bbox.w * bbox.h * 4);
    for (let y = 0; y < bbox.h; y++) {
        for (let x = 0; x < bbox.w; x++) {
            const s = ((bbox.y + y) * srcW + bbox.x + x) * 4;
            const d = (y * bbox.w + x) * 4;
            cut[d] = src[s]; cut[d + 1] = src[s + 1]; cut[d + 2] = src[s + 2]; cut[d + 3] = src[s + 3];
        }
    }
    const small = downscaleRGBA(cut, bbox.w, dw, a, bbox.h, dh);

    // кладём по центру итогового квадрата
    const out = new Uint8Array(dstSize * dstSize * 4);
    const ox = Math.floor((dstSize - dw) / 2), oy = Math.floor((dstSize - dh) / 2);
    for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
            const s = (y * dw + x) * 4;
            const d = ((oy + y) * dstSize + ox + x) * 4;
            out[d] = small[s]; out[d + 1] = small[s + 1]; out[d + 2] = small[s + 2]; out[d + 3] = small[s + 3];
        }
    }
    return out;
}

module.exports = { downscaleRGBA, sharpen, contentBBox, fitArtifactToSquare };
