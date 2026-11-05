// ICP (Integrated Control Panel): teclado para entrada de COM1/COM2/IFF/STPT.
// Fluxo: tecla de função → dígitos → ENT publica o comando "icp" em f22/comandos.

const FIELDS = {
  COM1: { key: 'com1', max: 5, hint: 'FREQ xxx.xx' },
  COM2: { key: 'com2', max: 5, hint: 'FREQ xxx.xx' },
  IFF: { key: 'iff', max: 4, hint: 'CODE 0-7' },
  STPT: { key: 'stpt', max: 2, hint: 'STPT Nº' },
};

export function initICP(root, api) {
  const st = { field: null, buf: '', msg: '', msgUntil: 0 };

  root.innerHTML = `
    <div class="icp-screen"><span class="icp-l1"></span><span class="icp-l2"></span></div>
    <div class="icp-keys">
      <div class="icp-group fn">
        ${Object.keys(FIELDS).map((k) => `<button class="icp-key fn" data-fn="${k}">${k}</button>`).join('')}
      </div>
      <div class="icp-group num">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT']
          .map((k) => `<button class="icp-key${/\d/.test(k) ? '' : ' act'}" data-k="${k}">${k}</button>`).join('')}
      </div>
      <div class="icp-group fn">
        <button class="icp-key fn" data-x="next">WP ▲</button>
        <button class="icp-key fn" data-x="prev">WP ▼</button>
        <button class="icp-key fn" data-x="mark">MARK</button>
        <button class="icp-key fn" data-x="rtn">RTN</button>
      </div>
    </div>`;

  const l1 = root.querySelector('.icp-l1');
  const l2 = root.querySelector('.icp-l2');

  const flash = (msg) => {
    st.msg = msg;
    st.msgUntil = performance.now() + 1500;
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fn) {
      st.field = b.dataset.fn;
      st.buf = '';
    } else if (b.dataset.k) {
      const k = b.dataset.k;
      if (k === 'CLR') {
        if (st.buf) st.buf = st.buf.slice(0, -1);
        else st.field = null;
      } else if (k === 'ENT') {
        if (st.field && st.buf) {
          api.cmd('icp', { field: FIELDS[st.field].key, value: st.buf });
          flash(`${st.field} ENTERED`);
          st.field = null;
          st.buf = '';
        }
      } else if (st.field && st.buf.length < FIELDS[st.field].max) {
        st.buf += k;
      } else if (!st.field) {
        flash('SELECT FUNCTION');
      }
    } else if (b.dataset.x) {
      const x = b.dataset.x;
      if (x === 'next' || x === 'prev') api.cmd('waypoint', x);
      else if (x === 'mark') {
        api.cmd('icp', { field: 'marca', value: '1' });
        flash('MARK STORED');
      } else {
        st.field = null;
        st.buf = '';
      }
    }
  });

  return function update(s) {
    const now = performance.now();
    let a;
    let b;
    if (st.field) {
      const f = FIELDS[st.field];
      a = `${st.field} ▸ ${st.buf}${Math.floor(now / 400) % 2 ? '_' : ' '}`;
      b = f.hint;
    } else {
      a = `COM1 ${s.comm?.com1 || '---.--'}   COM2 ${s.comm?.com2 || '---.--'}`;
      b = `IFF ${s.comm?.iff || '----'}   STPT ${s.nav?.wptIndex != null ? s.nav.wptIndex + 1 : '-'}`;
    }
    if (now < st.msgUntil) b = st.msg;
    if (l1.textContent !== a) l1.textContent = a;
    if (l2.textContent !== b) l2.textContent = b;
  };
}
