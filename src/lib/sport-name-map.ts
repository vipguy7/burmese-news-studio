/**
 * Canonical English → Burmese spellings for football clubs, national teams,
 * competitions, stadiums, and well-known players. Used by the Sport content
 * generator to keep Burmese names consistent across every article.
 *
 * Rule of thumb: only include names that have a settled Burmese form on
 * mainstream Myanmar sports pages. Anything not in here stays in Latin.
 */

export type NameEntry = {
  /** Canonical Burmese spelling (Myanmar Unicode). */
  my: string;
  /** Optional shorter form / nickname used in casual fan writing. */
  short?: string;
  /** Category — informational, used to label the prompt table. */
  kind: "club" | "national" | "competition" | "stadium" | "player" | "manager" | "term";
};

/**
 * Keys are matched case-insensitively as whole words. Longer keys are
 * applied first so "Manchester United" wins over "Manchester".
 */
export const SPORT_NAME_MAP: Record<string, NameEntry> = {
  // ── English Premier League clubs ────────────────────────────────────────
  "Manchester United": { my: "မန်ချက်စတာယူနိုက်တက်", short: "မန်ယူ", kind: "club" },
  "Man United": { my: "မန်ယူ", kind: "club" },
  "Man Utd": { my: "မန်ယူ", kind: "club" },
  "Manchester City": { my: "မန်ချက်စတာစီးတီး", short: "မန်စီးတီး", kind: "club" },
  "Man City": { my: "မန်စီးတီး", kind: "club" },
  Liverpool: { my: "လီဗာပူး", kind: "club" },
  Arsenal: { my: "အာဆင်နယ်", kind: "club" },
  Chelsea: { my: "ချယ်လ်ဆီး", kind: "club" },
  Tottenham: { my: "တော့တန်နမ်", kind: "club" },
  "Tottenham Hotspur": { my: "တော့တန်နမ်ဟော့စပါး", short: "စပါး", kind: "club" },
  "Newcastle United": { my: "နယူးကာဆယ်ယူနိုက်တက်", short: "နယူးကာဆယ်", kind: "club" },
  Newcastle: { my: "နယူးကာဆယ်", kind: "club" },
  Everton: { my: "အက်ဗာတန်", kind: "club" },
  "West Ham": { my: "ဝက်စ်ဟမ်း", kind: "club" },
  "Aston Villa": { my: "အက်စတန်ဗီလာ", kind: "club" },
  "Brighton": { my: "ဘရိုက်တန်", kind: "club" },
  "Crystal Palace": { my: "ခရစ်စတယ်ပါလက်စ်", kind: "club" },
  Fulham: { my: "ဖူလမ်", kind: "club" },
  "Nottingham Forest": { my: "နော့တင်ဟမ်ဖော်ရက်စ်", kind: "club" },
  Wolves: { my: "ဝူဗ်စ်", kind: "club" },
  "Leicester City": { my: "လက်စတာစီးတီး", short: "လက်စတာ", kind: "club" },
  // ── La Liga / Europe ────────────────────────────────────────────────────
  "Real Madrid": { my: "ရီးရဲလ်မက်ဒရစ်", kind: "club" },
  Barcelona: { my: "ဘာစီလိုနာ", short: "ဘာဆာ", kind: "club" },
  "Atletico Madrid": { my: "အက်တလက်တီကိုမက်ဒရစ်", kind: "club" },
  "Atlético Madrid": { my: "အက်တလက်တီကိုမက်ဒရစ်", kind: "club" },
  "Bayern Munich": { my: "ဘိုင်ယန်မြူးနစ်", kind: "club" },
  "Borussia Dortmund": { my: "ဒေါ့မွန်", kind: "club" },
  Dortmund: { my: "ဒေါ့မွန်", kind: "club" },
  Juventus: { my: "ဂျူဗင်တပ်စ်", kind: "club" },
  "Inter Milan": { my: "အင်တာမီလန်", kind: "club" },
  "AC Milan": { my: "အေစီမီလန်", kind: "club" },
  "Paris Saint-Germain": { my: "ပါရီစိန့်ဂျာမိန်း", short: "ပီအက်စ်ဂျီ", kind: "club" },
  PSG: { my: "ပီအက်စ်ဂျီ", kind: "club" },
  // ── National teams ──────────────────────────────────────────────────────
  Myanmar: { my: "မြန်မာ", kind: "national" },
  England: { my: "အင်္ဂလန်", kind: "national" },
  Brazil: { my: "ဘရာဇီး", kind: "national" },
  Argentina: { my: "အာဂျင်တီးနား", kind: "national" },
  Germany: { my: "ဂျာမနီ", kind: "national" },
  France: { my: "ပြင်သစ်", kind: "national" },
  Spain: { my: "စပိန်", kind: "national" },
  Portugal: { my: "ပေါ်တူဂီ", kind: "national" },
  Italy: { my: "အီတလီ", kind: "national" },
  Netherlands: { my: "နယ်သာလန်", kind: "national" },
  Japan: { my: "ဂျပန်", kind: "national" },
  "South Korea": { my: "တောင်ကိုရီးယား", kind: "national" },
  Thailand: { my: "ထိုင်း", kind: "national" },
  // ── Competitions ────────────────────────────────────────────────────────
  "Premier League": { my: "ပရီးမီးယားလိဂ်", kind: "competition" },
  "Champions League": { my: "ချန်ပီယံစ်လိဂ်", kind: "competition" },
  "Europa League": { my: "ယူရိုပါလိဂ်", kind: "competition" },
  "La Liga": { my: "လာလီဂါ", kind: "competition" },
  Bundesliga: { my: "ဘွန်ဒက်စ်လီဂါ", kind: "competition" },
  "Serie A": { my: "စီးရီးအေ", kind: "competition" },
  "Ligue 1": { my: "လီဂူး၁", kind: "competition" },
  "FA Cup": { my: "အက်ဖ်အေဖလား", kind: "competition" },
  "World Cup": { my: "ကမ္ဘာ့ဖလား", kind: "competition" },
  "Euro": { my: "ဥရောပဖလား", kind: "competition" },
  "AFC Asian Cup": { my: "အာရှဖလား", kind: "competition" },
  // ── Stadiums ────────────────────────────────────────────────────────────
  "Old Trafford": { my: "အိုးလ်ထရက်ဖို့ဒ်", kind: "stadium" },
  Anfield: { my: "အန်းဖီးလ်", kind: "stadium" },
  "Etihad Stadium": { my: "အီတီဟတ်ကွင်း", kind: "stadium" },
  "Stamford Bridge": { my: "စတမ်းဖို့ဒ်ဘရစ်ဂျ်", kind: "stadium" },
  "Emirates Stadium": { my: "အမီးရိတ်ကွင်း", kind: "stadium" },
  "Santiago Bernabeu": { my: "ဘားနာဘဲကွင်း", kind: "stadium" },
  "Camp Nou": { my: "ကမ်နို", kind: "stadium" },
  "Allianz Arena": { my: "အလီယန့်စ်အရီနာ", kind: "stadium" },
  // ── Star players (only widely-rendered Burmese forms) ───────────────────
  "Cristiano Ronaldo": { my: "ခရစ်စတီယာနိုရိုနယ်လ်ဒို", short: "ရိုနယ်လ်ဒို", kind: "player" },
  "Lionel Messi": { my: "လီယိုနယ်မက်စီ", short: "မက်စီ", kind: "player" },
  Messi: { my: "မက်စီ", kind: "player" },
  Ronaldo: { my: "ရိုနယ်လ်ဒို", kind: "player" },
  "Kylian Mbappe": { my: "ကိုင်လီယန်အမ်ဘာပေး", short: "အမ်ဘာပေး", kind: "player" },
  "Kylian Mbappé": { my: "ကိုင်လီယန်အမ်ဘာပေး", kind: "player" },
  Mbappe: { my: "အမ်ဘာပေး", kind: "player" },
  "Erling Haaland": { my: "အာလင်ဟာလန်း", short: "ဟာလန်း", kind: "player" },
  Haaland: { my: "ဟာလန်း", kind: "player" },
  "Mohamed Salah": { my: "မိုဟာမက်ဆာလာ", short: "ဆာလာ", kind: "player" },
  Salah: { my: "ဆာလာ", kind: "player" },
  "Harry Kane": { my: "ဟယ်ရီကိန်း", short: "ကိန်း", kind: "player" },
  "Bukayo Saka": { my: "ဘူကာယိုဆာကာ", short: "ဆာကာ", kind: "player" },
  "Vinicius Junior": { my: "ဗီနီစီယပ်စ်ဂျူနီယာ", short: "ဗီနီစီယပ်စ်", kind: "player" },
  "Jude Bellingham": { my: "ဂျုဒ်ဘဲလင်ဟမ်", short: "ဘဲလင်ဟမ်", kind: "player" },
  "Kevin De Bruyne": { my: "ကယ်ဗင်ဒီဘရွန်နာ", short: "ဒီဘရွန်နာ", kind: "player" },
  "Pep Guardiola": { my: "ပက်ပ်ဂွာဒီအိုလာ", kind: "manager" },
  "Jurgen Klopp": { my: "ယာဂန်ကလော့ပ်", kind: "manager" },
  "Carlo Ancelotti": { my: "ကာလိုအန်ချလော့တီ", kind: "manager" },
  // ── Common Burmese sport-terminology overrides ──────────────────────────
  Penalty: { my: "ပင်နယ်တီ", kind: "term" },
  "Free kick": { my: "ဖရီးကစ်", kind: "term" },
  Corner: { my: "ကော်နာ", kind: "term" },
  Offside: { my: "အော့ဖ်ဆိုက်ဒ်", kind: "term" },
  "Hat-trick": { my: "ဟက်ထရစ်", kind: "term" },
  Goalkeeper: { my: "ဂိုးသမား", kind: "term" },
  Midfielder: { my: "ကွင်းလယ်လူ", kind: "term" },
  Defender: { my: "နောက်တန်းလူ", kind: "term" },
  Forward: { my: "ရှေ့တန်းလူ", kind: "term" },
  Striker: { my: "တိုက်စစ်မှူး", kind: "term" },
  Manager: { my: "နည်းပြ", kind: "term" },
  Captain: { my: "အသင်းခေါင်းဆောင်", kind: "term" },
};

/** Long keys first so multi-word names beat their substrings. */
function sortedEntries(extra?: Record<string, NameEntry>) {
  const all = { ...SPORT_NAME_MAP, ...(extra ?? {}) };
  return Object.entries(all).sort((a, b) => b[0].length - a[0].length);
}

/**
 * Build a compact reference table for the LLM prompt. Grouped by kind so the
 * model can scan it quickly.
 */
export function buildNamePromptTable(extra?: Record<string, NameEntry>): string {
  const entries = sortedEntries(extra);
  const groups: Record<string, string[]> = {};
  for (const [en, v] of entries) {
    const line = `${en} → ${v.my}${v.short && v.short !== v.my ? ` (short: ${v.short})` : ""}`;
    (groups[v.kind] ??= []).push(line);
  }
  const order: NameEntry["kind"][] = ["club", "national", "competition", "stadium", "player", "manager", "term"];
  return order
    .filter((k) => groups[k]?.length)
    .map((k) => `## ${k.toUpperCase()}\n${groups[k].join("\n")}`)
    .join("\n\n");
}

/** Escape a string for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Post-process Burmese output: any *remaining* English club / player /
 * competition / stadium name that has a canonical Burmese form gets
 * rewritten to that form. We never touch text inside an English block
 * (callers pass burmeseOnly=false for bilingual to skip rewriting the
 * English half).
 *
 * The replacement is word-boundary aware in Latin script. Burmese script
 * has no spaces between words but we only match Latin-script keys, so
 * boundary handling stays simple.
 */
export function normalizeBurmeseNames(
  text: string,
  opts: { extra?: Record<string, NameEntry>; bilingual?: boolean } = {},
): string {
  if (!text) return text;

  const segments: { text: string; rewrite: boolean }[] = opts.bilingual
    ? splitBilingual(text)
    : [{ text, rewrite: true }];

  const entries = sortedEntries(opts.extra);
  return segments
    .map((seg) => {
      if (!seg.rewrite) return seg.text;
      let out = seg.text;
      for (const [en, v] of entries) {
        // Match the English form as a standalone token (boundary on each side).
        const re = new RegExp(`(^|[^A-Za-z0-9])(${escapeRe(en)})(?=$|[^A-Za-z0-9])`, "gi");
        out = out.replace(re, (_m, pre) => `${pre}${v.my}`);
      }
      return out;
    })
    .join("");
}

/**
 * Bilingual outputs are formatted as:
 *   <burmese block>\n\n---\n\n<english block>
 * We only rewrite the Burmese half.
 */
function splitBilingual(text: string): { text: string; rewrite: boolean }[] {
  const idx = text.search(/\n\s*-{3,}\s*\n/);
  if (idx === -1) return [{ text, rewrite: true }];
  const sep = text.match(/\n\s*-{3,}\s*\n/)![0];
  const before = text.slice(0, idx);
  const after = text.slice(idx + sep.length);
  return [
    { text: before, rewrite: true },
    { text: sep, rewrite: false },
    { text: after, rewrite: false },
  ];
}
