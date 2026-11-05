// Contrato MQTT do RaptorLink: tópicos, QoS/retenção, envelope e tradução
// das mensagens (português, { valor, unidade }) para o estado interno do painel.

export const DEFAULT_ROOT = 'f22';

/** Versão do contrato. O motor anuncia em f22/status; o painel avisa se for diferente. */
export const PROTOCOL_VERSION = '2';

/** Subtópicos, QoS e retenção. Telemetria contínua usa QoS 0; dados de estado e eventos, QoS 1. */
export const TOPICS = {
  nav: { qos: 0, retain: false, desc: 'Navegação' },
  atitude: { qos: 0, retain: false, desc: 'Atitude' },
  ambiente: { qos: 0, retain: false, desc: 'Ambiente' },
  motores: { qos: 0, retain: false, desc: 'Motores' },
  combustivel: { qos: 1, retain: true, desc: 'Combustível' },
  radar: { qos: 1, retain: false, desc: 'Radar e mira' },
  alertas: { qos: 1, retain: true, desc: 'Alertas' },
  misseis: { qos: 0, retain: false, desc: 'Rastreamento de mísseis' },
  armamento: { qos: 1, retain: false, desc: 'Armamento' },
  sistemas: { qos: 1, retain: false, desc: 'Sistemas' },
  comunicacao: { qos: 1, retain: false, desc: 'Comunicação' },
  status: { qos: 1, retain: true, desc: 'Status do motor' },
  comandos: { qos: 1, retain: false, desc: 'Comandos' },
};

export function envelope(dados, { seq = 0, origem = 'motor' } = {}) {
  return { ts: new Date().toISOString(), seq, origem, dados };
}

export function makeCommand(comando, valor, origem = 'painel') {
  const cmd = { comando, origem, ts: new Date().toISOString() };
  if (valor !== undefined) cmd.valor = valor;
  return cmd;
}

// ------------------------------------------------------------------ comandos do cockpit → protocolo
const CMD_NAMES = {
  throttle: 'manete',
  masterArm: 'masterArm',
  weaponSelect: 'selecionarArma',
  bay: 'baia',
  radarMode: 'modoRadar',
  radarRange: 'alcanceRadar',
  targetLock: 'travarAlvo',
  pickle: 'disparar',
  countermeasure: 'contramedida',
  gear: 'trem',
  flaps: 'flaps',
  speedBrake: 'freioAerodinamico',
  apu: 'apu',
  waypoint: 'waypoint',
  icp: 'icp',
};
const CMD_VALUES = {
  toggle: 'alternar',
  next: 'proximo',
  prev: 'anterior',
  nearest: 'maisProximo',
  off: 'desligar',
  up: 'aumentar',
  down: 'diminuir',
  main: 'principal',
  sideLeft: 'lateralEsquerda',
  sideRight: 'lateralDireita',
};

/** Converte uma ação interna do cockpit em comando do protocolo (ou null se for só local). */
export function cockpitCommand(action, value) {
  const comando = CMD_NAMES[action];
  if (!comando) return null;
  let valor = typeof value === 'string' && CMD_VALUES[value] ? CMD_VALUES[value] : value;
  if (action === 'icp' && value && typeof value === 'object') valor = { campo: value.field, valor: value.value };
  if (action === 'pickle') valor = undefined;
  return makeCommand(comando, valor, 'cockpit');
}

// ------------------------------------------------------------------ decodificação
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isReading = (v) => isObj(v) && 'valor' in v && Object.keys(v).every((k) => k === 'valor' || k === 'unidade');
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Desembrulha { valor, unidade } recursivamente.
 * Retorna o valor "plano" e registra as unidades em `units` (chave = caminho com pontos).
 */
export function unwrap(v, units = {}, path = '') {
  if (isReading(v)) {
    if (v.unidade) units[path] = v.unidade;
    return v.valor;
  }
  if (Array.isArray(v)) return v.map((x) => unwrap(x, {}, ''));
  if (isObj(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN.has(k)) continue;
      out[k] = unwrap(x, units, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return v;
}

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const TYPE = { hostil: 'hostile', amigo: 'friendly', desconhecido: 'unknown' };
const LEVEL = { aviso: 'warning', cuidado: 'caution', info: 'advisory' };
const GEAR = { recolhido: 'UP', baixado: 'DOWN', transito: 'TRANSIT' };
const FLAPS = { recolhido: 'UP', decolagem: 'TO', pouso: 'LDG' };

const DECODERS = {
  nav(p, s) {
    Object.assign(s.flight, {
      altitude: num(p.altitude, s.flight.altitude),
      airspeed: num(p.velocidade, s.flight.airspeed),
      mach: num(p.mach, s.flight.mach),
      heading: num(p.rumo, s.flight.heading),
      vvi: num(p.razaoSubida, s.flight.vvi),
    });
    Object.assign(s.nav, {
      lat: num(p.latitude, s.nav.lat),
      lon: num(p.longitude, s.nav.lon),
      groundSpeed: num(p.velocidadeSolo, s.nav.groundSpeed),
      track: num(p.trajetoria, s.nav.track),
    });
    if (isObj(p.waypoint)) {
      const w = p.waypoint;
      Object.assign(s.nav, {
        waypoint: `STPT ${num(w.indice) + 1} ${w.nome ?? ''}`.trim(),
        wptName: String(w.nome ?? ''),
        wptIndex: num(w.indice),
        wptBearing: num(w.marcacao),
        wptDistance: num(w.distancia),
        ete: num(w.ete),
      });
    }
    if (Array.isArray(p.rota)) s.nav.route = p.rota.filter(isObj).map((r) => ({ name: String(r.nome ?? ''), lat: num(r.lat), lon: num(r.lon) }));
  },
  atitude(p, s) {
    Object.assign(s.flight, {
      pitch: num(p.arfagem, s.flight.pitch),
      roll: num(p.rolagem, s.flight.roll),
      yaw: num(p.guinada, s.flight.yaw),
      gload: num(p.forcaG, s.flight.gload),
      gmax: num(p.forcaGMax, s.flight.gmax),
      aoa: num(p.anguloAtaque, s.flight.aoa),
    });
  },
  ambiente(p, s) {
    Object.assign(s.env, {
      windSpeed: num(p.ventoVelocidade, s.env.windSpeed),
      windDir: num(p.ventoDirecao, s.env.windDir),
      oat: num(p.temperaturaExterna, s.env.oat),
      turbulence: num(p.turbulencia, s.env.turbulence),
      gust: !!p.rajadaAtiva,
    });
  },
  motores(p, s) {
    s.engine.throttle = num(p.manete, s.engine.throttle);
    for (const [src, dst] of [['esquerdo', 'left'], ['direito', 'right']]) {
      const e = p[src];
      if (!isObj(e)) continue;
      Object.assign(s.engine[dst], {
        thrust: num(e.empuxo),
        egt: num(e.temperatura),
        rpm: num(e.rpm),
        fuelFlow: num(e.consumo),
        afterburner: !!e.posCombustao,
      });
    }
  },
  combustivel(p, s) {
    Object.assign(s.fuel, {
      total: num(p.quantidade, s.fuel.total),
      consumption: num(p.consumo, s.fuel.consumption),
      bingo: num(p.bingo, s.fuel.bingo),
      endurance: num(p.autonomia, s.fuel.endurance),
    });
  },
  radar(p, s) {
    if (p.modo) s.radar.mode = String(p.modo);
    s.radar.range = num(p.alcance, s.radar.range);
    s.radar.lockState = String(p.estadoMira ?? s.radar.lockState);
    if (Array.isArray(p.alvos)) {
      s.radar.contacts = p.alvos.filter(isObj).map((a) => ({
        id: String(a.id),
        type: TYPE[a.tipo] || 'unknown',
        bearing: num(a.marcacao),
        range: num(a.distancia),
        alt: num(a.altitude),
        heading: num(a.rumo),
        speed: num(a.velocidade),
        code: a.codigo != null ? String(a.codigo) : undefined,
      }));
    }
    if ('alvoTravado' in p) {
      const t = p.alvoTravado;
      s.targeting = isObj(t)
        ? {
          locked: true,
          targetId: String(t.id),
          range: num(t.distancia),
          bearing: num(t.marcacao),
          closure: num(t.aproximacao),
          aspect: num(t.aspecto),
          inRange: !!t.emAlcance,
          shootCue: !!t.podeDisparar,
        }
        : { locked: false, targetId: null, range: 0, bearing: 0, closure: 0, aspect: 0, inRange: false, shootCue: false };
    }
    if (isObj(p.ameaca)) s.threats = { missileLaunch: !!p.ameaca.lancamento, bearing: num(p.ameaca.marcacao) };
  },
  alertas(p, s) {
    const list = Array.isArray(p.lista) ? p.lista : [];
    s.engineAlerts = list.filter(isObj).map((a) => ({
      level: LEVEL[a.nivel] || 'advisory',
      code: String(a.codigo ?? a.mensagem ?? ''),
      msg: String(a.mensagem ?? a.codigo ?? ''),
    }));
  },
  armamento(p, s) {
    const w = s.weapons;
    if ('masterArm' in p) w.masterArm = !!p.masterArm;
    if (p.armaSelecionada) w.selected = String(p.armaSelecionada);
    if (isObj(p.baias)) w.bays = { main: !!p.baias.principal, sideLeft: !!p.baias.lateralEsquerda, sideRight: !!p.baias.lateralDireita };
    if (Array.isArray(p.estacoes)) {
      w.stores = p.estacoes.filter(isObj).map((e) => ({ station: String(e.estacao), type: String(e.tipo), status: e.estado === 'pronto' ? 'RDY' : 'EMPTY' }));
    }
    w.gun = num(p.canhao, w.gun);
    w.flares = num(p.flares, w.flares);
    w.chaff = num(p.chaff, w.chaff);
  },
  misseis(p, s) {
    const STATUS = { 'em voo': 'flight', acertou: 'hit', errou: 'miss', despistado: 'decoyed' };
    s.missiles = (Array.isArray(p.lista) ? p.lista : []).filter(isObj).map((m) => ({
      id: String(m.id),
      side: m.lado === 'inimigo' ? 'enemy' : 'own',
      type: String(m.tipo ?? ''),
      status: STATUS[m.estado] || 'flight',
      launcher: String(m.lancadoPor ?? ''),
      target: String(m.alvo ?? ''),
      lat: num(m.latitude),
      lon: num(m.longitude),
      alt: num(m.altitude),
      heading: num(m.rumo),
      speed: num(m.velocidade),
      bearing: num(m.marcacao),
      range: num(m.distancia),
      targetRange: num(m.distanciaAlvo),
      tof: num(m.tempoImpacto),
      flightTime: num(m.tempoVoo),
    }));
  },
  sistemas(p, s) {
    Object.assign(s.systems, {
      gear: GEAR[p.trem] || s.systems.gear,
      flaps: FLAPS[p.flaps] || s.systems.flaps,
      speedBrake: !!p.freioAerodinamico,
      hydA: num(p.hidraulicaA, s.systems.hydA),
      hydB: num(p.hidraulicaB, s.systems.hydB),
      elecVolts: num(p.tensaoEletrica, s.systems.elecVolts),
      apu: !!p.apu,
      oxygen: num(p.oxigenio, s.systems.oxygen),
    });
  },
  comunicacao(p, s) {
    Object.assign(s.comm, {
      com1: String(p.com1 ?? s.comm.com1),
      com2: String(p.com2 ?? s.comm.com2),
      iff: String(p.iff ?? s.comm.iff),
    });
  },
  status(p, s) {
    s.engineStatus = {
      online: !!p.online,
      paused: !!p.pausado,
      id: String(p.id ?? ''),
      intervalMs: num(p.intervaloMs),
      version: p.versao != null ? String(p.versao) : null,
    };
  },
};

/**
 * Aplica uma mensagem já parseada (envelope) ao estado interno.
 * @returns {{ plain: object, units: object } | null}
 */
export function decode(sub, msg, state) {
  const fn = DECODERS[sub];
  if (!fn || !isObj(msg)) return null;
  const units = {};
  const raw = isObj(msg.dados) ? msg.dados : msg;
  const plain = unwrap(raw, units);
  fn(plain, state);
  return { plain, units };
}
