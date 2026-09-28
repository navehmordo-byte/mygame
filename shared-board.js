// טבלת שיאים משותפת לכל השחקנים – נשמרת בשירות הציבורי jsonblob.com (בלי חשבון)
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

  const enabled = () => SHARED_BOARD_ID.trim() !== "";

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers },
        signal: controller.signal,
      });
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
    return { v: 1, scores };
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

      await request(`${API}/${encodeURIComponent(SHARED_BOARD_ID)}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if ((await bestOf(playerId)) >= best) return;
    }
    throw new Error("השמירה לטבלה המשותפת לא הצליחה");
  }

  async function createBoard() {
    const res = await request(API, { method: "POST", body: JSON.stringify({ v: 1, scores: {} }) });
    const id = res.headers.get("x-jsonblob-id") || (res.headers.get("Location") || "").split("/").pop();
    if (!id) throw new Error("השירות לא החזיר מזהה");
    return id;
  }

  return { enabled, fetchBoard, bestOf, submit, createBoard };
})();
