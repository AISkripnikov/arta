// Задания кампании, типы целей и генерация карты.

/** Детерминированный ГПСЧ (для карты). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAP = 20; // км

/** Свои корабли: hp, скорость (км/ч). */
export const FRIEND_KINDS = {
  patrol:    { name: 'Сторожевой катер', hp: 2, speed: 20, names: ['Стриж', 'Чайка', 'Буревестник', 'Кречет'] },
  transport: { name: 'Транспорт',        hp: 3, speed: 22, names: ['Онега', 'Вятка', 'Двина', 'Ладога'] },
};

// gun: { range (км), period (с), dmg, p } — ответный огонь по батарее
export const KINDS = {
  barge:      { name: 'Баржа',             site: 'sea',    armored: false, hp: 1, radius: 0.07, speed: 0 },
  depot:      { name: 'Склад на острове',  site: 'island', armored: false, hp: 1, radius: 0.07, speed: 0 },
  battery:    { name: 'Береговая батарея', site: 'island', armored: false, hp: 2, radius: 0.06, speed: 0, gun: { range: 99, period: 32, dmg: 5, p: 0.4 } },
  bunker:     { name: 'Бетонный ДОТ',      site: 'island', armored: true,  hp: 2, radius: 0.05, speed: 0, gun: { range: 99, period: 45, dmg: 4, p: 0.4 } },
  transport:  { name: 'Транспорт',         site: 'sea',    armored: false, hp: 2, radius: 0.08, speed: 14, end: 'escape' },
  landing:    { name: 'Десантные катера',  site: 'sea',    armored: false, hp: 1, radius: 0.08, speed: 28, end: 'land' },
  destroyer:  { name: 'Эсминец',           site: 'sea',    armored: false, hp: 2, radius: 0.07, speed: 24, end: 'patrol', gun: { range: 13, period: 30, dmg: 4, p: 0.4 } },
  cruiser:    { name: 'Крейсер',           site: 'sea',    armored: true,  hp: 3, radius: 0.09, speed: 18, end: 'patrol', gun: { range: 17, period: 34, dmg: 6, p: 0.4 } },
  minelayer:  { name: 'Минный заградитель', site: 'sea',  armored: false, hp: 1, radius: 0.07, speed: 32, end: 'escape' },
  howitzer:   { name: 'Гаубичная батарея', site: 'island', armored: false, hp: 2, radius: 0.06, speed: 0, gun: { range: 99, period: 28, dmg: 5, p: 0.35 } },
  radar:      { name: 'Радиолокационная станция', site: 'island', armored: false, hp: 1, radius: 0.05, speed: 0, spotter: true },
  fort:       { name: 'Береговой форт', site: 'island', armored: true, hp: 3, radius: 0.07, speed: 0, gun: { range: 99, period: 30, dmg: 7, p: 0.4 } },
  submarine:  { name: 'Подводная лодка', site: 'sea', armored: false, hp: 1, radius: 0.05, speed: 16, end: 'dive' },
  tanker:     { name: 'Танкер', site: 'sea', armored: false, hp: 3, radius: 0.1, speed: 11, end: 'escape' },
  battleship: { name: 'Линкор',            site: 'sea',    armored: true,  hp: 4, radius: 0.11, speed: 12, end: 'patrol', gun: { range: 21, period: 40, dmg: 7, p: 0.4 } },
};

// range — км от батареи; bearing — ° (сектор от и до, по часовой; допускается переход через 0)
export const CAMPAIGN = [
  {
    id: 'm1', name: 'Пристрелка', seed: 11, tutorial: true, shells: { he: 8, ap: 0 },
    targets: [{ kind: 'barge', range: [6.2, 7.6], bearing: [340, 25] }],
    brief: 'Учебная стрельба по брошенной барже. Противника нет, спешить некуда.\n\nПройдите всю процедуру по постам слева направо: ПЛАНШЕТ → ВЫЧИСЛИТЕЛЬ → ЗАРЯЖАНИЕ → ПОВОРОТ → ПОДЪЁМ → ОГОНЬ. Подсказка внизу экрана скажет, что делать дальше.\n\nНа будущее: противник не видит батарею, пока она молчит. Его орудия начнут бить прицельно только после вашего первого выстрела — по вспышке.',
  },
  {
    id: 'm2', name: 'Два ориентира', seed: 22, shells: { he: 10, ap: 0 },
    targets: [{ kind: 'barge', range: [4.5, 7.5], bearing: [300, 350] }, { kind: 'depot', range: [9.5, 13] }],
    brief: 'Две цели на разных дальностях. Для каждой — свой заряд: лампы на вычислителе покажут, какие заряды достают.\n\nПосле разрыва корректировщик сообщит отклонение. Перелёт — уменьшайте дальность на вычислителе и пересчитывайте угол. Ушло вправо — доверните башню влево.',
  },
  {
    id: 'm3', name: 'Бетон', seed: 33, shells: { he: 6, ap: 6 },
    targets: [{ kind: 'bunker', range: [8, 12] }, { kind: 'depot', range: [9, 14] }],
    brief: 'На острове — бетонный ДОТ, он ведёт огонь по батарее. Фугасный снаряд его не берёт: нужен бронебойный (ББ) и прямое попадание.\n\nСледите за прочностью батареи.',
  },
  {
    id: 'm4', wind: [2, 5], name: 'Конвой', seed: 44, shells: { he: 12, ap: 0 },
    targets: [{ kind: 'transport', range: [8, 11], bearing: [320, 40], path: 11 }, { kind: 'barge', range: [5, 8] }],
    brief: 'Транспорт противника идёт вдоль берега. Разведка сообщает его координаты, курс и скорость.\n\nСтреляйте с упреждением: наводитесь в точку, где цель окажется через время подготовки и полёта снаряда. Секундомер и время полёта — на посту ОГОНЬ и вычислителе. Уйдёт — задание провалено.',
  },
  {
    id: 'm5', wind: [2, 6], name: 'Десант', seed: 55, shells: { he: 14, ap: 0 },
    targets: [{ kind: 'landing', range: [9.5, 11], bearing: [325, 355] }, { kind: 'landing', range: [10.5, 12], bearing: [5, 35] }],
    brief: 'Две группы десантных катеров идут к нашему берегу. Каждая минута на счету: высадятся — батарея потеряна.\n\nКатера быстрые, упреждение берите с запасом.',
  },
  {
    id: 'm6', wind: [3, 7], name: 'Дуэль', seed: 66, shells: { he: 12, ap: 4 },
    targets: [{ kind: 'destroyer', range: [9, 12], bearing: [330, 30], path: 6 }, { kind: 'battery', range: [10, 14] }],
    brief: 'Эсминец и береговая батарея на острове ведут по вам огонь. Эсминец ходит галсами — следите за сменой курса в донесениях.\n\nРешайте, кого подавить первым.',
  },
  {
    id: 'm7', wind: [3, 8], name: 'Ночной конвой', seed: 77, shells: { he: 12, ap: 8 },
    targets: [{ kind: 'cruiser', range: [11, 14], bearing: [340, 20], path: 7 }, { kind: 'transport', range: [9, 12], bearing: [300, 340], path: 12 }, { kind: 'transport', range: [10, 13], bearing: [20, 60], path: 12 }],
    brief: 'Конвой под охраной крейсера. Крейсер бронирован — по нему только бронебойными. Транспорты нельзя упустить.',
  },
  {
    id: 'm8', wind: [4, 9], name: 'Линкор', seed: 88, shells: { he: 10, ap: 12 },
    targets: [{ kind: 'battleship', range: [14, 17], bearing: [345, 15], path: 6 }, { kind: 'destroyer', range: [9, 12], bearing: [300, 340], path: 6 }, { kind: 'bunker', range: [8, 13] }],
    brief: 'К берегу подошёл линкор. Его главный калибр разнесёт батарею за считанные минуты.\n\nПредельные дальности, шестой заряд, бронебойные. Всё, чему вы научились.',
  },

  // ---------------- КОНТРБАТАРЕЙНАЯ БОРЬБА ----------------
  {
    id: 'm9', wind: [2, 6], name: 'Звукометрия', seed: 99, shells: { he: 12, ap: 0 },
    targets: [{ kind: 'battery', locate: 'sound', range: [9, 13] }, { kind: 'barge', range: [5, 8] }],
    brief: 'Батарея противника замаскирована на острове — разведка её не видит. Но каждый её залп слышат два наших поста звукометрии на берегу (ЗВ-1 и ЗВ-2).\n\nПосты сообщают только пеленг на звук. На ПЛАНШЕТЕ от каждого поста проведена линия пеленга — батарея там, где линии пересекаются. Поставьте фишку в точку пересечения (лупа поможет) и стреляйте как обычно.',
  },
  {
    id: 'm10', wind: [3, 7], name: 'Огневой налёт', seed: 110, shells: { he: 14, ap: 0, smoke: 2 },
    targets: [{ kind: 'battery', locate: 'sound', range: [8, 12] }, { kind: 'howitzer', locate: 'sound', range: [11, 16] }],
    brief: 'Две скрытые батареи ведут огонь по «Утёсу». Каждый ваш выстрел помогает противнику уточнить вашу позицию — с каждым залпом они бьют точнее.\n\nСначала подавите ту, что ближе и опаснее. Не тратьте снаряды впустую.',
  },
  {
    id: 'm11', wind: [3, 8], name: 'Кочующая батарея', seed: 121, shells: { he: 14, ap: 6 },
    targets: [{ kind: 'howitzer', locate: 'sound', relocate: 3, range: [10, 14] }, { kind: 'bunker', range: [8, 12] }],
    brief: 'Гаубичная батарея после каждых трёх залпов снимается и переезжает на новую позицию на том же острове. Звукометристы засекут её заново — старая засечка станет бесполезной.\n\nБейте быстро, пока она не ушла. ДОТ — только бронебойными.',
  },
  {
    id: 'm12', wind: [4, 8], name: 'Минный заградитель', seed: 132, shells: { he: 14, ap: 4 },
    targets: [{ kind: 'minelayer', range: [9, 12], bearing: [320, 40], path: 10 }, { kind: 'destroyer', range: [10, 13], bearing: [330, 30], path: 6 }],
    brief: 'Быстроходный минный заградитель ставит мины на подходах к порту под прикрытием эсминца. Заградитель идёт 32 км/ч — упреждение большое.\n\nЕсли он уйдёт, фарватер будет закрыт.',
  },
  {
    id: 'm13', wind: [3, 8], name: 'Волны десанта', seed: 143, shells: { he: 18, ap: 0, shrap: 4 },
    targets: [{ kind: 'landing', range: [10, 12], bearing: [330, 355] }, { kind: 'landing', range: [10.5, 12.5], bearing: [5, 30], delay: 70 }, { kind: 'landing', range: [11, 13], bearing: [340, 20], delay: 140 }],
    brief: 'Противник высаживает десант волнами. Разведка сообщит о каждой новой группе катеров, когда та выйдет из-за островов.\n\nНе дайте ни одной группе дойти до берега.',
  },
  {
    id: 'm14', wind: [4, 9], name: 'Ночная дуэль', seed: 154, shells: { he: 12, ap: 10 },
    targets: [{ kind: 'cruiser', range: [11, 14], bearing: [340, 20], path: 7 }, { kind: 'battery', locate: 'sound', range: [9, 13] }, { kind: 'howitzer', locate: 'sound', relocate: 4, range: [12, 16] }],
    brief: 'Ночь. Крейсер прикрывает две скрытые батареи на островах. Крейсер — бронебойными, батареи — по засечкам звукометрии.\n\nСледите за прочностью: огонь трёх стволов быстро разрушит позицию.',
  },
  {
    id: 'm15', wind: [5, 10], name: 'Береговой щит', seed: 165, shells: { he: 14, ap: 12 },
    targets: [{ kind: 'battleship', range: [14, 17], bearing: [345, 15], path: 6 }, { kind: 'minelayer', range: [9, 12], bearing: [300, 340], path: 10, delay: 60 }, { kind: 'howitzer', locate: 'sound', relocate: 3, range: [10, 15] }],
    brief: 'Линкор ведёт огонь главным калибром, пока заградитель ставит мины, а кочующая гаубичная батарея на острове корректирует свой огонь по вашим вспышкам.\n\nРаспределите снаряды с умом.',
  },
  {
    id: 'm16', wind: [5, 10], name: 'Последний рубеж', seed: 176, shells: { he: 20, ap: 12, shrap: 3 },
    targets: [{ kind: 'battleship', range: [14, 17], bearing: [345, 15], path: 6 }, { kind: 'battery', locate: 'sound', relocate: 4, range: [9, 13] }, { kind: 'landing', range: [10, 12], bearing: [330, 355], delay: 40 }, { kind: 'landing', range: [10.5, 12.5], bearing: [5, 30], delay: 120 }],
    brief: 'Решающий бой. Линкор, скрытая батарея и две волны десанта. Батарея «Утёс» — последнее, что стоит между противником и городом.\n\nУдачи, командир.',
  },

  // ---------------- ЧАСТЬ III · ОСТРОВА В ОГНЕ ----------------
  {
    id: 'm17', wind: [3, 7], name: 'Глаза противника', seed: 187, shells: { he: 14, ap: 0 },
    targets: [{ kind: 'radar', range: [10, 14] }, { kind: 'battery', range: [8, 12] }],
    brief: 'На острове работает радиолокационная станция противника. Пока она цела, батареи противника стреляют по «Утёсу» заметно точнее.\n\nСначала ослепите противника — уничтожьте РЛС.',
  },
  {
    id: 'm18', wind: [3, 8], name: 'Подлодка', seed: 198, shells: { he: 14, ap: 0 },
    targets: [{ kind: 'submarine', range: [8, 11], bearing: [320, 40], path: 6 }, { kind: 'barge', range: [5, 8] }],
    brief: 'Подводная лодка всплыла для зарядки батарей. Пройдя около 6 км, она погрузится и уйдёт — у вас несколько минут.\n\nЦель маленькая: точное упреждение и, если нужно, очередь.',
  },
  {
    id: 'm19', wind: [4, 8], name: 'Форт', seed: 209, shells: { he: 10, ap: 12 },
    targets: [{ kind: 'fort', range: [9, 13] }, { kind: 'radar', range: [11, 15] }],
    brief: 'Береговой форт с толстыми бетонными стенами: только бронебойные, нужно три прямых попадания. РЛС на соседнем острове наводит его огонь.\n\nВыбирайте порядок сами.',
  },
  {
    id: 'm20', wind: [3, 8], name: 'Танкеры', seed: 220, raids: [{ at: 120, planes: 2, from: 340 }], shells: { he: 18, ap: 4 },
    targets: [{ kind: 'tanker', range: [9, 12], bearing: [310, 350], path: 11 }, { kind: 'tanker', range: [10, 13], bearing: [10, 50], path: 11, delay: 50 }, { kind: 'destroyer', range: [10, 13], bearing: [330, 30], path: 6 }],
    brief: 'Два танкера везут топливо для флота противника. Каждый выдерживает три попадания. Эсминец прикрывает конвой.\n\nНе дайте уйти ни одному танкеру.',
  },
  {
    id: 'm21', wind: [4, 9], name: 'Ночная охота', seed: 231, shells: { he: 18, ap: 0 },
    targets: [{ kind: 'submarine', range: [9, 12], bearing: [300, 345], path: 7 }, { kind: 'minelayer', range: [10, 12], bearing: [15, 45], path: 10, delay: 60 }, { kind: 'barge', range: [6, 9] }],
    brief: 'Ночь. Подлодка и минный заградитель пытаются проскочить мимо батареи. Обе цели быстро уйдут из зоны огня.\n\nРаспределяйте время: на каждую цель — один-два точных залпа.',
  },
  {
    id: 'm22', wind: [4, 9], name: 'Сеть радаров', seed: 242, shells: { he: 18, ap: 0, smoke: 3 },
    targets: [{ kind: 'radar', range: [9, 13] }, { kind: 'radar', range: [12, 16] }, { kind: 'howitzer', locate: 'sound', relocate: 3, range: [10, 15] }],
    brief: 'Две РЛС противника наводят кочующую гаубичную батарею. Пока работает хотя бы одна станция, гаубицы бьют точно.\n\nРешайте: ослепить противника или сразу охотиться за батареей по звуку.',
  },
  {
    id: 'm23', wind: [5, 10], name: 'Штурм форта', seed: 253, shells: { he: 16, ap: 12 },
    targets: [{ kind: 'fort', range: [9, 12] }, { kind: 'battery', locate: 'sound', range: [11, 15] }, { kind: 'landing', range: [10, 12], bearing: [330, 355], delay: 90 }],
    brief: 'Форт прикрывает высадку десанта, а скрытая батарея поддерживает его огнём. Катера выйдут через полторы минуты.\n\nСильный ветер — следите за поправками.',
  },
  {
    id: 'm24', wind: [5, 10], name: 'Генеральное сражение', seed: 264, raids: [{ at: 110, planes: 3, from: 20 }], shells: { he: 22, ap: 14 },
    targets: [{ kind: 'battleship', range: [14, 17], bearing: [345, 15], path: 6 }, { kind: 'fort', range: [9, 13] }, { kind: 'radar', range: [11, 15] }, { kind: 'submarine', range: [9, 11], bearing: [300, 340], path: 7, delay: 80 }, { kind: 'landing', range: [10, 12], bearing: [5, 30], delay: 150 }],
    brief: 'Всё, что есть у противника, — против одной батареи. Линкор, форт, РЛС, подлодка и десант.\n\nЭто последний бой кампании. Удачи, командир.',
  },
  // ---------------- ЧАСТЬ IV · НОЧЬ И ТУМАН ----------------
  {
    id: 'm25', name: 'Свет над водой', seed: 275, night: true, shells: { he: 10, ap: 0, illum: 6 },
    targets: [{ kind: 'barge', range: [6, 9], bearing: [330, 30] }, { kind: 'depot', range: [9, 13] }],
    brief: 'Ночь. Разведка целей не видит — штаб даёт только квадрат 2×2 км, где стоит цель.\n\nПовесьте над квадратом осветительный снаряд (ОСВ): целясь в центр квадрата, вы осветите круг радиусом 1,5 км на одну минуту. Освещённую цель разведка сообщит с точными координатами — дальше бейте фугасными как обычно.',
  },
  {
    id: 'm26', wind: [2, 5], name: 'Конвой в тумане', seed: 286, weather: 'fog', shells: { he: 22, ap: 0 },
    targets: [{ kind: 'transport', range: [8, 11], bearing: [315, 350], path: 12 }, { kind: 'tanker', range: [9, 12], bearing: [10, 45], path: 11, delay: 40 }, { kind: 'barge', range: [5, 8] }],
    brief: 'Густой туман. Разведка видит цели урывками: донесения приходят вдвое реже, координаты — с точностью до ста метров, а корректировщик оценивает отклонения лишь с точностью до пятидесяти.\n\nКонвой не должен уйти. Пристреливайтесь и не жалейте снарядов — очередь или «вилка» помогут накрыть цель.',
  },
  {
    id: 'm27', wind: [5, 9], name: 'Штормовая дуэль', seed: 297, weather: 'storm', raids: [{ at: 90, planes: 2, from: 310 }], shells: { he: 16, ap: 4, smoke: 3 },
    targets: [{ kind: 'destroyer', range: [9, 12], bearing: [330, 30], path: 6 }, { kind: 'battery', range: [10, 14] }],
    brief: 'Шторм. Ветер меняется каждые полторы-две минуты — МЕТЕО сообщит по радио. После каждой смены ветра расчёт вычислителя устаревает: пересчитайте угол и поправку пеленга.\n\nЭсминец и береговая батарея бьют по «Утёсу». Дымовой снаряд (ДЫМ), положенный в 1–4 км от батареи в сторону противника, на минуту сбивает ему прицел.',
  },
  {
    id: 'm28', wind: [3, 7], name: 'Шрапнель', seed: 308, weather: 'fog', shells: { he: 8, ap: 0, shrap: 14 },
    targets: [{ kind: 'landing', range: [10, 12], bearing: [325, 350] }, { kind: 'landing', range: [10.5, 12.5], bearing: [10, 35], delay: 50 }, { kind: 'landing', range: [11, 13], bearing: [340, 15], delay: 110 }, { kind: 'landing', range: [11, 13], bearing: [315, 340], delay: 170 }],
    brief: 'Четыре волны десантных катеров идут к берегу в тумане. Координаты неточны — фугасным в катер не попасть.\n\nШрапнель (ШРП) рвётся в воздухе и выкашивает десант в радиусе втрое большем, чем размер цели. По кораблям и постройкам она почти бесполезна.',
  },
  {
    id: 'm29', wind: [3, 8], name: 'Дуэль во тьме', seed: 319, night: true, shells: { he: 16, ap: 8, illum: 8, smoke: 4 },
    targets: [{ kind: 'battery', range: [9, 13] }, { kind: 'bunker', range: [8, 12] }, { kind: 'howitzer', locate: 'sound', range: [11, 15] }],
    brief: 'Ночь. На островах — батарея и ДОТ, их выдают только вспышки выстрелов: по вспышке разведка даёт координаты с точностью до полукилометра. Этого мало — подсветите цель осветительным и бейте точно.\n\nГаубицы засекают звукометристы, как и днём. Дымовая завеса прикроет «Утёс», пока вы возитесь со светом.',
  },
  {
    id: 'm30', wind: [5, 9], name: 'Ночь и туман', seed: 330, night: true, weather: 'storm', shells: { he: 20, ap: 14, illum: 12, smoke: 4, shrap: 8 },
    targets: [{ kind: 'cruiser', range: [11, 14], bearing: [340, 20], path: 7 }, { kind: 'battery', locate: 'sound', range: [9, 13] }, { kind: 'landing', range: [10.5, 12], bearing: [320, 350], delay: 80 }, { kind: 'landing', range: [11, 12.5], bearing: [10, 40], delay: 170 }],
    brief: 'Штормовая ночь. Крейсер, скрытая батарея и две волны десанта — и всё это в темноте, при ветре, который меняется каждую минуту.\n\nСвет, дым, шрапнель, бронебойные — у вас есть всё. Это последний бой. Удачи, командир.',
  },
  // ---------------- ЧАСТЬ V · КОНВОЙ ----------------
  // friends: path — точки [dx, dy] в км от батареи; near — индекс цели, возле которой ходит дозор
  {
    id: 'm31', wind: [2, 5], name: 'Проводка', seed: 341, shells: { he: 18, ap: 0, smoke: 3 },
    friends: [
      { kind: 'transport', convoy: true, path: [[-3, 4], [1.6, 4]] },
      { kind: 'transport', convoy: true, path: [[-3.6, 4], [1, 4]] },
      { kind: 'transport', convoy: true, path: [[-4.2, 4], [0.4, 4]] },
    ],
    targets: [{ kind: 'destroyer', hunts: true, range: [9, 11], bearing: [345, 20] }, { kind: 'submarine', hunts: true, range: [8.5, 10], bearing: [310, 335], delay: 80 }],
    brief: 'Мимо «Утёса» идёт наш конвой — три транспорта. Они отмечены на планшете как «СВОИ», их положение известно всегда.\n\nЭсминец и подводная лодка противника охотятся на конвой. Утопите их раньше, чем они утопят транспорты, — или продержитесь, пока конвой не дойдёт до порта. Дымовой снаряд, положенный рядом с транспортом (до 1,2 км), сбивает охотникам прицел.\n\nСнаряд, упавший ближе 250 м от своего корабля, попадёт по нему. За каждого потопленного своего — минус звезда.',
  },
  {
    id: 'm32', wind: [3, 6], name: 'Воздух!', seed: 352, shells: { he: 20, ap: 0, smoke: 3 },
    raids: [{ at: 50, planes: 2, from: 335 }, { at: 135, planes: 3, from: 25 }],
    friends: [
      { kind: 'transport', convoy: true, path: [[-3, 4], [1.6, 4]] },
      { kind: 'transport', convoy: true, path: [[-3.6, 4], [1, 4]] },
    ],
    targets: [{ kind: 'destroyer', hunts: true, range: [9, 11], bearing: [340, 20] }, { kind: 'battery', range: [10, 14] }],
    brief: 'Конвой идёт под ударами с моря и с воздуха. За десять секунд до налёта радист крикнет «ВОЗДУХ!» — переходите на пост ЗЕНИТКА.\n\nКольцевой прицел упреждения не требует: держите самолёт в кольце и давите гашетку. Автомат греется — бейте короткими очередями, иначе заклинит. Каждый прорвавшийся самолёт сбросит бомбы на батарею.\n\nГлавный калибр во время налёта работает как обычно: эсминец охотится на транспорты.',
  },
  {
    id: 'm33', wind: [2, 5], name: 'Свой в тумане', seed: 363, weather: 'fog', shells: { he: 22, ap: 0 },
    friends: [{ kind: 'patrol', near: 0, loop: true }],
    targets: [{ kind: 'barge', range: [6.5, 8.5], bearing: [345, 15] }, { kind: 'transport', range: [8.5, 11], bearing: [300, 330], path: 12 }, { kind: 'depot', range: [9, 13] }],
    brief: 'Туман. У баржи с боеприпасами противника крутится наш сторожевой катер — ведёт разведку и уходить не собирается.\n\nПрежде чем стрелять по барже, посмотрите на планшет: свой катер должен быть не ближе 400 метров от точки прицеливания. В тумане корректировщик видит плохо, а с наблюдательного поста дальше четырёх километров не видно ничего.\n\nТранспорт уйти не должен.',
  },
  {
    id: 'm34', wind: [2, 6], name: 'Рейдеры во тьме', seed: 374, night: true, noSpotter: true, shells: { he: 20, ap: 0, illum: 12, smoke: 3 },
    friends: [
      { kind: 'transport', convoy: true, path: [[-3, 4], [1.6, 4]] },
      { kind: 'transport', convoy: true, path: [[-3.6, 4], [1, 4]] },
      { kind: 'transport', convoy: true, path: [[-4.2, 4], [0.4, 4]] },
    ],
    targets: [{ kind: 'destroyer', hunts: true, range: [9, 11], bearing: [345, 20] }, { kind: 'minelayer', hunts: true, range: [9, 10.5], bearing: [310, 335], delay: 90 }],
    brief: 'Ночь. На конвой вышли рейдеры. Их выдают только вспышки выстрелов по транспортам — подсветите квадрат осветительным, и разведка даст точные координаты.\n\nКорректировщик этой ночью на связь не вышел. Разрывы наблюдайте сами: на посту НАБЛЮДЕНИЕ наведите трубу на освещённую цель — расчёт доложит, куда лёг снаряд относительно неё.',
  },
  {
    id: 'm35', wind: [3, 7], name: 'Дозор у берега', seed: 385, shells: { he: 18, ap: 0, shrap: 8, smoke: 2 },
    raids: [{ at: 95, planes: 3, from: 350 }],
    friends: [{ kind: 'patrol', path: [[-3, 2.6], [3, 2.6]], loop: true }],
    targets: [{ kind: 'howitzer', locate: 'sound', range: [10, 14] }, { kind: 'landing', range: [10, 11.5], bearing: [330, 355], delay: 20 }, { kind: 'landing', range: [10.5, 12], bearing: [5, 30], delay: 110 }],
    brief: 'Десант идёт к берегу, скрытая гаубичная батарея бьёт по «Утёсу», а в воздухе — тройка бомбардировщиков.\n\nВдоль берега ходит наш сторожевой катер. Шрапнель косит десант в широком круге — и своих тоже. Бейте катера противника подальше от берега, пока они не подошли к дозору.',
  },
  {
    id: 'm36', wind: [4, 8], name: 'Конвой прорвался', seed: 396, shells: { he: 22, ap: 14, smoke: 4 },
    raids: [{ at: 70, planes: 3, from: 330 }, { at: 200, planes: 4, from: 30 }],
    friends: [
      { kind: 'transport', convoy: true, path: [[-3, 4], [1.6, 4]] },
      { kind: 'transport', convoy: true, path: [[-3.6, 4], [1, 4]] },
      { kind: 'transport', convoy: true, path: [[-4.2, 4], [0.4, 4]] },
      { kind: 'patrol', path: [[-2.4, 4.7], [2.2, 4.7]] },
    ],
    targets: [{ kind: 'cruiser', hunts: true, range: [10.5, 12.5], bearing: [345, 20] }, { kind: 'destroyer', hunts: true, range: [9, 10.5], bearing: [310, 335], delay: 70 }, { kind: 'battery', locate: 'sound', range: [10, 14] }],
    brief: 'Последний конвой с подкреплением идёт в порт. Противник бросил на него всё: крейсер, эсминец, скрытую батарею и две волны авиации.\n\nКрейсер — только бронебойными. Конвой прикрывает сторожевой катер — не заденьте его. Дым у транспортов, зенитка по самолётам, главный калибр по рейдерам.\n\nДоведите конвой, командир.',
  },
];

export function skirmishDef(difficulty) {
  const pool = ['barge', 'depot', 'transport', 'battery', 'howitzer', 'radar', 'destroyer', 'bunker', 'landing', 'minelayer', 'submarine', 'tanker', 'cruiser', 'fort'];
  const n = 2 + Math.floor(Math.random() * 2), targets = [];
  for (let i = 0; i < n; i++) {
    const kind = pool[Math.floor(Math.random() * (difficulty ? pool.length : 5))];
    const r0 = 5 + Math.random() * 9;
    const hidden = (kind === 'battery' || kind === 'howitzer') && Math.random() < 0.6;
    targets.push({ kind, range: [r0, r0 + 2], path: 8, locate: hidden ? 'sound' : undefined, relocate: hidden && difficulty && Math.random() < 0.5 ? 3 : 0 });
  }
  return {
    id: 'skirmish', name: 'Свободный бой', seed: Math.floor(Math.random() * 1e9), skirmish: true,
    shells: { he: 12, ap: 8, shrap: 2, smoke: 1 }, targets, wind: difficulty ? [3, 9] : [0, 5],
    brief: 'Случайная боевая задача. Уничтожьте все цели.',
  };
}

/** Режим «ОБОРОНА»: стартовое описание (цели приходят волнами — survivalWave). */
export function survivalDef() {
  return {
    id: 'survival', name: 'Оборона', seed: Math.floor(Math.random() * 1e9), survival: true,
    shells: { he: 14, ap: 6, illum: 1, smoke: 2, shrap: 3 }, targets: [], wind: [0, 0],
    brief: 'Противник идёт волна за волной. Держитесь, сколько сможете.\n\nПосле каждой отбитой волны батарею подлатают (+25 прочности) и подвезут снаряды. Ушедшая или высадившаяся цель стоит 25 прочности. Бой кончится, когда батарея будет разбита.',
  };
}

/** Состав волны n (1…): 2–4 цели, с ростом волн — опаснее; скрытые батареи с 3-й волны; ветер со 2-й. */
export function survivalWave(n, difficulty) {
  const tiers = [
    ['barge', 'depot', 'transport'],
    ['transport', 'battery', 'landing', 'radar', 'minelayer'],
    ['destroyer', 'howitzer', 'bunker', 'submarine', 'tanker', 'landing'],
    ['cruiser', 'fort', 'destroyer', 'howitzer', 'battleship'],
  ];
  const top = Math.min(tiers.length - 1, Math.floor((n - 1) / 2) + (difficulty ? 1 : 0));
  const count = Math.min(4, 2 + Math.floor((n - 1) / 2));
  const targets = [];
  for (let i = 0; i < count; i++) {
    // хотя бы одна цель — из самого трудного доступного набора
    const tier = i === 0 ? top : Math.floor(Math.random() * (top + 1));
    const pool = tiers[tier], kind = pool[Math.floor(Math.random() * pool.length)];
    const r0 = kind === 'battleship' ? 14 : kind === 'landing' ? 10 : 6 + Math.random() * 7;
    const hidden = n >= 3 && (kind === 'battery' || kind === 'howitzer') && Math.random() < 0.6;
    targets.push({ kind, range: [r0, r0 + 2], path: kind === 'submarine' ? 6 : 9, delay: i * 12, locate: hidden ? 'sound' : undefined, relocate: hidden && n >= 5 && Math.random() < 0.5 ? 3 : 0 });
  }
  const ws = n < 2 ? 0 : Math.min(12, 1 + n + Math.floor(Math.random() * 3));
  return { targets, wind: { speed: ws, from: ws ? Math.round(Math.random() * 35) * 10 : 0 } };
}

const ISLAND_NAMES = ['о. Каменный', 'о. Чаячий', 'о. Долгий', 'о. Сторожевой', 'о. Малый', 'о. Туманный'];

/** Карта: наш берег на юге, острова в море. Все величины — км. */
export function makeMap(seed) {
  const r = rng(seed * 7919 + 17);
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  const coastY = (x) => 2.7 + 0.55 * Math.sin(x * 0.42 + ph[0]) + 0.3 * Math.sin(x * 1.13 + ph[1]) + 0.12 * Math.sin(x * 2.7 + ph[2]);
  const coast = [];
  for (let x = 0; x <= MAP + 1e-9; x += 0.25) coast.push(Math.round(coastY(x) * 1000) / 1000);
  const islands = [], names = ISLAND_NAMES.slice();
  let guard = 0;
  while (islands.length < 4 && guard++ < 400) {
    const isl = { x: 2.5 + r() * 15, y: 8 + r() * 9.5, rx: 0.55 + r() * 0.7, ry: 0.4 + r() * 0.45, rot: r() * Math.PI };
    if (islands.some((o) => Math.hypot(o.x - isl.x, o.y - isl.y) < 3.2)) continue;
    isl.name = names.splice(Math.floor(r() * names.length), 1)[0];
    isl.x = Math.round(isl.x * 100) / 100; isl.y = Math.round(isl.y * 100) / 100;
    islands.push(isl);
  }
  const bx = Math.round((8 + r() * 4) * 100) / 100;
  const battery = { x: bx, y: Math.round((coastY(bx) - 0.35) * 100) / 100 };
  return { seed, coast, coastStep: 0.25, islands, battery };
}

export function coastAt(map, x) {
  const i = Math.max(0, Math.min(map.coast.length - 2, Math.floor(x / map.coastStep)));
  const f = Math.max(0, Math.min(1, x / map.coastStep - i));
  return map.coast[i] + (map.coast[i + 1] - map.coast[i]) * f;
}

export function isLand(map, x, y) {
  if (y < coastAt(map, x)) return true;
  for (const o of map.islands) {
    const c = Math.cos(-o.rot), s = Math.sin(-o.rot), dx = x - o.x, dy = y - o.y;
    const u = (dx * c - dy * s) / o.rx, v = (dx * s + dy * c) / o.ry;
    if (u * u + v * v <= 1) return true;
  }
  return false;
}

/** Два поста звукометрии на нашем берегу по обе стороны от батареи (база ~9 км для чёткой засечки). */
export function soundPosts(map, bat) {
  const r2 = (v) => Math.round(v * 100) / 100;
  let x1 = bat.x - 4.6, x2 = bat.x + 4.6;
  if (x1 < 0.8) { x2 += 0.8 - x1; x1 = 0.8; }
  if (x2 > MAP - 0.8) { x1 -= x2 - (MAP - 0.8); x2 = MAP - 0.8; }
  return [
    { name: 'ЗВ-1', x: r2(x1), y: r2(coastAt(map, x1) - 0.3) },
    { name: 'ЗВ-2', x: r2(x2), y: r2(coastAt(map, x2) - 0.3) },
  ];
}

/** Хэш строки (FNV-1a) → зерно ГПСЧ. */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const DAILY_A = ['Северный', 'Стальной', 'Тихий', 'Дальний', 'Зимний', 'Штормовой', 'Красный', 'Гранитный', 'Утренний', 'Седой'];
const DAILY_N = ['прибой', 'маяк', 'ветер', 'залив', 'рубеж', 'дозор', 'якорь', 'горизонт', 'фарватер', 'мыс'];

/** Задание дня: описание полностью определяется датой 'YYYY-MM-DD' (одинаково на всех устройствах). */
export function dailyDef(dateKey) {
  const seed = hashSeed('arta-daily-' + dateKey), r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const wr = r();
  const weather = wr < 0.6 ? 'clear' : wr < 0.8 ? 'fog' : 'storm';
  const soft = ['barge', 'depot', 'transport', 'radar', 'tanker'];
  const armed = ['battery', 'howitzer', 'destroyer', 'bunker'];
  const fast = ['landing', 'minelayer', 'submarine'];
  const heavy = ['cruiser', 'fort'];
  const n = 3 + Math.floor(r() * 3), targets = [];
  for (let i = 0; i < n; i++) {
    // состав смешанный: первая — «мягкая», вторая — огрызается, дальше — что выпадет (в тумане без быстрых беглецов)
    const pool = i === 0 ? soft : i === 1 ? armed : i === 2 ? (weather === 'fog' ? soft : fast) : i === 3 ? heavy : soft.concat(armed);
    let kind = pick(pool), guard = 0;
    while (targets.some((t) => t.kind === kind) && guard++ < 8) kind = pick(pool);
    const r0 = kind === 'landing' ? 10 : 6 + r() * 6;
    const b0 = Math.round(300 + r() * 80) % 360;
    targets.push({ kind, range: [Math.round(r0 * 10) / 10, Math.round((r0 + 2) * 10) / 10], bearing: [b0, (b0 + 40) % 360], path: kind === 'submarine' ? 7 : 11, delay: i < 2 ? 0 : (i - 1) * 45 });
  }
  const has = (k) => targets.some((t) => t.kind === k);
  const armor = targets.filter((t) => KINDS[t.kind].armored).length;
  const shells = { he: 8 + 4 * n, ap: armor ? 6 + 5 * armor : 0, smoke: 2, shrap: has('landing') ? 5 : 0 };
  const w0 = weather === 'storm' ? 5 + Math.floor(r() * 5) : Math.floor(r() * 8);
  const def = {
    id: 'daily-' + dateKey, daily: dateKey, seed: seed % 100000, weather, wind: [w0, w0], shells, targets,
    name: pick(DAILY_A) + ' ' + pick(DAILY_N),
  };
  if (r() < 0.4) def.raids = [{ at: 60 + Math.round(r() * 120), planes: 2 + Math.floor(r() * 2), from: Math.round(300 + r() * 120) % 360 }];
  if (r() < 0.3) def.friends = [{ kind: 'patrol', near: 0, loop: true }];
  const d = dateKey.split('-');
  def.title = 'ЗАДАНИЕ ДНЯ · ' + d[2] + '.' + d[1];
  const names = targets.map((t) => KINDS[t.kind].name.toLowerCase());
  def.brief = 'Задание дня ' + d[2] + '.' + d[1] + '.' + d[0] + ' — одно на всех, попытки не ограничены, в зачёт идёт лучший счёт.\n\nЦели: ' + names.join(', ') + '. ' +
    (weather === 'fog' ? 'Туман. ' : weather === 'storm' ? 'Шторм, ветер меняется. ' : 'Видимость хорошая. ') +
    (def.raids ? 'Возможен налёт авиации — зенитка наготове. ' : '') + (def.friends ? 'В районе целей — наш сторожевой катер, не заденьте. ' : '') +
    '\n\nСчёт: звёзды, прочность батареи, время, расход снарядов; за огонь по своим — штраф.';
  return def;
}
