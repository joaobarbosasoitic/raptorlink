// Núcleo da simulação do F-22 (sem DOM e sem timers).
// Usado pelo motor Node (engine/index.js) e pelo modo MOCK do navegador,
// garantindo que os dois publiquem exatamente o mesmo contrato MQTT.
//
//   core.step(dt)          avança a simulação dt segundos
//   core.command(cmd)      aplica { comando, valor } vindo de f22/comandos
//   core.readings()        { subtopico: dados } no formato { valor, unidade }

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm360 = (a) => ((a % 360) + 360) % 360;
const norm180 = (a) => {
  const n = norm360(a);
  return n > 180 ? n - 360 : n;
};
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round = (v, d = 0) => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};
const u = (valor, unidade, d = 1) => ({ valor: typeof valor === 'number' ? round(valor, d) : valor, unidade });

// ------------------------------------------------------------------ parâmetros (valores didáticos)
const RANGES = [10, 20, 40, 80, 160];
const WPN = {
  'AIM-120': { max: 40, min: 1, speed: 0.62 }, // alcance NM, velocidade NM/s
  'AIM-9': { max: 10, min: 0.3, speed: 0.5 },
  GUN: { max: 1.2, min: 0 },
};
const WPN_ORDER = ['AIM-120', 'AIM-9', 'GUN'];
const BASE = { lat: -16.2286, lon: -48.9644 }; // Base Aérea de Anápolis
const WAYPOINTS = [
  { nome: 'IP ALFA', x: 30, y: 45 },
  { nome: 'CAP NORTE', x: -25, y: 95 },
  { nome: 'CAP SUL', x: 35, y: 10 },
  { nome: 'BASE', x: 0, y: -20 },
];
const HOSTILE_CODES = ['29', '35', '31', 'SA'];
export const FUEL_FULL = 8200; // kg
const FUEL_BINGO = 1800;
const FUEL_LOW = 900;
const ENGINE_TEMP_MAX = 1000; // °C
const G_LIMIT = 9;
const TIPOS = { hostile: 'hostil', friendly: 'amigo', unknown: 'desconhecido' };
const TIPOS_INV = { hostil: 'hostile', amigo: 'friendly', desconhecido: 'unknown' };

export class SimCore {
  /** @param {{ fuelBurnX?: number }} opts  fuelBurnX acelera o consumo para a demo */
  constructor(opts = {}) {
    this.fuelBurnX = opts.fuelBurnX ?? 6;
    this.reset();
  }

  reset() {
    Object.assign(this, {
      t: 0, paused: false,
      x: 0, y: -10, alt: 28000, hdg: 20, pitch: 0, prevPitch: 0, roll: 0, ias: 520, g: 1, gmax: 1, vvi: 0,
      throttle: 78, manualThrottle: false, abHeat: 0, temps: [700, 700],
      fuel: FUEL_FULL,
      radarMode: 'TWS', prevMode: 'TWS', rangeIdx: 2, lockId: null, autoLockAt: 4,
      masterArm: false, selected: 'AIM-120',
      bays: { main: false, sideLeft: false, sideRight: false },
      bayAuto: { main: 0, sideLeft: 0, sideRight: 0 },
      gun: 480, flares: 60, chaff: 60, missiles: [], mslSeq: 1, enemySeq: 1, damage: false,
      gear: 'UP', gearTarget: 'UP', gearTimer: 0, flaps: 'UP', speedBrake: false, apu: false,
      com1: '251.50', com2: '121.50', iff: '4521', wptIdx: 0,
      contacts: [], seq: 1, respawn: [], temp: [],
      nextThreat: 30,
      // ambiente
      windDirBase: rand(200, 300), oatDev: rand(-4, 4), turbBase: 0.1,
      gust: null, // { until, kt, turb }
      maneuver: null, // { start, dur, side }
      nextManeuver: rand(90, 150),
    });
    this.stores = [
      ...['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((station) => ({ station, type: 'AIM-120', status: 'RDY' })),
      { station: 'SL', type: 'AIM-9', status: 'RDY' },
      { station: 'SR', type: 'AIM-9', status: 'RDY' },
    ];
    ['hostile', 'hostile', 'hostile', 'friendly', 'friendly', 'unknown', 'unknown'].forEach((k) => this.spawn(k, { initial: true }));
    this.computeEnv();
  }

  // ---------------------------------------------------------------- utilidades
  spawn(type, { initial = false, bearing = null, range = null } = {}) {
    const brg = bearing ?? rand(0, 360);
    const r = range ?? (initial ? rand(15, 60) : rand(55, 80));
    const x = this.x + Math.sin(brg * D2R) * r;
    const y = this.y + Math.cos(brg * D2R) * r;
    const toOwn = norm360(brg + 180);
    const c = {
      id: `T${String(this.seq++).padStart(2, '0')}`,
      type, x, y,
      alt: rand(16000, 40000),
      hdg: type === 'hostile' ? norm360(toOwn + rand(-40, 40)) : rand(0, 360),
      spd: rand(380, 560),
      code: type === 'hostile' ? pick(HOSTILE_CODES) : undefined,
    };
    this.contacts.push(c);
    return c;
  }

  geo(c) {
    const dx = c.x - this.x;
    const dy = c.y - this.y;
    return { range: Math.hypot(dx, dy), bearing: norm360(Math.atan2(dx, dy) / D2R) };
  }

  note(msg, nivel = 'info', secs = 4, codigo = 'EVENTO') {
    this.temp.push({ msg, nivel, codigo, until: this.t + secs });
  }

  tas() {
    return this.ias * (1 + this.alt * 0.000012);
  }

  /** Vento (de onde sopra), temperatura externa e turbulência. */
  computeEnv() {
    const t = this.t;
    const gustOn = this.gust && this.t < this.gust.until;
    if (this.gust && !gustOn) this.gust = null;
    this.windDir = norm360(this.windDirBase + 25 * Math.sin(t / 240) + (gustOn ? 20 * Math.sin(t * 1.7) : 0));
    this.windSpeed = Math.max(0, (8 + this.alt * 0.0012) * (1 + 0.2 * Math.sin(t / 90)) + (gustOn ? this.gust.kt * (0.7 + 0.3 * Math.sin(t * 2.3)) : 0));
    this.oat = Math.max(-56.5, 15 - 1.98 * (this.alt / 1000)) + this.oatDev + 1.5 * Math.sin(t / 400);
    this.turbulence = clamp(this.turbBase + (gustOn ? this.gust.turb : 0), 0, 1);
  }

  // ---------------------------------------------------------------- passo
  step(dt) {
    if (this.paused || dt <= 0) return;
    this.t += dt;
    const t = this.t;

    // ambiente: turbulência de fundo em random walk
    this.turbBase = clamp(this.turbBase + (Math.random() - 0.5) * 0.3 * dt + (0.12 - this.turbBase) * 0.05 * dt, 0.02, 0.35);
    this.computeEnv();

    // manete automática (até o piloto mexer): cruzeiro com arrancadas de pós-combustão
    if (!this.manualThrottle) {
      const cycle = t % 160;
      this.throttle = cycle > 110 && cycle < 150 ? 100 : 78;
    }

    // manobra de alto G (automática ou por comando)
    if (!this.maneuver && t >= this.nextManeuver) this.startManeuver();
    let gBoost = 0;
    if (this.maneuver) {
      const p = (t - this.maneuver.start) / this.maneuver.dur;
      if (p >= 1) {
        this.maneuver = null;
        this.nextManeuver = t + rand(120, 200);
      } else {
        gBoost = 9.6 * Math.sin(Math.PI * p);
      }
    }

    // navegação: segue o waypoint atual com um zigue-zague suave
    const wp = WAYPOINTS[this.wptIdx];
    const wDist = Math.hypot(wp.x - this.x, wp.y - this.y);
    if (wDist < 3) {
      this.wptIdx = (this.wptIdx + 1) % WAYPOINTS.length;
      this.note(`WAYPOINT ${this.wptIdx + 1}`, 'info', 4, 'WAYPOINT');
    }
    const wBrg = norm360(Math.atan2(wp.x - this.x, wp.y - this.y) / D2R);
    let rollCmd = clamp(norm180(wBrg - this.hdg) * 1.6, -55, 55) + 24 * Math.sin(t / 6.5);
    if (this.maneuver) rollCmd = this.maneuver.side * 80;
    this.roll += clamp(rollCmd - this.roll, -60 * dt, 60 * dt);

    const altCmd = 28000 + 6000 * Math.sin(t / 40);
    const pitchCmd = clamp((altCmd - this.alt) / 600, -10, 12) + 2.5 * Math.sin(t / 5);
    this.pitch += clamp(pitchCmd - this.pitch, -6 * dt, 6 * dt);

    const ab = this.throttle > 85;
    let target = 180 + this.throttle * 5 + (ab ? (this.throttle - 85) * 12 : 0);
    if (this.speedBrake) target -= 140;
    if (this.gear !== 'UP') target -= 120;
    if (this.flaps !== 'UP') target -= 60;
    if (this.maneuver) target -= 120;
    target -= this.pitch * 9;
    this.ias += ((target - this.ias) * dt) / 5;

    // movimento: velocidade do ar + vento (deriva)
    const tas = this.tas();
    const v = Math.max(this.ias, 150);
    this.hdg = norm360(this.hdg + ((1091 * Math.tan(clamp(this.roll, -85, 85) * D2R)) / v) * dt);
    const windTo = (this.windDir + 180) * D2R;
    const vx = Math.sin(this.hdg * D2R) * tas + Math.sin(windTo) * this.windSpeed;
    const vy = Math.cos(this.hdg * D2R) * tas + Math.cos(windTo) * this.windSpeed;
    this.groundSpeed = Math.hypot(vx, vy);
    this.track = norm360(Math.atan2(vx, vy) / D2R);
    this.x += (vx * dt) / 3600;
    this.y += (vy * dt) / 3600;
    this.vvi = tas * 101.27 * Math.sin(this.pitch * D2R);
    this.alt = Math.max(0, this.alt + (this.vvi / 60) * dt);

    const q = (this.pitch - this.prevPitch) / dt;
    this.prevPitch = this.pitch;
    const turb = this.turbulence * (Math.sin(t * 7.3) + 0.6 * Math.sin(t * 12.7 + 1) + 0.4 * Math.sin(t * 3.1 + 2));
    let gT = Math.cos(this.pitch * D2R) / Math.cos(clamp(this.roll, -80, 80) * D2R) + (tas * 1.688 * q * D2R) / 32.2;
    gT = Math.max(gT, gBoost) + turb * 1.2;
    this.g += (gT - this.g) * clamp(dt * 4, 0, 1);
    this.gmax = Math.max(this.gmax, this.g);
    this.turbNoise = turb;

    // motores: temperatura com inércia térmica; pós-combustão prolongada aquece
    this.abHeat = ab ? Math.min(this.abHeat + dt * 4.5, 260) : Math.max(0, this.abHeat - dt * 8);
    this.eng = [0, 1].map((i) => {
      const k = i ? 1.012 : 1;
      const tgtTemp = (420 + this.throttle * 4.6 + (ab ? 120 : 0) + this.abHeat) * k;
      this.temps[i] += (tgtTemp - this.temps[i]) * clamp(dt / 4, 0, 1);
      return {
        rpm: (62 + this.throttle * 0.38) * k + Math.sin(t * 3 + i) * 0.3,
        temp: this.temps[i],
        thrust: this.throttle,
        burn: (ab ? 190 + (this.throttle - 85) * 6 : 9 + this.throttle * 0.75) * k, // kg/min
        ab,
      };
    });

    // combustível
    this.burn = this.eng[0].burn + this.eng[1].burn;
    this.fuel -= (this.burn / 60) * dt * this.fuelBurnX;
    if (this.fuel < 500) {
      this.fuel = FUEL_FULL;
      this.note('REABASTECIDO', 'info', 5, 'REABASTECIMENTO');
    }

    // trem e baias automáticas
    if (this.gearTimer > 0) {
      this.gearTimer -= dt;
      if (this.gearTimer <= 0) this.gear = this.gearTarget;
    }
    for (const k of Object.keys(this.bayAuto)) {
      if (this.bayAuto[k] > 0) {
        this.bayAuto[k] -= dt;
        if (this.bayAuto[k] <= 0) this.bays[k] = false;
      }
    }

    // contatos
    for (const c of this.contacts) {
      const { range, bearing } = this.geo(c);
      if (c.type === 'hostile' && range > 30) {
        const want = norm360(bearing + 180);
        c.hdg = norm360(c.hdg + clamp(norm180(want - c.hdg), -3 * dt, 3 * dt));
      } else {
        c.hdg = norm360(c.hdg + Math.sin(t / 9 + c.spd) * 4 * dt);
      }
      c.x += (Math.sin(c.hdg * D2R) * c.spd * dt) / 3600;
      c.y += (Math.cos(c.hdg * D2R) * c.spd * dt) / 3600;
    }
    this.contacts = this.contacts.filter((c) => {
      const keep = this.geo(c).range < 95;
      if (!keep) this.respawn.push({ type: c.type, at: t + 2 });
      return keep;
    });
    if (this.lockId && !this.contacts.some((c) => c.id === this.lockId)) this.unlock();
    this.respawn = this.respawn.filter((r) => {
      if (r.at > t) return true;
      this.spawn(r.type);
      return false;
    });

    if (t >= this.autoLockAt) {
      this.autoLockAt = Infinity;
      if (!this.lockId) this.lockNearest(true);
    }

    this.updateMissiles(dt);

    // ameaça: lançamento de míssil inimigo ocasional
    this.nextThreat -= dt;
    if (this.nextThreat <= 0) {
      this.nextThreat = rand(45, 90);
      const shooter = this.contacts.find((c) => c.type === 'hostile' && this.geo(c).range < 35);
      if (shooter && !this.enemyMissilesInFlight().length) this.launchEnemy(shooter);
    }

    this.temp = this.temp.filter((m) => m.until > t);
  }

  startManeuver() {
    this.maneuver = { start: this.t, dur: 8, side: Math.random() < 0.5 ? -1 : 1 };
  }

  // ---------------------------------------------------------------- mísseis
  // Cada míssil (próprio ou inimigo) é um objeto com posição, altitude, rumo e velocidade,
  // guiado por perseguição pura até o alvo. Após o desfecho fica alguns segundos na lista
  // (estado acertou/errou/despistado) para o painel mostrar o resultado.

  enemyMissilesInFlight() {
    return this.missiles.filter((m) => m.side === 'enemy' && m.status === 'voo');
  }

  launchEnemy(shooter) {
    const brg = this.geo(shooter).bearing;
    this.missiles.push({
      id: `E${this.enemySeq++}`,
      side: 'enemy',
      type: 'AAM',
      launcher: shooter.id,
      target: 'F-22',
      x: shooter.x,
      y: shooter.y,
      alt: shooter.alt,
      hdg: norm360(brg + 180),
      spd: 0.6, // NM/s ≈ Mach 3,3
      t0: this.t,
      maxTime: 60,
      status: 'voo',
      decoyAt: 0,
    });
  }

  updateMissiles(dt) {
    const t = this.t;
    for (const m of this.missiles) {
      if (m.status !== 'voo') {
        // após o desfecho segue em linha reta perdendo velocidade (só visual)
        m.spd *= 1 - 0.4 * dt;
        m.x += Math.sin(m.hdg * D2R) * m.spd * dt;
        m.y += Math.cos(m.hdg * D2R) * m.spd * dt;
        continue;
      }
      const own = m.side === 'own';
      const tgt = own ? this.contacts.find((c) => c.id === m.target) : { x: this.x, y: this.y, alt: this.alt };
      if (!tgt) {
        this.endMissile(m, 'errou', 'ALVO PERDIDO');
        continue;
      }
      if (!own && m.decoyAt && t >= m.decoyAt) {
        m.hdg = norm360(m.hdg + (Math.random() < 0.5 ? -70 : 70));
        this.endMissile(m, 'despistado', 'MÍSSIL DESPISTADO');
        continue;
      }
      const dx = tgt.x - m.x;
      const dy = tgt.y - m.y;
      const d = Math.hypot(dx, dy);
      const stepLen = m.spd * dt;
      m.hdg = norm360(Math.atan2(dx, dy) / D2R);
      m.alt += clamp(tgt.alt - m.alt, -900 * dt, 900 * dt);
      if (d <= stepLen) {
        m.x = tgt.x;
        m.y = tgt.y;
        if (own) {
          if (Math.random() < 0.85) {
            this.endMissile(m, 'acertou');
            this.splash(tgt);
          } else this.endMissile(m, 'errou', 'MÍSSIL ERROU');
        } else if (Math.random() < 0.5) {
          this.endMissile(m, 'acertou', 'CAÇA ATINGIDO', 'aviso', 'AERONAVE_ATINGIDA', 8);
          this.damage = true;
        } else {
          this.endMissile(m, 'errou', 'MÍSSIL PASSOU');
        }
        continue;
      }
      m.x += (dx / d) * stepLen;
      m.y += (dy / d) * stepLen;
      if (t - m.t0 > m.maxTime) this.endMissile(m, 'errou', 'MÍSSIL SEM ENERGIA');
    }
    this.missiles = this.missiles.filter((m) => m.status === 'voo' || t - m.endT < 6);
  }

  endMissile(m, status, msg, nivel = 'info', codigo = null, secs = 5) {
    m.status = status;
    m.endT = this.t;
    if (msg) this.note(`${msg} ${m.id}`, nivel, secs, codigo || `MISSIL_${status.toUpperCase()}`);
  }

  // ---------------------------------------------------------------- alvo e armas
  lock(id) {
    if (!this.lockId && this.radarMode !== 'STT') this.prevMode = this.radarMode;
    this.lockId = id;
    this.radarMode = 'STT';
  }

  unlock() {
    if (!this.lockId) return;
    this.lockId = null;
    this.radarMode = this.prevMode || 'TWS';
  }

  candidates() {
    const rng = RANGES[this.rangeIdx];
    return this.contacts
      .map((c) => ({ c, ...this.geo(c) }))
      .filter((o) => o.range <= rng)
      .sort((a, b) => ((a.c.type === 'hostile') === (b.c.type === 'hostile') ? a.range - b.range : a.c.type === 'hostile' ? -1 : 1));
  }

  lockNearest(silent = false) {
    const c = this.candidates()[0];
    if (c) this.lock(c.c.id);
    else if (!silent) this.note('SEM ALVO', 'cuidado', 2, 'SEM_ALVO');
  }

  splash(c) {
    this.contacts = this.contacts.filter((k) => k !== c);
    if (this.lockId === c.id) this.unlock();
    this.note(`ABATIDO ${c.id}`, 'info', 5, 'ALVO_ABATIDO');
    this.respawn.push({ type: c.type, at: this.t + 10 });
  }

  targeting() {
    const c = this.lockId && this.contacts.find((k) => k.id === this.lockId);
    if (!c) return null;
    const { range, bearing } = this.geo(c);
    const tas = this.tas();
    const ux = (c.x - this.x) / Math.max(range, 1e-6);
    const uy = (c.y - this.y) / Math.max(range, 1e-6);
    const rvx = Math.sin(c.hdg * D2R) * c.spd - Math.sin(this.hdg * D2R) * tas;
    const rvy = Math.cos(c.hdg * D2R) * c.spd - Math.cos(this.hdg * D2R) * tas;
    const w = WPN[this.selected];
    const inRange = range <= w.max && range >= w.min;
    const hasAmmo = this.selected === 'GUN' ? this.gun > 0 : this.stores.some((s) => s.type === this.selected && s.status === 'RDY');
    return {
      id: c.id,
      range,
      bearing,
      closure: -(rvx * ux + rvy * uy),
      aspect: norm180(norm360(bearing + 180) - c.hdg),
      inRange,
      shootCue: inRange && this.masterArm && hasAmmo,
    };
  }

  fire() {
    if (!this.masterArm) return this.note('MASTER ARM OFF', 'cuidado', 2, 'MASTER_ARM_OFF');
    const tgt = this.lockId && this.contacts.find((c) => c.id === this.lockId);
    if (this.selected === 'GUN') {
      if (this.gun <= 0) return this.note('CANHÃO VAZIO', 'cuidado', 2, 'SEM_MUNICAO');
      this.gun = Math.max(0, this.gun - 60);
      if (tgt && this.geo(tgt).range <= WPN.GUN.max && Math.random() < 0.5) this.splash(tgt);
      return;
    }
    const st = this.stores.find((s) => s.type === this.selected && s.status === 'RDY');
    if (!st) return this.note(`${this.selected} VAZIO`, 'cuidado', 2, 'SEM_MUNICAO');
    if (!tgt) return this.note('SEM ALVO', 'cuidado', 2, 'SEM_ALVO');
    const { range } = this.geo(tgt);
    const w = WPN[this.selected];
    if (range > w.max || range < w.min) return this.note('FORA DE ALCANCE', 'cuidado', 2, 'FORA_ALCANCE');

    st.status = 'EMPTY';
    const bay = st.station === 'SL' ? 'sideLeft' : st.station === 'SR' ? 'sideRight' : 'main';
    if (!this.bays[bay]) {
      this.bays[bay] = true;
      this.bayAuto[bay] = 3;
    }
    this.missiles.push({
      id: `M${this.mslSeq++}`,
      side: 'own',
      type: this.selected,
      launcher: 'F-22',
      target: tgt.id,
      x: this.x,
      y: this.y,
      alt: this.alt,
      hdg: this.geo(tgt).bearing,
      spd: w.speed,
      t0: this.t,
      maxTime: (w.max / w.speed) * 1.6,
      status: 'voo',
    });
    this.note(this.selected === 'AIM-120' ? 'FOX 3' : 'FOX 2', 'info', 3, 'DISPARO');
  }

  // ---------------------------------------------------------------- comandos (f22/comandos)
  /**
   * @param {{comando: string, valor?: any}} cmd
   * @returns {{ok: boolean, erro?: string}}
   */
  command(cmd) {
    const { comando, valor: v } = cmd || {};
    const alternar = v === undefined || v === null || v === 'alternar';
    switch (comando) {
      // --- comandos da proposta
      case 'rajada': {
        const kt = clamp(+(v?.intensidade ?? 40) || 40, 5, 120);
        const dur = clamp(+(v?.duracao ?? 10) || 10, 1, 120);
        this.gust = { until: this.t + dur, kt, turb: clamp(kt / 100, 0.15, 0.9) };
        this.computeEnv();
        this.note('RAJADA DE VENTO', 'cuidado', Math.min(dur, 6), 'RAJADA');
        break;
      }
      case 'novoAlvo': {
        const type = TIPOS_INV[v?.tipo] || 'hostile';
        const brg = Number.isFinite(+v?.marcacao) && v?.marcacao !== '' ? norm360(+v.marcacao) : null;
        const rng = Number.isFinite(+v?.distancia) && v?.distancia !== '' ? clamp(+v.distancia, 2, 90) : rand(20, 50);
        const c = this.spawn(type, { bearing: brg, range: rng });
        this.note(`NOVO ALVO ${c.id}`, type === 'hostile' ? 'cuidado' : 'info', 4, 'NOVO_ALVO');
        break;
      }
      case 'pausa':
        this.paused = true;
        break;
      case 'retomar':
        this.paused = false;
        break;
      case 'reiniciar':
        this.reset();
        break;
      case 'ameaca': {
        // força um lançamento inimigo: usa o hostil mais próximo ou cria um a 25 NM
        let shooter = this.contacts
          .filter((c) => c.type === 'hostile')
          .sort((a, b) => this.geo(a).range - this.geo(b).range)[0];
        if (!shooter || this.geo(shooter).range > 45) shooter = this.spawn('hostile', { range: 25 });
        this.launchEnemy(shooter);
        break;
      }
      case 'manobra':
        if (!this.maneuver) this.startManeuver();
        break;

      // --- comandos do cockpit
      case 'manete':
        this.throttle = clamp(+v || 0, 0, 100);
        this.manualThrottle = true;
        break;
      case 'masterArm':
        this.masterArm = alternar ? !this.masterArm : !!v;
        break;
      case 'selecionarArma':
        this.selected = WPN[v] ? v : WPN_ORDER[(WPN_ORDER.indexOf(this.selected) + 1) % WPN_ORDER.length];
        break;
      case 'baia': {
        const k = { principal: 'main', lateralEsquerda: 'sideLeft', lateralDireita: 'sideRight' }[v];
        if (!k) return { ok: false, erro: 'baia inválida' };
        this.bays[k] = !this.bays[k];
        this.bayAuto[k] = 0;
        break;
      }
      case 'modoRadar':
        if (this.lockId) this.note('DESTRAVE O ALVO', 'cuidado', 2, 'RADAR_STT');
        else if (['RWS', 'TWS'].includes(v)) this.radarMode = v;
        else this.radarMode = this.radarMode === 'RWS' ? 'TWS' : 'RWS';
        break;
      case 'alcanceRadar':
        if (v === 'aumentar') this.rangeIdx = Math.min(RANGES.length - 1, this.rangeIdx + 1);
        else if (v === 'diminuir') this.rangeIdx = Math.max(0, this.rangeIdx - 1);
        else if (RANGES.includes(+v)) this.rangeIdx = RANGES.indexOf(+v);
        break;
      case 'travarAlvo':
        if (v === 'desligar') this.unlock();
        else if (v === 'maisProximo') this.lockNearest();
        else if (v === 'proximo') {
          const list = this.candidates();
          if (!list.length) this.note('SEM ALVO', 'cuidado', 2, 'SEM_ALVO');
          else {
            const i = list.findIndex((o) => o.c.id === this.lockId);
            this.lock(list[(i + 1) % list.length].c.id);
          }
        } else if (alternar) {
          if (this.lockId) this.unlock();
          else this.lockNearest();
        } else if (this.contacts.some((c) => c.id === v)) this.lock(v);
        break;
      case 'disparar':
        this.fire();
        break;
      case 'contramedida': {
        const k = v === 'chaff' ? 'chaff' : 'flares';
        if (this[k] <= 0) {
          this.note(`${k === 'chaff' ? 'CHAFF' : 'FLARE'} VAZIO`, 'cuidado', 2, 'SEM_CONTRAMEDIDA');
          break;
        }
        this[k] = Math.max(0, this[k] - 2);
        // cada míssil inimigo em voo tem 85% de chance de ser despistado em 1,5 s
        for (const m of this.enemyMissilesInFlight()) {
          if (!m.decoyAt && Math.random() < 0.85) m.decoyAt = this.t + 1.5;
        }
        break;
      }
      case 'trem': {
        const cur = this.gear === 'TRANSIT' ? this.gearTarget : this.gear;
        const want = v === 'baixado' ? 'DOWN' : v === 'recolhido' ? 'UP' : cur === 'DOWN' ? 'UP' : 'DOWN';
        if (want !== cur) {
          this.gearTarget = want;
          this.gear = 'TRANSIT';
          this.gearTimer = 5;
        }
        break;
      }
      case 'flaps': {
        const seq = ['UP', 'TO', 'LDG'];
        const map = { recolhido: 'UP', decolagem: 'TO', pouso: 'LDG' };
        this.flaps = map[v] || seq[(seq.indexOf(this.flaps) + 1) % seq.length];
        break;
      }
      case 'freioAerodinamico':
        this.speedBrake = alternar ? !this.speedBrake : !!v;
        break;
      case 'apu':
        this.apu = alternar ? !this.apu : !!v;
        break;
      case 'waypoint':
        if (v === 'proximo') this.wptIdx = (this.wptIdx + 1) % WAYPOINTS.length;
        else if (v === 'anterior') this.wptIdx = (this.wptIdx - 1 + WAYPOINTS.length) % WAYPOINTS.length;
        else if (Number.isInteger(+v) && +v >= 1 && +v <= WAYPOINTS.length) this.wptIdx = +v - 1;
        break;
      case 'icp':
        this.icp(v || {});
        break;
      default:
        return { ok: false, erro: `comando desconhecido: ${comando}` };
    }
    return { ok: true };
  }

  icp({ campo, valor }) {
    const d = String(valor || '');
    const err = () => this.note('ICP ENTRADA INVÁLIDA', 'cuidado', 2, 'ICP_ERRO');
    if (campo === 'com1' || campo === 'com2') {
      const f = d.length === 5 ? `${d.slice(0, 3)}.${d.slice(3)}` : null;
      if (f && +f >= 118 && +f <= 399.975) this[campo] = f;
      else err();
    } else if (campo === 'iff') {
      if (/^[0-7]{4}$/.test(d)) this.iff = d;
      else err();
    } else if (campo === 'stpt') {
      const n = +d;
      if (n >= 1 && n <= WAYPOINTS.length) this.wptIdx = n - 1;
      else err();
    } else if (campo === 'marca') {
      this.note('PONTO MARCADO', 'info', 3, 'MARCA');
    }
  }

  // ---------------------------------------------------------------- alertas do motor
  alerts(tg) {
    const list = [];
    const add = (nivel, codigo, mensagem) => list.push({ nivel, codigo, mensagem });
    if (this.paused) add('info', 'PAUSADO', 'SIMULAÇÃO PAUSADA');
    if (this.enemyMissilesInFlight().length) add('aviso', 'AMEACA_MISSIL', 'LANÇAMENTO MÍSSIL');
    if (this.damage) add('cuidado', 'HIDRAULICA_A', 'FALHA HIDRÁULICA A');
    if (this.g > G_LIMIT) add('aviso', 'EXCESSO_G', 'EXCESSO DE G');
    if (this.fuel < FUEL_LOW) add('aviso', 'COMBUSTIVEL_BAIXO', 'COMBUSTÍVEL BAIXO');
    else if (this.fuel < FUEL_BINGO) add('cuidado', 'COMBUSTIVEL_BINGO', 'BINGO');
    ['E', 'D'].forEach((lado, i) => {
      if (this.temps[i] > ENGINE_TEMP_MAX) add('aviso', `SUPERAQUECIMENTO_${lado}`, `SUPERAQUEC. MOTOR ${lado}`);
    });
    if (this.alt < 1500 && this.vvi < -3000) add('aviso', 'PULL_UP', 'PULL UP');
    if (this.turbulence > 0.6) add('cuidado', 'TURBULENCIA', 'TURBULÊNCIA SEVERA');
    if (this.gear !== 'UP' && this.ias > 280) add('cuidado', 'TREM_VELOCIDADE', 'TREM C/ VELOC.');
    if (this.flaps !== 'UP' && this.ias > 350) add('cuidado', 'FLAPS_VELOCIDADE', 'FLAPS C/ VELOC.');
    if (tg) add('info', 'MIRA_TRAVADA', `MIRA TRAVADA ${tg.id}`);
    if (this.gear === 'TRANSIT') add('info', 'TREM_TRANSITO', 'TREM EM TRÂNSITO');
    if (this.masterArm) add('info', 'MASTER_ARM', 'MASTER ARM');
    if (Object.values(this.bays).some(Boolean)) add('info', 'BAIA_ABERTA', 'BAIA ABERTA');
    if (this.throttle > 85) add('info', 'POS_COMBUSTAO', 'PÓS-COMBUSTÃO');
    if (this.speedBrake) add('info', 'FREIO_AERO', 'FREIO AERODINÂMICO');
    if (this.apu) add('info', 'APU', 'APU LIGADA');
    for (const m of this.temp) add(m.nivel, m.codigo, m.msg);
    return list;
  }

  // ---------------------------------------------------------------- leituras por subsistema
  readings() {
    const tas = this.tas();
    const T = Math.max(216.65, 288.15 - 0.0019812 * this.alt);
    const sound = 661.47 * Math.sqrt(T / 288.15);
    const wp = WAYPOINTS[this.wptIdx];
    const wDist = Math.hypot(wp.x - this.x, wp.y - this.y);
    const toLatLon = (x, y) => this.toLatLon(x, y);
    const [lat, lon] = toLatLon(this.x, this.y);
    const tg = this.targeting();
    const eng = this.eng || [{ rpm: 0, temp: this.temps[0], thrust: 0, burn: 0, ab: false }, { rpm: 0, temp: this.temps[1], thrust: 0, burn: 0, ab: false }];
    const burn = this.burn || 0;
    const n = (k) => Math.sin(this.t * 0.7 + k);
    const motor = (e) => ({
      empuxo: u(e.thrust, '%', 0),
      temperatura: u(e.temp, '°C', 0),
      rpm: u(e.rpm, '%', 1),
      consumo: u(e.burn, 'kg/min', 1),
      posCombustao: e.ab,
    });
    const gear = { UP: 'recolhido', DOWN: 'baixado', TRANSIT: 'transito' }[this.gear];
    const flaps = { UP: 'recolhido', TO: 'decolagem', LDG: 'pouso' }[this.flaps];
    const turbN = this.turbNoise || 0;

    return {
      nav: {
        altitude: u(this.alt, 'ft', 0),
        velocidade: u(this.ias + turbN * 6, 'kt', 0),
        mach: u(tas / sound, 'Mach', 2),
        rumo: u(this.hdg, '°', 1),
        razaoSubida: u(this.vvi, 'ft/min', 0),
        latitude: u(lat, '°', 5),
        longitude: u(lon, '°', 5),
        velocidadeSolo: u(this.groundSpeed ?? tas, 'kt', 0),
        trajetoria: u(this.track ?? this.hdg, '°', 1),
        waypoint: {
          nome: wp.nome,
          indice: this.wptIdx,
          marcacao: u(norm360(Math.atan2(wp.x - this.x, wp.y - this.y) / D2R), '°', 1),
          distancia: u(wDist, 'NM', 1),
          ete: u((wDist / Math.max(this.groundSpeed || tas, 1)) * 3600, 's', 0),
        },
        rota: WAYPOINTS.map((w) => {
          const [la, lo] = toLatLon(w.x, w.y);
          return { nome: w.nome, lat: round(la, 5), lon: round(lo, 5) };
        }),
      },
      atitude: {
        arfagem: u(this.pitch + turbN * 2.5, '°', 1),
        rolagem: u(this.roll + turbN * 6, '°', 1),
        guinada: u(this.hdg, '°', 1),
        forcaG: u(this.g, 'G', 2),
        forcaGMax: u(this.gmax, 'G', 2),
        anguloAtaque: u(clamp(1.5 + this.g * 1.4 * (500 / Math.max(this.ias, 150)), 0, 28), '°', 1),
      },
      ambiente: {
        ventoVelocidade: u(this.windSpeed, 'kt', 0),
        ventoDirecao: u(this.windDir, '°', 0),
        temperaturaExterna: u(this.oat, '°C', 1),
        turbulencia: u(this.turbulence, '0-1', 2),
        rajadaAtiva: !!this.gust,
      },
      motores: {
        manete: u(this.throttle, '%', 0),
        esquerdo: motor(eng[0]),
        direito: motor(eng[1]),
      },
      combustivel: {
        quantidade: u(this.fuel, 'kg', 0),
        consumo: u(burn, 'kg/min', 1),
        bingo: u(FUEL_BINGO, 'kg', 0),
        autonomia: u(burn > 0 ? this.fuel / (burn * this.fuelBurnX) : 0, 'min', 1),
      },
      radar: {
        modo: this.radarMode,
        alcance: u(RANGES[this.rangeIdx], 'NM', 0),
        estadoMira: tg ? 'travado' : 'buscando',
        alvos: this.contacts.map((c) => {
          const g = this.geo(c);
          return {
            id: c.id,
            tipo: TIPOS[c.type],
            marcacao: round(g.bearing, 1),
            distancia: round(g.range, 2),
            altitude: round(c.alt, 0),
            rumo: round(c.hdg, 1),
            velocidade: round(c.spd, 0),
            codigo: c.code,
          };
        }),
        alvoTravado: tg && {
          id: tg.id,
          distancia: u(tg.range, 'NM', 2),
          marcacao: u(tg.bearing, '°', 1),
          aproximacao: u(tg.closure, 'kt', 0),
          aspecto: u(tg.aspect, '°', 0),
          emAlcance: tg.inRange,
          podeDisparar: tg.shootCue,
        },
        ameaca: (() => {
          const near = this.enemyMissilesInFlight().map((m) => this.geo(m)).sort((a, b) => a.range - b.range)[0];
          return { lancamento: !!near, marcacao: u(near ? near.bearing : 0, '°', 0) };
        })(),
      },
      alertas: { lista: this.alerts(tg) },
      armamento: {
        masterArm: this.masterArm,
        armaSelecionada: this.selected,
        baias: { principal: this.bays.main, lateralEsquerda: this.bays.sideLeft, lateralDireita: this.bays.sideRight },
        estacoes: this.stores.map((s) => ({ estacao: s.station, tipo: s.type, estado: s.status === 'RDY' ? 'pronto' : 'vazio' })),
        canhao: u(this.gun, 'tiros', 0),
        flares: u(this.flares, 'un', 0),
        chaff: u(this.chaff, 'un', 0),
      },
      sistemas: {
        trem: gear,
        flaps,
        freioAerodinamico: this.speedBrake,
        hidraulicaA: u(this.damage ? 1650 + n(1) * 60 : 4000 + n(1) * 25, 'psi', 0),
        hidraulicaB: u(3990 + n(2) * 25, 'psi', 0),
        tensaoEletrica: u(270 + n(3) * 1.5, 'V', 1),
        apu: this.apu,
        oxigenio: u(94 + n(4), '%', 0),
      },
      comunicacao: { com1: this.com1, com2: this.com2, iff: this.iff },
      misseis: this.missileReadings(),
    };
  }

  toLatLon(x, y) {
    const lat = BASE.lat + y / 60;
    return [lat, BASE.lon + x / (60 * Math.cos(lat * D2R))];
  }

  /** f22/misseis — o runner publica com mais frequência enquanto houver míssil no ar. */
  missileReadings() {
    const ESTADO = { voo: 'em voo', acertou: 'acertou', errou: 'errou', despistado: 'despistado' };
    return {
      emVoo: this.missiles.filter((m) => m.status === 'voo').length,
      lista: this.missiles.map((m) => {
        const g = this.geo(m);
        const [lat, lon] = this.toLatLon(m.x, m.y);
        const tgt = m.side === 'own' ? this.contacts.find((c) => c.id === m.target) : { x: this.x, y: this.y };
        const dAlvo = tgt ? Math.hypot(tgt.x - m.x, tgt.y - m.y) : 0;
        const flying = m.status === 'voo';
        return {
          id: m.id,
          lado: m.side === 'own' ? 'proprio' : 'inimigo',
          tipo: m.type,
          estado: ESTADO[m.status],
          lancadoPor: m.launcher,
          alvo: m.target,
          latitude: round(lat, 5),
          longitude: round(lon, 5),
          altitude: round(m.alt, 0),
          rumo: round(m.hdg, 1),
          velocidade: round(m.spd * 3600, 0),
          marcacao: round(g.bearing, 1),
          distancia: round(g.range, 2),
          distanciaAlvo: flying ? round(dAlvo, 2) : 0,
          tempoImpacto: flying ? round(dAlvo / m.spd, 1) : 0,
          tempoVoo: round((flying ? this.t : m.endT) - m.t0, 1),
        };
      }),
    };
  }
}
