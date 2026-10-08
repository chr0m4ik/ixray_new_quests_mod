// tools/check_balance.js
//
// Проверяет САМ БАЛАНС из tools/artifact_balance.js: не «так задумано», а
// «правила соблюдены». Если кто-то поправит характеристики и сломает правила
// (например, даст артефакту 3-го тира радиацию 10 и он перестанет влезать в
// полевой контейнер), проверка это поймает.
//
// Запуск из корня аддона:  node tools/check_balance.js

const B = require('./artifact_balance.js');

let errors = 0;
const err = (m) => { console.error('FAIL: ' + m); errors++; };
const ok = (m) => console.log('  ok: ' + m);

const STAT_KEYS = ['hp', 'bleed', 'power', 'weight', 'rad', 'satiety', 'radimm', 'burn', 'chem', 'psi', 'shock'];
const RUS = {
    hp: 'здоровье', bleed: 'раны', power: 'силы', weight: 'вес', rad: 'радиация',
    satiety: 'голод', radimm: 'радиозащита', burn: 'термо', chem: 'хим',
    psi: 'пси', shock: 'электро',
};

console.log('== 1. Количество свойств у каждого артефакта ==');
for (const a of B.ARTIFACTS) {
    const keys = STAT_KEYS.filter((k) => a.stats[k] !== undefined);
    const n = keys.length;
    // Требование заказчика: у каждого артефакта 3-4 свойства в сумме (защита от
    // типов урона тоже считается свойством). Исключение - два особых артефакта.
    if (a.special) {
        if (n !== 2 || a.stats.rad === undefined || a.stats.radimm === undefined) {
            err(`${a.ru}: у особого артефакта должно быть РОВНО 2 свойства ` +
                `(радиозащита + радиопоглощение), а есть [${keys.join(', ')}]`);
        } else {
            ok(`${a.ru}: ровно 2 свойства (радиозащита ${a.stats.radimm}, поглощение ${-a.stats.rad} )`);
        }
        continue;
    }
    // Уникальные богаче: в тир-листе заказчика у Компаса 6 свойств, у Сердца
    // Оазиса 5. Это их смысл - они выдаются за действия и в ограниченном
    // количестве, поэтому правило "3-4" на них не распространяется.
    if (a.tier === 'unique') {
        if (n < 4 || n > 6) err(`${a.ru}: у уникального ${n} свойств, ожидалось 4-6`);
        else ok(`${a.ru} (уникальный): ${n} свойств — ${keys.map((k) => RUS[k]).join(', ')}`);
        continue;
    }
    if (n < 3 || n > 4) {
        err(`${a.ru}: свойств ${n} ([${keys.join(', ')}]), а нужно 3-4`);
    } else {
        ok(`${a.ru} (тир ${a.tier}): ${n} свойства — ${keys.map((k) => RUS[k]).join(', ')}`);
    }
}

console.log('\n== 2. Сила по тирам (тир 1 > тир 2 > тир 3) ==');
// Сравниваем не абсолют, а среднее по сопоставимым свойствам: у тира 1 значения
// должны быть заметно выше, чем у тира 3. Радиацию исключаем - она не "сила".
const SCALED = ['hp', 'bleed', 'power', 'burn', 'chem', 'psi', 'shock', 'radimm'];
const avg = (tier) => {
    const vals = [];
    for (const a of B.ARTIFACTS) {
        if (a.tier !== tier) continue;
        for (const k of SCALED) if (a.stats[k] !== undefined) vals.push(a.stats[k]);
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
};
// Радиозащита Медузы/Пузыря выброс: она на порядок больше остальных, поэтому
// при сравнении тиров считаем её отдельно.
const avgNoRadImm = (tier) => {
    const vals = [];
    for (const a of B.ARTIFACTS) {
        if (a.tier !== tier) continue;
        if (a.special) continue;
        for (const k of SCALED.filter((x) => x !== 'radimm')) {
            if (a.stats[k] !== undefined) vals.push(a.stats[k]);
        }
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
};
const t1 = avgNoRadImm('1'), t2 = avgNoRadImm('2'), t3 = avgNoRadImm('3');
console.log(`  средняя величина свойства: тир1 ${t1.toFixed(4)}, тир2 ${t2.toFixed(4)}, тир3 ${t3.toFixed(4)}`);
if (!(t1 > t2 && t2 > t3)) {
    err(`нарушен порядок силы тиров: тир1 ${t1.toFixed(4)} > тир2 ${t2.toFixed(4)} > тир3 ${t3.toFixed(4)}`);
} else {
    ok('тир 1 сильнее тира 2, тир 2 сильнее тира 3');
}

console.log('\n== 3. Радиация: диапазоны по тирам ==');
// Правило заказчика (уточнено): у артефакта радиация НЕ НИЖЕ 3, кроме Медузы и
// Пузыря, которые радиацию ВЫВОДЯТ. Диапазон считается вокруг поглощения
// контейнера своего тира:
//   тир 3: 3..7   (полевой 4,  разброс +-3)
//   тир 2: 7..12  (универсальный 8, разброс +4 вверх)
//   тир 1: 9..14  (универсальный 8 + 6)
//   уникальные: 17..19 (научный 14 + 3..5)
// Артефакты, ВЫВОДЯЩИЕ радиацию (отрицательная), под диапазон не попадают.
const RAD_RANGE = {
    1: [9, 14],
    2: [7, 12],
    3: [3, 7],
    unique: [17, 19],
};
for (const a of B.ARTIFACTS) {
    const rad = a.stats.rad;
    if (rad === undefined) { err(`${a.ru}: не задана радиация`); continue; }
    if (rad < 0) {
        ok(`${a.ru}: выводит радиацию ${-rad} — под диапазон тира не попадает (исключение)`);
        continue;
    }
    const [lo, hi] = RAD_RANGE[a.tier];
    if (rad < lo || rad > hi) {
        err(`${a.ru} (тир ${a.tier}): радиация ${rad} вне диапазона ${lo}..${hi}`);
    } else {
        ok(`${a.ru} (тир ${a.tier}): радиация ${rad} в диапазоне ${lo}..${hi}`);
    }
}

// Градиент редкости: внутри тира артефакты с БОЛЬШЕЙ радиацией должны быть реже.
// Пока это проверяется мягко: в тире должны присутствовать разные значения
// радиации и хотя бы один артефакт с радиацией выше середины диапазона (он реже).
console.log('\n== 3b. Градиент редкости внутри тира ==');
for (const tier of ['1', '2', '3', 'unique']) {
    const vals = B.ARTIFACTS.filter((a) => a.tier === tier && a.stats.rad > 0)
        .map((a) => a.stats.rad).sort((x, y) => x - y);
    if (!vals.length) { err(`тир ${tier}: нет артефактов с положительной радиацией`); continue; }
    const uniq = [...new Set(vals)];
    if (uniq.length < 2) {
        // У уникальных радиация может совпадать: их редкость задаётся не тиром и
        // не радиацией, а способом получения (Компас - до 3 раз, Сердце Оазиса -
        // 1 раз), поэтому градиент по радиации к ним не применяется.
        if (tier === 'unique') {
            ok(`тир unique: радиация ${uniq[0]} у всех — редкость задаётся способом ` +
                `получения, а не радиацией`);
        } else {
            err(`тир ${tier}: у всех артефактов одинаковая радиация (${uniq[0]}), ` +
                `а нужен градиент редкости`);
        }
    } else {
        ok(`тир ${tier}: радиация от ${uniq[0]} до ${uniq[uniq.length - 1]} ` +
            `(${uniq.length} разных значений -> выше радиация, реже артефакт)`);
    }
}

console.log('\n== 4. Медуза и Пузырь ==');
const medusa = B.ARTIFACTS.find((a) => a.map.includes('af_medusa'));
const bubble = B.ARTIFACTS.find((a) => a.map.includes('af_baloon'));
if (!medusa || !bubble) err('не найдены Медуза или Пузырь');
else {
    // Заказчик: Пузырь в 2-3 раза сильнее Медузы; Медуза - уровень оригинала.
    const k = -bubble.stats.rad / -medusa.stats.rad;
    if (k < 2 || k > 3) err(`Пузырь сильнее Медузы в ${k.toFixed(1)} раза, а нужно 2-3`);
    else ok(`Пузырь выводит радиацию в ${k.toFixed(1)} раза сильнее Медузы`);
    const ki = bubble.stats.radimm / medusa.stats.radimm;
    if (ki < 2 || ki > 3) err(`радиозащита Пузыря больше Медузы в ${ki.toFixed(1)} раза, а нужно 2-3`);
    else ok(`радиозащита Пузыря в ${ki.toFixed(1)} раза выше Медузы`);
    if (medusa.tier !== '3') err(`Медуза должна быть 3-го тира, а она ${medusa.tier}`);
    if (bubble.tier !== '1') err(`Пузырь должен быть 1-го тира, а он ${bubble.tier}`);
}

console.log('\n== 5. Секции не дублируются ==');
const seen = new Map();
for (const a of B.ARTIFACTS) {
    for (const s of a.map) {
        if (seen.has(s)) err(`секция ${s} встречается и у «${seen.get(s)}», и у «${a.ru}»`);
        seen.set(s, a.ru);
    }
}
for (const s of B.QUEST_SECTIONS) {
    if (seen.has(s)) err(`квестовая секция ${s} попала в список артефактов`);
}
ok(`секций в балансе: ${seen.size}, квестовых отдельно: ${B.QUEST_SECTIONS.length}`);

console.log(`\nвсего артефактов: ${B.ARTIFACTS.length}, комбо будет: ` +
    `${B.ARTIFACTS.reduce((n, a) => n + B.CONTAINERS.length, 0)}`);

if (errors === 0) {
    console.log('\nOK: баланс согласован, правила соблюдены.');
    process.exit(0);
}
console.error(`\nFAIL: ${errors} ошибок`);
process.exit(1);
