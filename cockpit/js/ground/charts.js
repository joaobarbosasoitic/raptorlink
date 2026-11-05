// Gráficos de série temporal (Chart.js) alimentados diretamente pelas mensagens de cada tópico.
const WINDOW = 120; // pontos (~2 min a 1 Hz)
const COL = { green: '#3cff7c', cyan: '#35e3ff', amber: '#ffab2e', magenta: '#ff63e8', red: '#ff4747', yellow: '#ffd43b' };

const DEFS = [
  {
    id: 'chNav', topic: 'nav',
    y: 'ft', y1: 'kt',
    series: [
      { label: 'Altitude (ft)', get: (p) => p.altitude, color: COL.green },
      { label: 'Velocidade (kt)', get: (p) => p.velocidade, color: COL.cyan, axis: 'y1' },
    ],
  },
  {
    id: 'chAtt', topic: 'atitude',
    y: 'graus', y1: 'G',
    series: [
      { label: 'Arfagem (°)', get: (p) => p.arfagem, color: COL.green },
      { label: 'Rolagem (°)', get: (p) => p.rolagem, color: COL.cyan },
      { label: 'Força G', get: (p) => p.forcaG, color: COL.amber, axis: 'y1' },
    ],
    limits: [{ label: 'Limite G', value: 9, axis: 'y1' }],
  },
  {
    id: 'chEng', topic: 'motores',
    y: '°C', y1: '%',
    series: [
      { label: 'Temp. motor E (°C)', get: (p) => p.esquerdo?.temperatura, color: COL.amber },
      { label: 'Temp. motor D (°C)', get: (p) => p.direito?.temperatura, color: COL.magenta },
      { label: 'Manete (%)', get: (p) => p.manete, color: COL.cyan, axis: 'y1' },
    ],
    limits: [{ label: 'Superaquecimento', value: 1000 }],
  },
  {
    id: 'chFuel', topic: 'combustivel',
    y: 'kg', y1: 'kg/min',
    series: [
      { label: 'Quantidade (kg)', get: (p) => p.quantidade, color: COL.green },
      { label: 'Consumo (kg/min)', get: (p) => p.consumo, color: COL.amber, axis: 'y1' },
    ],
    limits: [{ label: 'Bingo', get: (p) => p.bingo }],
  },
  {
    id: 'chEnv', topic: 'ambiente',
    y: 'kt', y1: '°C',
    series: [
      { label: 'Vento (kt)', get: (p) => p.ventoVelocidade, color: COL.cyan },
      { label: 'Turbulência (×100)', get: (p) => (p.turbulencia ?? 0) * 100, color: COL.yellow },
      { label: 'Temp. externa (°C)', get: (p) => p.temperaturaExterna, color: COL.magenta, axis: 'y1' },
    ],
  },
];

const timeLabel = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour12: false });

export function createCharts() {
  const Chart = window.Chart;
  const charts = [];
  if (!Chart) {
    for (const d of DEFS) {
      const c = document.getElementById(d.id);
      if (c) c.replaceWith(Object.assign(document.createElement('p'), { className: 'gs-empty', textContent: 'Chart.js não carregou.' }));
    }
    return { push() {}, flush() {}, reset() {} };
  }

  Chart.defaults.color = '#8a96a3';
  Chart.defaults.font.family = '"B612", system-ui, sans-serif';
  Chart.defaults.font.size = 10;
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

  for (const d of DEFS) {
    const canvas = document.getElementById(d.id);
    if (!canvas) continue;
    const hasY1 = d.series.some((s) => s.axis === 'y1');
    const datasets = d.series.map((s) => ({
      label: s.label,
      data: [],
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 1.6,
      pointRadius: 0,
      tension: 0.25,
      yAxisID: s.axis || 'y',
    }));
    for (const l of d.limits || []) {
      datasets.push({
        label: l.label,
        data: [],
        borderColor: COL.red,
        backgroundColor: COL.red,
        borderWidth: 1,
        borderDash: [5, 4],
        pointRadius: 0,
        yAxisID: l.axis || 'y',
      });
    }
    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels: [], datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 10, boxHeight: 2, padding: 8 } },
          tooltip: { backgroundColor: 'rgba(5,8,10,0.92)', borderColor: '#2a3139', borderWidth: 1 },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } },
          y: { title: { display: true, text: d.y } },
          ...(hasY1 ? { y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: d.y1 } } } : {}),
        },
      },
    });
    charts.push({ def: d, chart, dirty: false });
  }

  return {
    /** Adiciona um ponto a partir dos dados "planos" de um tópico. */
    push(topic, plain, time) {
      for (const c of charts) {
        if (c.def.topic !== topic) continue;
        const { labels, datasets } = c.chart.data;
        labels.push(timeLabel(time));
        c.def.series.forEach((s, i) => {
          const v = Number(s.get(plain));
          datasets[i].data.push(Number.isFinite(v) ? v : null);
        });
        (c.def.limits || []).forEach((l, i) => {
          const v = l.get ? Number(l.get(plain)) : l.value;
          datasets[c.def.series.length + i].data.push(Number.isFinite(v) ? v : null);
        });
        if (labels.length > WINDOW) {
          labels.splice(0, labels.length - WINDOW);
          for (const ds of datasets) ds.data.splice(0, ds.data.length - WINDOW);
        }
        c.dirty = true;
      }
    },
    /** Redesenha os gráficos com dados novos (só quando a aba está visível). */
    flush() {
      for (const c of charts) {
        if (!c.dirty) continue;
        c.dirty = false;
        c.chart.update('none');
      }
    },
    reset() {
      for (const c of charts) {
        c.chart.data.labels.length = 0;
        for (const ds of c.chart.data.datasets) ds.data.length = 0;
        c.dirty = true;
      }
    },
  };
}
