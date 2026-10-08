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

console.log('\n== 3. Радиация и контейнеры ==');
// Правила заказчика: тир 3 влезает в полевой, тир 2 - в универсальный,
// тир 1 - в научный, уникальные не обнуляются даже научным.
const REQUIRED = {
    1: 'bq_sci_container',
    2: 'bq_uni_container',
    3: 'bq_field_container',
};
for (const a of B.ARTIFACTS) {
    const rad = a.stats.rad || 0;
    const fits = B.containersThatNeutralize(a.stats);
    if (a.tier === 'unique') {
        // уникальные должны фонить даже в научном
        if (fits.includes('bq_sci_container')) {
            err(`${a.ru}: уникальный, но научный контейнер его обнуляет (радиация ${rad} <= 14)`);
        } else {
            ok(`${a.ru}: радиация ${rad} > 14 — не обнуляется даже научным контейнером`);
        }
        continue;
    }
    const need = REQUIRED[a.tier];
    if (rad <= 0) {
        ok(`${a.ru} (тир ${a.tier}): радиация ${rad} — не фонит, влезает в любой контейнер`);
        continue;
    }
    if (!fits.includes(need)) {
        err(`${a.ru} (тир ${a.tier}): радиация ${rad} НЕ влезает в ${need} ` +
            `(поглощение ${B.ABSORB[need]}) — правило «тир ${a.tier} -> ${need}» нарушено`);
    } else {
        ok(`${a.ru} (тир ${a.tier}): радиация ${rad} <= ${B.ABSORB[need]} — влезает в ${need}`);
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
