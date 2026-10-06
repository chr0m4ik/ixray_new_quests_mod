#!/usr/bin/env node
/*
 * generate_containers.js — генератор комбо-секций «артефакт в контейнере».
 *
 * ЧТО ДЕЛАЕТ
 *   Для каждого артефакта из списка ARTIFACTS создаёт ТРИ плоские секции
 *   (полевой / универсальный / научный контейнер) и их absorbation-таблицы,
 *   записывая результат в отдельный файл configs\misc\artefacts_bq_containers.ltx.
 *
 * ГЛАВНОЕ СВОЙСТВО: секции для артефактов, у которых комбо УЖЕ ЕСТЬ
 *   (в текущем artefacts.ltx или в ранее сгенерированном файле), НЕ создаются.
 *   Поэтому скрипт можно запускать повторно после добавления новых артефактов —
 *   он не будет перегенерировать всё с нуля.
 *
 * ЗАПУСК (из корня аддона):
 *     node generate_containers.js
 *   или с параметрами:
 *     node generate_containers.js --dry-run      только показать, что будет создано
 *     node generate_containers.js --out=имя.ltx  другой файл результата
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ПРАВКА artefacts.ltx
 *   artefacts.ltx — большая копия файла игры (2500+ строк). Правка его скриптом
 *   рискованна: один сбой в разборе портит весь конфиг. Отдельный файл подключается
 *   одной строкой в mod_system_z_bq.ltx:
 *       #include "misc\artefacts_bq_containers.ltx"
 *   и его всегда можно удалить целиком.
 *
 * КОДИРОВКИ
 *   artefacts.ltx читается и пишется побайтово (latin1) — кириллица в нём остаётся
 *   нетронутой. Сгенерированный файл пишется в cp1251 (как остальные конфиги
 *   артефактов), комментарии в нём только ASCII.
 *
 * ВАЖНО ПРО СЕКЦИИ (см. MEMO.md, разделы 15.3 и 15.6)
 *   Секции плоские (без родителей) НАМЕРЕННО: если комбо наследуется от артефакта,
 *   движок берёт координаты иконки родителя (CInventoryItem::Load читает
 *   inv_grid_x/y по cNameSect), и иконка рисуется как 2x2.
 *   Поэтому в секцию явно выписаны ВСЕ ключи, которые читаются строго:
 *   immunities_sect, sprint_allowed, control_inertion_factor и остальные.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ============================================================================
// НАСТРОЙКИ
// ============================================================================

const ADDON_DIR = __dirname;
const ARTEFACTS_LTX = path.join(ADDON_DIR, "configs", "misc", "artefacts.ltx");

// Артефакты находятся в artefacts.ltx АВТОМАТИЧЕСКИ (см. discoverArtifacts),
// поэтому новые артефакты подхватываются сами — править список не нужно.
//
// Сюда попадают только те, кому контейнер НЕ нужен (квестовые и служебные).
const EXCLUDE = [
    "af_oasis_heart",        // квестовый артефакт
    "jup_b1_half_artifact",  // половинка артефакта по квесту
    "af_quest_b14_twisted",  // квестовый
];

// Контейнеры: суффикс имени комбо -> { секция контейнера, вычитаемая радиация }.
// Значения радиации — как у пустых контейнеров в artefacts.ltx
// (показ в интерфейсе = значение x 1000, то есть -0.004 => -4).
const CONTAINERS = [
    { suffix: "field_container",   container: "bq_field_container", radiation: -0.004 },
    { suffix: "bq_uni_container",  container: "bq_uni_container",   radiation: -0.007 },
    { suffix: "bq_sci_container",  container: "bq_sci_container",   radiation: -0.011 },
];

// Файл результата
let OUT_NAME = "artefacts_bq_containers.ltx";
let DRY_RUN = false;
for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") DRY_RUN = true;
    else if (arg.startsWith("--out=")) OUT_NAME = arg.slice(6);
}

const OUT_LTX = path.join(ADDON_DIR, "configs", "misc", OUT_NAME);

// Секции из ранее сгенерированного файла. Нужны, чтобы повторный запуск не создал
// дубликаты: комбо из этого файла тоже считаются «уже существующими».
// Перезапись безопасна: мы читаем старый файл ДО записи нового.
let PREVIOUS = "";
try {
    if (fs.existsSync(OUT_LTX)) PREVIOUS = fs.readFileSync(OUT_LTX, "latin1");
} catch (e) {
    console.error("не удалось прочитать прежний " + OUT_NAME + ": " + e.message);
}

// ============================================================================
// РАЗБОР artefacts.ltx
// ============================================================================

const raw = fs.readFileSync(ARTEFACTS_LTX, "latin1");   // байты как есть
const NL = raw.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
const LINES = raw.split(/\r?\n/);

/** Границы секции [name] (или [name]:parents) — только точное имя без ':' */
function findSection(name) {
    const re = new RegExp("^\\[" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\]|:)");
    for (let i = 0; i < LINES.length; i++) {
        if (re.test(LINES[i].trim())) {
            let end = i + 1;
            while (end < LINES.length && !/^\s*\[/.test(LINES[end])) end++;
            return { start: i, end: end };
        }
    }
    return null;
}

/** Все имена секций в файле */
function allSectionNames() {
    const names = new Set();
    for (const line of LINES) {
        const m = line.trim().match(/^\[([^\]:]+)\]/);
        if (m) names.add(m[1]);
    }
    return names;
}

/** Значение ключа в секции (первое совпадение), без комментария */
function getKey(sectionName, key) {
    const s = findSection(sectionName);
    if (!s) return null;
    const re = new RegExp("^\\s*" + key + "\\s*=\\s*(.+)$");
    for (let i = s.start + 1; i < s.end; i++) {
        const m = LINES[i].match(re);
        if (m) return m[1].replace(/;.*$/, "").trim();
    }
    return null;
}

/** Родители секции: [x]:a,b -> ["a","b"] */
function getParents(sectionName) {
    const s = findSection(sectionName);
    if (!s) return [];
    const m = LINES[s.start].match(/^\[[^\]]+\]:(.+)$/);
    if (!m) return [];
    return m[1].split(",").map(x => x.trim()).filter(Boolean);
}

/**
 * Найти значение ключа с учётом наследования (движок именно так и делает).
 * Нужно, например, чтобы узнать particles/visual, унаследованные от af_base.
 */
function resolveKey(sectionName, key, depth) {
    depth = depth || 0;
    if (depth > 6) return null;
    const own = getKey(sectionName, key);
    if (own !== null) return own;
    for (const parent of getParents(sectionName)) {
        const v = resolveKey(parent, key, depth + 1);
        if (v !== null) return v;
    }
    return null;
}

/** Экранирование для путей в ltx: \ остаётся как есть */
function ltxPath(v) {
    return v === null || v === undefined ? "" : String(v);
}

/**
 * Найти все артефакты в artefacts.ltx.
 *
 * Признак артефакта: секция с непустым visual и inv_weight, у которой по цепочке
 * наследования class = ARTEFACT или SCRPTART. Плюс ИСКЛЮЧАЕМ:
 *   - наши собственные секции (bq_*),
 *   - пустые контейнеры,
 *   - комбо (они оканчиваются на суффикс контейнера),
 *   - absorbation-таблицы,
 *   - всё из EXCLUDE.
 *
 * Благодаря этому новые артефакты подхватываются автоматически, а уже
 * существующие комбо (см. combosExist) повторно не генерируются.
 */
function discoverArtifacts() {
    const suffixes = CONTAINERS.map(c => "_" + c.suffix);
    const found = [];

    for (const name of allSectionNames()) {
        if (name.startsWith("bq_")) continue;                       // наши секции
        if (/_absorbation$/.test(name)) continue;                   // таблицы защиты
        if (suffixes.some(s => name.endsWith(s))) continue;         // готовые комбо
        if (EXCLUDE.indexOf(name) !== -1) continue;                 // квестовые/служебные

        const cls = (resolveKey(name, "class") || "").toUpperCase();
        if (cls !== "ARTEFACT" && cls !== "SCRPTART") continue;

        if (!resolveKey(name, "visual")) continue;                  // не предмет
        if (resolveKey(name, "inv_weight") === null) continue;      // не носится

        found.push(name);
    }
    found.sort();
    return found;
}

const ARTIFACTS = discoverArtifacts();

// ============================================================================
// ГЕНЕРАЦИЯ
// ============================================================================

const EXISTING = allSectionNames();

/** Уже есть комбо для этого артефакта? (в artefacts.ltx или в нашем файле) */
function combosExist(artifact) {
    return CONTAINERS.some(c => {
        const name = artifact + "_" + c.suffix;
        if (EXISTING.has(name)) return true;
        return sectionInPrevious(name);
    });
}

/** Секция есть в ранее сгенерированном файле? */
function sectionInPrevious(name) {
    if (!PREVIOUS) return false;
    return new RegExp("^\\[" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\]", "m").test(PREVIOUS);
}

/** Уже есть absorbation-таблица для этого артефакта? */
function absorbationSection(artifact) {
    const own = artifact + "_absorbation";
    if (EXISTING.has(own)) return own;
    if (sectionInPrevious(own)) return own;   // уже создавали в прошлый запуск
    return null;   // нет — секцию тоже надо создать
}

const out = [];
const created = [];
const skipped = [];
const warnings = [];

out.push("; ============================================================================");
out.push("; Combo items (artefact inside a container) - GENERATED FILE");
out.push(";");
out.push("; Generated by generate_containers.js. Do not edit by hand:");
out.push("; re-run the script instead, it only adds missing artefacts.");
out.push(";");
out.push("; Every combo inherits the COMMON TEMPLATE [bq_combo_base], which lives in");
out.push("; configs\\misc\\artefacts_bq_containers.ltx together with the four");
out.push("; hand-written combos (eye, cristall, fireball, compass).");
out.push("; Overridden here are only: visual, names, radiation, absorbation table,");
out.push("; icon cell and the take-out button - about 13 lines per combo.");
out.push(";");
out.push("; A combo must NOT inherit from its artefact: CInventoryItem::Load reads");
out.push("; inv_grid_x/y via cNameSect(), so the parent icon cell (af_eye = 12,4)");
out.push("; would be used and the icon would show up as 2x2. See MEMO.md 15.3/15.6.");
out.push(";");
out.push("; Requires in configs\\mod_system_z_bq.ltx:");
out.push(";     #include \"misc\\artefacts_bq_containers.ltx\"   (template + base combos)");
out.push(";     #include \"misc\\" + OUT_NAME + "\"");
out.push("; ============================================================================");

for (const artifact of ARTIFACTS) {
    if (!EXISTING.has(artifact)) {
        warnings.push("нет секции артефакта: " + artifact + " (пропущен)");
        continue;
    }

    if (combosExist(artifact)) {
        skipped.push(artifact);
        continue;
    }

    // Данные артефакта (с учётом наследования)
    const visual = resolveKey(artifact, "visual");
    const name = resolveKey(artifact, "inv_name");
    const descr = resolveKey(artifact, "description");
    const weight = resolveKey(artifact, "inv_weight") || "0.5";
    const particles = resolveKey(artifact, "particles");
    const detShow = resolveKey(artifact, "det_show_particles");
    const detHide = resolveKey(artifact, "det_hide_particles");
    const activation = resolveKey(artifact, "artefact_activation_seq");
    const lightColor = resolveKey(artifact, "trail_light_color");
    const lightRange = resolveKey(artifact, "trail_light_range");
    const radNow = parseFloat(resolveKey(artifact, "radiation_restore_speed") || "0");

    if (!visual) warnings.push(artifact + ": нет visual, комбо будет без модели");
    if (!name) warnings.push(artifact + ": нет inv_name");

    // Таблица защиты: либо своя у артефакта, либо создаём пустую
    let absSect = absorbationSection(artifact);
    let absBody = null;
    if (!absSect) {
        absSect = artifact + "_absorbation";
        const parentAbs = resolveKey(artifact, "hit_absorbation_sect");
        if (parentAbs && EXISTING.has(parentAbs)) {
            // Скопировать значения из таблицы, на которую ссылается артефакт
            absBody = [
                "burn_immunity             = " + (getKey(parentAbs, "burn_immunity") || "0"),
                "strike_immunity           = " + (getKey(parentAbs, "strike_immunity") || "0"),
                "shock_immunity            = " + (getKey(parentAbs, "shock_immunity") || "0"),
                "wound_immunity            = " + (getKey(parentAbs, "wound_immunity") || "0"),
                "radiation_immunity        = " + (getKey(parentAbs, "radiation_immunity") || "0"),
                "telepatic_immunity        = " + (getKey(parentAbs, "telepatic_immunity") || "0"),
                "chemical_burn_immunity    = " + (getKey(parentAbs, "chemical_burn_immunity") || "0"),
                "explosion_immunity        = " + (getKey(parentAbs, "explosion_immunity") || "0"),
                "fire_wound_immunity       = " + (getKey(parentAbs, "fire_wound_immunity") || "0"),
            ];
        } else {
            absBody = [
                "burn_immunity             = 0",
                "strike_immunity           = 0",
                "shock_immunity            = 0",
                "wound_immunity            = 0",
                "radiation_immunity        = 0",
                "telepatic_immunity        = 0",
                "chemical_burn_immunity    = 0",
                "explosion_immunity        = 0",
                "fire_wound_immunity       = 0",
            ];
            warnings.push(artifact + ": нет своей absorbation-таблицы, создана пустая");
        }
    }

    // Таблица защиты (одна на артефакт, нужна всем трём комбо).
    // Объявляем ДО комбо: так файл читается сверху вниз без сюрпризов.
    if (absBody) {
        out.push("");
        out.push("[" + absSect + "]");
        for (const line of absBody) out.push(line);
    }

    out.push("");
    out.push(";--- " + artifact);

    for (const c of CONTAINERS) {
        const combo = artifact + "_" + c.suffix;
        const rad = radNow + c.radiation;   // вычитаем радиацию контейнера
        const radStr = (Math.round(rad * 1e6) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
        const cell = CONTAINERS.indexOf(c);

        // Секция наследуется от ОБЩЕГО ШАБЛОНА (bq_combo_base из
        // configs\misc\artefacts_bq_containers.ltx), а не от артефакта.
        // Наследование от артефакта брало бы его inv_grid_x/y и ломало иконку.
        out.push("");
        out.push("[" + combo + "]:bq_combo_base");
        out.push("visual                    = " + ltxPath(visual));
        out.push("description               = " + ltxPath(descr));
        out.push("inv_name                  = " + ltxPath(name));
        out.push("inv_name_short            = " + ltxPath(name));
        out.push("radiation_restore_speed   = " + radStr);
        if (particles) out.push("particles                 = " + particles);
        if (detShow) out.push("det_show_particles        = " + detShow);
        if (detHide) out.push("det_hide_particles        = " + detHide);
        if (activation) out.push("artefact_activation_seq   = " + activation);
        if (lightColor) out.push("trail_light_color         = " + lightColor);
        if (lightRange) out.push("trail_light_range         = " + lightRange);
        out.push("hit_absorbation_sect      = " + absSect);
        out.push("icons_texture             = ui\\ui_bq_field_container");
        out.push("inv_grid_x                = " + cell);
        out.push("inv_grid_y                = 1");
        out.push("inv_grid_width            = 1");
        out.push("inv_grid_height           = 1");
        // Слой-иконка содержимого: поверх иконки контейнера рисуется
        // уменьшенная иконка артефакта (см. ENGINE_PATCH_icon_layer.cpp.txt).
        // Без патча движка ключи просто игнорируются - вреда нет.
        out.push("1icon_layer               = " + artifact);
        out.push("1icon_layer_x             = 2");
        out.push("1icon_layer_y             = 2");
        out.push("1icon_layer_scale         = 0.5");
        out.push("use1_text                 = bq_take_artifact");
        out.push("use1_functor              = bq_field_container.take_artifact");

        created.push({ artifact: artifact, combo: combo, rad: radStr, container: c.suffix });
    }
}

// ============================================================================
// ЗАПИСЬ И ОТЧЁТ
// ============================================================================

out.push("");

console.log("=== generate_containers.js ===");
console.log("прочитан: " + path.relative(ADDON_DIR, ARTEFACTS_LTX));
console.log("найдено артефактов в конфиге: " + ARTIFACTS.length +
    " (из них уже с комбо: " + ARTIFACTS.filter(combosExist).length + ")");
console.log("");

if (created.length === 0) {
    console.log("Нечего создавать: комбо уже есть для всех найденных артефактов.");
} else {
    const uniq = [...new Set(created.map(c => c.artifact))];
    console.log("Будет создано: " + uniq.length + " артефактов x " + CONTAINERS.length +
        " контейнера = " + created.length + " комбо-секций.");
    console.log("");
    console.log("артефакт".padEnd(24) + "контейнер".padEnd(21) + "радиация (показ)");
    for (const c of created) {
        const show = (parseFloat(c.rad) * 1000).toFixed(0);
        console.log(c.artifact.padEnd(24) + c.container.padEnd(21) +
            c.rad.padEnd(10) + (show > 0 ? "+" : "") + show);
    }
    console.log("");
}

if (skipped.length) {
    console.log("Пропущено (комбо уже есть): " + [...new Set(skipped)].join(", "));
    console.log("");
}
if (warnings.length) {
    console.log("ПРЕДУПРЕЖДЕНИЯ:");
    for (const w of warnings) console.log("  ! " + w);
    console.log("");
}

if (DRY_RUN) {
    console.log("--dry-run: файл НЕ записан.");
    process.exit(0);
}
if (created.length === 0) {
    console.log("Файл не перезаписывается (нечего добавлять).");
    process.exit(0);
}

fs.writeFileSync(OUT_LTX, out.join(NL) + NL, "latin1");
console.log("записано: " + path.relative(ADDON_DIR, OUT_LTX) + " (" + fs.statSync(OUT_LTX).size + " байт)");
console.log("");
console.log("Не забудь подключить файл в configs\\mod_system_z_bq.ltx:");
console.log('    #include "misc\\' + OUT_NAME + '"');
