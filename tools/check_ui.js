// tools/check_ui.js
//
// Проверка наших файлов интерфейса (окно актора, карточка предмета).
//
// Зачем: XML интерфейса - это не оформление, а КАРКАС. Движок сам создаёт
// элементы по именам узлов (CUIXmlInit::InitStatic / InitProgressBar и т.д.) и
// падает с "XML node not found", если узел пропал. Плюс каждая <texture> должна
// существовать, иначе элемент просто не нарисуется (а игрок увидит пустоту).
// Поэтому проверяем ровно две вещи:
//   1) набор узлов совпадает с ванильным файлом (правим только вид, не каркас);
//   2) все картинки на месте.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IX_UI = 'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\Исходники ixray\\gamedata\\configs\\ui';

// Наши файлы интерфейса и их ванильные оригиналы (эталон каркаса).
const PAIRS = [
    { ours: 'configs/ui/actor_menu_16.xml', vanilla: 'actor_menu_16.xml' },
];

let errors = 0, warnings = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const warn = (m) => { console.warn('  предупреждение: ' + m); warnings++; };
const ok = (m) => console.log('  ok: ' + m);

// Убираем комментарии: в них бывают примеры вида <texture>ui\ui_bq_*</texture>,
// которые не являются ссылками (движок комментарии не читает).
function stripComments(text) {
    return text.replace(/<!--[\s\S]*?-->/g, '');
}

// Все имена узлов (теги) в файле - сравнение каркаса.
function tags(text) {
    const set = new Map();
    for (const m of text.matchAll(/<([a-zA-Z0-9_]+)(\s[^>]*)?\/?>/g)) {
        set.set(m[1], (set.get(m[1]) || 0) + 1);
    }
    return set;
}

// Куда указывает текстура: прямо в файл (ui\имя) или в атлас по логическому id.
function textureTarget(ref) {
    const name = ref.trim().replace(/\//g, '\\');
    if (name.includes('\\')) {
        return 'textures\\' + name + '.dds';
    }
    return null;         // логический id: разрешается через configs\ui\textures_descr
}

for (const p of PAIRS) {
    const oursPath = path.join(ROOT, p.ours);
    if (!fs.existsSync(oursPath)) { err(`${p.ours}: файла нет`); continue; }
    const ourText = stripComments(fs.readFileSync(oursPath, 'utf8'));
    const vanText = stripComments(fs.readFileSync(path.join(IX_UI, p.vanilla), 'utf8'));

    console.log(`\n== ${p.ours} ==`);

    // 1. Каркас: имена узлов и их количество.
    const a = tags(ourText), b = tags(vanText);
    const missing = [];
    const extra = [];
    for (const [tag, n] of b) {
        if (!a.has(tag)) missing.push(`${tag} (${n} шт.)`);
        else if (a.get(tag) < n) missing.push(`${tag}: у нас ${a.get(tag)}, в оригинале ${n}`);
    }
    for (const [tag, n] of a) if (!b.has(tag)) extra.push(`${tag} (${n} шт.)`);
    if (missing.length) {
        err(`пропали узлы, движок может не собрать окно: ${missing.join(', ')}`);
    } else {
        ok(`каркас совпадает с оригиналом (${b.size} видов узлов)`);
    }
    if (extra.length) warn(`добавлены свои узлы: ${extra.join(', ')}`);

    // 2. Какие узлы движок требует особо (без них окно не соберётся).
    for (const need of ['inventory_slot_wnd', 'dragdrop_bag', 'dragdrop_belt', 'dragdrop_trash', 'actor_state_info']) {
        if (!ourText.includes(`<${need}`)) err(`нет обязательного узла <${need}>`);
    }

    // 3. Картинки.
    const refs = [];
    for (const m of ourText.matchAll(/<texture[^>]*>([^<]+)<\/texture>/g)) refs.push(m[1]);
    let own = 0, logical = 0, missingTex = 0;
    const seen = new Set();
    for (const ref of refs) {
        const t = textureTarget(ref);
        if (!t) {
            logical++;
            continue;
        }
        if (seen.has(t)) continue;
        seen.add(t);
        own++;
        if (!fs.existsSync(path.join(ROOT, t))) {
            err(`нет файла текстуры: ${t} (ссылка ui\\${ref.trim()})`);
            missingTex++;
        }
    }
    if (!missingTex) ok(`свои текстуры на месте: ${own} файлов, ссылок всего ${refs.length}`);
    if (logical) ok(`ссылок на ванильные атласы (логические id): ${logical}`);

    // 4. Размеры текстур против размера элемента - предупреждение, если картинка
    //    меньше элемента (будет растянута и размыта).
    const bad = [];
    for (const m of ourText.matchAll(/<([a-zA-Z0-9_]+)([^>]*)>\s*<texture[^>]*>([^<]+)<\/texture>/g)) {
        const attrs = m[2], ref = m[3].trim();
        const w = /width="(\d+)"/.exec(attrs), h = /height="(\d+)"/.exec(attrs);
        if (!w || !h) continue;
        const t = textureTarget(ref);
        if (!t) continue;
        const file = path.join(ROOT, t);
        if (!fs.existsSync(file)) continue;
        const dds = require('./dds.js');
        try {
            const hdr = dds.readHeader(fs.readFileSync(file));
            if (hdr.width < +w[1] || hdr.height < +h[1]) {
                bad.push(`${ref.trim()}: картинка ${hdr.width}x${hdr.height}, элемент ${w[1]}x${h[1]}`);
            }
        } catch (e) { /* о проблемах чтения сообщит другой инструмент */ }
    }
    if (bad.length) warn(`картинка меньше элемента (будет растянута): ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? ` и ещё ${bad.length - 4}` : ''}`);
}

// Режим "список файлов" - то, что нужно художнику: какой файл за что отвечает,
// какого он размера сейчас и в какое место интерфейса он ложится (размер элемента
// в XML - это и есть целевой размер картинки).
if (process.argv[2] === 'list' || process.argv[2] === '--list') {
    const dds = require('./dds.js');
    for (const p of PAIRS) {
        const ourText = stripComments(fs.readFileSync(path.join(ROOT, p.ours), 'utf8'));
        const usage = new Map();     // наш файл -> Set(целевых размеров)
        const logical = new Map();   // ванильный логический id -> Set(размеров)

        // Идём по строкам и держим стек открытых элементов: целевой размер
        // картинки - это размер ближайшего родителя, у которого он задан
        // (именно в этот прямоугольник движок растянет текстуру).
        let stack = [];
        for (const raw of ourText.split(/\r?\n/)) {
            const line = raw.trim();
            for (const m of line.matchAll(/<([a-zA-Z0-9_]+)((?:\s+[a-zA-Z0-9_]+="[^"]*")*)\s*\/?>/g)) {
                if (m[1] === 'texture') continue;
                const attrs = {};
                for (const a of m[2].matchAll(/([a-zA-Z0-9_]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
                stack.push({ tag: m[1], attrs });
            }
            const tm = line.match(/<texture[^>]*>([^<]+)<\/texture>/);
            if (tm) {
                let owner = null;
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].attrs.width && stack[i].attrs.height) { owner = stack[i]; break; }
                }
                const size = owner ? `${owner.attrs.width}x${owner.attrs.height}` : null;
                const ref = tm[1].trim();
                const target = ref.includes('\\') ? 'textures\\' + ref.replace(/\//g, '\\') + '.dds' : null;
                const map = target ? usage : logical;
                const key = target || ref;
                if (!map.has(key)) map.set(key, new Set());
                if (size) map.get(key).add(size);
            }
            for (const m of line.matchAll(/<\/([a-zA-Z0-9_]+)>/g)) {
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].tag === m[1]) { stack = stack.slice(0, i); break; }
                }
            }
        }

        console.log(`\n===== ${p.ours}: НАШИ ФАЙЛЫ (правятся) =====`);
        console.log('файл\tsize\tсейчас\tкуда ложится (размер элемента)');
        for (const [file, sizes] of [...usage.entries()].sort()) {
            const abs = path.join(ROOT, file);
            let now = '?';
            try { const h = dds.readHeader(fs.readFileSync(abs)); now = `${h.width}x${h.height} ${h.fourCC || 'A8R8G8B8'}`; } catch (e) { now = 'НЕТ ФАЙЛА'; }
            console.log(`${path.basename(file)}\t${now}\t${[...sizes].join(' / ') || 'по месту'}`);
        }
        console.log(`\n===== ${p.ours}: ЕЩЁ ВАНИЛЬНЫЕ (рисуем сами) =====`);
        for (const [id, sizes] of [...logical.entries()].sort()) {
            console.log(`${id}\t${[...sizes].join(' / ') || 'по месту'}`);
        }
    }
    process.exit(errors ? 1 : 0);
}

console.log(errors ? `\nFAIL: ${errors} ошибок` : '\nOK: файлы интерфейса согласованы.');
process.exit(errors ? 1 : 0);
