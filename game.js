// פלאפי בחלל – לוגיקת המשחק
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const screenCtx = canvas.getContext("2d");
  let ctx = screenCtx; // מוחלף זמנית בזמן ציור רקע קודם למעבר בין שלבים
  const W = canvas.width;
  const H = canvas.height;
  const fadeCanvas = document.createElement("canvas");
  fadeCanvas.width = W;
  fadeCanvas.height = H;
  const fadeCtx = fadeCanvas.getContext("2d");

  // ---------- קבועים ----------
  // מצב בדיקה: ?debug בכתובת, בלי תלות באותיות גדולות/קטנות
  const DEBUG = [...new URLSearchParams(location.search).keys()].some((k) => k.toLowerCase() === "debug");
  let invincible = false;

  const PILLAR_W = 64;
  const SPACING = 220;
  const POINTS_PER_LEVEL = 10;
  const LOOP_SPEEDUP = 0.15; // כל סיבוב מלא על כל הכוכבים מאיץ ב-15%

  // ---------- שלבים לפי כוכבי לכת (ערכים ליחידת שנייה) ----------
  const LEVELS = [
    {
      name: "ירח", gravityLabel: "נמוכה", emoji: "🌕", gravity: 700, flap: -290, speed: 140, gap: 180,
      obstacle: "rock", colors: ["#4a4a55", "#8a8a96", "#35353f"], cap: "#d8d8e8",
      starAlpha: 1, drawScenery: drawMoonScenery,
    },
    {
      name: "מאדים", gravityLabel: "בינונית", emoji: "🔴", gravity: 1300, flap: -410, speed: 155, gap: 175,
      obstacle: "rock", colors: ["#5a1a0e", "#a8452a", "#40120a"], cap: "#ffb07a",
      starAlpha: 0.35, drawScenery: drawMarsScenery,
    },
    {
      name: "שבתאי", gravityLabel: "רגילה", emoji: "🪐", gravity: 1400, flap: -430, speed: 165, gap: 172,
      obstacle: "ring", cap: "#f3d58a",
      starAlpha: 0.9, drawScenery: drawSaturnScenery,
    },
    {
      name: "יופיטר", gravityLabel: "כבדה מאוד", emoji: "🟠", gravity: 2200, flap: -540, speed: 170, gap: 185,
      obstacle: "storm", colors: ["#7a3f1c", "#c9793f", "#e8b27a"], cap: "#ffcf8a",
      starAlpha: 0, drawScenery: drawJupiterScenery,
    },
  ];

  const levelLabel = (lvl) => `${lvl.emoji} ${lvl.name}`;

  // ---------- צלילים (Web Audio, בלי קבצים) ----------
  let audio = null;
  function initAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio = new AC();
    }
    if (audio && audio.state === "suspended") audio.resume();
  }

  function tone(freqFrom, freqTo, duration, type = "sine", volume = 0.15, delay = 0) {
    if (!audio) return;
    const t = audio.currentTime + delay;
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
    flap: () => tone(420, 760, 0.1, "triangle", 0.08),
    point: () => {
      tone(880, 880, 0.08, "sine", 0.12);
      tone(1320, 1320, 0.12, "sine", 0.12, 0.07);
    },
    levelUp: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, "triangle", 0.12, i * 0.11));
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

  // ---------- רקעים ----------
  const starLayers = [
    { speed: 12, size: 0.8, alpha: 0.5, count: 50 },
    { speed: 30, size: 1.3, alpha: 0.75, count: 30 },
    { speed: 60, size: 1.9, alpha: 1, count: 15 },
  ].map((layer) => ({
    ...layer,
    stars: Array.from({ length: layer.count }, () => ({ x: Math.random() * W, y: Math.random() * H })),
  }));

  const dust = Array.from({ length: 40 }, () => ({
    x: Math.random() * W, y: Math.random() * H, s: 1 + Math.random() * 2, v: 40 + Math.random() * 60,
  }));

  let scroll = 0; // מרחק גלילה כולל – לתנועת נוף
  let time = 0;

  function updateBackground(dt, speedFactor) {
    scroll += 60 * speedFactor * dt;
    for (const layer of starLayers) {
      for (const s of layer.stars) {
        s.x -= layer.speed * speedFactor * dt;
        if (s.x < 0) {
          s.x += W;
          s.y = Math.random() * H;
        }
      }
    }
    for (const d of dust) {
      d.x -= d.v * speedFactor * dt;
      d.y += Math.sin(time * 2 + d.x / 30) * 0.3;
      if (d.x < 0) {
        d.x += W;
        d.y = Math.random() * H;
      }
    }
  }

  const wrap = (v, size) => ((v % size) + size) % size;

  function skyGradient(top, bottom) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawStars(alpha) {
    if (alpha <= 0) return;
    ctx.fillStyle = "#fff";
    for (const layer of starLayers) {
      ctx.globalAlpha = layer.alpha * alpha;
      for (const s of layer.stars) ctx.fillRect(s.x, s.y, layer.size, layer.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawMoonScenery() {
    skyGradient("#030308", "#1b1b29");
    drawStars(1);

    // כדור הארץ ברקע
    const ex = W - wrap(scroll * 0.05 + 80, W + 120) + 60;
    const eg = ctx.createRadialGradient(ex - 8, 82, 4, ex, 90, 30);
    eg.addColorStop(0, "#9fd8ff");
    eg.addColorStop(1, "#1d5fbf");
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(ex, 90, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3fae5a";
    ctx.beginPath();
    ctx.ellipse(ex - 8, 84, 10, 6, 0.5, 0, Math.PI * 2);
    ctx.ellipse(ex + 10, 100, 7, 5, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // קרקע ירח עם מכתשים
    ctx.fillStyle = "#4a4a55";
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H - 20 + Math.sin((x + scroll * 0.8) / 45) * 6);
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.fillStyle = "#35353f";
    for (let i = 0; i < 5; i++) {
      const cx = W - wrap(scroll * 0.8 + i * 97, W + 40) + 20;
      ctx.beginPath();
      ctx.ellipse(cx, H - 8, 9 + (i % 3) * 3, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMarsScenery() {
    skyGradient("#2a0906", "#b5462a");
    drawStars(0.35);

    // פובוס – ירח קטן
    const px = W - wrap(scroll * 0.06 + 200, W + 60) + 30;
    ctx.fillStyle = "#8c7b70";
    ctx.beginPath();
    ctx.ellipse(px, 70, 14, 10, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // אבק מסתחרר
    ctx.fillStyle = "rgba(255, 180, 120, 0.45)";
    for (const d of dust) ctx.fillRect(d.x, d.y, d.s, d.s);

    // דיונות בשתי שכבות
    const dunes = [
      { color: "#8f2d17", h: 55, speed: 0.4, wave: 70 },
      { color: "#6b1e10", h: 30, speed: 0.9, wave: 50 },
    ];
    for (const d of dunes) {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H - d.h + Math.sin((x + scroll * d.speed) / d.wave) * 12);
      ctx.lineTo(W, H);
      ctx.fill();
    }
  }

  function drawSaturnScenery() {
    skyGradient("#0e0724", "#4a3a6a");
    drawStars(0.9);

    // שבתאי ענק ברקע
    const sx = W * 0.3 - wrap(scroll * 0.04, W + 300) + (W + 300) / 2;
    const sy = H * 0.32;
    const r = 70;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-0.35);
    ctx.strokeStyle = "rgba(230, 200, 140, 0.35)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 2, r * 0.45, 0, Math.PI, Math.PI * 2); // חצי טבעת אחורית
    ctx.stroke();
    const pg = ctx.createRadialGradient(-20, -20, 10, 0, 0, r);
    pg.addColorStop(0, "#f6e2b0");
    pg.addColorStop(1, "#b08850");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(140, 100, 50, 0.35)";
    ctx.lineWidth = 6;
    for (const by of [-30, -10, 15, 35]) {
      ctx.beginPath();
      ctx.ellipse(0, by, Math.sqrt(r * r - by * by), 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(240, 215, 160, 0.7)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 2, r * 0.45, 0, 0, Math.PI); // חצי טבעת קדמית
    ctx.stroke();
    ctx.restore();
  }

  function drawJupiterScenery() {
    // פסי עננים גליים של יופיטר
    const bands = ["#5a2e14", "#9a5a2e", "#d9a066", "#b3713c", "#f0cf9c", "#8a4a22"];
    const bh = H / 12;
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = bands[i % bands.length];
      ctx.beginPath();
      ctx.moveTo(0, i * bh + Math.sin(scroll / 60 + i) * 4);
      for (let x = 0; x <= W; x += 10) {
        ctx.lineTo(x, i * bh + Math.sin((x + scroll * (0.3 + (i % 3) * 0.2)) / 50 + i) * 5);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.fill();
    }

    // הכתם האדום הגדול
    const rx = W - wrap(scroll * 0.3 + 120, W + 160) + 80;
    const spot = ctx.createRadialGradient(rx, H * 0.62, 5, rx, H * 0.62, 50);
    spot.addColorStop(0, "#c4402a");
    spot.addColorStop(0.7, "#a33a22");
    spot.addColorStop(1, "rgba(163, 58, 34, 0)");
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.ellipse(rx, H * 0.62, 60, 30, 0, 0, Math.PI * 2);
    ctx.fill();

    // הכהיה כדי שהמכשולים והציפור יבלטו
    ctx.fillStyle = "rgba(10, 5, 20, 0.35)";
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- מצב המשחק ----------
  let state = "ready"; // ready | playing | over
  let bird, pillars, particles, score, lastTime;
  let levelIndex = 0;
  let prevLevelIndex = 0;
  let fade = 1; // 0..1 – מעבר רקע בין שלבים
  let banner = { text: "", sub: "", t: 0 };

  const level = () => LEVELS[levelIndex];
  const loopCount = () => Math.floor(score / (POINTS_PER_LEVEL * LEVELS.length));
  const speedMultiplier = () => 1 + LOOP_SPEEDUP * loopCount();

  function currentSpeed() {
    return (level().speed + (score % POINTS_PER_LEVEL) * 3) * speedMultiplier();
  }

  function currentGap() {
    return Math.max(135, level().gap - (score % POINTS_PER_LEVEL) * 2 - loopCount() * 6);
  }

  function reset() {
    bird = { x: 100, y: H / 2, vy: 0, r: 16, angle: 0, flap: 0 };
    pillars = [];
    particles = [];
    score = 0;
    levelIndex = prevLevelIndex = 0;
    fade = 1;
    banner.t = 0;
    $("level-name").textContent = levelLabel(level());
  }

  function addPillar(x) {
    const gap = currentGap();
    const margin = 60;
    pillars.push({
      x,
      gapY: margin + Math.random() * (H - gap - margin * 2),
      gap,
      passed: false,
      level: levelIndex,
      decor: Array.from({ length: 6 }, () => ({ dx: Math.random(), dy: Math.random(), r: 4 + Math.random() * 6 })),
    });
  }

  function changeLevel(newIndex) {
    prevLevelIndex = levelIndex;
    levelIndex = newIndex;
    fade = prevLevelIndex === levelIndex ? 1 : 0;
    // מסירים מכשולים שעוד לא נכנסו למסך – רגע של שקט במעבר
    pillars = pillars.filter((p) => p.x < W);

    const lvl = level();
    const loop = loopCount();
    banner = {
      text: `${lvl.emoji} שלב ${levelIndex + 1}: ${lvl.name}`,
      sub: `כבידה ${lvl.gravityLabel}` + (loop ? ` | סיבוב ${loop + 1} – מהר יותר!` : ""),
      t: 2.2,
    };
    $("level-name").textContent = levelLabel(lvl);
    sounds.levelUp();
  }

  function flap() {
    initAudio();
    if (state === "over") return;
    if (state === "ready") start();
    bird.vy = level().flap;
    bird.flap = 1;
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
      particles.push({
        x: bird.x, y: bird.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1,
        color: i % 3 ? "#ffd23f" : "#bfe9ff",
      });
    }

    const previousBest = Auth.currentUser()?.best || 0;
    // במצב בדיקה אפשר לקפוץ לכל ניקוד – לכן לא שומרים שיא
    const best = DEBUG ? previousBest : Auth.saveBest(score);
    refreshStats();
    if (!DEBUG && score > previousBest) syncShared();

    $("overlay-title").textContent = "💥 התרסקת!";
    $("overlay-text").textContent =
      `ניקוד: ${score} | שלב: ${levelLabel(level())} | שיא: ${best}` +
      (DEBUG ? " (מצב בדיקה – השיא לא נשמר)" : score > previousBest ? " – שיא חדש! 🎉" : "");
    $("start-btn").textContent = "שחק שוב";
    setTimeout(() => state === "over" && $("overlay").classList.remove("hidden"), 600);
  }

  function hitsPillar(p) {
    // בדיקת התנגשות בין עיגול למלבן
    const rects = [
      { x: p.x, y: 0, w: PILLAR_W, h: p.gapY },
      { x: p.x, y: p.gapY + p.gap, w: PILLAR_W, h: H - p.gapY - p.gap },
    ];
    const r = bird.r - 3; // קצת סלחני
    return rects.some((rc) => {
      const cx = Math.max(rc.x, Math.min(bird.x, rc.x + rc.w));
      const cy = Math.max(rc.y, Math.min(bird.y, rc.y + rc.h));
      return (bird.x - cx) ** 2 + (bird.y - cy) ** 2 < r * r;
    });
  }

  function update(dt) {
    time += dt;
    updateBackground(dt, state === "playing" ? speedMultiplier() : 0.3);
    fade = Math.min(1, fade + dt);
    banner.t = Math.max(0, banner.t - dt);
    bird.flap = Math.max(0, bird.flap - dt * 4);

    if (state === "ready") {
      bird.y = H / 2 + Math.sin(time * 3) * 8;
      return;
    }

    for (const pt of particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt * 1.2;
    }
    particles = particles.filter((pt) => pt.life > 0);

    if (state !== "playing") return;

    const lvl = level();
    bird.vy += lvl.gravity * dt;
    bird.y += bird.vy * dt;
    bird.angle = Math.max(-0.5, Math.min(1.2, bird.vy / 600));

    const speed = currentSpeed();
    for (const p of pillars) {
      p.x -= speed * dt;
      if (!p.passed && p.x + PILLAR_W < bird.x) {
        p.passed = true;
        score++;
        sounds.point();
        if (score % POINTS_PER_LEVEL === 0) {
          changeLevel((score / POINTS_PER_LEVEL) % LEVELS.length);
        }
      }
    }
    pillars = pillars.filter((p) => p.x + PILLAR_W > -30);
    const last = pillars[pillars.length - 1];
    if (!last || last.x < W - SPACING) addPillar(W + 10);

    if (invincible) {
      // מצב בלתי פגיע: הציפור נשארת בתוך המסך ועוברת דרך מכשולים
      if (bird.y < bird.r || bird.y > H - bird.r) {
        bird.y = Math.max(bird.r, Math.min(H - bird.r, bird.y));
        bird.vy = 0;
      }
    } else if (bird.y - bird.r < 0 || bird.y + bird.r > H || pillars.some(hitsPillar)) {
      gameOver();
    }
  }

  // ---------- ציור מכשולים ----------
  function pillarParts(p) {
    return [
      { y: 0, h: p.gapY, edge: p.gapY, top: true },
      { y: p.gapY + p.gap, h: H - p.gapY - p.gap, edge: p.gapY + p.gap, top: false },
    ];
  }

  function glowRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
  }

  function drawRockPillar(p, lvl) {
    for (const part of pillarParts(p)) {
      const g = ctx.createLinearGradient(p.x, 0, p.x + PILLAR_W, 0);
      g.addColorStop(0, lvl.colors[0]);
      g.addColorStop(0.5, lvl.colors[1]);
      g.addColorStop(1, lvl.colors[2]);
      ctx.fillStyle = g;
      ctx.fillRect(p.x, part.y, PILLAR_W, part.h);

      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      if (part.h > 20) {
        for (const c of p.decor) {
          ctx.beginPath();
          ctx.arc(p.x + 10 + c.dx * (PILLAR_W - 20), part.y + c.dy * part.h, c.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      glowRect(p.x - 6, part.top ? part.edge - 14 : part.edge, PILLAR_W + 12, 14, lvl.cap);
    }
  }

  function drawRingPillar(p, lvl) {
    // עמודה של שכבות טבעת: פסים אנכיים שקופים למחצה + גושי קרח
    const stripes = ["#e8d3a0", "#c9a86b", "#8a6a3f", "#f3e3b8", "#a7824f"];
    for (const part of pillarParts(p)) {
      for (let i = 0; i < 8; i++) {
        ctx.globalAlpha = 0.65 + (i % 2) * 0.3;
        ctx.fillStyle = stripes[i % stripes.length];
        ctx.fillRect(p.x + i * (PILLAR_W / 8), part.y, PILLAR_W / 8 - 1, part.h);
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = "#e6f6ff";
      if (part.h > 20) {
        for (const c of p.decor) {
          const iy = part.y + wrap(c.dy * part.h + time * 20 * (c.dx - 0.5), part.h);
          ctx.beginPath();
          ctx.arc(p.x + 8 + c.dx * (PILLAR_W - 16), iy, c.r * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // שפת טבעת אליפטית בקצה הפתח
      const cy = part.top ? part.edge - 6 : part.edge + 6;
      ctx.strokeStyle = lvl.cap;
      ctx.shadowColor = lvl.cap;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(p.x + PILLAR_W / 2, cy, PILLAR_W / 2 + 16, 8, -0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x + PILLAR_W / 2, cy, PILLAR_W / 2 + 9, 4, -0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function drawStormPillar(p, lvl) {
    // עמודת סערה עם פסים מתערבלים
    for (const part of pillarParts(p)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, part.y, PILLAR_W, part.h);
      ctx.clip();
      for (let y = part.y - 20; y < part.y + part.h + 20; y += 10) {
        const k = Math.floor((y - part.y) / 10);
        ctx.fillStyle = lvl.colors[((k % 3) + 3) % 3];
        ctx.beginPath();
        ctx.moveTo(p.x, y);
        for (let x = 0; x <= PILLAR_W; x += 8) {
          ctx.lineTo(p.x + x, y + Math.sin(x / 10 + time * 3 + k) * 3);
        }
        ctx.lineTo(p.x + PILLAR_W, y + 12);
        ctx.lineTo(p.x, y + 12);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255, 240, 220, 0.5)";
      ctx.lineWidth = 2;
      for (const c of p.decor.slice(0, 3)) {
        ctx.beginPath();
        ctx.arc(p.x + 12 + c.dx * (PILLAR_W - 24), part.y + c.dy * part.h, c.r + 2, time * 4, time * 4 + 4.5);
        ctx.stroke();
      }
      ctx.restore();
      glowRect(p.x - 6, part.top ? part.edge - 14 : part.edge, PILLAR_W + 12, 14, lvl.cap);
    }
  }

  function drawPillar(p) {
    const lvl = LEVELS[p.level];
    if (lvl.obstacle === "ring") drawRingPillar(p, lvl);
    else if (lvl.obstacle === "storm") drawStormPillar(p, lvl);
    else drawRockPillar(p, lvl);
  }

  // ---------- הציפור האסטרונאוטית ----------
  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.angle);

    // מיכל חמצן על הגב + סילון בזמן נפנוף
    if (bird.flap > 0) {
      const len = 6 + bird.flap * 16;
      const jg = ctx.createLinearGradient(-20, 0, -20 - len, 0);
      jg.addColorStop(0, "rgba(160, 230, 255, 0.9)");
      jg.addColorStop(1, "rgba(160, 230, 255, 0)");
      ctx.fillStyle = jg;
      ctx.beginPath();
      ctx.moveTo(-20, 1);
      ctx.lineTo(-20 - len, 5);
      ctx.lineTo(-20, 9);
      ctx.fill();
    }
    ctx.fillStyle = "#9aa3b5";
    ctx.strokeStyle = "#5b6275";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-22, -4, 9, 15, 3);
    ctx.fill();
    ctx.stroke();

    // גוף
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(0, 2, 14, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff1b8";
    ctx.beginPath();
    ctx.ellipse(3, 7, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // כנף שמתנפנפת
    const wing = -0.9 * bird.flap + Math.sin(time * 10) * 0.15 + 0.3;
    ctx.save();
    ctx.translate(-4, 3);
    ctx.rotate(wing);
    ctx.fillStyle = "#f0a818";
    ctx.beginPath();
    ctx.ellipse(-6, 0, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // עין
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(6, -4, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath();
    ctx.arc(7.5, -4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // מקור
    ctx.fillStyle = "#ff8a2a";
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(20, 3);
    ctx.lineTo(11, 6);
    ctx.fill();

    // קסדת אסטרונאוט
    ctx.fillStyle = "rgba(180, 230, 255, 0.22)";
    ctx.strokeStyle = "#f4f7ff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(2, 0, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(2, 0, 16, -2.4, -1.5); // השתקפות
    ctx.stroke();
    // צווארון הקסדה
    ctx.fillStyle = "#c9d2e3";
    ctx.beginPath();
    ctx.roundRect(-10, 17, 24, 6, 3);
    ctx.fill();
    // אנטנה
    ctx.strokeStyle = "#c9d2e3";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -20);
    ctx.lineTo(-8, -29);
    ctx.stroke();
    ctx.fillStyle = Math.sin(time * 6) > 0 ? "#ff4f7b" : "#ff9ab3";
    ctx.beginPath();
    ctx.arc(-8, -30, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBanner() {
    if (banner.t <= 0) return;
    const a = Math.min(1, banner.t / 0.4, (2.2 - banner.t) / 0.3 + 0.001);
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = "rgba(5, 3, 15, 0.6)";
    ctx.fillRect(0, 105, W, 100);
    ctx.textAlign = "center";
    ctx.fillStyle = "#7df9ff";
    ctx.font = "bold 32px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(banner.text, W / 2, 152);
    ctx.fillStyle = "#e8e6ff";
    ctx.font = "18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(banner.sub, W / 2, 186);
    ctx.globalAlpha = 1;
  }

  function draw() {
    level().drawScenery();
    if (fade < 1) {
      // מציירים את רקע השלב הקודם על קנבס נפרד ומעמעמים אותו החוצה
      ctx = fadeCtx;
      LEVELS[prevLevelIndex].drawScenery();
      ctx = screenCtx;
      ctx.globalAlpha = 1 - fade;
      ctx.drawImage(fadeCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }

    pillars.forEach(drawPillar);
    if (state !== "over") drawBird();

    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
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
    drawBanner();
  }

  function loop(t) {
    const dt = Math.min(0.033, (t - (lastTime ?? t)) / 1000);
    lastTime = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- ממשק ----------
  // ---------- טבלת שיאים (משותפת אם אפשר, אחרת מקומית) ----------
  const BOARD_MODES = {
    shared: "🌐 משותפת",
    offline: "⚠️ לא מחובר – טבלה מקומית",
    local: "💻 טבלה מקומית",
    loading: "⏳ טוען…",
  };
  let boardRequest = 0;

  function renderBoard(rows, mode, isMe) {
    $("board-mode").textContent = BOARD_MODES[mode];
    $("board-mode").dataset.mode = mode;
    const list = $("leaderboard-list");
    list.innerHTML = "";
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "עדיין אין שיאים – תהיה הראשון!";
      list.appendChild(li);
    }
    for (const row of rows) {
      const li = document.createElement("li");
      li.textContent = `${row.name} – ${row.best}`;
      if (isMe(row)) li.classList.add("me");
      list.appendChild(li);
    }
  }

  async function refreshStats() {
    const user = Auth.currentUser();
    if (!user) return;
    $("current-user").textContent = user.name;
    $("best-score").textContent = user.best;

    const localRows = Auth.leaderboard();
    const isLocalMe = (row) => row.name === user.name;
    if (!SharedBoard.enabled()) {
      renderBoard(localRows, "local", isLocalMe);
      return;
    }

    // מציגים מיד את הטבלה המקומית, ומחליפים כשהמשותפת מגיעה
    const req = ++boardRequest;
    if (!$("leaderboard-list").children.length) renderBoard(localRows, "loading", isLocalMe);
    try {
      const rows = await SharedBoard.fetchBoard();
      if (req === boardRequest) renderBoard(rows, "shared", (row) => row.id === user.playerId);
    } catch {
      if (req === boardRequest) renderBoard(localRows, "offline", isLocalMe);
    }
  }

  // שולח לטבלה המשותפת את השיא המקומי (גם שיא שהושג בזמן שלא היה חיבור)
  async function syncShared() {
    const user = Auth.currentUser();
    if (DEBUG || !user || !SharedBoard.enabled() || user.best <= 0) return;
    try {
      await SharedBoard.submit(user.playerId, user.name, user.best);
    } catch {
      // לא מחובר – ננסה שוב בטעינה הבאה או אחרי המשחק הבא
    }
    refreshStats();
  }

  setInterval(() => {
    if (gameVisible() && state !== "playing" && document.visibilityState === "visible") refreshStats();
  }, 30000);

  function showReady() {
    reset();
    state = "ready";
    $("overlay-title").textContent = "מוכן להמראה?";
    $("overlay-text").textContent =
      `מתחילים ב${levelLabel(level())} – כל ${POINTS_PER_LEVEL} נקודות עוברים לכוכב הבא. ` +
      "לחץ רווח, קליק או גע במסך כדי לעוף";
    $("start-btn").textContent = "התחל";
    $("overlay").classList.remove("hidden");
  }

  function showScreen() {
    const loggedIn = !!Auth.currentUser();
    $("auth-screen").classList.toggle("active", !loggedIn);
    $("game-screen").classList.toggle("active", loggedIn);
    if (loggedIn) {
      $("leaderboard-list").innerHTML = "";
      refreshStats();
      syncShared();
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

  // כלי בדיקה – פעיל רק עם ?debug בכתובת
  if (DEBUG) {
    const debug = {
      setScore(n) {
        if (state !== "playing") start();
        score = n;
        const target = Math.floor(n / POINTS_PER_LEVEL) % LEVELS.length;
        // באנר רק כשמגיעים לתחילת שלב (כפתור שלב או מעבר של 10 נקודות)
        if (target !== levelIndex || n % POINTS_PER_LEVEL === 0) changeLevel(target);
        fade = 1;
      },
      addPoint() {
        debug.setScore(state === "playing" ? score + 1 : 1);
      },
      setInvincible(on) {
        invincible = !!on;
      },
      info: () => ({
        state, score, level: level().name, speed: currentSpeed(), y: bird.y, vy: bird.vy, invincible,
      }),
    };
    window.__spaceFlappyDebug = debug;

    // פאנל בדיקה גלוי מתחת למשחק
    const panel = document.createElement("aside");
    panel.className = "debug-panel";
    const title = document.createElement("h3");
    title.textContent = "🛠 מצב בדיקה";
    panel.appendChild(title);

    const makeButton = (text, onClick) => {
      const btn = document.createElement("button");
      btn.className = "btn small";
      btn.textContent = text;
      btn.addEventListener("click", (e) => {
        e.currentTarget.blur();
        initAudio();
        onClick();
      });
      return btn;
    };

    const levelRow = document.createElement("div");
    levelRow.className = "debug-row";
    LEVELS.forEach((lvl, i) => {
      levelRow.appendChild(makeButton(levelLabel(lvl), () => debug.setScore(i * POINTS_PER_LEVEL)));
    });
    panel.appendChild(levelRow);

    const toolsRow = document.createElement("div");
    toolsRow.className = "debug-row";
    toolsRow.appendChild(makeButton("+1 נקודה", debug.addPoint));
    const shield = document.createElement("label");
    shield.className = "debug-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "debug-invincible";
    checkbox.addEventListener("change", () => debug.setInvincible(checkbox.checked));
    const shieldText = document.createElement("span");
    shieldText.textContent = "🛡 בלתי פגיע";
    shield.append(checkbox, shieldText);
    toolsRow.appendChild(shield);
    panel.appendChild(toolsRow);

    const boardRow = document.createElement("div");
    boardRow.className = "debug-row";
    const boardOut = document.createElement("p");
    boardOut.className = "debug-status";
    boardRow.appendChild(
      makeButton("🌐 צור טבלה משותפת חדשה", async () => {
        boardOut.textContent = "יוצר…";
        try {
          const id = await SharedBoard.createBoard();
          boardOut.textContent =
            `נוצרה טבלה! המזהה: ${id} – הדביקו אותו ב-SHARED_BOARD_ID בקובץ shared-board.js (או שלחו לי ואכניס).`;
        } catch (err) {
          boardOut.textContent = "לא הצלחתי ליצור טבלה: " + err.message;
        }
      })
    );
    panel.append(boardRow, boardOut);

    const status = document.createElement("p");
    status.className = "debug-status";
    panel.appendChild(status);
    setInterval(() => {
      const lvl = level();
      status.textContent =
        `שלב: ${levelLabel(lvl)} | ניקוד: ${score} | מהירות: ${Math.round(currentSpeed())} | כבידה: ${lvl.gravity}`;
    }, 200);

    document.querySelector(".game-wrap").after(panel);
  }

  reset();
  showScreen();
  requestAnimationFrame(loop);
})();
