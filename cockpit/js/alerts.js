// Alertas do painel: verifica limites sobre a telemetria recebida e mescla
// com os alertas publicados pelo motor em f22/alertas (deduplicados por código).

export const LIMITS = {
  gCaution: 7.5,
  gWarning: 9,
  fuelLowKg: 900,
  engineTempCaution: 950,
  engineTempWarning: 1000,
};

const RANK = { warning: 0, caution: 1, advisory: 2 };

/** Alertas calculados pelo painel a partir dos valores atuais. */
export function limitAlerts(s, { mqtt = false, stale = false } = {}) {
  const out = [];
  const add = (level, code, msg) => out.push({ level, code, msg, source: 'painel' });
  const g = s.flight.gload || 0;
  if (g > LIMITS.gWarning) add('warning', 'EXCESSO_G', 'EXCESSO DE G');
  else if (g > LIMITS.gCaution) add('caution', 'G_ALTO', 'G ALTO');

  const fuel = s.fuel.total;
  if (fuel > 0 && fuel < LIMITS.fuelLowKg) add('warning', 'COMBUSTIVEL_BAIXO', 'COMBUSTÍVEL BAIXO');
  else if (fuel > 0 && fuel < s.fuel.bingo) add('caution', 'COMBUSTIVEL_BINGO', 'BINGO');

  [['left', 'E'], ['right', 'D']].forEach(([k, lado]) => {
    const t = s.engine[k]?.egt || 0;
    if (t > LIMITS.engineTempWarning) add('warning', `SUPERAQUECIMENTO_${lado}`, `SUPERAQUEC. MOTOR ${lado}`);
    else if (t > LIMITS.engineTempCaution) add('caution', `TEMP_ALTA_${lado}`, `TEMP. ALTA MOTOR ${lado}`);
  });

  if (s.threats?.missileLaunch) add('warning', 'AMEACA_MISSIL', 'LANÇAMENTO MÍSSIL');
  if (s.targeting?.locked) add('advisory', 'MIRA_TRAVADA', `MIRA TRAVADA ${s.targeting.targetId}`);

  if (mqtt && s.engineStatus.known && !s.engineStatus.online) add('caution', 'MOTOR_OFFLINE', 'MOTOR OFFLINE');
  if (stale) add('caution', 'SEM_TELEMETRIA', 'SEM TELEMETRIA');
  return out;
}

/** Une alertas do motor e do painel; mesmo código → fica o de maior severidade. */
export function mergeAlerts(engine, panel) {
  const byCode = new Map();
  for (const a of [...engine, ...panel]) {
    const prev = byCode.get(a.code);
    if (!prev || RANK[a.level] < RANK[prev.level]) byCode.set(a.code, a);
  }
  return [...byCode.values()].sort((a, b) => RANK[a.level] - RANK[b.level]);
}
