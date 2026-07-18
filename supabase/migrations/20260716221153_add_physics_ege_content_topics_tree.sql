-- Корень
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
VALUES (900000, NULL, 'Физика ЕГЭ · темы', 'physics-ege-topics', 0, true, 'Физика', 'ЕГЭ');

-- 7 разделов (parent = корень)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, r.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900001, 'Механика', 'physics-ege-mechanics', 1),
  (900002, 'МКТ и термодинамика', 'physics-ege-mkt-termo', 2),
  (900003, 'Электростатика', 'physics-ege-electrostatics', 3),
  (900004, 'Постоянный ток', 'physics-ege-dc-current', 4),
  (900005, 'Магнитное поле и электромагнитная индукция', 'physics-ege-magnetism', 5),
  (900006, 'Оптика', 'physics-ege-optics', 6),
  (900007, 'Квантовая и атомная физика', 'physics-ege-quantum', 7)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics r ON r.external_id = 900000 AND r.subject='Физика' AND r.exam_type='ЕГЭ';

-- Листья раздела 1: Механика (29 тем, 900101-900129)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, s.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900101,'Равномерное прямолинейное движение','physics-ege-mechanics-01',1),
  (900102,'Равноускоренное движение','physics-ege-mechanics-02',2),
  (900103,'Графики движения (x-t, v-t, a-t)','physics-ege-mechanics-03',3),
  (900104,'Свободное падение','physics-ege-mechanics-04',4),
  (900105,'Движение тела, брошенного под углом к горизонту','physics-ege-mechanics-05',5),
  (900106,'Движение по окружности','physics-ege-mechanics-06',6),
  (900107,'Относительность движения','physics-ege-mechanics-07',7),
  (900108,'Законы Ньютона','physics-ege-mechanics-08',8),
  (900109,'Сила трения','physics-ege-mechanics-09',9),
  (900110,'Движение по наклонной плоскости','physics-ege-mechanics-10',10),
  (900111,'Движение связанных тел (блоки, нити)','physics-ege-mechanics-11',11),
  (900112,'Вес тела, невесомость, перегрузки','physics-ege-mechanics-12',12),
  (900113,'Закон всемирного тяготения','physics-ege-mechanics-13',13),
  (900114,'Движение спутников','physics-ege-mechanics-14',14),
  (900115,'Условие равновесия тел','physics-ege-mechanics-15',15),
  (900116,'Момент силы, рычаг','physics-ege-mechanics-16',16),
  (900117,'Центр тяжести','physics-ege-mechanics-17',17),
  (900118,'Импульс, закон сохранения импульса','physics-ege-mechanics-18',18),
  (900119,'Упругий и неупругий удар','physics-ege-mechanics-19',19),
  (900120,'Работа и мощность','physics-ege-mechanics-20',20),
  (900121,'Кинетическая и потенциальная энергия','physics-ege-mechanics-21',21),
  (900122,'Закон сохранения механической энергии','physics-ege-mechanics-22',22),
  (900123,'Гармонические колебания','physics-ege-mechanics-23',23),
  (900124,'Математический и пружинный маятник','physics-ege-mechanics-24',24),
  (900125,'Превращение энергии при колебаниях','physics-ege-mechanics-25',25),
  (900126,'Механические волны, звук','physics-ege-mechanics-26',26),
  (900127,'Давление жидкости','physics-ege-mechanics-27',27),
  (900128,'Закон Паскаля','physics-ege-mechanics-28',28),
  (900129,'Закон Архимеда, плавание тел','physics-ege-mechanics-29',29)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics s ON s.external_id = 900001 AND s.subject='Физика' AND s.exam_type='ЕГЭ';

-- Листья раздела 2: МКТ и термодинамика (12 тем, 900201-900212)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, s.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900201,'Основное уравнение МКТ','physics-ege-mkt-termo-01',1),
  (900202,'Уравнение состояния идеального газа (Менделеева-Клапейрона)','physics-ege-mkt-termo-02',2),
  (900203,'Изопроцессы','physics-ege-mkt-termo-03',3),
  (900204,'Графики изопроцессов','physics-ege-mkt-termo-04',4),
  (900205,'Внутренняя энергия газа','physics-ege-mkt-termo-05',5),
  (900206,'Работа газа в термодинамике','physics-ege-mkt-termo-06',6),
  (900207,'Первый закон термодинамики','physics-ege-mkt-termo-07',7),
  (900208,'Тепловые машины, КПД','physics-ege-mkt-termo-08',8),
  (900209,'Теплопередача, количество теплоты','physics-ege-mkt-termo-09',9),
  (900210,'Агрегатные переходы (плавление, парообразование)','physics-ege-mkt-termo-10',10),
  (900211,'Влажность воздуха','physics-ege-mkt-termo-11',11),
  (900212,'Насыщенный пар','physics-ege-mkt-termo-12',12)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics s ON s.external_id = 900002 AND s.subject='Физика' AND s.exam_type='ЕГЭ';

-- Листья раздела 3: Электростатика (8 тем, 900301-900308)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, s.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900301,'Закон Кулона','physics-ege-electrostatics-01',1),
  (900302,'Напряжённость электрического поля','physics-ege-electrostatics-02',2),
  (900303,'Потенциал, разность потенциалов','physics-ege-electrostatics-03',3),
  (900304,'Работа электрического поля','physics-ege-electrostatics-04',4),
  (900305,'Проводники и диэлектрики в поле','physics-ege-electrostatics-05',5),
  (900306,'Конденсаторы, электроёмкость','physics-ege-electrostatics-06',6),
  (900307,'Энергия электрического поля','physics-ege-electrostatics-07',7),
  (900308,'Соединение конденсаторов','physics-ege-electrostatics-08',8)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics s ON s.external_id = 900003 AND s.subject='Физика' AND s.exam_type='ЕГЭ';

-- Листья раздела 4: Постоянный ток (7 тем, 900401-900407)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, s.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900401,'Сила тока, напряжение, сопротивление','physics-ege-dc-current-01',1),
  (900402,'Закон Ома для участка цепи','physics-ege-dc-current-02',2),
  (900403,'Закон Ома для полной цепи (ЭДС)','physics-ege-dc-current-03',3),
  (900404,'Последовательное и параллельное соединение','physics-ege-dc-current-04',4),
  (900405,'Работа и мощность тока, закон Джоуля-Ленца','physics-ege-dc-current-05',5),
  (900406,'Расчёт электрических цепей','physics-ege-dc-current-06',6),
  (900407,'Ток в различных средах','physics-ege-dc-current-07',7)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics s ON s.external_id = 900004 AND s.subject='Физика' AND s.exam_type='ЕГЭ';

-- Листья раздела 5: Магнитное поле и электромагнитная индукция (13 тем, 900501-900513)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, s.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900501,'Магнитное поле тока','physics-ege-magnetism-01',1),
  (900502,'Сила Ампера','physics-ege-magnetism-02',2),
  (900503,'Сила Лоренца','physics-ege-magnetism-03',3),
  (900504,'Движение заряда в магнитном поле','physics-ege-magnetism-04',4),
  (900505,'Магнитный поток','physics-ege-magnetism-05',5),
  (900506,'Электромагнитная индукция (закон Фарадея)','physics-ege-magnetism-06',6),
  (900507,'Правило Ленца','physics-ege-magnetism-07',7),
  (900508,'Самоиндукция, индуктивность','physics-ege-magnetism-08',8),
  (900509,'Энергия магнитного поля','physics-ege-magnetism-09',9),
  (900510,'Электромагнитные колебания, колебательный контур','physics-ege-magnetism-10',10),
  (900511,'Переменный ток','physics-ege-magnetism-11',11),
  (900512,'Трансформатор','physics-ege-magnetism-12',12),
  (900513,'Электромагнитные волны','physics-ege-magnetism-13',13)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics s ON s.external_id = 900005 AND s.subject='Физика' AND s.exam_type='ЕГЭ';

-- Листья раздела 6: Оптика (8 тем, 900601-900608)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, s.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900601,'Законы отражения, плоское зеркало','physics-ege-optics-01',1),
  (900602,'Законы преломления, полное внутреннее отражение','physics-ege-optics-02',2),
  (900603,'Линзы, формула тонкой линзы','physics-ege-optics-03',3),
  (900604,'Построение изображений в линзах','physics-ege-optics-04',4),
  (900605,'Оптические приборы','physics-ege-optics-05',5),
  (900606,'Интерференция света','physics-ege-optics-06',6),
  (900607,'Дифракция, дифракционная решётка','physics-ege-optics-07',7),
  (900608,'Дисперсия света','physics-ege-optics-08',8)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics s ON s.external_id = 900006 AND s.subject='Физика' AND s.exam_type='ЕГЭ';

-- Листья раздела 7: Квантовая и атомная физика (12 тем, 900701-900712)
INSERT INTO public.catalog_topics (external_id, parent_id, title, slug, position, is_published, subject, exam_type)
SELECT v.external_id, s.id, v.title, v.slug, v.position, true, 'Физика', 'ЕГЭ'
FROM (VALUES
  (900701,'Фотоэффект, уравнение Эйнштейна','physics-ege-quantum-01',1),
  (900702,'Фотоны, энергия и импульс фотона','physics-ege-quantum-02',2),
  (900703,'Постулаты Бора, спектры','physics-ege-quantum-03',3),
  (900704,'Волновые свойства частиц (де Бройль)','physics-ege-quantum-04',4),
  (900705,'Строение атома','physics-ege-quantum-05',5),
  (900706,'Радиоактивность, виды распада','physics-ege-quantum-06',6),
  (900707,'Ядерные реакции','physics-ege-quantum-07',7),
  (900708,'Энергия связи, дефект массы','physics-ege-quantum-08',8),
  (900709,'Закон радиоактивного распада','physics-ege-quantum-09',9),
  (900710,'Постулаты СТО','physics-ege-quantum-10',10),
  (900711,'Релятивистские эффекты (замедление времени, сокращение длины)','physics-ege-quantum-11',11),
  (900712,'Связь массы и энергии','physics-ege-quantum-12',12)
) AS v(external_id, title, slug, position)
JOIN public.catalog_topics s ON s.external_id = 900007 AND s.subject='Физика' AND s.exam_type='ЕГЭ';
