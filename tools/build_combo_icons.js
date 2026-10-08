// tools/build_combo_icons.js — генератор иконок заполненных контейнеров.
//
// ЗАЧЕМ
//   Заполненный контейнер должен отличаться от пустого: на иконке контейнера
//   (на всю клетку) рисуется уменьшенная иконка лежащего внутри артефакта.
//
//   Механика выбрана так, чтобы НЕ править движок: иконки компонуются заранее
//   и каждая комбинация ссылается на свою ячейку атласа. Движок просто рисует
//   готовую картинку — ровно как для любого другого предмета.
//
// ЧТО ДЕЛАЕТ
//   1. читает наши иконки контейнеров (верхняя строка атласа ui_bq_field_container);
//   2. берёт иконки артефактов (по умолчанию из HQ-атласа ui_icon_equipment_hd,
//      он НЕ сжат — значит без потерь от сжатия) и уменьшает их;
//   3. кладёт уменьшенный артефакт в правый нижний угол иконки контейнера;
//   4. пишет атлас: строка 0 — пустые контейнеры, дальше по строке на артефакт;
//   5. переписывает inv_grid_x / inv_grid_y у 12 комбо в mod_artefacts_z_bq.ltx.
//
//   Добавили артефакт — дописали его в ARTIFACTS и запустили скрипт заново.
//   Руками рисовать ничего не нужно.
//
// ЗАПУСК: node tools/build_combo_icons.js [--check]
//   --check : ничего не писать, только показать, что получилось бы.
'use strict';
const fs = require('fs');
const path = require('path');
const { decodeAuto } = require('./dds.js');
const { encodeDXT5 } = require('./dds_encode.js');

const ROOT = path.join(__dirname, '..');
const CONTAINER_ATLAS = path.join(ROOT, 'textures', 'ui', 'ui_bq_field_container.dds');
const GAME = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod';
const ADDONS = path.join(GAME, 'StalkerCoP_IXRAY', 'ixr_addons');
const HQ_MOD = path.join(ADDONS, 'ixray-hq-icons-v2.0');
const HQ_CONFIG = path.join(HQ_MOD, 'configs', 'mod_system_hqicons.ltx');
const VANILLA = path.join(GAME, 'StalkerCoP_Original_gamedata', 'gamedata');
const VANILLA_TEXTURE = path.join(VANILLA, 'textures', 'ui', 'ui_icon_equipment.dds');
const VANILLA_ARTEFACTS = path.join(VANILLA, 'configs', 'misc', 'artefacts.ltx');
const MOD_ARTEFACTS = path.join(ROOT, 'configs', 'misc', 'mod_artefacts_z_bq.ltx');

// --- параметры картинки -----------------------------------------------------
const CELL = 50;              // клетка иконки в нашем атласе (inv_scale = 1.0)
// Размер уменьшенного артефакта. ВАЖНО: движок рисует этот значок ПИКСЕЛЬ В
// ПИКСЕЛЬ (источник N px кладётся в прямоугольник N px), поэтому всё, что
// потеряно при уменьшении, видно на экране напрямую. Проверено сравнением
// (tools/compare_artifact_sizes.js): 24x24 заметно грубее, 32x32 уже близко к
// исходнику. Здесь стоит 32; значение не обязано быть кратным 4 — кратность
// нужна только размерам АТЛАСА (их проверяет кодировщик).
const ART = 32;
const ART_OFFSET = 2;         // отступ значка от правого нижнего угла клетки, px
const ATLAS_W = 256;          // 5 клеток по 50
// РАСШИРЕНИЕ НА ВСЕ АРТЕФАКТЫ: строка на артефакт, поэтому при ~24 артефактах
// нужен ATLAS_H = 50 * (24 + 1) = 1250. Возьмите 1280 (степень двойки и кратно
// 4 — движок любит степени двойки). Объём при DXT5 вырастет до ~320 КБ, это
// нормально; при этом число комбинаций на диске НЕ растёт: у артефакта одна
// строка, а три контейнера — это три столбца в ней.
// 512 = степень двойки и кратно 4 (требования к DDS). Хватает на 1 строку
// пустых контейнеров + 9 артефактов; при большем числе поднимайте дальше.
const ATLAS_H = 512;          // строки: пустые + до 9 артефактов
const MAX_ROWS = ATLAS_H / CELL;

// Артефакты в порядке строк атласа (строка 1 = первый). Порядок менять можно,
// но тогда поменяются inv_grid_y у комбо — генератор их перепишет сам.
const ARTIFACTS = ['af_eye', 'af_cristall', 'af_compass', 'af_ice', 'af_fireball'];

// Контейнеры в порядке столбцов (строка 0 атласа и inv_grid_x).
const CONTAINERS = [
    { short: 'field', name: 'полевой' },
    { short: 'uni', name: 'универсальный' },
    { short: 'sci', name: 'научный' },
];

const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------- утилиты ---
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

// Уменьшение картинки. Используем точный фильтр из tools/downscale.js: простое
// усреднение по блокам давало заметное мыло и ступеньки (проверено сравнением).
//
// ВАЖНО: значок артефакта не «растягиваем на всю клетку», а вписываем по
// границам содержимого со свободным полем. Иначе у артефактов, чья картинка
// упирается в край клетки атласа (у «Кристалла» содержимое 66x100 при клетке
// 100), изображение обрывается ровной линией, и на иконке контейнера это
// выглядит как прямоугольный рез.
const { downscaleRGBA, fitArtifactToSquare } = require('./downscale.js');
function downscale(src, srcSize, dstSize) {
    if (srcSize === dstSize) return src;
    return downscaleRGBA(src, srcSize, dstSize, 3);
}

// Наложение картинки с альфой в буфер (ширина буфера задаётся отдельно).
function blit(dst, dstW, img, w, h, px, py) {
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = ((py + y) * dstW + (px + x)) * 4;
            const i = (y * w + x) * 4;
            const a = img[i + 3] / 255;
            if (a <= 0) continue;
            for (let c = 0; c < 3; c++) {
                dst[o + c] = Math.round(img[i + c] * a + dst[o + c] * (1 - a));
            }
            dst[o + 3] = Math.max(dst[o + 3], img[i + 3]);
        }
    }
}

// Читает LTX (файлы сборки в cp1251 — читаем как latin1, чтобы не портить байты).
function readLtxRaw(file) {
    return fs.readFileSync(file).toString('latin1');
}
function readLtxLines(file) {
    return readLtxRaw(file).split(/\r?\n/);
}

// Возвращает ключи секции как объект (первое вхождение).
function sectionKeys(lines, section) {
    const out = {};
    let inside = false;
    for (const line of lines) {
        const s = line.replace(/;.*$/, '').trim();
        if (!s) continue;
        const h = s.match(/^!?\[([^\]]+)\]/);
        if (h) { inside = h[1].trim().toLowerCase() === section.toLowerCase(); continue; }
        if (!inside) continue;
        const kv = s.match(/^([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
        if (kv) out[kv[1]] = kv[2].trim();
    }
    return out;
}

// ------------------------------------------------------- иконки артефактов ---
// Источник иконок артефактов. Приоритет:
//   1. мод HQ Icons, если он установлен: иконки крупнее (клетка 100 px) и
//      атлас НЕ сжат (A8R8G8B8) — уменьшение не накапливает ошибку сжатия;
//   2. штатный атлас игры (клетка 50 px, DXT5) — запасной вариант.
//
// Это зависимость ТОЛЬКО инструмента: сам аддон везёт уже готовые иконки, и в
// игре никакой другой мод не нужен. Координаты артефактов в обоих атласах
// совпадают (проверено), отличается лишь размер клетки — он берётся из ключа
// inv_scale той секции, откуда читаем.
function loadArtifactSource() {
    const hqTex = path.join(HQ_MOD, 'textures', 'ui', 'ui_icon_equipment_hd.dds');
    if (fs.existsSync(hqTex) && fs.existsSync(HQ_CONFIG)) {
        return { file: hqTex, config: HQ_CONFIG, source: 'мод HQ Icons (атлас без сжатия)' };
    }
    if (fs.existsSync(VANILLA_TEXTURE) && fs.existsSync(VANILLA_ARTEFACTS)) {
        return { file: VANILLA_TEXTURE, config: VANILLA_ARTEFACTS, source: 'штатный атлас игры' };
    }
    console.error('FAIL: не найден ни мод HQ Icons, ни штатный атлас иконок игры.');
    console.error(`  искал: ${hqTex}`);
    console.error(`  искал: ${VANILLA_TEXTURE}`);
    console.error('  Укажите путь к атласу или установите мод HQ Icons.');
    process.exit(1);
}

// Координаты иконки артефакта: клетка = 50 * inv_scale.
function artifactCell(src, artefact) {
    const keys = sectionKeys(readLtxLines(src.config), artefact);
    const scale = parseFloat(keys.inv_scale || '1');
    const gx = parseInt(keys.inv_grid_x, 10);
    const gy = parseInt(keys.inv_grid_y, 10);
    if (Number.isNaN(gx) || Number.isNaN(gy)) return null;
    const cell = Math.round(50 * scale);
    return { gx, gy, cell, scale };
}

// ------------------------------------------------------------------ запись ---
function writeComboGrids(combosGrid) {
    const raw = readLtxRaw(MOD_ARTEFACTS);
    const lines = raw.split('\n');
    let changed = 0;
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const s = lines[i].replace(/;.*$/, '').trim();
        const h = s.match(/^!?\[([^\]]+)\]/);
        if (h) { current = h[1].trim().toLowerCase(); continue; }
        if (!current || !(current in combosGrid)) continue;
        const kv = s.match(/^(inv_grid_[xy])\s*=/);
        if (!kv) continue;
        const want = combosGrid[current][kv[1] === 'inv_grid_x' ? 'x' : 'y'];
        const replaced = lines[i].replace(/(inv_grid_[xy]\s*=\s*)(-?\d+)/, `$1${want}`);
        if (replaced !== lines[i]) { lines[i] = replaced; changed++; }
    }
    if (!CHECK_ONLY) fs.writeFileSync(MOD_ARTEFACTS, Buffer.from(lines.join('\n'), 'latin1'));
    return changed;
}

// -------------------------------------------------------------------- main ---
console.log('=== Генератор иконок заполненных контейнеров ===');

// 1. исходные иконки контейнеров
const contDec = decodeAuto(fs.readFileSync(CONTAINER_ATLAS));
console.log(`Атлас контейнеров: ${contDec.width}x${contDec.height}`);
const containerIcons = CONTAINERS.map((c, i) => crop(contDec, i * CELL, 0, CELL, CELL));

// 2. источник иконок артефактов
const src = loadArtifactSource();
console.log(`Источник иконок артефактов: ${src.source}`);
console.log(`  файл: ${path.basename(src.file)}`);
const artDec = decodeAuto(fs.readFileSync(src.file));
console.log(`  размер атласа: ${artDec.width}x${artDec.height}`);

const artIcons = [];
for (const art of ARTIFACTS) {
    const cell = artifactCell(src, art);
    if (!cell) { console.error(`FAIL: не найдены координаты иконки для ${art}`); process.exit(1); }
    if ((cell.gx + 1) * cell.cell > artDec.width || (cell.gy + 1) * cell.cell > artDec.height) {
        console.error(`FAIL: ${art} выходит за пределы атласа (${cell.gx},${cell.gy} клетка ${cell.cell})`);
        process.exit(1);
    }
    const big = crop(artDec, cell.gx * cell.cell, cell.gy * cell.cell, cell.cell, cell.cell);
    // вписываем по содержимому со свободным полем, а не растягиваем клетку
    artIcons.push(fitArtifactToSquare(big, cell.cell, cell.cell, ART, 1, 3));
    console.log(`  ${art}: клетка ${cell.cell}px (${cell.gx},${cell.gy}) -> значок ${ART}x${ART} ` +
        `(вписан по содержимому)`);
}

// 3. сборка атласа
const atlas = new Uint8Array(ATLAS_W * ATLAS_H * 4);
containerIcons.forEach((icon, i) => blit(atlas, ATLAS_W, icon, CELL, CELL, i * CELL, 0));

const OFFSET = CELL - ART - ART_OFFSET;    // правый нижний угол минус отступ
for (let row = 0; row < ARTIFACTS.length; row++) {
    if (row + 1 >= MAX_ROWS) {
        console.error(`FAIL: артефактов больше, чем строк в атласе (${MAX_ROWS - 1}); ` +
            `увеличьте ATLAS_H`);
        process.exit(1);
    }
    for (let col = 0; col < CONTAINERS.length; col++) {
        const cellImg = new Uint8Array(containerIcons[col]);   // копия
        blit(cellImg, CELL, artIcons[row], ART, ART, OFFSET, OFFSET);
        blit(atlas, ATLAS_W, cellImg, CELL, CELL, col * CELL, (row + 1) * CELL);
    }
}

// 4. запись атласа
const dds = encodeDXT5(atlas, ATLAS_W, ATLAS_H);
console.log(`\nАтлас: ${ATLAS_W}x${ATLAS_H}, ${(dds.length / 1024).toFixed(1)} КБ, ` +
    `строк: пустые + ${ARTIFACTS.length}`);
if (!CHECK_ONLY) {
    fs.writeFileSync(CONTAINER_ATLAS, dds);
    console.log(`Записан: ${path.relative(ROOT, CONTAINER_ATLAS)}`);
}

// 4b. выгрузка PNG для визуальной проверки (увеличено, чтобы было видно глазами).
// Кладём во временную папку, чтобы не мусорить в репозитории.
{
    const { encodePNG, upscale } = require('./png.js');
    const up = upscale(atlas, ATLAS_W, ATLAS_H, 3);
    const pngPath = path.join(require('os').tmpdir(), 'bq_atlas_preview.png');
    fs.writeFileSync(pngPath, encodePNG(up.rgba, up.width, up.height));
    console.log(`Предпросмотр (x3): ${pngPath}`);
}

// 5. сетка комбо: x = столбец контейнера, y = строка артефакта (+1)
const combosGrid = {};
for (let row = 0; row < ARTIFACTS.length; row++) {
    for (let col = 0; col < CONTAINERS.length; col++) {
        combosGrid[`${ARTIFACTS[row]}_bq_${CONTAINERS[col].short}_container`] =
            { x: col, y: row + 1 };
    }
}
const changed = writeComboGrids(combosGrid);
console.log(`Секций комбо обновлено: ${changed}` + (CHECK_ONLY ? ' (режим проверки, файлы не менялись)' : ''));

console.log('\nНапоминание: после генерации запустите проверки:');
console.log('  node tools/check_containers.js');
console.log('  node tools/check_ltx_syntax.js');
