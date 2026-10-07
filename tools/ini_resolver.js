// tools/ini_resolver.js — разбор ltx-конфигов так, как это делает движок.
//
// Что важно и что уже приводило к ошибкам:
//  1. Переопределение секции пишется "![Имя]" - восклицательный знак ПЕРЕД
//     скобкой. Вариант "[!Имя]" движок понимает как секцию с именем "!Имя",
//     поэтому такие переопределения молча теряются.
//  2. Переопределение ДОПОЛНЯЕТ секцию: его ключи добавляются к уже
//     существующим, родители и остальные ключи сохраняются
//     (Xr_ini.cpp, insert_item в существующую секцию).
//  3. Файлы читаются в порядке загрузки (ванильные, моды сборки, наш мод):
//     последний выигрывает.
//  4. Оригинальные файлы игры в cp1251, поэтому читаем побайтово (latin1).
//
// Наследование: при нескольких родителях важнее ПОСЛЕДНИЙ.
'use strict';
const fs = require('fs');

// Читает один файл и ДОПОЛНЯЕТ переданную карту (mergeAll - общий режим,
// как в игре). Если mergeAll не задан, работает по одному файлу.
function readLtxInto(file, target) {
    const text = fs.readFileSync(file).toString('latin1');
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/;.*$/, '').trim();
        if (!line) continue;

        const h = line.match(/^(!?)\[([^\]]+)\](?:\s*:\s*(.*))?$/);
        if (h) {
            const isOverride = h[1] === '!';
            const name = h[2].trim();
            const parents = (h[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
            if (isOverride && target.has(name)) {
                const prev = target.get(name);
                if (parents.length) prev.parents = parents;
                prev.override = true;
                cur = prev;
                continue;
            }
            cur = { name, parents, keys: new Map(), file, override: isOverride };
            target.set(name, cur);
            continue;
        }

        const kv = line.match(/^([A-Za-z0-9_.$]+)\s*=\s*(.*)$/);
        if (kv && cur) cur.keys.set(kv[1], kv[2].trim());
    }
    return target;
}

function readLtx(file) {
    return readLtxInto(file, new Map());
}

// Собирает все файлы в одну карту в порядке загрузки.
function loadAll(files) {
    const merged = new Map();
    for (const f of files) {
        if (fs.existsSync(f)) readLtxInto(f, merged);
    }
    return merged;
}

// Разрешает наследование. Возвращает Map с итоговыми ключами секции.
function makeResolver(merged) {
    const cache = new Map();
    const resolve = (name) => {
        if (cache.has(name)) return cache.get(name);
        const sec = merged.get(name);
        if (!sec) return new Map();
        const acc = new Map();
        for (const p of sec.parents) for (const [k, v] of resolve(p)) acc.set(k, v);
        for (const [k, v] of sec.keys) acc.set(k, v);
        cache.set(name, acc);
        return acc;
    };
    return resolve;
}

module.exports = { readLtx, readLtxInto, loadAll, makeResolver };
