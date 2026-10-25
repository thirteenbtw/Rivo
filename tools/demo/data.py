"""A fictional catalog: every title, person and image here is made up."""

PALS = [
    ("#0f1a3a", "#e98a5c", "#ffd3a1", "#2a1b2e", "#ffb070"),  # dusk
    ("#06121f", "#2b5876", "#e7ecf7", "#0b1724", "#8edcc8"),  # night teal
    ("#1a0f2e", "#7a3e6c", "#ffc8dd", "#1b0d1f", "#a5b4fc"),  # violet
    ("#071b16", "#3a7a62", "#f3f0c8", "#0c2018", "#8edcc8"),  # forest
    ("#2a0e0a", "#c4502a", "#ffdf8a", "#3a160c", "#ffb347"),  # desert
    ("#0b0f1e", "#3d4a8a", "#cfd6ff", "#121735", "#5b6ee1"),  # iris
    ("#101010", "#5a5a5a", "#f2f2f2", "#1a1a1a", "#e05252"),  # noir
    ("#0a2230", "#5fa8c4", "#fff6e0", "#0d2b3a", "#ffd166"),  # sea
    ("#1f0a1a", "#d1495b", "#ffe5a8", "#2a0c1c", "#ff8fa3"),  # crimson
    ("#0c1a12", "#88a35b", "#f6f3d0", "#1a2a12", "#d4e157"),  # moss
]

# id, ru title, original, year, kind(scene), pal, style, genres, rating, tagline, overview
MOVIES = [
    (101, "Последний рейс", "The Last Flight", 2025, "mountains", 0, 0, [18, 53], 8.1, "Обратного билета нет",
     "Пилот ночного грузового рейса получает приказ сесть в горах, которых нет ни на одной карте. До рассвета ему нужно понять, кто на самом деле ждёт его на земле."),
    (102, "Северный ветер", "North Wind", 2024, "forest", 3, 1, [12, 18], 7.6, "Лес помнит всё",
     "Двое братьев возвращаются в посёлок у тайги, чтобы продать отцовский дом, и находят карту, которую отец рисовал двадцать лет."),
    (103, "Город без сна", "Sleepless City", 2025, "city", 5, 0, [80, 53], 7.9, "Ночью правила меняются",
     "Таксистка ночной смены становится единственной свидетельницей ограбления века и вынуждена до утра возить по городу тех, кто его совершил."),
    (104, "Соль", "Salt", 2023, "sea", 7, 2, [18, 10749], 7.3, "Море отдаёт то, что взяло",
     "Летом на маленьком острове художница и смотритель маяка пытаются понять, можно ли начать всё заново в сорок лет."),
    (105, "Красная пустыня", "Red Desert", 2025, "desert", 4, 0, [878, 12], 8.4, "Марс ближе, чем кажется",
     "Экспедиция тренируется в пустыне перед полётом на Марс, но связь с базой пропадает, а следы на песке ведут не туда, куда нужно."),
    (106, "Затмение", "Eclipse", 2024, "eclipse", 2, 1, [878, 9648], 8.0, "Три минуты темноты",
     "Во время полного солнечного затмения в обсерватории исчезают трое учёных. Через год их коллега возвращается туда в день следующего."),
    (107, "Тихий берег", "Quiet Shore", 2022, "sea", 1, 2, [18], 7.1, "Иногда нужно просто остаться",
     "Бывший футболист устраивается сторожем в закрытый на зиму пансионат и неожиданно для себя начинает учить местных детей."),
    (108, "Ноль градусов", "Zero Degrees", 2025, "mountains", 1, 0, [28, 53], 7.4, "Холоднее только правда",
     "Спасатели уходят в горы за пропавшей группой и понимают, что пропавшие не очень хотят, чтобы их нашли."),
    (109, "Неон", "Neon", 2024, "city", 2, 0, [878, 80], 7.8, "Город светится всегда",
     "В городе, где реклама читает мысли, хакерша находит способ выключить её на одну ночь."),
    (110, "Старый сад", "The Old Garden", 2023, "forest", 9, 2, [18, 10751], 7.7, "Каждое лето — как первое",
     "Три поколения одной семьи собираются в старом саду, который решено продать. За одно лето всем придётся договориться."),
    (111, "Прилив", "High Tide", 2025, "sea", 8, 0, [27, 53], 6.9, "Не оставайся на берегу",
     "Компания друзей застревает на приливном острове, и вода прибывает быстрее, чем должна."),
    (112, "Высота", "Altitude", 2024, "mountains", 5, 1, [12, 18], 7.5, "Восемь тысяч метров тишины",
     "Альпинистка возвращается на вершину, где погиб её напарник, чтобы закончить его последний маршрут."),
    (113, "Полдень", "Noon", 2023, "desert", 0, 2, [37, 18], 7.2, "Солнце в зените, оружие в кобуре",
     "В пыльном городке шериф на пенсии в последний раз выходит на главную улицу."),
    (114, "Синяя линия", "Blue Line", 2025, "city", 7, 0, [80, 18], 7.6, "Последняя станция метро",
     "Машинист последнего поезда метро замечает в вагоне пассажира, который едет по кругу уже третью ночь."),
    (115, "Светлячки", "Fireflies", 2024, "forest", 3, 1, [16, 10751], 8.2, "Свет есть даже в темноте",
     "Девочка и её дед отправляются в ночной лес искать светлячков, о которых дед рассказывал всю жизнь."),
    (116, "Тень горы", "Shadow of the Mountain", 2022, "eclipse", 6, 0, [9648, 53], 7.0, "Солнце сюда не заходит",
     "В деревне у подножия горы, где солнце не показывается три месяца, пропадает журналист."),
]

SHOWS = [
    (201, "Маяк", "The Lighthouse", 2024, "sea", 1, 0, [9648, 18], 8.3, "Свет видно издалека",
     "Новый смотритель маяка находит дневник предшественника, в котором описано то, что ещё не произошло.", 2),
    (202, "Станция «Восток»", "Vostok Station", 2025, "mountains", 5, 0, [10765, 18], 8.6, "Минус восемьдесят",
     "Зимовка на антарктической станции идёт по плану, пока из-подо льда не приходит сигнал.", 1),
    (203, "Пятничный вечер", "Friday Night", 2023, "city", 8, 1, [35], 7.4, "Неделя закончилась",
     "Четверо друзей каждую пятницу собираются в одном баре. Каждая серия — один вечер и одна история.", 3),
    (204, "Дорога на юг", "Southbound", 2024, "desert", 4, 2, [18, 12], 7.9, "Три тысячи километров",
     "Отец и взрослая дочь едут через всю страну на старом фургоне, чтобы развеять прах матери у моря.", 2),
    (205, "Чаща", "The Thicket", 2025, "forest", 9, 0, [9648, 80], 8.1, "Здесь все что-то скрывают",
     "Следователь из столицы приезжает в лесной посёлок, где все жители — свидетели и никто ничего не видел.", 1),
    (206, "Орбита", "Orbit", 2024, "eclipse", 2, 1, [10765, 18], 8.0, "Четыреста километров над Землёй",
     "Экипаж частной орбитальной станции узнаёт, что их корабль возвращения больше никто не ждёт.", 2),
    (207, "Рыбаки", "Fishermen", 2022, "sea", 7, 2, [35, 18], 7.6, "Клюёт — не клюёт",
     "Бригада рыбаков из северного посёлка решает открыть ресторан, ни разу не приготовив ничего, кроме ухи.", 3),
    (208, "Сигнал", "Signal", 2025, "city", 6, 0, [80, 53], 8.4, "Позвони мне вчера",
     "Детектив находит рацию, по которой можно говорить с полицейским из 1999 года.", 2),
]

GENRES = {
    "movie": [(28, "боевик"), (12, "приключения"), (16, "мультфильм"), (35, "комедия"), (80, "криминал"),
              (18, "драма"), (10751, "семейный"), (27, "ужасы"), (9648, "детектив"), (10749, "мелодрама"),
              (878, "фантастика"), (53, "триллер"), (37, "вестерн")],
    "tv": [(10759, "боевик и приключения"), (35, "комедия"), (80, "криминал"), (18, "драма"),
           (9648, "детектив"), (10765, "фантастика и фэнтези"), (12, "приключения")],
}

# id, name, female, pal, dept, bio, birthday, place
PEOPLE = [
    (301, "Анна Соколова", True, 2, "Acting", "Актриса театра и кино. Окончила ГИТИС, сыграла более тридцати ролей.", "1990-03-14", "Санкт-Петербург"),
    (302, "Илья Громов", False, 0, "Acting", "Начинал в уличном театре, известен ролями молчаливых героев.", "1986-07-02", "Екатеринбург"),
    (303, "Мария Лебедева", True, 7, "Acting", "Снимается с детства, лауреат нескольких фестивалей.", "1995-11-21", "Москва"),
    (304, "Дмитрий Орлов", False, 5, "Directing", "Режиссёр и сценарист. Снимает жанровое кино с живыми людьми в центре.", "1979-01-30", "Новосибирск"),
    (305, "Ева Миронова", True, 8, "Acting", "Актриса и певица, играла в мюзиклах.", "1992-05-09", "Казань"),
    (306, "Павел Ветров", False, 1, "Acting", "Характерный актёр, одинаково убедителен в комедии и драме.", "1975-09-17", "Самара"),
    (307, "Ольга Белова", True, 3, "Acting", "Актриса, известная по фестивальному кино.", "1988-12-03", "Пермь"),
    (308, "Артём Зорин", False, 6, "Acting", "Бывший каскадёр, сам выполняет трюки.", "1983-04-25", "Владивосток"),
    (309, "Кира Ланская", True, 9, "Directing", "Режиссёр документального и игрового кино.", "1984-08-11", "Калининград"),
    (310, "Никита Соболев", False, 4, "Acting", "Молодой актёр, первая главная роль — в «Красной пустыне».", "1998-02-28", "Ростов-на-Дону"),
    (311, "Вера Климова", True, 0, "Acting", "Актриса МХТ, снимается в сериалах.", "1981-06-06", "Москва"),
    (312, "Георгий Нестеров", False, 2, "Acting", "Народный артист, полвека на сцене.", "1958-10-10", "Тбилиси"),
]

# English: id -> (tagline, overview)
EN = {
    101: ("There is no ticket back", "A night cargo pilot is ordered to land in mountains that appear on no map. Before dawn he has to find out who is really waiting for him on the ground."),
    102: ("The forest remembers", "Two brothers return to a taiga village to sell their father's house and find the map he spent twenty years drawing."),
    103: ("At night the rules change", "A night-shift cab driver becomes the only witness to the robbery of the century and has to drive the robbers around the city until morning."),
    104: ("The sea gives back what it took", "One summer on a small island, a painter and a lighthouse keeper try to work out whether you can start over at forty."),
    105: ("Mars is closer than it looks", "A crew trains in the desert before a flight to Mars, but contact with base goes dead and the tracks in the sand lead the wrong way."),
    106: ("Three minutes of darkness", "Three scientists vanish from an observatory during a total solar eclipse. A year later their colleague returns on the day of the next one."),
    107: ("Sometimes you just have to stay", "A former footballer takes a job guarding a seaside resort closed for winter and, to his own surprise, starts coaching the local kids."),
    108: ("Only the truth is colder", "A rescue team heads into the mountains after a missing group and realises the missing don't really want to be found."),
    109: ("The city never stops glowing", "In a city where billboards read your mind, a hacker finds a way to switch them off for one night."),
    110: ("Every summer feels like the first", "Three generations of one family gather in the old garden that is about to be sold. They have one summer to come to terms."),
    111: ("Don't stay on the shore", "A group of friends gets stranded on a tidal island, and the water is rising faster than it should."),
    112: ("Eight thousand metres of silence", "A climber returns to the summit where her partner died to finish his last route."),
    113: ("Sun at its height, gun in its holster", "In a dusty town, a retired sheriff walks out onto Main Street one last time."),
    114: ("The last metro stop", "The driver of the last metro train notices a passenger who has been riding the loop for three nights in a row."),
    115: ("There is light even in the dark", "A girl and her grandfather go into the night forest to find the fireflies he has talked about all his life."),
    116: ("The sun never comes here", "A journalist disappears in a village at the foot of a mountain where the sun doesn't show for three months."),
    201: ("You can see the light from afar", "A new lighthouse keeper finds his predecessor's diary, which describes things that haven't happened yet."),
    202: ("Minus eighty", "The winter shift at an Antarctic station goes to plan until a signal comes from under the ice."),
    203: ("The week is over", "Four friends meet in the same bar every Friday. Each episode is one evening and one story."),
    204: ("Three thousand kilometres", "A father and his grown-up daughter cross the country in an old van to scatter her mother's ashes by the sea."),
    205: ("Everyone here is hiding something", "A detective from the capital arrives in a forest village where everyone is a witness and nobody saw anything."),
    206: ("Four hundred kilometres above the Earth", "The crew of a private orbital station learns that nobody is waiting for their return ship any more."),
    207: ("Bite or no bite", "A crew of fishermen from a northern village decides to open a restaurant without ever having cooked anything but fish soup."),
    208: ("Call me yesterday", "A detective finds a radio that lets him talk to a police officer from 1999."),
}

GENRES_EN = {28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 18: "Drama", 10751: "Family", 27: "Horror",
             9648: "Mystery", 10749: "Romance", 878: "Science Fiction", 53: "Thriller", 37: "Western",
             10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy"}

# id -> (name, bio, place)
PEOPLE_EN = {
    301: ("Anna Sokolova", "Stage and screen actress. Graduated from GITIS and has played more than thirty roles.", "Saint Petersburg"),
    302: ("Ilya Gromov", "Started out in street theatre; known for playing quiet heroes.", "Yekaterinburg"),
    303: ("Maria Lebedeva", "Has acted since childhood and won awards at several festivals.", "Moscow"),
    304: ("Dmitry Orlov", "Director and screenwriter. Makes genre films with real people at their heart.", "Novosibirsk"),
    305: ("Eva Mironova", "Actress and singer who has starred in musicals.", "Kazan"),
    306: ("Pavel Vetrov", "Character actor, equally convincing in comedy and drama.", "Samara"),
    307: ("Olga Belova", "Actress known for festival cinema.", "Perm"),
    308: ("Artyom Zorin", "Former stuntman who does his own stunts.", "Vladivostok"),
    309: ("Kira Lanskaya", "Director of documentary and feature films.", "Kaliningrad"),
    310: ("Nikita Sobolev", "Young actor; his first lead role was in Red Desert.", "Rostov-on-Don"),
    311: ("Vera Klimova", "Moscow Art Theatre actress who also works in television.", "Moscow"),
    312: ("Georgy Nesterov", "People's Artist with half a century on stage.", "Tbilisi"),
}

ROLES_EN = ["Vera", "Andrey", "Captain Leskov", "Marina", "Old Man", "Sonya", "Voice on the Radio"]
EPISODES_EN = ["Pilot", "Signal", "Second Shift", "White Night", "Quiet Hour", "Point of No Return", "Storm", "Dawn"]
