// פלאפי בחלל – לוגיקת המשחק
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // ---------- קבועים (ליחידת שנייה) ----------
  const GRAVITY = 1500;
  const FLAP = -430;
  const PILLAR_W = 64;
  const GAP_START = 175;
  const GAP_MIN = 135;
  const SPEED_START = 150;
  const SPEED_MAX = 260;
  const SPACING = 220;

  // ---------- צלילים (Web Audio, בלי קבצים) ----------
  let audio = null;
  function initAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio = new AC();
    }
    if (audio && audio.state === "suspended") audio.resume();
  }

  function tone(freqFrom, freqTo, duration, type = "sine", volume = 0.15) {
    if (!audio) return;
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  const sounds = {
    flap: () => tone(300, 620, 0.12, "square", 0.06),
    point: () => {
      tone(880, 880, 0.08, "sine", 0.12);
      setTimeout(() => tone(1320, 1320, 0.12, "sine", 0.12), 70);
    },
    crash: () => {
      if (!audio) return;
      const len = audio.sampleRate * 0.4;
      const buffer = audio.createBuffer(1, len, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = audio.createBufferSource();
      const gain = audio.createGain();
      gain.gain.value = 0.25;
      src.buffer = buffer;
      src.connect(gain).connect(audio.destination);
      src.start();
      tone(200, 40, 0.4, "sawtooth", 0.1);
    },
  };

  // ---------- רקע: כוכבים בשכבות + כוכב לכת ----------
  const starLayers = [
    { speed: 12, size: 0.8, alpha: 0.5, count: 50 },
    { speed: 30, size: 1.3, alpha: 0.75, count: 30 },
    { speed: 60, size: 1.9, alpha: 1, count: 15 },
  ].map((layer) => ({
    ...layer,
    stars: Array.from({ length: layer.count }, () => ({ x: Math.random() * W, y: Math.random() * H })),
  }));

  const planet = { x: W * 0.75, y: H * 0.22, r: 46 };

  function updateBackground(dt) {
    for (const layer of starLayers) {
      for (const s of layer.stars) {
        s.x -= layer.speed * dt;
        if (s.x < 0) {
          s.x += W;
          s.y = Math.random() * H;
        }
      }
    }
    planet.x -= 5 * dt;
    if (planet.x < -planet.r * 2) {
      planet.x = W + planet.r * 2;
      planet.y = 60 + Math.random() * (H * 0.4);
    }
  }

  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0b0624");
    grad.addColorStop(1, "#1a0b3d");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ערפילית
    const neb = ctx.createRadialGradient(W * 0.2, H * 0.7, 10, W * 0.2, H * 0.7, 220);
    neb.addColorStop(0, "rgba(176, 79, 224, 0.25)");
    neb.addColorStop(1, "rgba(176, 79, 224, 0)");
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);

    // כוכב לכת עם טבעת
    const pg = ctx.createRadialGradient(planet.x - 15, planet.y - 15, 5, planet.x, planet.y, planet.r);
    pg.addColorStop(0, "#ffb86b");
    pg.addColorStop(1, "#b0476b");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 220, 180, 0.6)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(planet.x, planet.y, planet.r * 1.7, planet.r * 0.4, -0.3, 0, Math.PI * 2);
    ctx.stroke();

    for (const layer of starLayers) {
      ctx.globalAlpha = layer.alpha;
      ctx.fillStyle = "#fff";
      for (const s of layer.stars) ctx.fillRect(s.x, s.y, layer.size, layer.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- מצב המשחק ----------
  let state = "ready"; // ready | playing | over
  let rocket, pillars, particles, score, speed, gap, lastTime;

  function reset() {
    rocket = { x: 100, y: H / 2, vy: 0, r: 16, angle: 0, flame: 0 };
    pillars = [];
    particles = [];
    score = 0;
    speed = SPEED_START;
    gap = GAP_START;
  }

  function addPillar(x) {
    const margin = 60;
    const gapY = margin + Math.random() * (H - gap - margin * 2);
    pillars.push({
      x,
      gapY,
      gap,
      passed: false,
      craters: Array.from({ length: 6 }, () => ({ dx: Math.random(), dy: Math.random(), r: 4 + Math.random() * 6 })),
    });
  }

  function flap() {
    initAudio();
    if (state === "over") return;
    if (state === "ready") start();
    rocket.vy = FLAP;
    rocket.flame = 1;
    sounds.flap();
  }

  function start() {
    reset();
    state = "playing";
    addPillar(W + 40);
    $("overlay").classList.add("hidden");
  }

  function gameOver() {
    state = "over";
    sounds.crash();
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 220;
      particles.push({ x: rocket.x, y: rocket.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 });
    }

    const previousBest = Auth.currentUser()?.best || 0;
    const best = Auth.saveBest(score);
    refreshStats();

    $("overlay-title").textContent = "💥 התרסקת!";
    $("overlay-text").textContent =
      `ניקוד: ${score} | שיא: ${best}` + (score > previousBest ? " – שיא חדש! 🎉" : "");
    $("start-btn").textContent = "שחק שוב";
    setTimeout(() => $("overlay").classList.remove("hidden"), 600);
  }

  function hitsPillar(p) {
    // בדיקת התנגשות בין עיגול למלבן
    const rects = [
      { x: p.x, y: 0, w: PILLAR_W, h: p.gapY },
      { x: p.x, y: p.gapY + p.gap, w: PILLAR_W, h: H - p.gapY - p.gap },
    ];
    const r = rocket.r - 3; // קצת סלחני
    return rects.some((rc) => {
      const cx = Math.max(rc.x, Math.min(rocket.x, rc.x + rc.w));
      const cy = Math.max(rc.y, Math.min(rocket.y, rc.y + rc.h));
      return (rocket.x - cx) ** 2 + (rocket.y - cy) ** 2 < r * r;
    });
  }

  function update(dt) {
    updateBackground(state === "playing" ? dt : dt * 0.3);

    if (state === "ready") {
      rocket.y = H / 2 + Math.sin(performance.now() / 300) * 8;
      return;
    }

    for (const pt of particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt * 1.2;
    }
    particles = particles.filter((pt) => pt.life > 0);

    if (state !== "playing") return;

    rocket.vy += GRAVITY * dt;
    rocket.y += rocket.vy * dt;
    rocket.angle = Math.max(-0.5, Math.min(1.2, rocket.vy / 600));
    rocket.flame = Math.max(0, rocket.flame - dt * 4);

    for (const p of pillars) {
      p.x -= speed * dt;
      if (!p.passed && p.x + PILLAR_W < rocket.x) {
        p.passed = true;
        score++;
        speed = Math.min(SPEED_MAX, speed + 4);
        gap = Math.max(GAP_MIN, gap - 2);
        sounds.point();
      }
    }
    pillars = pillars.filter((p) => p.x + PILLAR_W > -10);
    const last = pillars[pillars.length - 1];
    if (!last || last.x < W - SPACING) addPillar(W + 10);

    if (rocket.y - rocket.r < 0 || rocket.y + rocket.r > H || pillars.some(hitsPillar)) {
      gameOver();
    }
  }

  function drawPillar(p) {
    const parts = [
      { y: 0, h: p.gapY, capY: p.gapY - 14 },
      { y: p.gapY + p.gap, h: H - p.gapY - p.gap, capY: p.gapY + p.gap },
    ];
    for (const part of parts) {
      const g = ctx.createLinearGradient(p.x, 0, p.x + PILLAR_W, 0);
      g.addColorStop(0, "#3a3355");
      g.addColorStop(0.5, "#6b6190");
      g.addColorStop(1, "#2a2440");
      ctx.fillStyle = g;
      ctx.fillRect(p.x, part.y, PILLAR_W, part.h);

      // מכתשים של אסטרואיד
      ctx.fillStyle = "rgba(20, 15, 35, 0.5)";
      for (const c of p.craters) {
        const cy = part.y + c.dy * part.h;
        if (part.h > 20) {
          ctx.beginPath();
          ctx.arc(p.x + 10 + c.dx * (PILLAR_W - 20), cy, c.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // קצה ניאון
      ctx.fillStyle = "#7df9ff";
      ctx.shadowColor = "#7df9ff";
      ctx.shadowBlur = 12;
      ctx.fillRect(p.x - 6, part.capY, PILLAR_W + 12, 14);
      ctx.shadowBlur = 0;
    }
  }

  function drawRocket() {
    ctx.save();
    ctx.translate(rocket.x, rocket.y);
    ctx.rotate(rocket.angle);

    // להבה
    const flameLen = 10 + rocket.flame * 18 + Math.random() * 5;
    const fg = ctx.createLinearGradient(-14, 0, -14 - flameLen, 0);
    fg.addColorStop(0, "#fff3a0");
    fg.addColorStop(0.5, "#ff9a3c");
    fg.addColorStop(1, "rgba(255, 60, 60, 0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-14, -7);
    ctx.lineTo(-14 - flameLen, 0);
    ctx.lineTo(-14, 7);
    ctx.fill();

    // כנפיים
    ctx.fillStyle = "#ff4f7b";
    ctx.beginPath();
    ctx.moveTo(-8, -9);
    ctx.lineTo(-18, -18);
    ctx.lineTo(-14, -6);
    ctx.moveTo(-8, 9);
    ctx.lineTo(-18, 18);
    ctx.lineTo(-14, 6);
    ctx.fill();

    // גוף
    ctx.fillStyle = "#e8e6ff";
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.quadraticCurveTo(10, -12, -14, -9);
    ctx.lineTo(-14, 9);
    ctx.quadraticCurveTo(10, 12, 22, 0);
    ctx.fill();

    // חלון
    ctx.fillStyle = "#4fc3ff";
    ctx.strokeStyle = "#2a2166";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(4, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function draw() {
    drawBackground();
    pillars.forEach(drawPillar);
    if (state !== "over") drawRocket();

    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.life > 0.5 ? "#ffd36b" : "#ff5a5a";
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (state !== "ready") {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 48px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.shadowColor = "#b04fe0";
      ctx.shadowBlur = 10;
      ctx.fillText(score, W / 2, 70);
      ctx.shadowBlur = 0;
    }
  }

  function loop(time) {
    const dt = Math.min(0.033, (time - (lastTime ?? time)) / 1000);
    lastTime = time;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- ממשק ----------
  function refreshStats() {
    const user = Auth.currentUser();
    if (!user) return;
    $("current-user").textContent = user.name;
    $("best-score").textContent = user.best;

    const list = $("leaderboard-list");
    list.innerHTML = "";
    const rows = Auth.leaderboard();
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "עדיין אין שיאים – תהיה הראשון!";
      list.appendChild(li);
    }
    for (const row of rows) {
      const li = document.createElement("li");
      li.textContent = `${row.name} – ${row.best}`;
      if (row.name === user.name) li.classList.add("me");
      list.appendChild(li);
    }
  }

  function showReady() {
    reset();
    state = "ready";
    $("overlay-title").textContent = "מוכן להמראה?";
    $("overlay-text").textContent = "לחץ רווח, קליק או גע במסך כדי לעוף";
    $("start-btn").textContent = "התחל";
    $("overlay").classList.remove("hidden");
  }

  function showScreen() {
    const loggedIn = !!Auth.currentUser();
    $("auth-screen").classList.toggle("active", !loggedIn);
    $("game-screen").classList.toggle("active", loggedIn);
    if (loggedIn) {
      refreshStats();
      showReady();
    }
  }

  function gameVisible() {
    return $("game-screen").classList.contains("active");
  }

  $("start-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    e.currentTarget.blur(); // שרווח לא "ילחץ" שוב על הכפתור
    initAudio();
    start();
    flap();
  });

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (state !== "over") flap();
  });

  document.addEventListener("keydown", (e) => {
    if (!gameVisible()) return;
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (state === "over") {
        if (!$("overlay").classList.contains("hidden")) {
          start();
          flap();
        }
      } else {
        flap();
      }
    }
  });

  window.addEventListener("auth-changed", showScreen);

  reset();
  showScreen();
  requestAnimationFrame(loop);
})();
