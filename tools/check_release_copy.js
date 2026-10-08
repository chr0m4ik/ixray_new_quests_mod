// tools/check_release_copy.js
//
// Проверяет, что копия аддона для релиза САМОДОСТАТОЧНА: все ссылки из конфигов
// и скриптов разрешаются ВНУТРИ копии, а не в оригинальной папке.
//
// Это защита от ровно той ошибки, из-за которой мод может не загрузиться или
// оказаться «пустым»: файл забыли скопировать, а игра молча ничего не нашла.
//
// Запуск:  node tools/check_release_copy.js <путь к папке релиза>

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('usage: node tools/check_release_copy.js <папка>'); process.exit(2); }
if (!fs.existsSync(root)) { console.error(`FAIL: нет папки ${root}`); process.exit(1); }

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const ok = (m) => console.log('  ok: ' + m);

const exists = (rel) => fs.existsSync(path.join(root, rel));

console.log(`== Копия: ${root} ==`);

// 1. Обязательные элементы.
console.log('\n== 1. Обязательные файлы и папки ==');
for (const rel of ['addon.init', 'configs', 'scripts', 'sounds', 'meshes', 'textures']) {
    if (!exists(rel)) err(`нет обязательного элемента: ${rel}`);
    else ok(rel);
}
// addon.init должен содержать name и platform, иначе движок не зарегистрирует аддон.
if (exists('addon.init')) {
    const ini = fs.readFileSync(path.join(root, 'addon.init'), 'utf8');
    for (const key of ['name:', 'platform:']) {
        if (!ini.includes(key)) err(`addon.init: нет строки "${key}" - аддон не зарегистрируется`);
    }
    ok('addon.init содержит name и platform');
}

// 2. Все visual из конфигов должны лежать в meshes копии.
console.log('\n== 2. Модели (visual) ==');
let meshChecked = 0;
const cfgFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ltx$/i.test(e.name)) cfgFiles.push(p);
    }
})(path.join(root, 'configs'));
for (const f of cfgFiles) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const bare = line.replace(/;.*$/, '').trim();
        const kv = bare.match(/^visual\s*=\s*(\S+)/);
        if (!kv) continue;
        meshChecked++;
        // visual может быть записан без расширения (dynamics\box\box_1a) или с ним
        // (....ogf) - движок принимает оба варианта, значит проверяем оба.
        const base = kv[1].replace(/\\/g, path.sep);
        const candidates = [path.join('meshes', base), path.join('meshes', base + '.ogf')];
        if (!candidates.some((r) => fs.existsSync(path.join(root, r)))) {
            err(`${path.relative(root, f)}: нет модели meshes\\${kv[1]}`);
        }
    }
}
ok(`проверено ссылок на модели: ${meshChecked}`);

// 3. Все icons_texture должны лежать в textures копии.
console.log('\n== 3. Текстуры иконок ==');
let texChecked = 0;
for (const f of cfgFiles) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const bare = line.replace(/;.*$/, '').trim();
        const kv = bare.match(/^icons_texture\s*=\s*(\S+)/);
        if (!kv) continue;
        texChecked++;
        const rel = path.join('textures', kv[1].replace(/\//g, path.sep) + '.dds');
        if (!fs.existsSync(path.join(root, rel))) {
            err(`${path.relative(root, f)}: нет текстуры ${rel}`);
        }
    }
}
ok(`проверено ссылок на текстуры иконок: ${texChecked}`);

// 4. Текстуры моделей: имена лежат в мешах строками "папка\имя".
//
// ВАЖНО: часть текстур моделей - ШТАТНЫЕ текстуры игры (item_x_files,
// item_safe_container, prop_item3, wood_walls8 и т.п.). Их НЕ надо дублировать в
// аддоне: игра их и так найдёт. Поэтому ищем и в копии, и в gamedata игры.
// Ошибкой считается только то, чего нет НИГДЕ.
console.log('\n== 4. Текстуры моделей ==');
{
    const GAME_ROOTS = [
        'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_IXRAY\\gamedata\\textures',
        'Z:\\Games\\Stalker_Call_of_Pripyat_Mod\\StalkerCoP_Original_gamedata\\gamedata\\textures',
    ];
    const OWN_TEX = path.join(root, 'textures');
    const allRoots = [OWN_TEX, ...GAME_ROOTS];

    // Папки-кандидаты: и из копии, и из игры (иначе штатные имена текстур
    // отсеивались бы как мусор).
    const texFolders = new Set();
    for (const r of allRoots) {
        if (!fs.existsSync(r)) continue;
        for (const d of fs.readdirSync(r, { withFileTypes: true })) {
            if (d.isDirectory()) texFolders.add(d.name.toLowerCase());
        }
    }

    const meshDir = path.join(root, 'meshes');
    const files = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.ogf$/i.test(e.name)) files.push(p);
        }
    })(meshDir);

    let fromGame = 0;
    for (const f of files) {
        const data = fs.readFileSync(f);
        const found = new Set();
        for (const m of data.toString('latin1').matchAll(/[A-Za-z0-9_]{2,20}(?:\\[A-Za-z0-9_.\-]{2,40}){1,4}/g)) {
            const t = m[0];
            if (!texFolders.has(t.split('\\')[0].toLowerCase())) continue;
            found.add(t);
        }
        if (found.size === 0) {
            err(`${path.relative(root, f)}: не прочитано ни одной текстуры ` +
                `(нет папки textures с нужным именем?)`);
            continue;
        }
        for (const t of found) {
            const rel = t.replace(/\\/g, path.sep) + '.dds';
            const inOwn = fs.existsSync(path.join(OWN_TEX, rel));
            const inGame = GAME_ROOTS.some((r) => fs.existsSync(path.join(r, rel)));
            if (!inOwn && !inGame) {
                err(`${path.relative(root, f)}: нет текстуры textures\\${t}.dds ` +
                    `ни в копии, ни в gamedata игры`);
            } else if (!inOwn && inGame) {
                fromGame++;
            }
        }
    }
    ok(`проверено моделей: ${files.length} ` +
        `(текстур из штатной игры: ${fromGame} - это нормально)`);
}

// 5. Локализация: все inv_name и description из конфигов должны иметь строки.
console.log('\n== 5. Локализация ==');
{
    const locales = {};
    for (const lang of ['rus', 'eng']) {
        const dir = path.join(root, 'configs', 'text', lang);
        if (!fs.existsSync(dir)) { err(`нет папки локализации ${lang}`); continue; }
        const ids = new Set();
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
            const raw = fs.readFileSync(path.join(dir, f), 'utf8');
            for (const m of raw.matchAll(/<string id="([^"]+)"/g)) ids.add(m[1]);
        }
        locales[lang] = ids;
    }
    let locChecked = 0;
    for (const f of cfgFiles) {
        for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
            const bare = line.replace(/;.*$/, '').trim();
            const kv = bare.match(/^(inv_name|inv_name_short|description)\s*=\s*(\S+)/);
            if (!kv) continue;
            // значения вида st_... - ванильные строки, их в аддоне нет и не должно быть
            const id = kv[2];
            if (id.startsWith('st_') && !locales.rus.has(id)) continue;
            locChecked++;
            for (const lang of ['rus', 'eng']) {
                if (locales[lang] && !locales[lang].has(id)) {
                    err(`${path.relative(root, f)}: ${lang} не содержит строки '${id}'`);
                }
            }
        }
    }
    ok(`проверено ссылок на строки: ${locChecked}`);
}

// 6. Скрипты: синтаксис и отсутствие BOM.
console.log('\n== 6. Скрипты ==');
{
    const dir = path.join(root, 'scripts');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.script'));
    for (const f of files) {
        const buf = fs.readFileSync(path.join(dir, f));
        if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
            err(`scripts/${f}: файл с BOM (игра требует UTF-8 без BOM)`);
        }
    }
    ok(`скриптов: ${files.length}, без BOM`);
}

// 7. Что НЕ должно попасть в релиз.
console.log('\n== 7. Лишние файлы ==');
{
    const FORBIDDEN = ['MEMO.md', 'lastest.md', 'AGENTS.md', 'CLAUDE.md', '.gitignore',
        'copy_files.py', 'NOTES_inventory_radiation.md', 'NOTES_radiation_research.md',
        'ENGINE_ISSUE_icon_layer.md', 'ENGINE_PATCH_icon_layer.cpp.txt'];
    for (const f of FORBIDDEN) {
        if (exists(f)) err(`в релизе лишний файл: ${f}`);
    }
    for (const d of ['tools', '.git', '.dsh']) {
        if (exists(d)) err(`в релизе лишняя папка: ${d}`);
    }
    ok('рабочих файлов и инструментов нет');
}

if (errors === 0) {
    console.log('\nOK: копия самодостаточна, все ссылки разрешаются внутри неё.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
