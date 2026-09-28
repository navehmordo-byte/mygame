// טבלת שיאים שבועית משותפת לכל השחקנים – נשמרת בשירות הציבורי jsonblob.com (בלי חשבון)
//
// הטבלה מתאפסת כל יום ראשון בחצות (שעון ישראל). השירות מוחק טבלאות שלא נעשה בהן שימוש
// ואי אפשר להבטיח טבלה קבועה – לכן היא מלכתחילה שבועית.
//
// רק שם + ניקוד נשלחים לשירות. משתמשים וסיסמאות נשארים בדפדפן בלבד.
// שימו לב: כל מי שמבין בקוד יכול לשנות את הטבלה, והשירות עלול למחוק טבלה שלא נעשה בה שימוש זמן רב.
//
// כדי להפעיל: צרו טבלה (כפתור "צור טבלה משותפת חדשה" במצב ?debug, או ידנית ב-jsonblob.com
// עם התוכן {"v":1,"scores":{}}) והדביקו כאן את המזהה שלה.
const SHARED_BOARD_ID = "";

const SharedBoard = (() => {
  const API = "https://jsonblob.com/api/jsonBlob";
  const TIMEOUT_MS = 8000;
  const MAX_ROWS = 300;
  const MAX_SCORE = 100000;

  const TZ = "Asia/Jerusalem";
  const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

  const enabled = () => SHARED_BOARD_ID.trim() !== "";

  // התאריך והיום בשבוע לפי שעון ישראל – זהה לכל השחקנים בכל אזור זמן
  function israelToday(now = new Date()) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
        .formatToParts(now)
        .map((p) => [p.type, p.value])
    );
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return { y: +parts.year, m: +parts.month, d: +parts.day, weekday };
  }

  // מפתח השבוע = תאריך יום ראשון שפתח אותו, למשל "2026-09-27"
  function currentWeek(now = new Date()) {
    const t = israelToday(now);
    const sunday = new Date(Date.UTC(t.y, t.m - 1, t.d - t.weekday));
    return sunday.toISOString().slice(0, 10);
  }

  // כמה ימים (לפי לוח שנה) עד האיפוס הבא – 1 = הלילה בחצות
  function daysUntilReset(now = new Date()) {
    return 7 - israelToday(now).weekday;
  }

  class BoardMissingError extends Error {}

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers },
        signal: controller.signal,
      });
      if (res.status === 404) throw new BoardMissingError("הטבלה לא קיימת");
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // המידע מהשירות לא אמין – משאירים רק שורות תקינות
  function sanitize(raw) {
    const scores = {};
    const src = raw && typeof raw === "object" && raw.scores && typeof raw.scores === "object" ? raw.scores : {};
    for (const [id, row] of Object.entries(src)) {
      if (!/^[0-9a-f]{16}$/.test(id) || !row || typeof row !== "object") continue;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const best = row.best;
      if (!name || name.length > 20) continue;
      if (!Number.isInteger(best) || best < 0 || best > MAX_SCORE) continue;
      scores[id] = { name, best, at: Number.isFinite(row.at) ? row.at : 0 };
    }
    const week = raw && typeof raw.week === "string" && WEEK_RE.test(raw.week) ? raw.week : "";
    // טבלה משבוע קודם נחשבת ריקה
    if (week !== currentWeek()) return { v: 1, week: currentWeek(), scores: {} };
    return { v: 1, week, scores };
  }

  function sortedRows(data) {
    return Object.entries(data.scores)
      .map(([id, row]) => ({ id, name: row.name, best: row.best, at: row.at }))
      .sort((a, b) => b.best - a.best || a.at - b.at);
  }

  async function load() {
    const res = await request(`${API}/${encodeURIComponent(SHARED_BOARD_ID)}`);
    return sanitize(await res.json());
  }

  async function fetchBoard(limit = 10) {
    return sortedRows(await load()).filter((r) => r.best > 0).slice(0, limit);
  }

  async function bestOf(playerId) {
    const data = await load();
    return data.scores[playerId]?.best ?? 0;
  }

  // קריאה → מיזוג (הגבוה מנצח) → כתיבה → אימות. ניסיון נוסף אם כתיבה של מישהו אחר דרסה אותנו.
  // אם הטבלה משבוע קודם – load() כבר מחזיר אותה ריקה, כך שהכתיבה הראשונה בשבוע מאפסת אותה לכולם.
  async function submit(playerId, name, best) {
    if (!enabled() || !Number.isInteger(best) || best <= 0) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await load();
      const old = data.scores[playerId];
      if (old && old.best >= best && old.name === name) return;
      data.scores[playerId] = { name, best: Math.max(best, old?.best ?? 0), at: Date.now() };

      // שומרים על גודל סביר: רק MAX_ROWS הגבוהים
      const keep = sortedRows(data).slice(0, MAX_ROWS);
      data.scores = Object.fromEntries(keep.map((r) => [r.id, { name: r.name, best: r.best, at: r.at }]));
      data.week = currentWeek();

      await request(`${API}/${encodeURIComponent(SHARED_BOARD_ID)}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if ((await bestOf(playerId)) >= best) return;
    }
    throw new Error("השמירה לטבלה המשותפת לא הצליחה");
  }

  async function createBoard() {
    const res = await request(API, { method: "POST", body: JSON.stringify({ v: 1, week: currentWeek(), scores: {} }) });
    const id = res.headers.get("x-jsonblob-id") || (res.headers.get("Location") || "").split("/").pop();
    if (!id) throw new Error("השירות לא החזיר מזהה");
    return id;
  }

  return { enabled, fetchBoard, bestOf, submit, createBoard, currentWeek, daysUntilReset, BoardMissingError };
})();
