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

// Уменьшение RGBA-картинки srcW x srcW до dstW x dstW (квадрат).
// a — порядок фильтра (2 или 3); a=1 даёт почти линейный фильтр (мягче).
function downscaleRGBA(src, srcW, dstW, a = 3) {
    const srcH = srcW, dstH = dstW;                 // работаем с квадратами
    const scale = dstW / srcW;
    const support = a / scale;                      // радиус фильтра в исходных пикселях
    const tmp = new Float32Array(dstW * srcH * 4);
    const out = new Uint8Array(dstW * dstH * 4);

    // проход по X: srcW -> dstW
    for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < dstW; x++) {
            const center = (x + 0.5) / scale;
            const left = Math.max(0, Math.floor(center - support));
            const right = Math.min(srcW - 1, Math.ceil(center + support));
            let r = 0, g = 0, b = 0, al = 0, wsum = 0;
            for (let sx = left; sx <= right; sx++) {
                const w = lanczos((sx + 0.5 - center) * scale, a);
                if (w === 0) continue;
                const o = (y * srcW + sx) * 4;
                // альфу учитываем как вес: иначе прозрачный фон «подмешивает» цвет
                const ww = w * (src[o + 3] / 255);
                r += src[o] * ww; g += src[o + 1] * ww; b += src[o + 2] * ww;
                al += src[o + 3] * w;
                wsum += ww;
            }
            const t = (y * dstW + x) * 4;
            if (wsum > 0) {
                tmp[t] = r / wsum; tmp[t + 1] = g / wsum; tmp[t + 2] = b / wsum;
            }
            tmp[t + 3] = al / (wsum > 0 ? 1 : 1);     // накапливали с весом w
        }
    }
    // нормируем альфу отдельно (она считалась с весом w, а не ww)
    for (let i = 0; i < dstW * srcH; i++) {
        const t = i * 4;
        if (tmp[t + 3] > 255) tmp[t + 3] = 255;
        if (tmp[t + 3] < 0) tmp[t + 3] = 0;
    }

    // проход по Y: srcH -> dstH
    for (let y = 0; y < dstH; y++) {
        const center = (y + 0.5) / scale;
        const top = Math.max(0, Math.floor(center - support));
        const bottom = Math.min(srcH - 1, Math.ceil(center + support));
        for (let x = 0; x < dstW; x++) {
            let r = 0, g = 0, b = 0, al = 0, wsum = 0, asum = 0;
            for (let sy = top; sy <= bottom; sy++) {
                const w = lanczos((sy + 0.5 - center) * scale, a);
                if (w === 0) continue;
                const o = (sy * dstW + x) * 4;
                const ww = w * (tmp[o + 3] / 255);
                r += tmp[o] * ww; g += tmp[o + 1] * ww; b += tmp[o + 2] * ww;
                al += tmp[o + 3] * w; asum += w;
                wsum += ww;
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

module.exports = { downscaleRGBA, sharpen };
