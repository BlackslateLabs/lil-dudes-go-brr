// The landing page's hero: a top-down mini lane that loops. A cannon fires blue dudes up the
// lane, the first one to touch the hidden gate flips it to ×3, every dude through it becomes
// three, red troops walk down and clash with them, and the tower's HP counts down to a fall.
// Plain canvas, drawn in a 300 × 400 logical space and scaled for the screen's pixel ratio.
// Pauses off-screen and in hidden tabs; under reduced motion it draws one settled frame.

const W = 300;
const H = 400;

const C = {
  grass: '#6fcf5a',
  grass2: '#79d663',
  tile: '#ffcf98',
  tile2: '#ffc88a',
  grout: '#efab6c',
  kerb: '#ff7eb3',
  ink: '#1b1530',
  me: '#2a7bff',
  meLight: '#7fb4ff',
  them: '#f2404f',
  themLight: '#ff9aa4',
  grape: '#7c5cff',
  gold: '#ffc21a',
  white: '#ffffff',
};

const LANE_L = 46;
const LANE_R = 254;
const TOWER = { x: 150, y: 66, r: 27 };
const GATE = { y: 214, l: 64, r: 236, h: 26 };
const CANNON_Y = 362;
const LINE_Y = 340;
const HP_MAX = 60;
const DUDE_R = 5;
const FIRE_EVERY = 0.17;
const MAX_DUDES = 170;

interface Dude {
  x: number;
  y: number;
  vx: number;
  gated: boolean;
}

interface Troop {
  x: number;
  y: number;
}

interface Pop {
  x: number;
  y: number;
  t: number;
  color: string;
  big: boolean;
}

interface State {
  t: number;
  dudes: Dude[];
  troops: Troop[];
  pops: Pop[];
  hp: number;
  /** 0 hidden; counts up from the first touch (the flip takes 0.35 s). */
  gateFlip: number;
  gateOpen: boolean;
  fireIn: number;
  troopsIn: number;
  shake: number;
  /** Seconds since the tower fell (-1 while it stands). */
  down: number;
}

function fresh(): State {
  return {
    t: 0,
    dudes: [],
    troops: [],
    pops: [],
    hp: HP_MAX,
    gateFlip: 0,
    gateOpen: false,
    fireIn: 0.5,
    troopsIn: 1.6,
    shake: 0,
    down: -1,
  };
}

function step(s: State, dt: number) {
  s.t += dt;
  s.shake = Math.max(0, s.shake - dt);
  if (s.gateOpen) s.gateFlip = Math.min(1, s.gateFlip + dt / 0.35);

  // After the fall: let the dust settle, then deal the lane again.
  if (s.down >= 0) {
    s.down += dt;
    if (s.down > 2.4) Object.assign(s, fresh());
  }

  const cannonX = 150 + Math.sin(s.t * 0.9) * 62;
  if (s.down < 0) {
    s.fireIn -= dt;
    if (s.fireIn <= 0 && s.dudes.length < MAX_DUDES) {
      s.fireIn += FIRE_EVERY;
      s.dudes.push({ x: cannonX, y: CANNON_Y - 22, vx: (Math.random() - 0.5) * 36, gated: false });
    }
    s.troopsIn -= dt;
    if (s.troopsIn <= 0) {
      s.troopsIn = 2.6;
      for (let i = 0; i < 4; i++) s.troops.push({ x: TOWER.x - 18 + i * 12, y: TOWER.y + 38 + (i % 2) * 8 });
    }
  }

  // Dudes walk up, drift toward the middle of the lane and keep apart.
  const next: Dude[] = [];
  for (const d of s.dudes) {
    const speed = d.y > CANNON_Y - 60 ? 120 : 62;
    d.y -= speed * dt;
    // Spread out on the open lane, close in on the tower near the top.
    d.vx += (TOWER.x - d.x) * (d.y < 150 ? 0.9 : 0.06) * dt;
    d.vx *= 1 - 0.8 * dt;
    d.x += d.vx * dt;
    d.x = Math.min(LANE_R - DUDE_R - 2, Math.max(LANE_L + DUDE_R + 2, d.x));

    // Through the gate: it flips on the first touch, and every dude out of it is three.
    if (!d.gated && d.y <= GATE.y + GATE.h / 2) {
      d.gated = true;
      if (!s.gateOpen) {
        s.gateOpen = true;
        s.pops.push({ x: 150, y: GATE.y, t: 0, color: C.gold, big: true });
      }
      if (s.dudes.length + next.length < MAX_DUDES) {
        for (const k of [-1, 1]) next.push({ x: d.x + k * 10, y: d.y - 3, vx: k * (30 + Math.random() * 30), gated: true });
      }
    }

    // At the tower: it scores a hit and pops.
    const dx = d.x - TOWER.x;
    const dy = d.y - TOWER.y;
    if (s.down < 0 && dx * dx + dy * dy < (TOWER.r + DUDE_R) ** 2) {
      s.hp = Math.max(0, s.hp - 1);
      s.shake = 0.12;
      s.pops.push({ x: d.x, y: d.y, t: 0, color: C.me, big: false });
      if (s.hp === 0) {
        s.down = 0;
        s.pops.push({ x: TOWER.x, y: TOWER.y, t: 0, color: C.them, big: true });
      }
      continue;
    }
    if (d.y < 22) continue;
    next.push(d);
  }
  s.dudes = next;

  // Keep apart (few dozen bodies: pairwise is fine).
  const ds = s.dudes;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i]!;
      const b = ds[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      const min = DUDE_R * 2.1;
      if (d2 > 0.01 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        a.x -= dx * push;
        a.y -= dy * push * 0.4;
        b.x += dx * push;
        b.y += dy * push * 0.4;
      }
    }
  }

  // Red troops walk down; a troop and a dude that meet both pop.
  const troops: Troop[] = [];
  for (const tr of s.troops) {
    tr.y += 38 * dt;
    let hit = -1;
    for (let i = 0; i < s.dudes.length; i++) {
      const d = s.dudes[i]!;
      if ((d.x - tr.x) ** 2 + (d.y - tr.y) ** 2 < (DUDE_R * 2.2) ** 2) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      const d = s.dudes[hit]!;
      s.dudes.splice(hit, 1);
      s.pops.push({ x: (d.x + tr.x) / 2, y: (d.y + tr.y) / 2, t: 0, color: C.white, big: false });
      continue;
    }
    if (tr.y > LINE_Y || s.down >= 0) continue;
    troops.push(tr);
  }
  s.troops = troops;

  s.pops = s.pops.filter((p) => (p.t += dt) < (p.big ? 0.7 : 0.35));
}

// ---- Drawing -------------------------------------------------------------------------------

function paintGround(g: CanvasRenderingContext2D) {
  g.fillStyle = C.grass;
  g.fillRect(0, 0, W, H);
  g.fillStyle = C.grass2;
  for (let x = 0; x < W; x += 40) g.fillRect(x, 0, 20, H);

  // Kerbs, then the tiled lane between them.
  for (let y = 0; y < H; y += 12) {
    g.fillStyle = (y / 12) % 2 ? C.kerb : C.white;
    g.fillRect(LANE_L - 7, y, 7, 12);
    g.fillRect(LANE_R, y, 7, 12);
  }
  const tile = (LANE_R - LANE_L) / 4;
  g.fillStyle = C.grout;
  g.fillRect(LANE_L, 0, LANE_R - LANE_L, H);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j * tile < H; j++) {
      g.fillStyle = (i + j) % 2 ? C.tile : C.tile2;
      g.beginPath();
      g.roundRect(LANE_L + i * tile + 1.5, j * tile + 1.5, tile - 3, tile - 3, 6);
      g.fill();
    }
  }

  // Your cannon line.
  g.fillStyle = '#f2404f40';
  g.fillRect(LANE_L, LINE_Y - 4, LANE_R - LANE_L, 8);
  g.fillStyle = C.them;
  g.fillRect(LANE_L, LINE_Y - 1, LANE_R - LANE_L, 2);
}

function outlinedText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string) {
  g.font = `${size}px "Lilita One", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.22;
  g.strokeStyle = C.ink;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

function body(g: CanvasRenderingContext2D, x: number, y: number, fill: string, light: string, r = DUDE_R) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = C.ink;
  g.stroke();
  g.beginPath();
  g.arc(x - r * 0.3, y - r * 0.35, r * 0.38, 0, Math.PI * 2);
  g.fillStyle = light;
  g.fill();
}

function draw(g: CanvasRenderingContext2D, ground: HTMLCanvasElement, s: State) {
  g.drawImage(ground, 0, 0, W, H);

  // The gate: a "?" until the first touch, then it flips (squash through the middle) to ×3.
  const f = s.gateFlip;
  const squash = s.gateOpen ? Math.abs(Math.cos(f * Math.PI)) : 1;
  const shown = s.gateOpen && f >= 0.5;
  const gh = GATE.h * Math.max(0.06, squash);
  g.beginPath();
  g.roundRect(GATE.l, GATE.y - gh / 2, GATE.r - GATE.l, gh, 6);
  g.fillStyle = shown ? C.me : C.grape;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = C.ink;
  g.stroke();
  if (squash > 0.5) outlinedText(g, shown ? '×3' : '?', 150, GATE.y + 1, 22 * squash, C.white);
  for (const x of [GATE.l, GATE.r]) body(g, x, GATE.y, C.white, '#ffffff', 6);

  // The tower (gone once it falls), shaking a little on each hit.
  if (s.down < 0) {
    const sx = s.shake > 0 ? Math.sin(s.t * 90) * 2 : 0;
    const tx = TOWER.x + sx;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.fillStyle = '#c8343f';
      g.beginPath();
      g.roundRect(tx + Math.cos(a) * TOWER.r - 5, TOWER.y + Math.sin(a) * TOWER.r - 5, 10, 10, 2);
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = C.ink;
      g.stroke();
    }
    body(g, tx, TOWER.y, C.them, C.themLight, TOWER.r);
    g.beginPath();
    g.arc(tx, TOWER.y, TOWER.r * 0.55, 0, Math.PI * 2);
    g.fillStyle = '#c8343f';
    g.fill();
    outlinedText(g, String(s.hp), tx, TOWER.y + 1, 20, C.white);
  } else {
    g.fillStyle = '#c8343f80';
    g.beginPath();
    g.ellipse(TOWER.x, TOWER.y + 6, TOWER.r, TOWER.r * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    const a = Math.min(1, s.down * 3) * Math.max(0, Math.min(1, (2.2 - s.down) * 2));
    g.globalAlpha = a;
    outlinedText(g, 'Tower down!', 150, TOWER.y + 4, 30, C.gold);
    g.globalAlpha = 1;
  }

  for (const tr of s.troops) body(g, tr.x, tr.y, C.them, C.themLight);
  for (const d of s.dudes) body(g, d.x, d.y, C.me, C.meLight);

  for (const p of s.pops) {
    const life = p.big ? 0.7 : 0.35;
    const k = p.t / life;
    g.globalAlpha = 1 - k;
    g.beginPath();
    g.arc(p.x, p.y, (p.big ? 14 : 4) + k * (p.big ? 46 : 12), 0, Math.PI * 2);
    g.lineWidth = p.big ? 5 : 2.5;
    g.strokeStyle = p.color;
    g.stroke();
    g.globalAlpha = 1;
  }

  // The cannon, swinging as it aims.
  const cx = 150 + Math.sin(s.t * 0.9) * 62;
  g.fillStyle = C.ink;
  g.beginPath();
  g.roundRect(cx - 5, CANNON_Y - 30, 10, 22, 3);
  g.fill();
  g.fillStyle = '#9fc4ff';
  g.beginPath();
  g.roundRect(cx - 3, CANNON_Y - 28, 6, 18, 2);
  g.fill();
  body(g, cx, CANNON_Y, C.me, C.meLight, 15);
}

/** Starts the hero lane on `canvas`. */
export function startLane(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const ground = document.createElement('canvas');
  const s = fresh();
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fit = () => {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.round((w * H) / W);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ground.width = w;
      ground.height = h;
      const gg = ground.getContext('2d')!;
      gg.setTransform(w / W, 0, 0, h / H, 0, 0);
      paintGround(gg);
    }
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  };

  const frame = () => {
    fit();
    draw(g, ground, s);
  };

  if (still) {
    // A settled moment: the gate open and the crowd mid-lane.
    for (let i = 0; i < 300; i++) step(s, 1 / 60);
    void document.fonts.ready.then(frame);
    new ResizeObserver(frame).observe(canvas);
    return;
  }

  let visible = true;
  let raf = 0;
  let last = 0;
  const loop = (now: number) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    step(s, dt);
    frame();
    raf = requestAnimationFrame(loop);
  };
  const run = () => {
    const on = visible && document.visibilityState === 'visible';
    if (on && !raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    } else if (!on && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    run();
  }).observe(canvas);
  document.addEventListener('visibilitychange', run);
  void document.fonts.load('20px "Lilita One"').finally(run);
}
