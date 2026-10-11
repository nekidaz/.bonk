//! Postman-style dynamic variables (`{{$guid}}`, `{{$randomEmail}}`, ...): a fresh value at
//! every request send. Pure domain code: randomness comes from `fastrand`, the only I/O is
//! reading the system clock. `ru` locale gives Russian/Kazakh names, cities and +7 phones.

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// How dynamic values are generated (Settings → Variables).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DynamicOptions {
    /// "ru": Russian/Kazakh names, Kazakhstan cities, streets and +7 phones. Anything else: English (US).
    pub locale: String,
    /// true: one value per name within one resolution ({{$guid}} in a header and in the body match).
    /// false: a new value at every occurrence (what Postman does).
    pub per_request: bool,
    /// Fixed seed: the same "random" values every time (repeatable Runner runs).
    pub seed: Option<u64>,
}

impl Default for DynamicOptions {
    fn default() -> Self {
        Self {
            locale: "en".to_string(),
            per_request: true,
            seed: None,
        }
    }
}

/// One substituted value, as reported back to the UI (Timeline).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DynamicValue {
    pub name: String,
    pub value: String,
}

/// Generator for one resolution (one request send).
pub struct Dynamic {
    rng: fastrand::Rng,
    ru: bool,
    per_request: bool,
    memo: BTreeMap<String, String>,
    used: Vec<DynamicValue>,
}

impl Default for Dynamic {
    fn default() -> Self {
        Self::new(&DynamicOptions::default())
    }
}

impl Dynamic {
    pub fn new(options: &DynamicOptions) -> Self {
        let rng = match options.seed {
            Some(seed) => fastrand::Rng::with_seed(seed),
            None => fastrand::Rng::new(),
        };
        Self {
            rng,
            ru: options.locale == "ru",
            per_request: options.per_request,
            memo: BTreeMap::new(),
            used: Vec::new(),
        }
    }

    /// `name` includes the leading `$` (e.g. "$guid"). `None` for an unknown name.
    /// per_request mode: the first call for a name generates and memoizes; later calls return the memo.
    /// Every returned value is recorded in `used` — once per name in per_request mode, once per call otherwise.
    pub fn value(&mut self, name: &str) -> Option<String> {
        if self.per_request {
            if let Some(v) = self.memo.get(name) {
                return Some(v.clone());
            }
        }
        let value = self.generate(name)?;
        if self.per_request {
            self.memo.insert(name.to_string(), value.clone());
        }
        self.used.push(DynamicValue {
            name: name.to_string(),
            value: value.clone(),
        });
        Some(value)
    }

    /// Values handed out so far, in first-use order.
    pub fn used(&self) -> &[DynamicValue] {
        &self.used
    }

    pub fn into_used(self) -> Vec<DynamicValue> {
        self.used
    }

    fn generate(&mut self, name: &str) -> Option<String> {
        let v = match name {
            // time
            "$timestamp" => (now_ms() / 1000).to_string(),
            "$isoTimestamp" => iso_from_unix_ms(now_ms()),
            "$randomDateRecent" => {
                let secs = self.rng.i64(0..=2 * DAY_SECS);
                iso_from_unix_ms(now_ms() - secs * 1000)
            }
            "$randomDatePast" => {
                let secs = self.rng.i64(DAY_SECS..=365 * DAY_SECS);
                iso_from_unix_ms(now_ms() - secs * 1000)
            }
            "$randomDateFuture" => {
                let secs = self.rng.i64(DAY_SECS..=365 * DAY_SECS);
                iso_from_unix_ms(now_ms() + secs * 1000)
            }
            "$randomWeekday" => self.pick_loc(WEEKDAYS_RU, WEEKDAYS_EN).to_string(),
            "$randomMonth" => self.pick_loc(MONTHS_RU, MONTHS_EN).to_string(),

            // id
            "$guid" | "$randomUUID" => self.uuid(),
            "$randomAlphaNumeric" => self.chars(LOWER_DIGITS, 1),

            // numbers
            "$randomInt" => self.rng.u32(0..=1000).to_string(),
            "$randomBoolean" => self.rng.bool().to_string(),
            "$randomSemver" => format!(
                "{}.{}.{}",
                self.rng.u8(0..=9),
                self.rng.u8(0..=20),
                self.rng.u8(0..=30)
            ),
            "$randomHexColor" => format!("#{}", self.hex(6)),

            // text
            "$randomWord" => self.word().to_string(),
            "$randomWords" => {
                let n = self.rng.usize(2..=5);
                self.words(n, WORDS, " ")
            }
            "$randomLoremWord" => pick(&mut self.rng, LOREM).to_string(),
            "$randomLoremWords" => self.words(3, LOREM, " "),
            "$randomLoremSentence" => self.lorem_sentence(),
            "$randomLoremParagraph" => {
                let n = self.rng.usize(3..=5);
                (0..n)
                    .map(|_| self.lorem_sentence())
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            "$randomLoremSlug" => self.words(3, LOREM, "-"),
            "$randomColor" => self.pick_loc(COLORS_RU, COLORS_EN).to_string(),

            // people
            "$randomFullName" => {
                let p = self.person();
                format!("{} {}", p.first, p.last)
            }
            "$randomFirstName" => self.person().first,
            "$randomLastName" => self.person().last,
            "$randomUserName" => {
                let p = self.person();
                let first = p.first_lat.to_lowercase();
                if self.rng.bool() {
                    let initial = p
                        .last_lat
                        .chars()
                        .next()
                        .unwrap_or('x')
                        .to_ascii_lowercase();
                    format!("{first}.{initial}{}", self.digits(2))
                } else {
                    format!("{first}_{}", p.last_lat.to_lowercase())
                }
            }
            "$randomPhoneNumber" => self.phone(),
            "$randomJobTitle" => self.pick_loc(JOBS_RU, JOBS_EN).to_string(),
            "$randomCompanyName" => self.company(),
            "$randomAvatarImage" => {
                format!("https://i.pravatar.cc/150?img={}", self.rng.u8(1..=70))
            }
            "$randomNamePrefix" => self.pick_loc(PREFIXES_RU, PREFIXES_EN).to_string(),

            // internet
            "$randomEmail" => {
                let local = self.email_local();
                let domain = self.pick_loc(EMAIL_DOMAINS_RU, EMAIL_DOMAINS_EN);
                format!("{local}@{domain}")
            }
            "$randomExampleEmail" => {
                let local = self.email_local();
                format!("{local}@{}", pick(&mut self.rng, EXAMPLE_DOMAINS))
            }
            "$randomUrl" => format!("https://www.{}", self.domain()),
            "$randomDomainName" => self.domain(),
            "$randomIP" => (0..4)
                .map(|_| self.rng.u8(1..=254).to_string())
                .collect::<Vec<_>>()
                .join("."),
            "$randomIPV6" => self.hex_groups(8, 4),
            "$randomMACAddress" => self.hex_groups(6, 2),
            "$randomUserAgent" => pick(&mut self.rng, USER_AGENTS).to_string(),
            "$randomPassword" => self.chars(ALPHANUMERIC, 15),
            "$randomProtocol" => pick(&mut self.rng, &["http", "https"]).to_string(),

            // finance
            "$randomCurrencyCode" => self.currency().0.to_string(),
            "$randomCurrencyName" => {
                let c = self.currency();
                if self.ru { c.1 } else { c.2 }.to_string()
            }
            "$randomCurrencySymbol" => self.currency().3.to_string(),
            "$randomBankAccount" => self.digits(8),
            "$randomBankAccountIban" => self.iban(),
            "$randomBankAccountBic" => {
                let bank = self.chars(UPPER, 4);
                let country = if self.ru { "KZ" } else { "US" };
                format!("{bank}{country}{}", self.chars(UPPER_DIGITS, 2))
            }
            "$randomCreditCardMask" => self.digits(4),
            "$randomPrice" => {
                let cents = self.rng.u32(100..=100_000);
                format!("{}.{:02}", cents / 100, cents % 100)
            }
            "$randomTransactionType" => self.pick_loc(TRANSACTIONS_RU, TRANSACTIONS_EN).to_string(),

            // address
            "$randomCity" => self.pick_loc(CITIES_RU, CITIES_EN).to_string(),
            "$randomStreetName" => self.pick_loc(STREETS_RU, STREETS_EN).to_string(),
            "$randomStreetAddress" => {
                let number = self.rng.u16(1..=250);
                if self.ru {
                    let street = pick(&mut self.rng, STREETS_SHORT_RU);
                    format!("{street}, {number}, кв. {}", self.rng.u16(1..=200))
                } else {
                    format!("{number} {}", pick(&mut self.rng, STREETS_EN))
                }
            }
            "$randomCountry" => {
                let c = pick(&mut self.rng, COUNTRIES);
                if self.ru { c.1 } else { c.2 }.to_string()
            }
            "$randomCountryCode" => pick(&mut self.rng, COUNTRIES).0.to_string(),
            "$randomLatitude" => format!("{:.6}", self.rng.f64() * 180.0 - 90.0),
            "$randomLongitude" => format!("{:.6}", self.rng.f64() * 360.0 - 180.0),

            // files
            "$randomFileName" => self.file_name(),
            "$randomFileExt" => pick(&mut self.rng, FILE_EXTS).to_string(),
            "$randomFileType" => pick(&mut self.rng, FILE_TYPES).to_string(),
            "$randomMimeType" => pick(&mut self.rng, MIME_TYPES).to_string(),
            "$randomFilePath" => {
                let dir = self.word();
                format!("/usr/local/{dir}/{}", self.file_name())
            }
            "$randomDirectoryPath" => {
                if self.rng.bool() {
                    pick(&mut self.rng, DIRECTORIES).to_string()
                } else {
                    format!("/var/{}", self.words(2, WORDS, "/"))
                }
            }
            "$randomImageUrl" => format!(
                "https://picsum.photos/640/480?random={}",
                self.rng.u16(1..=1000)
            ),
            "$randomCommonFileExt" => pick(&mut self.rng, COMMON_FILE_EXTS).to_string(),
            _ => return None,
        };
        Some(v)
    }

    // ---- small building blocks ----

    /// Picks from the list for the current locale.
    fn pick_loc(&mut self, ru: &[&'static str], en: &[&'static str]) -> &'static str {
        let list = if self.ru { ru } else { en };
        pick(&mut self.rng, list)
    }

    fn word(&mut self) -> &'static str {
        pick(&mut self.rng, WORDS)
    }

    /// `n` words from `list` joined by `sep`.
    fn words(&mut self, n: usize, list: &[&str], sep: &str) -> String {
        (0..n)
            .map(|_| *pick(&mut self.rng, list))
            .collect::<Vec<_>>()
            .join(sep)
    }

    fn lorem_sentence(&mut self) -> String {
        let n = self.rng.usize(5..=10);
        let text = self.words(n, LOREM, " ");
        let mut chars = text.chars();
        let first = chars.next().map(|c| c.to_ascii_uppercase()).unwrap_or('L');
        format!("{first}{}.", chars.as_str())
    }

    fn chars(&mut self, alphabet: &str, n: usize) -> String {
        let bytes = alphabet.as_bytes();
        (0..n)
            .map(|_| bytes[self.rng.usize(..bytes.len())] as char)
            .collect()
    }

    fn digits(&mut self, n: usize) -> String {
        self.chars("0123456789", n)
    }

    fn hex(&mut self, n: usize) -> String {
        self.chars("0123456789abcdef", n)
    }

    /// `groups` groups of `width` lowercase hex chars joined by ':' (IPv6, MAC).
    fn hex_groups(&mut self, groups: usize, width: usize) -> String {
        (0..groups)
            .map(|_| self.hex(width))
            .collect::<Vec<_>>()
            .join(":")
    }

    fn uuid(&mut self) -> String {
        let variant = self.chars("89ab", 1);
        format!(
            "{}-{}-4{}-{variant}{}-{}",
            self.hex(8),
            self.hex(4),
            self.hex(3),
            self.hex(3),
            self.hex(12)
        )
    }

    fn person(&mut self) -> Person {
        if self.ru {
            let &(first, first_lat, female) = pick(&mut self.rng, FIRST_NAMES_RU);
            let &(m, f, m_lat, f_lat) = pick(&mut self.rng, LAST_NAMES_RU);
            let (last, last_lat) = if female { (f, f_lat) } else { (m, m_lat) };
            Person {
                first: first.to_string(),
                last: last.to_string(),
                first_lat: first_lat.to_string(),
                last_lat: last_lat.to_string(),
            }
        } else {
            let first = pick(&mut self.rng, FIRST_NAMES_EN);
            let last = pick(&mut self.rng, LAST_NAMES_EN);
            Person {
                first: first.to_string(),
                last: last.to_string(),
                first_lat: first.to_string(),
                last_lat: last.to_string(),
            }
        }
    }

    fn email_local(&mut self) -> String {
        let p = self.person();
        format!("{}.{}", p.first_lat, p.last_lat).to_lowercase()
    }

    fn phone(&mut self) -> String {
        if self.ru {
            let code = pick(&mut self.rng, KZ_MOBILE_CODES);
            format!(
                "+7 {code} {} {} {}",
                self.digits(3),
                self.digits(2),
                self.digits(2)
            )
        } else {
            let area = format!("{}{}", self.rng.u8(2..=9), self.digits(2));
            let exchange = format!("{}{}", self.rng.u8(2..=9), self.digits(2));
            format!("+1 ({area}) {exchange}-{}", self.digits(4))
        }
    }

    fn company(&mut self) -> String {
        if self.ru {
            let form = pick(&mut self.rng, &["ТОО", "АО"]);
            let a = pick(&mut self.rng, COMPANY_A_RU);
            let b = pick(&mut self.rng, COMPANY_B_RU);
            format!("{form} «{a} {b}»")
        } else {
            let a = pick(&mut self.rng, COMPANY_A_EN);
            let b = pick(&mut self.rng, COMPANY_B_EN);
            let suffix = pick(&mut self.rng, &["Inc", "LLC", "Group", "Co"]);
            format!("{a} {b} {suffix}")
        }
    }

    fn domain(&mut self) -> String {
        let name = self.words(2, WORDS, "-");
        let tld = if self.ru && self.rng.u8(0..=4) == 0 {
            "kz"
        } else {
            pick(&mut self.rng, &["com", "net", "org", "io"])
        };
        format!("{name}.{tld}")
    }

    fn currency(&mut self) -> &'static (&'static str, &'static str, &'static str, &'static str) {
        pick(&mut self.rng, CURRENCIES)
    }

    fn iban(&mut self) -> String {
        let (country, bban) = if self.ru {
            (
                "KZ",
                format!("{}{}", self.digits(3), self.chars(UPPER_DIGITS, 13)),
            )
        } else {
            ("GB", format!("{}{}", self.chars(UPPER, 4), self.digits(14)))
        };
        // ISO 13616: the check digits make "bban + country + check" ≡ 1 (mod 97).
        let check = 98 - mod97(&format!("{bban}{country}00"));
        format!("{country}{check:02}{bban}")
    }

    fn file_name(&mut self) -> String {
        let name = self.words(2, WORDS, "_");
        format!("{name}.{}", pick(&mut self.rng, FILE_EXTS))
    }
}

/// A generated person: display names plus ASCII forms for emails/usernames.
struct Person {
    first: String,
    last: String,
    first_lat: String,
    last_lat: String,
}

/// Every supported name, `$`-prefixed, in catalog order (must equal the TS list in src/shared/model/dynamicVars.ts).
pub const NAMES: &[&str] = &[
    // time
    "$timestamp",
    "$isoTimestamp",
    "$randomDateRecent",
    "$randomDatePast",
    "$randomDateFuture",
    "$randomWeekday",
    "$randomMonth",
    // id
    "$guid",
    "$randomUUID",
    "$randomAlphaNumeric",
    // numbers
    "$randomInt",
    "$randomBoolean",
    "$randomSemver",
    "$randomHexColor",
    // text
    "$randomWord",
    "$randomWords",
    "$randomLoremWord",
    "$randomLoremWords",
    "$randomLoremSentence",
    "$randomLoremParagraph",
    "$randomLoremSlug",
    "$randomColor",
    // people
    "$randomFullName",
    "$randomFirstName",
    "$randomLastName",
    "$randomUserName",
    "$randomPhoneNumber",
    "$randomJobTitle",
    "$randomCompanyName",
    "$randomAvatarImage",
    "$randomNamePrefix",
    // internet
    "$randomEmail",
    "$randomExampleEmail",
    "$randomUrl",
    "$randomDomainName",
    "$randomIP",
    "$randomIPV6",
    "$randomMACAddress",
    "$randomUserAgent",
    "$randomPassword",
    "$randomProtocol",
    // finance
    "$randomCurrencyCode",
    "$randomCurrencyName",
    "$randomCurrencySymbol",
    "$randomBankAccount",
    "$randomBankAccountIban",
    "$randomBankAccountBic",
    "$randomCreditCardMask",
    "$randomPrice",
    "$randomTransactionType",
    // address
    "$randomCity",
    "$randomStreetName",
    "$randomStreetAddress",
    "$randomCountry",
    "$randomCountryCode",
    "$randomLatitude",
    "$randomLongitude",
    // files
    "$randomFileName",
    "$randomFileExt",
    "$randomFileType",
    "$randomMimeType",
    "$randomFilePath",
    "$randomDirectoryPath",
    "$randomImageUrl",
    "$randomCommonFileExt",
];

pub fn is_known(name: &str) -> bool {
    NAMES.contains(&name)
}

/// One example value per name, for the editor UI (autocomplete, catalog, settings preview).
pub fn samples(options: &DynamicOptions) -> BTreeMap<String, String> {
    let mut dynamic = Dynamic::new(options);
    NAMES
        .iter()
        .filter_map(|name| dynamic.value(name).map(|v| (name.to_string(), v)))
        .collect()
}

// ---- helpers ----

const DAY_SECS: i64 = 86_400;

fn pick<'a, T>(rng: &mut fastrand::Rng, items: &'a [T]) -> &'a T {
    &items[rng.usize(..items.len())]
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `2026-10-11T07:04:11.204Z`. Days → civil date is Howard Hinnant's algorithm.
fn iso_from_unix_ms(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let day_ms = ms.rem_euclid(86_400_000);

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);

    let (h, m, s, milli) = (
        day_ms / 3_600_000,
        day_ms / 60_000 % 60,
        day_ms / 1000 % 60,
        day_ms % 1000,
    );
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{milli:03}Z")
}

/// Remainder mod 97 of an alphanumeric IBAN string (letters count as 10..35), piecewise.
fn mod97(s: &str) -> u32 {
    s.chars().fold(0, |rem, c| match c.to_digit(36) {
        Some(v) if v < 10 => (rem * 10 + v) % 97,
        Some(v) => (rem * 100 + v) % 97,
        None => rem,
    })
}

// ---- data ----

const LOWER_DIGITS: &str = "abcdefghijklmnopqrstuvwxyz0123456789";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UPPER_DIGITS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ALPHANUMERIC: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const WEEKDAYS_RU: &[&str] = &[
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
];
const WEEKDAYS_EN: &[&str] = &[
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];
const MONTHS_RU: &[&str] = &[
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
];
const MONTHS_EN: &[&str] = &[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const WORDS: &[&str] = &[
    "river", "stone", "cloud", "forest", "window", "garden", "bridge", "silver", "market", "light",
    "north", "ocean", "paper", "story", "violet", "winter", "summer", "engine", "pixel", "signal",
    "anchor", "bamboo", "candle", "dragon", "falcon", "harbor", "island", "jungle", "kernel",
    "lantern", "meadow", "nebula", "orbit", "planet", "quartz", "rocket", "sunset", "tunnel",
    "valley", "willow",
];

const LOREM: &[&str] = &[
    "lorem",
    "ipsum",
    "dolor",
    "sit",
    "amet",
    "consectetur",
    "adipiscing",
    "elit",
    "sed",
    "do",
    "eiusmod",
    "tempor",
    "incididunt",
    "ut",
    "labore",
    "et",
    "dolore",
    "magna",
    "aliqua",
    "enim",
    "ad",
    "minim",
    "veniam",
    "quis",
    "nostrud",
    "exercitation",
    "ullamco",
    "laboris",
    "nisi",
    "aliquip",
    "ex",
    "ea",
    "commodo",
    "consequat",
    "duis",
    "aute",
    "irure",
    "in",
    "reprehenderit",
    "voluptate",
    "velit",
    "esse",
    "cillum",
    "fugiat",
    "nulla",
    "pariatur",
];

const COLORS_RU: &[&str] = &[
    "бирюзовый",
    "красный",
    "синий",
    "зелёный",
    "жёлтый",
    "фиолетовый",
    "оранжевый",
    "серый",
    "белый",
    "чёрный",
    "розовый",
    "голубой",
];
const COLORS_EN: &[&str] = &[
    "teal", "red", "blue", "green", "yellow", "purple", "orange", "gray", "white", "black", "pink",
    "cyan",
];

/// (Cyrillic, Latin, female)
const FIRST_NAMES_RU: &[(&str, &str, bool)] = &[
    ("Айгерим", "Aigerim", true),
    ("Тимур", "Timur", false),
    ("Асель", "Asel", true),
    ("Нурлан", "Nurlan", false),
    ("Дана", "Dana", true),
    ("Арман", "Arman", false),
    ("Алия", "Aliya", true),
    ("Ерлан", "Erlan", false),
    ("Мадина", "Madina", true),
    ("Данияр", "Daniyar", false),
    ("Анна", "Anna", true),
    ("Иван", "Ivan", false),
    ("Мария", "Maria", true),
    ("Дмитрий", "Dmitry", false),
    ("Елена", "Elena", true),
    ("Сергей", "Sergey", false),
];

/// (male Cyrillic, female Cyrillic, male Latin, female Latin)
const LAST_NAMES_RU: &[(&str, &str, &str, &str)] = &[
    ("Касымов", "Касымова", "Kasymov", "Kasymova"),
    ("Нурланов", "Нурланова", "Nurlanov", "Nurlanova"),
    ("Ахметов", "Ахметова", "Akhmetov", "Akhmetova"),
    ("Сатпаев", "Сатпаева", "Satpaev", "Satpaeva"),
    ("Иванов", "Иванова", "Ivanov", "Ivanova"),
    ("Жумабаев", "Жумабаева", "Zhumabaev", "Zhumabaeva"),
    ("Петров", "Петрова", "Petrov", "Petrova"),
    ("Смагулов", "Смагулова", "Smagulov", "Smagulova"),
    ("Омаров", "Омарова", "Omarov", "Omarova"),
    ("Сидоров", "Сидорова", "Sidorov", "Sidorova"),
    ("Байжанов", "Байжанова", "Baizhanov", "Baizhanova"),
    ("Кузнецов", "Кузнецова", "Kuznetsov", "Kuznetsova"),
];

const FIRST_NAMES_EN: &[&str] = &[
    "James", "Emma", "Michael", "Olivia", "William", "Sophia", "Daniel", "Ava", "Matthew", "Emily",
    "Joseph", "Grace", "David", "Chloe", "Ryan", "Hannah",
];
const LAST_NAMES_EN: &[&str] = &[
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Anderson",
    "Taylor", "Moore", "Thompson",
];

const KZ_MOBILE_CODES: &[&str] = &[
    "700", "701", "702", "705", "707", "708", "747", "771", "775", "776", "777", "778",
];

const JOBS_RU: &[&str] = &[
    "Финансовый аналитик",
    "Бэкенд-разработчик",
    "Менеджер по продажам",
    "Дизайнер интерфейсов",
    "Юрист",
    "Бухгалтер",
    "Руководитель проекта",
    "Инженер-программист",
    "Маркетолог",
    "Системный администратор",
    "Врач-терапевт",
    "Учитель математики",
];
const JOBS_EN: &[&str] = &[
    "Financial Analyst",
    "Backend Developer",
    "Sales Manager",
    "UI Designer",
    "Lawyer",
    "Accountant",
    "Project Manager",
    "Software Engineer",
    "Marketing Specialist",
    "System Administrator",
    "Data Scientist",
    "Product Owner",
];

const COMPANY_A_RU: &[&str] = &[
    "Алем",
    "Береке",
    "Нур",
    "Астана",
    "Казах",
    "Сарыарка",
    "Дала",
    "Жулдыз",
];
const COMPANY_B_RU: &[&str] = &[
    "Трейд",
    "Финанс",
    "Логистик",
    "Строй",
    "Технолоджи",
    "Групп",
    "Сервис",
    "Капитал",
];
const COMPANY_A_EN: &[&str] = &[
    "Northwind",
    "Bluebird",
    "Redwood",
    "Silverline",
    "Brightside",
    "Ironclad",
    "Evergreen",
    "Summit",
];
const COMPANY_B_EN: &[&str] = &[
    "Labs",
    "Systems",
    "Logistics",
    "Partners",
    "Solutions",
    "Dynamics",
    "Works",
    "Ventures",
];

const PREFIXES_RU: &[&str] = &["г-н", "г-жа"];
const PREFIXES_EN: &[&str] = &["Mr.", "Mrs.", "Ms.", "Dr."];

const EMAIL_DOMAINS_RU: &[&str] = &["gmail.com", "mail.ru", "yandex.kz", "outlook.com"];
const EMAIL_DOMAINS_EN: &[&str] = &["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
const EXAMPLE_DOMAINS: &[&str] = &["example.com", "example.net", "example.org"];

const USER_AGENTS: &[&str] = &[
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
];

/// (code, ru name, en name, symbol)
const CURRENCIES: &[(&str, &str, &str, &str)] = &[
    ("KZT", "казахстанский тенге", "Kazakhstani Tenge", "₸"),
    ("RUB", "российский рубль", "Russian Ruble", "₽"),
    ("USD", "доллар США", "US Dollar", "$"),
    ("EUR", "евро", "Euro", "€"),
    ("GBP", "фунт стерлингов", "Pound Sterling", "£"),
    ("CNY", "китайский юань", "Chinese Yuan", "¥"),
    ("JPY", "японская иена", "Japanese Yen", "¥"),
    ("TRY", "турецкая лира", "Turkish Lira", "₺"),
    ("UZS", "узбекский сум", "Uzbekistani Som", "soʻm"),
    ("KGS", "киргизский сом", "Kyrgyzstani Som", "с"),
];

const TRANSACTIONS_RU: &[&str] = &["платёж", "счёт", "депозит", "снятие"];
const TRANSACTIONS_EN: &[&str] = &["payment", "invoice", "deposit", "withdrawal"];

const CITIES_RU: &[&str] = &[
    "Алматы",
    "Астана",
    "Шымкент",
    "Караганда",
    "Актобе",
    "Тараз",
    "Павлодар",
    "Усть-Каменогорск",
    "Семей",
    "Атырау",
    "Костанай",
    "Кызылорда",
    "Уральск",
    "Петропавловск",
    "Актау",
    "Туркестан",
];
const CITIES_EN: &[&str] = &[
    "New York",
    "Los Angeles",
    "Chicago",
    "Houston",
    "Phoenix",
    "Philadelphia",
    "San Antonio",
    "San Diego",
    "Dallas",
    "Austin",
    "Seattle",
    "Denver",
];

const STREETS_RU: &[&str] = &[
    "улица Абая",
    "проспект Достык",
    "улица Толе би",
    "проспект Аль-Фараби",
    "улица Сатпаева",
    "проспект Назарбаева",
    "улица Жандосова",
    "улица Гоголя",
    "проспект Республики",
    "улица Байтурсынова",
];
const STREETS_SHORT_RU: &[&str] = &[
    "ул. Абая",
    "пр. Достык",
    "ул. Толе би",
    "пр. Аль-Фараби",
    "ул. Сатпаева",
    "пр. Республики",
    "ул. Гоголя",
    "ул. Жандосова",
];
const STREETS_EN: &[&str] = &[
    "Maple Street",
    "Oak Avenue",
    "Pine Road",
    "Cedar Lane",
    "Elm Street",
    "Washington Boulevard",
    "Lake Drive",
    "Sunset Avenue",
    "Park Place",
    "Main Street",
];

/// (ISO alpha-2, ru name, en name)
const COUNTRIES: &[(&str, &str, &str)] = &[
    ("KZ", "Казахстан", "Kazakhstan"),
    ("RU", "Россия", "Russia"),
    ("US", "США", "United States"),
    ("GB", "Великобритания", "United Kingdom"),
    ("DE", "Германия", "Germany"),
    ("FR", "Франция", "France"),
    ("CN", "Китай", "China"),
    ("JP", "Япония", "Japan"),
    ("TR", "Турция", "Turkey"),
    ("UZ", "Узбекистан", "Uzbekistan"),
    ("KG", "Кыргызстан", "Kyrgyzstan"),
    ("CA", "Канада", "Canada"),
    ("IT", "Италия", "Italy"),
    ("ES", "Испания", "Spain"),
    ("IN", "Индия", "India"),
];

const FILE_EXTS: &[&str] = &[
    "pdf", "json", "csv", "txt", "png", "jpg", "mp4", "zip", "xml", "docx",
];
const COMMON_FILE_EXTS: &[&str] = &["pdf", "mp4", "mp3", "png", "jpg", "gif", "txt", "docx"];
const FILE_TYPES: &[&str] = &["image", "video", "audio", "application", "text"];
const MIME_TYPES: &[&str] = &[
    "application/json",
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/csv",
    "text/plain",
    "video/mp4",
    "audio/mpeg",
    "application/zip",
    "application/xml",
];
const DIRECTORIES: &[&str] = &[
    "/usr/local/bin",
    "/var/log",
    "/etc/nginx",
    "/home/user/documents",
    "/opt/app",
    "/tmp/cache",
];

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;

    /// The editor's catalog (src/shared/model/dynamicVars.json) lists exactly these names.
    #[test]
    fn names_match_the_app_catalog() {
        #[derive(serde::Deserialize)]
        struct Row {
            name: String,
        }
        let rows: Vec<Row> = serde_json::from_str(include_str!(
            "../../../../src/shared/model/dynamicVars.json"
        ))
        .unwrap();
        let app: Vec<&str> = rows.iter().map(|row| row.name.as_str()).collect();
        assert_eq!(app, NAMES);
    }

    fn opts(locale: &str, seed: u64) -> DynamicOptions {
        DynamicOptions {
            locale: locale.to_string(),
            seed: Some(seed),
            ..DynamicOptions::default()
        }
    }

    fn matches(pattern: &str, s: &str) -> bool {
        Regex::new(pattern).unwrap().is_match(s)
    }

    #[test]
    fn every_name_generates_in_both_locales() {
        assert_eq!(NAMES.len(), 65);
        for locale in ["en", "ru"] {
            let mut d = Dynamic::new(&opts(locale, 1));
            for name in NAMES {
                assert!(is_known(name));
                let v = d.value(name).unwrap_or_default();
                assert!(!v.is_empty(), "{name} empty for {locale}");
            }
        }
        let mut d = Dynamic::default();
        assert_eq!(d.value("$nope"), None);
        assert_eq!(d.value("guid"), None);
        assert!(!is_known("guid"));
        assert!(d.used().is_empty());
    }

    #[test]
    fn seed_makes_values_repeatable() {
        let strip = |mut m: BTreeMap<String, String>| {
            m.retain(|k, _| {
                !(k.starts_with("$timestamp")
                    || k.starts_with("$isoTimestamp")
                    || k.starts_with("$randomDate"))
            });
            m
        };
        assert_eq!(
            strip(samples(&opts("ru", 7))),
            strip(samples(&opts("ru", 7)))
        );
        assert_ne!(
            samples(&opts("en", 1))["$guid"],
            samples(&opts("en", 2))["$guid"]
        );
    }

    #[test]
    fn per_request_memoizes_per_name() {
        let mut d = Dynamic::new(&opts("en", 3));
        assert_eq!(d.value("$guid"), d.value("$guid"));
        assert_eq!(d.used().len(), 1);

        let mut d = Dynamic::new(&DynamicOptions {
            per_request: false,
            ..opts("en", 3)
        });
        assert_ne!(d.value("$guid"), d.value("$guid"));
        assert_eq!(d.into_used().len(), 2);
    }

    #[test]
    fn value_formats() {
        let mut en = Dynamic::new(&opts("en", 5));
        let mut ru = Dynamic::new(&opts("ru", 5));

        assert!(matches(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            &en.value("$guid").unwrap()
        ));
        assert!(matches(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$",
            &en.value("$isoTimestamp").unwrap()
        ));
        assert!(matches(
            r"^\+7 7\d{2} \d{3} \d{2} \d{2}$",
            &ru.value("$randomPhoneNumber").unwrap()
        ));
        assert!(matches(
            r"^\+1 \([2-9]\d{2}\) [2-9]\d{2}-\d{4}$",
            &en.value("$randomPhoneNumber").unwrap()
        ));

        let email = ru.value("$randomEmail").unwrap();
        assert!(email.is_ascii() && email.contains('@'), "{email}");

        // Memo is off for the loop below: use a non-memoizing generator.
        let mut ru = Dynamic::new(&DynamicOptions {
            per_request: false,
            ..opts("ru", 5)
        });
        for _ in 0..20 {
            let iban = ru.value("$randomBankAccountIban").unwrap();
            assert!(iban.len() == 20 && iban.starts_with("KZ"));
            assert_eq!(mod97(&format!("{}{}", &iban[4..], &iban[..4])), 1, "{iban}");
        }
        let gb = en.value("$randomBankAccountIban").unwrap();
        assert!(gb.len() == 22 && gb.starts_with("GB"));
        assert_eq!(mod97(&format!("{}{}", &gb[4..], &gb[..4])), 1);
    }

    #[test]
    fn iso_from_unix_ms_converts_dates() {
        assert_eq!(iso_from_unix_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso_from_unix_ms(1_760_166_251_204),
            "2025-10-11T07:04:11.204Z"
        );
        assert_eq!(
            iso_from_unix_ms(951_782_400_000),
            "2000-02-29T00:00:00.000Z"
        );
        assert_eq!(iso_from_unix_ms(-1), "1969-12-31T23:59:59.999Z");
    }
}
