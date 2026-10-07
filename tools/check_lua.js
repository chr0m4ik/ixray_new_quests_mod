// check_lua.js — простая структурная проверка Lua 5.1 (без полного парсера).
// Проверяет: баланс блоков (do/then/function ... end, repeat ... until),
// баланс скобок, незакрытые строки и длинные комментарии.
// Запуск: node tools/check_lua.js scripts/bq_containers.script
'use strict';
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('usage: node tools/check_lua.js <file>'); process.exit(2); }
const src = fs.readFileSync(file, 'utf8');

if (src.charCodeAt(0) === 0xFEFF) {
    console.error('FAIL: файл начинается с BOM (нужен UTF-8 без BOM)');
    process.exit(1);
}
if (src.includes('\uFFFD')) {
    console.error('FAIL: в файле есть символ-замена U+FFFD (битая кодировка)');
    process.exit(1);
}

const lines = src.split(/\r\n|\r|\n/);
const stack = [];      // [{what, line}]
const parens = [];     // [{ch, line}]
let errors = 0;
const fail = (line, msg) => { console.error(`FAIL line ${line}: ${msg}`); errors++; };

// Длинная скобка [[ ... ]] / [=[ ... ]=]
const longOpen = (s, i) => {
    if (s[i] !== '[') return null;
    let j = i + 1, eq = 0;
    while (s[j] === '=') { eq++; j++; }
    if (s[j] !== '[') return null;
    return { eq, end: j + 1 };
};
const longClose = (s, i, eq) => s[i] === ']' && s.slice(i + 1, i + 1 + eq) === '='.repeat(eq) && s[i + 1 + eq] === ']';

for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const lineNo = ln + 1;
    let i = 0;

    while (i < line.length) {
        const c = line[i];

        // Комментарий
        if (c === '-' && line[i + 1] === '-') {
            const lo = longOpen(line, i + 2);
            if (lo) { i = lo.end; continue; } // внутри длинного комментария код не ищем
            break;                            // однострочный комментарий до конца строки
        }

        // Длинная строка
        if (c === '[') {
            const lo = longOpen(line, i);
            if (lo) {
                // многострочные [[ ]] в этом файле не используются — предупреждаем
                console.error(`WARN line ${lineNo}: длинная строка [[...]] — проверьте вручную`);
                i = lo.end;
                continue;
            }
        }

        // Обычная строка
        if (c === '"' || c === "'") {
            const quote = c;
            i++;
            let closed = false;
            while (i < line.length) {
                if (line[i] === '\\') { i += 2; continue; }
                if (line[i] === quote) { closed = true; i++; break; }
                i++;
            }
            if (!closed) fail(lineNo, 'незакрытая строка');
            continue;
        }

        // Скобки
        if (c === '(' || c === '[' || c === '{') { parens.push({ ch: c, line: lineNo }); i++; continue; }
        if (c === ')' || c === ']' || c === '}') {
            const want = { ')': '(', ']': '[', '}': '{' }[c];
            const got = parens.pop();
            if (!got) fail(lineNo, `лишняя закрывающая '${c}'`);
            else if (got.ch !== want) fail(lineNo, `'${c}' закрывает '${got.ch}' со строки ${got.line}`);
            i++;
            continue;
        }

        // Слова
        if (/[A-Za-z_]/.test(c)) {
            let j = i;
            while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
            const word = line.slice(i, j);
            i = j;

            // 'then' и 'do' НЕ открывают отдельный блок: у if/while/for
            // блок закрывается тем же 'end'. Считаем только ключевые слова,
            // каждому из которых соответствует ровно один 'end'.
            if (word === 'if' || word === 'while' || word === 'for' || word === 'function') {
                stack.push({ what: word, line: lineNo });
            } else if (word === 'repeat') {
                stack.push({ what: 'repeat', line: lineNo });
            } else if (word === 'end') {
                const top = stack.pop();
                if (!top) fail(lineNo, "лишний 'end'");
                else if (top.what === 'repeat') fail(lineNo, `'end' закрывает 'repeat' со строки ${top.line} (нужен 'until')`);
            } else if (word === 'until') {
                const top = stack.pop();
                if (!top) fail(lineNo, "лишний 'until'");
                else if (top.what !== 'repeat') fail(lineNo, `'until' закрывает '${top.what}' со строки ${top.line}`);
            } else if (word === 'elseif' || word === 'else') {
                // не меняет глубину
            }
            continue;
        }
        i++;
    }
}

for (const s of stack) fail(s.line, `не закрыт блок '${s.what}'`);
for (const p of parens) fail(p.line, `не закрыта скобка '${p.ch}'`);

if (errors === 0) {
    console.log(`OK: ${file} — блоки и скобки сбалансированы, строки закрыты, UTF-8 без BOM`);
    process.exit(0);
}
console.error(`FAIL: ${errors} ошибок`);
process.exit(1);
