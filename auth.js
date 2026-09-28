// ניהול משתמשים – נשמר ב-localStorage של הדפדפן
const Auth = (() => {
  const USERS_KEY = "spaceFlappy.users";
  const SESSION_KEY = "spaceFlappy.session"; // הלשונית הנוכחית בלבד
  const REMEMBER_KEY = "spaceFlappy.remember"; // "זכור אותי" – נשמר גם אחרי סגירת הדפדפן

  function loadUsers() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(salt, password) {
    const text = salt + ":" + password;
    if (window.crypto && crypto.subtle) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    // גיבוי לדפדפנים ללא crypto.subtle (למשל חלק מדפי file://)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return "fb-" + (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
  }

  const key = (username) => username.trim().toLowerCase();

  async function register(username, password, confirm) {
    username = username.trim();
    if (username.length < 3 || username.length > 20) {
      throw new Error("שם המשתמש חייב להכיל 3 עד 20 תווים");
    }
    if (password.length < 4) throw new Error("הסיסמה חייבת להכיל לפחות 4 תווים");
    if (password !== confirm) throw new Error("הסיסמאות אינן תואמות");

    const users = loadUsers();
    if (users[key(username)]) throw new Error("שם המשתמש כבר תפוס");

    const salt = randomSalt();
    users[key(username)] = {
      name: username,
      salt,
      hash: await hashPassword(salt, password),
      best: 0,
    };
    saveUsers(users);
  }

  // נקרא/כותב לאחסון בלי לקרוס בחלון פרטי או כשהאחסון חסום
  function storageGet(storage, k) {
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  }

  function storageSet(storage, k, value) {
    try {
      if (value == null) storage.removeItem(k);
      else storage.setItem(k, value);
    } catch {
      // מתעלמים – הכניסה תעבוד רק ללשונית הנוכחית
    }
  }

  // המשתמש המחובר: קודם הלשונית הנוכחית, אחר כך "זכור אותי"
  function sessionKey() {
    return storageGet(sessionStorage, SESSION_KEY) || storageGet(localStorage, REMEMBER_KEY);
  }

  async function login(username, password, remember = false) {
    const users = loadUsers();
    const user = users[key(username)];
    if (!user || (await hashPassword(user.salt, password)) !== user.hash) {
      throw new Error("שם משתמש או סיסמה שגויים");
    }
    storageSet(sessionStorage, SESSION_KEY, key(username));
    storageSet(localStorage, REMEMBER_KEY, remember ? key(username) : null);
    return user.name;
  }

  function logout() {
    storageSet(sessionStorage, SESSION_KEY, null);
    storageSet(localStorage, REMEMBER_KEY, null);
  }

  function currentUser() {
    const k = sessionKey();
    if (!k) return null;
    const users = loadUsers();
    const user = users[k];
    if (!user) {
      logout(); // המשתמש השמור כבר לא קיים
      return null;
    }
    // מזהה שחקן קבוע לטבלה המשותפת – כך שני "דני" ממכשירים שונים לא דורסים זה את זה
    if (!/^[0-9a-f]{16}$/.test(user.playerId || "")) {
      user.playerId = randomSalt().slice(0, 16);
      try {
        saveUsers(users);
      } catch {
        // אחסון חסום – המזהה יתקיים רק לטעינה הזו
      }
    }
    return {
      name: user.name,
      best: user.best,
      playerId: user.playerId,
      weekBest: user.week === thisWeek() ? user.weekBest || 0 : 0,
    };
  }

  // השבוע הנוכחי של הטבלה השבועית (מוגדר ב-shared-board.js, שנטען אחרי הקובץ הזה)
  const thisWeek = () => (typeof SharedBoard !== "undefined" ? SharedBoard.currentWeek() : "");

  // שומר גם את השיא של כל הזמנים וגם את השיא של השבוע (לטבלה השבועית)
  function saveBest(score) {
    const k = sessionKey();
    const users = loadUsers();
    const user = k && users[k];
    if (!user) return 0;
    let changed = false;
    if (score > user.best) {
      user.best = score;
      changed = true;
    }
    const week = thisWeek();
    if (user.week !== week) {
      user.week = week;
      user.weekBest = 0;
      changed = true;
    }
    if (score > user.weekBest) {
      user.weekBest = score;
      changed = true;
    }
    if (changed) saveUsers(users);
    return user.best;
  }

  function leaderboard(limit = 10) {
    return Object.values(loadUsers())
      .filter((u) => u.best > 0)
      .sort((a, b) => b.best - a.best)
      .slice(0, limit)
      .map((u) => ({ name: u.name, best: u.best }));
  }

  return { register, login, logout, currentUser, saveBest, leaderboard };
})();

// ---------- ממשק מסך הכניסה ----------
(() => {
  const $ = (id) => document.getElementById(id);
  const message = $("auth-message");

  function showMessage(text, type) {
    message.textContent = text;
    message.className = "message " + (type || "");
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".auth-form").forEach((f) => {
        f.classList.toggle("active", f.id === tab.dataset.tab + "-form");
      });
      showMessage("");
    });
  });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await Auth.login($("login-username").value, $("login-password").value, $("login-remember").checked);
      $("login-password").value = "";
      showMessage("");
      window.dispatchEvent(new Event("auth-changed"));
    } catch (err) {
      showMessage(err.message, "error");
    }
  });

  $("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("register-username").value;
    try {
      await Auth.register(username, $("register-password").value, $("register-confirm").value);
      $("register-form").reset();
      document.querySelector('.tab[data-tab="login"]').click();
      $("login-username").value = username.trim();
      showMessage("נרשמת בהצלחה! עכשיו אפשר להיכנס", "success");
    } catch (err) {
      showMessage(err.message, "error");
    }
  });

  $("logout-btn").addEventListener("click", () => {
    Auth.logout();
    window.dispatchEvent(new Event("auth-changed"));
  });

  // רקע כוכבים מנצנצים
  const canvas = $("stars");
  const ctx = canvas.getContext("2d");
  let stars = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: Math.floor((canvas.width * canvas.height) / 4000) }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.3,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 700 + s.phase);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(draw);
})();
