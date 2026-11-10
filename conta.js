// Reserva completa, conta de hóspede, gestão e e-mails — site de demonstração.
// Tudo fica no navegador (localStorage). Os e-mails são simulados: vão para a caixa de saída da Gestão.

// ---------- sessão (hóspede ou pousada) ----------
const sessao = () => JSON.parse(sessionStorage.getItem('tg_sessao') || localStorage.getItem('tg_sessao') || 'null');
function entrarComo(s, lembrar) {
  sessionStorage.setItem('tg_sessao', JSON.stringify(s));
  if (lembrar) localStorage.setItem('tg_sessao', JSON.stringify(s));
}
function sair() { const adm = ehAdmin(); sessionStorage.removeItem('tg_sessao'); localStorage.removeItem('tg_sessao'); location.hash = adm ? '#/login' : '#/'; render(); }
window.sair = sair;
const ehAdmin = () => sessao()?.tipo === 'admin';
const hospedeAtual = () => { const s = sessao(); return s?.tipo === 'hospede' ? db.get('hospedes').find(h => h.id === s.id) : null; };
const ADMIN = { usuario: 'admin', senha: 'guara123' }; // credencial só de teste

async function hash(txt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tg:' + txt));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const soDig = s => String(s).replace(/\D/g, '');
function cpfValido(c) {
  c = soDig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if ((s * 10 % 11) % 10 !== +c[t]) return false;
  }
  return true;
}
const fmtCPF = c => soDig(c).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
const uid = p => p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

// ---------- e-mails simulados ----------
const POUSADA_EMAIL = 'reservas@guarabangalos.test';
function enviarEmail(para, assunto, corpo) {
  db.add('emails', { id: uid('M'), data: new Date().toISOString(), para, assunto, corpo });
  toast(`E-mail enviado (simulado) para ${para}`);
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add('on'), 10);
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, 3500);
}
const STATUS = { aguardando: 'Aguardando pagamento', comprovante: 'Comprovante enviado', confirmada: 'Confirmada', cancelada: 'Cancelada' };
const selo = s => `<span class="status st-${s}">${STATUS[s] || s}</span>`;
const linhaReserva = r => { const u = unidade(r.unidade); return `${u.nome} · ${dBR(r.entrada)} a ${dBR(r.saida)} · ${r.adultos} adulto(s)${r.criancas ? `, ${r.criancas} criança(s)` : ''} · total ${fmt(r.total)}`; };

// ---------- regras do original ----------
// "Mínimo de duas diárias. Em feriados prolongados somente serão aceitas reservas para todo o período."
// feriados prolongados editáveis na Gestão (Editar site > Preços)
const PROLONGADOS_ = () => CMS.feriados;
function regraPeriodo(ent, sai) {
  if (noites(ent, sai).length < (+CMS.precos.minNoites || 1)) return `Mínimo de ${CMS.precos.minNoites} diárias.`;
  for (const [a, b, nome] of PROLONGADOS_()) {
    const fimSaida = somaDia(b, 1);
    if (ent <= b && sai > a && (ent > a || sai < fimSaida)) return `Feriado prolongado (${nome}): somente reservas para todo o período, de ${dBR(a)} a ${dBR(fimSaida)}.`;
  }
  return '';
}

// ---------- Reservas: unidade → datas → hóspedes (uma coisa por vez, com prévia ao vivo) ----------
let cal = { u: null, mes: null, ent: null, sai: null, msg: '', ad: 2, cr: 0, bb: 0 };
const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const primeiroDoMes = iso => iso.slice(0, 8) + '01';
const somaMes = (iso, n) => { const d = new Date(iso.slice(0, 7) + '-01T12:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const ehFeriadoLongo = d => PROLONGADOS_().some(([a, b]) => d >= a && d <= b);
const curto = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');

function estadoDia(u, d) {
  if (d < hoje()) return 'passado';
  const antes = diaOcupado(u.id, somaDia(d, -1)), noite = diaOcupado(u.id, d);
  if (noite && antes) return 'ocupado';
  if (noite) return 'so-saida';
  return 'livre';
}
function mesHTML(u, ini) {
  const dt = new Date(ini + 'T12:00'), ano = dt.getFullYear(), m = dt.getMonth();
  const vazios = new Date(ano, m, 1).getDay(), dias = new Date(ano, m + 1, 0).getDate();
  let cel = '<span></span>'.repeat(vazios);
  for (let n = 1; n <= dias; n++) {
    const d = `${ano}-${String(m + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    const st = estadoDia(u, d), di = diaria(d, u);
    const cls = [st, 'p-' + (di.tipo === 'Semana' ? 'normal' : di.tipo === 'Fim de semana' ? 'fds' : 'alta')];
    if (d === hoje()) cls.push('hoje');
    if (cal.ent === d) cls.push('ini');
    if (cal.sai === d) cls.push('fim');
    if (cal.ent && cal.sai && d > cal.ent && d < cal.sai) cls.push('meio');
    const dis = st === 'passado' || st === 'ocupado';
    const rot = `${n} de ${MESES_LONGOS[m]}, ${st === 'ocupado' ? 'ocupado' : st === 'so-saida' ? 'só para saída' : st === 'passado' ? 'data passada' : `${di.tipo.toLowerCase()}, ${fmt(di.v)}`}`;
    cel += `<button type="button" data-d="${d}" class="${cls.join(' ')}" ${dis ? 'disabled' : `onclick="escolherDia('${d}')"`} aria-label="${rot}" aria-pressed="${cal.ent === d || cal.sai === d}"><b>${n}</b><small>${st === 'livre' ? Math.round(di.v) : st === 'so-saida' ? 'saída' : st === 'ocupado' ? 'ocupado' : ''}</small></button>`;
  }
  return `<div class="cal-mes"><h3>${MESES_LONGOS[m]} <span>${ano}</span></h3><div class="cal-sem" aria-hidden="true">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(x => `<span>${x}</span>`).join('')}</div><div class="cal-dias">${cel}</div></div>`;
}
window.escolherDia = d => {
  const u = unidade(cal.u);
  cal.msg = '';
  if (!cal.ent || cal.sai || d <= cal.ent) {
    if (estadoDia(u, d) !== 'livre') cal.msg = 'Nesse dia só dá para fazer check-out. Escolha outro dia para a entrada.';
    else { cal.ent = d; cal.sai = null; }
  } else if (ocupado(u.id, cal.ent, d)) {
    cal.msg = 'Há noites ocupadas no meio. Escolha uma saída antes da primeira data ocupada.';
  } else {
    const regra = regraPeriodo(cal.ent, d);
    if (regra) cal.msg = regra; else cal.sai = d;
  }
  redesenharCal();
};
window.trocarUnidade = id => { const manter = cal.ent && cal.sai && !ocupado(+id, cal.ent, cal.sai); cal = { ...cal, u: +id, msg: '', ...(manter ? {} : { ent: null, sai: null }) }; redesenharCal(); };
window.trocarMes = n => { const novo = somaMes(cal.mes, n); if (novo >= primeiroDoMes(hoje())) { cal.mes = novo; redesenharCal(); } };
window.limparCal = () => { cal = { ...cal, ent: null, sai: null, msg: '' }; redesenharCal(); };
window.hospedes = (k, d) => {
  const u = unidade(cal.u), lim = { ad: [1, u.capacidade], cr: [0, u.capacidade], bb: [0, 3] }[k];
  cal[k] = Math.min(lim[1], Math.max(lim[0], cal[k] + d));
  if (cal.ad + cal.cr > u.capacidade) cal[k] -= d;
  redesenharCal();
};
function redesenharCal() { const el = $('#reserva-app'); if (el) el.outerHTML = reservaHTML(); }

// prévia ao vivo: com a entrada marcada, passar o mouse pinta o período e mostra noites e total
document.addEventListener('mouseover', e => {
  const b = e.target.closest('#reserva-app .cal-dias button');
  const prev = document.querySelector('.cal-previa');
  document.querySelectorAll('.cal-dias .previa').forEach(x => x.classList.remove('previa'));
  if (!b || !cal.ent || cal.sai || b.disabled || b.dataset.d <= cal.ent) { if (prev) prev.textContent = cal.ent && !cal.sai ? 'Agora clique no dia da saída' : ''; return; }
  const u = unidade(cal.u), d = b.dataset.d;
  if (ocupado(u.id, cal.ent, d)) { if (prev) prev.textContent = 'Há noites ocupadas nesse período'; return; }
  document.querySelectorAll('.cal-dias button').forEach(x => { if (x.dataset.d > cal.ent && x.dataset.d <= d) x.classList.add('previa'); });
  const o = orcamento(u, cal.ent, d, cal.ad, cal.cr);
  if (prev) prev.textContent = `${o.ns.length} ${o.ns.length > 1 ? 'noites' : 'noite'} · ${fmt(o.total)}`;
});

const passo = () => !cal.ent ? 1 : !cal.sai ? 2 : 3;
const stepper = (k, rot, sub) => `<div class="hosp"><div><b>${rot}</b>${sub ? `<small>${sub}</small>` : ''}</div>
  <div class="hosp-ctrl"><button type="button" onclick="hospedes('${k}',-1)" aria-label="Menos ${rot.toLowerCase()}">−</button><output aria-live="polite">${cal[k]}</output><button type="button" onclick="hospedes('${k}',1)" aria-label="Mais ${rot.toLowerCase()}">+</button></div></div>`;

function reservaHTML() {
  const u = unidade(cal.u), p = passo();
  const livreNoPeriodo = x => !(cal.ent && cal.sai) || !ocupado(x.id, cal.ent, cal.sai);
  let resumo;
  if (p === 3) {
    const o = orcamento(u, cal.ent, cal.sai, cal.ad, cal.cr);
    const link = '#/reservar?' + new URLSearchParams({ entrada: cal.ent, saida: cal.sai, adultos: cal.ad, criancas: cal.cr, bebe: cal.bb, unidade: u.id });
    resumo = `<div class="rs-datas"><div><span>Entrada</span><b>${dBR(cal.ent)}</b><small>a partir das 15h</small></div><div><span>Saída</span><b>${dBR(cal.sai)}</b><small>até as 12h</small></div></div>
      <div class="rs-hosp">${stepper('ad', 'Adultos', '')}${stepper('cr', 'Crianças', '1 a 12 anos')}${stepper('bb', 'Bebês', 'até 12 meses, não pagam')}</div>
      <details class="rs-conta"><summary><span>${o.ns.length} noites${o.extras ? `, ${o.extras} pessoa(s) extra` : ''}</span><span>ver detalhes</span></summary><ul>${o.linhas.map(l => `<li><span>${dBR(l.d).slice(0, 5)} · ${l.tipo}</span><span>${fmt(l.v + l.extra)}</span></li>`).join('')}</ul></details>
      <div class="rs-total"><span>Total</span><b>${fmt(o.total)}</b></div>
      <p class="rs-sinal">${fmt(o.sinal)} na reserva e ${fmt(o.total - o.sinal)} no check-in.</p>
      <a class="btn btn-block rs-ir" href="${link}">Continuar reserva</a>`;
  } else {
    resumo = `<div class="rs-datas vazio"><div class="${p === 1 ? 'agora' : 'ok'}"><span>Entrada</span><b>${cal.ent ? dBR(cal.ent) : 'Escolha no calendário'}</b></div><div class="${p === 2 ? 'agora' : ''}"><span>Saída</span><b>${p === 2 ? 'Escolha no calendário' : '—'}</b></div></div>
      <p class="rs-dica">Mínimo de ${CMS.precos.minNoites} noites. Em feriados prolongados, só o período inteiro.</p>`;
  }
  return `<div id="reserva-app" class="reserva-app">
    <ol class="passos" aria-label="Etapas">${['Escolha a entrada', 'Escolha a saída', 'Hóspedes e total'].map((t, i) => `<li class="${i + 1 === p ? 'atual' : i + 1 < p ? 'feito' : ''}" ${i + 1 === p ? 'aria-current="step"' : ''}><span>${i + 1 < p ? '<i class="fa fa-check"></i>' : i + 1}</span>${t}</li>`).join('')}</ol>
    <div class="rs-unidades" role="radiogroup" aria-label="Unidade">${UN.map(x => `<button type="button" role="radio" aria-checked="${x.id === u.id}" class="rs-un ${x.id === u.id ? 'on' : ''} ${livreNoPeriodo(x) ? '' : 'indisp'}" onclick="trocarUnidade(${x.id})">
      <img src="${x.fotos[0] || ''}" alt=""><span><b>${esc(x.nome.replace(' (duas suítes)', ''))}</b><small>até ${x.capacidade} pessoas · desde ${curto(aPartirDe(x))}</small>${cal.ent && cal.sai ? `<em>${livreNoPeriodo(x) ? 'Livre nessas datas' : 'Ocupado nessas datas'}</em>` : ''}</span></button>`).join('')}</div>
    <div class="rs-corpo">
      <div class="rs-cal">
        <div class="rs-cal-topo"><button type="button" class="cal-seta" onclick="trocarMes(-1)" aria-label="Meses anteriores" ${cal.mes <= primeiroDoMes(hoje()) ? 'disabled' : ''}><i class="fa fa-chevron-left"></i></button>
          <p class="cal-previa" aria-live="polite">${p === 2 ? 'Agora clique no dia da saída' : ''}</p>
          <button type="button" class="cal-seta" onclick="trocarMes(1)" aria-label="Próximos meses"><i class="fa fa-chevron-right"></i></button></div>
        <div class="rs-meses">${mesHTML(u, cal.mes)}${mesHTML(u, somaMes(cal.mes, 1))}</div>
        <div class="cal-legenda"><span class="lg-txt">Diária em R$ abaixo de cada dia</span><span class="lg-normal">Semana</span><span class="lg-fds">Fim de semana</span><span class="lg-alta">Feriado</span><span class="lg-ocup">Ocupado</span></div>
      </div>
      <aside class="rs-resumo" aria-live="polite">
        <div class="rs-un-topo"><img src="${u.fotos[0] || ''}" alt=""><div><h3>${esc(u.nome)}</h3><p>${esc(u.categoria)}, até ${u.capacidade} pessoas</p></div></div>
        ${cal.msg ? `<p class="cal-msg" role="alert">${cal.msg}</p>` : ''}${resumo}
        ${cal.ent ? '<button type="button" class="cal-limpar" onclick="limparCal()">Limpar datas</button>' : ''}
      </aside>
    </div>
  </div>`;
}

P.reservas = q => {
  if (!cal.u || !unidade(cal.u) || (q.unidade && +q.unidade !== cal.u)) cal = { ...cal, u: +(q.unidade || (unidade(cal.u) ? cal.u : UN[0].id)), ent: null, sai: null };
  if (q.adultos) { cal.ad = +q.adultos || 2; cal.cr = +q.criancas || 0; cal.bb = +q.bebe || 0; }
  const temBusca = q.entrada && q.saida && q.saida > q.entrada;
  if (temBusca) {
    const regra = regraPeriodo(q.entrada, q.saida);
    const livre = UN.find(x => x.id === cal.u && !ocupado(x.id, q.entrada, q.saida)) || UN.find(x => !ocupado(x.id, q.entrada, q.saida));
    if (!regra && livre) { cal = { ...cal, u: livre.id, ent: q.entrada, sai: q.saida, msg: '' }; }
    else { cal.ent = null; cal.sai = null; cal.msg = regra || 'Nenhuma unidade livre nessas datas. Veja outras datas no calendário.'; }
    cal.mes = primeiroDoMes(q.entrada < hoje() ? hoje() : q.entrada);
  }
  if (!cal.mes) cal.mes = primeiroDoMes(hoje());
  return banda('Reservas', 'Reservas', 'Escolha a unidade e as datas. O total aparece na hora.') + `<section class="pagina-texto"><div class="container">${reservaHTML()}</div></section>`;
};

// ---------- confirmação da reserva (checkout) ----------
const PIX_TESTE = new Proxy({}, { get: (_, k) => CMS.pix[k] }); // dados editáveis na Gestão
const pixCopiaECola = (id, valor) => `00020126TESTE0014BR.GOV.BCB.PIX01${PIX_TESTE.chave}52040000530398654${valor.toFixed(2)}5802BR5920GUARABANGALOS6009ALTOPARAISO62${id}6304TEST`;

P.reservar = q => {
  const u = unidade(q.unidade);
  if (!u || !q.entrada || !q.saida) { location.hash = '#/reservas'; return ''; }
  const regra = regraPeriodo(q.entrada, q.saida);
  if (regra || ocupado(u.id, q.entrada, q.saida)) return banda('Reservas') + `<section class="page-body"><div class="container"><div class="alert-danger">${regra || 'Período não disponível.'}</div><a class="btn" href="#/reservas">Voltar</a></div></section>`;
  const h = hospedeAtual();
  const o = orcamento(u, q.entrada, q.saida, q.adultos, q.criancas);
  const voltar = encodeURIComponent(location.hash);
  const dados = h ? `<form id="dados" class="checkout-box" onsubmit="event.preventDefault();confirmarReserva(this)">
      <div class="checkout-title"><h3>Seus dados</h3></div>
      <div class="pad">
      <label>Nome completo<input name="nome" value="${esc(h.nome)}" required></label>
      <div class="linha"><label>CPF<input value="${fmtCPF(h.cpf)}" disabled></label><label>Celular<input name="celular" value="${esc(h.celular)}" required></label></div>
      <label>E-mail<input value="${esc(h.email)}" disabled></label>
      <div class="linha"><label>Horário previsto de chegada<input type="time" name="chegada" min="15:00" value="15:00"></label>
        <label>Forma de pagamento<select name="pagamento"><option>PIX</option><option>TED</option><option>Transferência bancária</option></select></label></div>
      <label>Observações<textarea name="obs" rows="3"></textarea></label>
      <label class="check"><input type="checkbox" required> Li e aceito a&nbsp;<a href="#/politica" target="_blank">política de cancelamento</a></label>
      <button class="btn btn-block">Confirmar reserva</button></div></form>`
    : `<div id="dados" class="checkout-box"><div class="checkout-title"><h3>Identificação</h3></div><div class="pad">
      <p>Para concluir a reserva, entre na sua conta ou crie um cadastro.</p>
      <form class="login" style="margin:0;max-width:none" onsubmit="event.preventDefault();entrar(this,'${voltar}')">
        <label>E-mail ou CPF <span class="star">*</span><input name="usuario" required></label>
        <label>Senha <span class="star">*</span><input type="password" name="senha" required></label>
        <button class="btn btn-block">Acessar</button><div id="ret-login"></div></form>
      <p style="margin-top:14px">Não possui uma conta? <a href="#/cadastro?volta=${voltar}">Cadastre-se</a></p></div></div>`;
  return banda('Reservas') + `<section class="page-body layout-confirmacaoreserva"><div class="container"><div class="checkout">
    ${dados}
    <div id="resumo" class="checkout-box"><div class="checkout-title"><h3>Resumo</h3></div><div class="pad">
      <div class="res-unidade"><img src="${u.fotos[0]}" alt=""><div><b>${u.nome}</b><br><small>${u.categoria}</small></div></div>
      <div class="kv"><span>Entrada</span><b>${dBR(q.entrada)} (a partir das 15h)</b></div>
      <div class="kv"><span>Saída</span><b>${dBR(q.saida)} (até às 12h)</b></div>
      <div class="kv"><span>Hóspedes</span><b>${q.adultos} adulto(s), ${q.criancas} criança(s), ${q.bebe || 0} bebê(s)</b></div>
      <ul class="diarias">${o.linhas.map(l => `<li><span>${dBR(l.d)} · ${l.tipo}</span><span>${fmt(l.v + l.extra)}</span></li>`).join('')}</ul>
      <div class="total"><span>Valor Total:</span><b>${fmt(o.total)}</b></div>
      <div id="pagamento"><h4><i class="fa fa-qrcode"></i> Pagamento</h4>
        <p>Pagamento de <b>50% (${fmt(o.sinal)})</b> na data da reserva e <b>50% (${fmt(o.total - o.sinal)})</b> no check-in, via PIX, TED ou transferência bancária.</p>
        <p class="peq">Os dados para pagamento aparecem após confirmar a reserva.</p></div>
    </div></div>
  </div></div></section>`;
};

window.confirmarReserva = f => {
  const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]));
  const u = unidade(q.unidade), h = hospedeAtual();
  if (!h) return;
  if (ocupado(u.id, q.entrada, q.saida)) return alert('Essas datas acabaram de ficar indisponíveis.');
  const o = orcamento(u, q.entrada, q.saida, q.adultos, q.criancas);
  const d = Object.fromEntries(new FormData(f));
  const r = db.add('reservas', {
    id: uid('TG'), criada: new Date().toISOString(), status: 'aguardando', hospede: h.id,
    unidade: u.id, entrada: q.entrada, saida: q.saida, adultos: +q.adultos, criancas: +q.criancas, bebe: +(q.bebe || 0),
    total: o.total, sinal: o.sinal, nome: d.nome, email: h.email, telefone: d.celular, cpf: h.cpf,
    chegada: d.chegada, pagamento: d.pagamento, obs: d.obs,
  });
  enviarEmail(h.email, `[Guará Bangalôs] Pré-reserva ${r.id} recebida`,
    `<p>Olá, ${esc(h.nome)}!</p><p>Recebemos sua pré-reserva:</p><p><b>${linhaReserva(r)}</b></p>
     <p>Para garantir as datas, faça o pagamento do sinal de <b>${fmt(r.sinal)}</b> via PIX (chave ${PIX_TESTE.chave}) e envie o comprovante em "Minhas reservas".</p>
     <p>O restante (${fmt(r.total - r.sinal)}) é pago no check-in. Check-in a partir das 15h, check-out até às 12h.</p>`);
  enviarEmail(POUSADA_EMAIL, `[Site] Nova pré-reserva ${r.id}`, `<p>Nova pré-reserva de <b>${esc(h.nome)}</b> (${esc(h.email)}, ${esc(d.celular)}):</p><p>${linhaReserva(r)}</p><p>Observações: ${esc(d.obs || '—')}</p>`);
  location.hash = '#/confirmacao/' + r.id;
};

P.confirmacao = id => {
  const r = db.get('reservas').find(x => x.id === id);
  const h = hospedeAtual();
  if (!h && !ehAdmin()) return irParaLogin();
  if (!r || !(ehAdmin() || r.hospede === h.id)) return P['404']();
  const u = unidade(r.unidade);
  const msg = encodeURIComponent(`Olá! Segue o comprovante da pré-reserva ${r.id}: ${u.nome}, ${dBR(r.entrada)} a ${dBR(r.saida)}.`);
  const pagar = r.status === 'aguardando' ? `
    <div id="pagamento" class="pix"><h4><i class="fa fa-qrcode"></i> Pague o sinal de ${fmt(r.sinal)} via PIX</h4>
      <div class="pix-grid"><div class="qr" aria-label="QR Code de teste">${qrFake(r.id)}</div>
      <div><p><b>Chave PIX:</b> ${PIX_TESTE.chave}<br><b>Favorecido:</b> ${PIX_TESTE.favorecido}</p>
        <label>PIX copia e cola<textarea readonly rows="3" onclick="this.select()">${pixCopiaECola(r.id, r.sinal)}</textarea></label>
        <button class="btn btn-sm" onclick="navigator.clipboard.writeText(this.previousElementSibling.querySelector('textarea').value);toast('Código copiado')">Copiar código</button>
        <p class="peq">Ou TED/transferência: ${PIX_TESTE.banco} · Ag. ${PIX_TESTE.agencia} · C/C ${PIX_TESTE.conta}</p></div></div>
      <hr><h4>Enviar comprovante</h4>
      <form onsubmit="event.preventDefault();enviarComprovante('${r.id}',this)"><input type="file" name="arq" accept="image/*,application/pdf" required> <button class="btn btn-sm">Enviar</button></form>
      <p class="peq">Ou envie pelo <a target="_blank" href="https://wa.me/5561900000000?text=${msg}">WhatsApp</a>.</p>
      <p class="peq aviso-teste">Dados de pagamento fictícios: este é um site de demonstração.</p></div>` : '';
  return banda('Reservas') + `<section class="page-body"><div class="container" style="max-width:760px">
    <div class="checkout-title"><h3>Reserva ${r.id}</h3></div>
    <div class="checkout-box pad"><p>${selo(r.status)}</p><p><b>${linhaReserva(r)}</b></p>
      <p>Sinal (50%): ${fmt(r.sinal)} · Restante no check-in: ${fmt(r.total - r.sinal)}</p>
      ${r.comprovante ? `<p>Comprovante: ${esc(r.comprovante.nome)} (${new Date(r.comprovante.data).toLocaleString('pt-BR')})</p>` : ''}
      ${pagar}
      <p style="margin-top:16px"><a class="btn" href="#/minhas-reservas">Minhas reservas</a></p></div>
  </div></section>`;
};
// QR ilustrativo (não é um PIX válido)
function qrFake(seed) {
  let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  let cel = ''; const n = 21;
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = Math.floor(i / n);
    const canto = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    let on;
    if (canto) { const cx = x > 13 ? x - 14 : x, cy = y > 13 ? y - 14 : y; on = cx === 0 || cy === 0 || cx === 6 || cy === 6 || (cx > 1 && cx < 5 && cy > 1 && cy < 5); }
    else { s = (s * 1103515245 + 12345) >>> 0; on = (s >> 16) & 1; }
    if (on) cel += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg viewBox="-1 -1 23 23" width="150" height="150"><rect x="-1" y="-1" width="23" height="23" fill="#fff"/><g fill="#000">${cel}</g></svg>`;
}
window.enviarComprovante = (id, f) => {
  const arq = f.arq.files[0]; if (!arq) return;
  const l = db.get('reservas'), r = l.find(x => x.id === id);
  r.comprovante = { nome: arq.name, tamanho: arq.size, data: new Date().toISOString() };
  r.status = 'comprovante'; db.set('reservas', l);
  enviarEmail(POUSADA_EMAIL, `[Site] Comprovante da reserva ${r.id}`, `<p>${esc(r.nome)} enviou o comprovante <b>${esc(arq.name)}</b> da reserva:</p><p>${linhaReserva(r)}</p><p>Confira o pagamento e confirme a reserva na Gestão.</p>`);
  render();
};

// ---------- cadastro, login e recuperação de senha ----------
// Layout igual ao original (Joomla + motor de reservas), com melhorias marcadas como "melhoria".

// volta para a página onde a pessoa estava depois de entrar (melhoria)
const irParaLogin = () => { location.hash = '#/login?volta=' + encodeURIComponent(location.hash); return ''; };
const destino = (volta, padrao) => volta ? decodeURIComponent(volta) : padrao;

// campo de senha com olho e aviso de Caps Lock (melhoria)
const campoSenha = (name, extra = '') => `<div class="senha-wrap"><span class="addon-ic"><i class="fa fa-key"></i></span>
  <input type="password" name="${name}" ${extra} onkeyup="capsLock(event,this)" onkeydown="capsLock(event,this)">
  <button type="button" class="olho" aria-label="Mostrar senha" onclick="olho(this)"><i class="far fa-eye"></i></button></div>
  <small class="caps">Caps Lock está ligado</small>`;
window.olho = b => {
  const i = b.parentNode.querySelector('input'), ver = i.type === 'password';
  i.type = ver ? 'text' : 'password';
  b.innerHTML = `<i class="far fa-eye${ver ? '-slash' : ''}"></i>`; b.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
};
window.capsLock = (e, el) => { if (e.getModifierState) el.closest('label').classList.toggle('caps-on', e.getModifierState('CapsLock')); };

// máscaras (melhoria)
window.mascaraCPF = el => { el.value = soDig(el.value).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'); };
window.mascaraCel = el => {
  const d = soDig(el.value).slice(0, 11);
  el.value = d.length > 10 ? d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : d.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (m, a, b, c) => `(${a}) ${b}${c ? '-' + c : ''}`).replace(/\D+$/, '');
};
// força da senha (melhoria)
function forca(s) {
  let p = 0; if (s.length >= 8) p++; if (s.length >= 12) p++; if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++; if (/\d/.test(s)) p++; if (/[^A-Za-z0-9]/.test(s)) p++;
  return s.length < 6 ? 0 : Math.min(4, Math.max(1, p));
}
window.medirSenha = el => {
  const n = forca(el.value), m = el.closest('form').querySelector('.forca');
  m.dataset.n = el.value ? n : ''; m.querySelector('span').textContent = el.value ? ['Muito curta', 'Fraca', 'Razoável', 'Boa', 'Forte'][n] : '';
};

// erro embaixo de cada campo (melhoria)
function erroCampo(f, nome, msg) {
  const el = f.elements[nome], lab = el.closest('label');
  lab.classList.add('invalido'); lab.querySelector('.msg-erro')?.remove();
  lab.insertAdjacentHTML('beforeend', `<small class="msg-erro">${msg}</small>`);
}
const limparErros = f => f.querySelectorAll('.invalido').forEach(l => { l.classList.remove('invalido'); l.querySelector('.msg-erro')?.remove(); });

// ----- Login (igual ao original: usuário, senha com chave, lembrar-me, Acessar, links) -----
P.login = q => {
  if (ehAdmin()) { location.hash = destino(q.volta, '#/gestao'); return ''; }
  if (hospedeAtual()) { location.hash = destino(q.volta, '#/minhas-reservas'); return ''; }
  if (q.view === 'reset') return P.recuperar(q);
  if (q.view === 'codigo') return P.loginCodigo(q);
  const v = q.volta ? `&volta=${encodeURIComponent(q.volta)}` : '';
  return `<section class="login-unico"><form class="adm-card" onsubmit="event.preventDefault();entrar(this,'${esc(q.volta || '')}')" novalidate>
    <img src="${urlMidia(CMS.marca.logoDestaque)}" alt="" class="logo-pedra"><strong class="adm-marca">Guará Bangalôs</strong>
    <h1>Entrar</h1><p class="peq">Hóspedes e equipe da pousada usam o mesmo acesso.</p>
    <label>E-mail, CPF ou usuário<input name="usuario" required autocomplete="username"></label>
    <label>Senha${campoSenha('senha', 'required autocomplete="current-password"')}</label>
    <label class="check"><input type="checkbox" name="lembrar"> Manter conectado</label>
    <button class="btn btn-block">Entrar</button><div id="ret-login"></div>
    <a class="btn-codigo" href="#/login?view=codigo${v}"><i class="far fa-envelope"></i> Entrar com código por e-mail</a>
    <div class="login-links"><a href="#/login?view=reset">Esqueceu sua senha?</a><a href="#/cadastro${q.volta ? '?volta=' + encodeURIComponent(q.volta) : ''}">Criar conta de hóspede</a></div>
    <p class="dica">Demonstração — pousada: <b>admin</b> / <b>guara123</b>. Hóspede: <b>maria@teste.test</b> / <b>demo1234</b>.</p>
    <a class="voltar-site" href="#/">← Voltar ao site</a>
  </form></section>`;
};

// bloqueio depois de 5 tentativas erradas por 5 minutos (melhoria)
const TENT = 5, ESPERA = 5 * 60e3;
const bloqueio = () => JSON.parse(localStorage.getItem('tg_bloqueio') || '{"n":0,"ate":0}');
window.entrar = async (f, volta) => {
  const { usuario = '', senha = '', lembrar } = Object.fromEntries(new FormData(f));
  const out = f.querySelector('#ret-login') || $('#ret-login');
  limparErros(f);
  if (!usuario.trim()) return erroCampo(f, 'usuario', 'Informe seu e-mail ou CPF.');
  if (!senha) return erroCampo(f, 'senha', 'Informe sua senha.');
  const b = bloqueio();
  if (b.ate > Date.now()) return out.innerHTML = `<p class="aviso erro">Muitas tentativas. Tente de novo em ${Math.ceil((b.ate - Date.now()) / 60e3)} minuto(s) ou entre com código por e-mail.</p>`;
  const falhou = () => {
    const n = b.n + 1;
    localStorage.setItem('tg_bloqueio', JSON.stringify(n >= TENT ? { n: 0, ate: Date.now() + ESPERA } : { n, ate: 0 }));
    out.innerHTML = `<p class="aviso erro">Usuário ou senha inválidos.${n >= TENT ? ' Acesso bloqueado por 5 minutos.' : n >= 3 ? ` Restam ${TENT - n} tentativa(s).` : ''}</p>`;
  };
  if (usuario.trim().toLowerCase() === ADMIN.usuario) {
    if (senha !== ADMIN.senha) return falhou();
    localStorage.removeItem('tg_bloqueio'); entrarComo({ tipo: 'admin' }, lembrar);
    location.hash = destino(volta, '#/gestao'); render(); return;
  }
  const h = acharHospede(usuario);
  if (!h || h.senha !== await hash(senha)) return falhou();
  localStorage.removeItem('tg_bloqueio'); entrarComo({ tipo: 'hospede', id: h.id }, lembrar);
  location.hash = destino(volta, '#/minhas-reservas'); render();
};
const acharHospede = u => { u = u.trim().toLowerCase(); const d = soDig(u); return db.get('hospedes').find(x => x.email.toLowerCase() === u || (d.length === 11 && x.cpf === d)); };

// ----- Entrar com código por e-mail, sem senha (melhoria) -----
P.loginCodigo = q => `<section class="login-unico"><div class="adm-card login-passo"><img src="${urlMidia(CMS.marca.logoDestaque)}" alt="" class="logo-pedra"><strong class="adm-marca">Guará Bangalôs</strong><h1>Entrar com código</h1>
  ${q.email === undefined ? `<p>Informe o e-mail da sua conta. Enviaremos um código de 6 dígitos para você entrar sem senha.</p>
  <form onsubmit="event.preventDefault();pedirCodigoLogin(this,'${esc(q.volta || '')}')"><label>Endereço de e-mail <span class="star">*</span><input type="email" name="email" required></label>
    <button class="btn">Enviar código</button></form>`
  : `<p>Enviamos um código para <b>${esc(q.email)}</b>. Ele vale por 10 minutos.</p>
  <form onsubmit="event.preventDefault();entrarComCodigo(this,'${esc(q.volta || '')}')"><input type="hidden" name="email" value="${esc(q.email)}">
    <label>Código <span class="star">*</span><input name="codigo" inputmode="numeric" maxlength="6" required autocomplete="one-time-code" class="codigo"></label>
    <button class="btn">Entrar</button></form>`}
  <div id="ret-rec"></div><a class="voltar-site" href="#/login">← Entrar com senha</a></div></section>`;
window.pedirCodigoLogin = (f, volta) => {
  const email = f.email.value.trim().toLowerCase();
  const l = db.get('hospedes'), h = l.find(x => x.email.toLowerCase() === email);
  if (h) {
    h.codLogin = { codigo: String(Math.floor(100000 + Math.random() * 900000)), ate: Date.now() + 10 * 60e3 }; db.set('hospedes', l);
    enviarEmail(h.email, '[Guará Bangalôs] Seu código de acesso', `<p>Use o código <b style="font-size:20px;letter-spacing:3px">${h.codLogin.codigo}</b> para entrar no site da Guará Bangalôs. Ele vale por 10 minutos.</p><p>Se não foi você, ignore este e-mail.</p>`);
  }
  // não revela se o e-mail existe
  location.hash = '#/login?' + new URLSearchParams({ view: 'codigo', email, ...(volta ? { volta: decodeURIComponent(volta) } : {}) });
};
window.entrarComCodigo = (f, volta) => {
  const d = Object.fromEntries(new FormData(f));
  const l = db.get('hospedes'), h = l.find(x => x.email.toLowerCase() === d.email);
  if (!h || !h.codLogin || h.codLogin.codigo !== d.codigo.trim() || Date.now() > h.codLogin.ate) return $('#ret-rec').innerHTML = '<p class="aviso erro">Código inválido ou expirado.</p>';
  delete h.codLogin; db.set('hospedes', l); localStorage.removeItem('tg_bloqueio');
  entrarComo({ tipo: 'hospede', id: h.id });
  location.hash = destino(volta, '#/minhas-reservas'); render();
};

// ----- Cadastro (igual ao original: "Crie sua conta", campos na largura toda, Enviar) -----
const ESTADOS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
P.cadastro = q => `<section class="page-body"><div class="container"><div class="cadastro">
  <h1 class="art-title">Crie sua conta</h1>
  <p class="sub-cad">Preencha todos os dados e depois acesse com seu e-mail e senha para efetivar sua pré-reserva.</p>
  <form onsubmit="event.preventDefault();cadastrar(this,'${esc(q.volta || '')}')" novalidate>
    <label>Nome completo:<input name="nome" required autocomplete="name"></label>
    <label>CPF:<input name="cpf" required inputmode="numeric" placeholder="000.000.000-00" oninput="mascaraCPF(this)"></label>
    <label>Celular:<input type="tel" name="celular" required placeholder="(61) 99999-9999" oninput="mascaraCel(this)" autocomplete="tel"></label>
    <label>E-mail:<input type="email" name="email" required autocomplete="email"></label>
    <label>Sua senha:${campoSenha('senha', 'required minlength="6" autocomplete="new-password" oninput="medirSenha(this)"')}
      <div class="forca" data-n=""><i></i><i></i><i></i><i></i><span></span></div></label>
    <label>Confirme a senha:${campoSenha('conf', 'required autocomplete="new-password"')}</label>
    <label class="estado">Estado:<select name="estado"><option value="">Selecione...</option>${ESTADOS.map(e => `<option>${e}</option>`).join('')}</select></label>
    <button class="btn">Enviar</button><div id="ret-cad"></div>
  </form>
  <p class="ja-tenho">Já tem cadastro? <a href="#/login${q.volta ? '?volta=' + encodeURIComponent(q.volta) : ''}">Entrar</a></p>
</div></div></section>`;
window.cadastrar = async (f, volta) => {
  const d = Object.fromEntries(new FormData(f));
  limparErros(f);
  const hs = db.get('hospedes'); let ok = true;
  const erro = (c, m) => { erroCampo(f, c, m); ok = false; };
  if (d.nome.trim().split(/\s+/).length < 2) erro('nome', 'Informe nome e sobrenome.');
  if (!cpfValido(d.cpf)) erro('cpf', 'CPF inválido.');
  else if (hs.some(h => h.cpf === soDig(d.cpf))) erro('cpf', 'Já existe uma conta com este CPF.');
  if (soDig(d.celular).length < 10) erro('celular', 'Celular incompleto.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) erro('email', 'E-mail inválido.');
  else if (hs.some(h => h.email.toLowerCase() === d.email.trim().toLowerCase())) erro('email', 'Já existe uma conta com este e-mail.');
  if (d.senha.length < 6) erro('senha', 'A senha precisa ter pelo menos 6 caracteres.');
  if (d.senha !== d.conf) erro('conf', 'As senhas não conferem.');
  if (!ok) { f.querySelector('.invalido input')?.focus(); return; }
  const h = db.add('hospedes', { id: uid('H'), criado: new Date().toISOString(), nome: d.nome.trim(), cpf: soDig(d.cpf), celular: d.celular, email: d.email.trim(), estado: d.estado, senha: await hash(d.senha) });
  enviarEmail(h.email, '[Guará Bangalôs] Cadastro realizado', `<p>Olá, ${esc(h.nome)}! Seu cadastro no site da Guará Bangalôs foi criado. Use seu e-mail ou CPF para entrar.</p>`);
  entrarComo({ tipo: 'hospede', id: h.id });
  location.hash = destino(volta, '#/minhas-reservas'); render();
};

// ----- Esqueceu a senha (igual ao original: texto + e-mail + Enviar; depois código e nova senha) -----
P.recuperar = q => `<section class="login-unico"><div class="adm-card login-passo"><img src="${urlMidia(CMS.marca.logoDestaque)}" alt="" class="logo-pedra"><strong class="adm-marca">Guará Bangalôs</strong><h1>Redefinir senha</h1>
  ${q.codigo === undefined ? `<p>Informe o endereço de e-mail para sua conta. Um código de verificação será enviado a você. Uma vez recebido o código, você poderá escolher uma nova senha para sua conta.</p>
  <form onsubmit="event.preventDefault();pedirCodigo(this)"><label>Endereço de e-mail <span class="star">*</span><input type="email" name="email" required></label>
    <button class="btn">Enviar</button></form>`
  : `<p>Um e-mail foi enviado para sua conta com o código de verificação. Digite o código e escolha a nova senha.</p>
  <form onsubmit="event.preventDefault();trocarSenha(this)" novalidate><input type="hidden" name="email" value="${esc(q.email || '')}">
    <label>Código de verificação <span class="star">*</span><input name="codigo" inputmode="numeric" maxlength="6" required class="codigo"></label>
    <label>Nova senha <span class="star">*</span>${campoSenha('senha', 'minlength="6" required autocomplete="new-password" oninput="medirSenha(this)"')}
      <div class="forca" data-n=""><i></i><i></i><i></i><i></i><span></span></div></label>
    <button class="btn">Enviar</button></form>`}
  <div id="ret-rec"></div><a class="voltar-site" href="#/login">← Voltar ao login</a></div></section>`;
window.pedirCodigo = f => {
  const email = f.email.value.trim().toLowerCase();
  const l = db.get('hospedes'), h = l.find(x => x.email.toLowerCase() === email);
  if (h) {
    h.reset = { codigo: String(Math.floor(100000 + Math.random() * 900000)), ate: Date.now() + 30 * 60e3 }; db.set('hospedes', l);
    enviarEmail(h.email, '[Guará Bangalôs] Código para redefinir a senha', `<p>Seu código de verificação é <b>${h.reset.codigo}</b>. Ele vale por 30 minutos.</p>`);
  }
  location.hash = '#/login?' + new URLSearchParams({ view: 'reset', codigo: '', email });
};
window.trocarSenha = async f => {
  const d = Object.fromEntries(new FormData(f));
  limparErros(f);
  if (d.senha.length < 6) return erroCampo(f, 'senha', 'A senha precisa ter pelo menos 6 caracteres.');
  const l = db.get('hospedes'), h = l.find(x => x.email.toLowerCase() === d.email);
  if (!h || !h.reset || h.reset.codigo !== d.codigo.trim() || Date.now() > h.reset.ate) return erroCampo(f, 'codigo', 'Código inválido ou expirado.');
  h.senha = await hash(d.senha); delete h.reset; db.set('hospedes', l); localStorage.removeItem('tg_bloqueio');
  enviarEmail(h.email, '[Guará Bangalôs] Sua senha foi alterada', `<p>A senha da sua conta foi alterada. Se não foi você, fale conosco pelo WhatsApp ${CMS.contato.telefone}.</p>`);
  $('#ret-rec').innerHTML = '<p class="aviso">Senha alterada. <a href="#/login">Entrar agora</a></p>';
};

// ----- Meus dados (melhoria) -----
P['meus-dados'] = () => {
  const h = hospedeAtual(); if (!h) return irParaLogin();
  return banda('Meus dados') + `<section class="page-body"><div class="container"><div class="cadastro">
  <div class="ola"><a href="#/minhas-reservas">← Minhas reservas</a><button class="btn btn-sm btn-sec" onclick="sair()">Sair</button></div>
  <form onsubmit="event.preventDefault();salvarDados(this)" novalidate>
    <label>Nome completo:<input name="nome" value="${esc(h.nome)}" required></label>
    <label>CPF:<input value="${fmtCPF(h.cpf)}" disabled></label>
    <label>Celular:<input type="tel" name="celular" value="${esc(h.celular)}" oninput="mascaraCel(this)" required></label>
    <label>E-mail:<input type="email" name="email" value="${esc(h.email)}" required></label>
    <label class="estado">Estado:<select name="estado"><option value="">Selecione...</option>${ESTADOS.map(e => `<option ${e === h.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
    <button class="btn">Salvar</button><div id="ret-dados"></div></form>
  <hr><h3 style="font-size:20px">Alterar senha</h3>
  <form onsubmit="event.preventDefault();alterarSenha(this)" novalidate>
    <label>Senha atual:${campoSenha('atual', 'required autocomplete="current-password"')}</label>
    <label>Nova senha:${campoSenha('senha', 'required minlength="6" autocomplete="new-password" oninput="medirSenha(this)"')}<div class="forca" data-n=""><i></i><i></i><i></i><i></i><span></span></div></label>
    <label>Confirme a nova senha:${campoSenha('conf', 'required autocomplete="new-password"')}</label>
    <button class="btn">Alterar senha</button><div id="ret-senha"></div></form>
</div></div></section>`;
};
window.salvarDados = f => {
  const d = Object.fromEntries(new FormData(f)); limparErros(f);
  const l = db.get('hospedes'), h = l.find(x => x.id === sessao().id);
  if (d.nome.trim().split(/\s+/).length < 2) return erroCampo(f, 'nome', 'Informe nome e sobrenome.');
  if (soDig(d.celular).length < 10) return erroCampo(f, 'celular', 'Celular incompleto.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return erroCampo(f, 'email', 'E-mail inválido.');
  if (l.some(x => x.id !== h.id && x.email.toLowerCase() === d.email.trim().toLowerCase())) return erroCampo(f, 'email', 'Este e-mail já é usado por outra conta.');
  const antigo = h.email;
  Object.assign(h, { nome: d.nome.trim(), celular: d.celular, email: d.email.trim(), estado: d.estado }); db.set('hospedes', l);
  if (antigo !== h.email) enviarEmail(antigo, '[Guará Bangalôs] E-mail da conta alterado', `<p>O e-mail da sua conta foi alterado para ${esc(h.email)}. Se não foi você, fale conosco.</p>`);
  $('#ret-dados').innerHTML = '<p class="aviso">Dados salvos.</p>';
};
window.alterarSenha = async f => {
  const d = Object.fromEntries(new FormData(f)); limparErros(f);
  const l = db.get('hospedes'), h = l.find(x => x.id === sessao().id);
  if (h.senha !== await hash(d.atual)) return erroCampo(f, 'atual', 'Senha atual incorreta.');
  if (d.senha.length < 6) return erroCampo(f, 'senha', 'A senha precisa ter pelo menos 6 caracteres.');
  if (d.senha !== d.conf) return erroCampo(f, 'conf', 'As senhas não conferem.');
  h.senha = await hash(d.senha); db.set('hospedes', l); f.reset(); f.querySelector('.forca').dataset.n = '';
  enviarEmail(h.email, '[Guará Bangalôs] Sua senha foi alterada', `<p>A senha da sua conta foi alterada. Se não foi você, fale conosco pelo WhatsApp ${CMS.contato.telefone}.</p>`);
  $('#ret-senha').innerHTML = '<p class="aviso">Senha alterada.</p>';
};

// ---------- Minhas reservas ----------
P['minhas-reservas'] = () => {
  const h = hospedeAtual(); if (!h) return irParaLogin();
  const rs = db.get('reservas').filter(r => r.hospede === h.id).sort((a, b) => b.entrada.localeCompare(a.entrada));
  return banda('Minhas reservas') + `<section class="page-body"><div class="container">
    <div class="ola"><span>Olá, <b>${esc(h.nome)}</b> · ${esc(h.email)}</span><span><a class="btn btn-sm" href="#/meus-dados"><i class="far fa-user"></i> Meus dados</a> <button class="btn btn-sm btn-sec" onclick="sair()">Sair</button></span></div>
    ${rs.length ? `<table><tr><th>Código</th><th>Unidade</th><th>Período</th><th>Total</th><th>Situação</th><th></th></tr>
    ${rs.map(r => `<tr><td>${r.id}</td><td>${unidade(r.unidade).nome}</td><td>${dBR(r.entrada)} – ${dBR(r.saida)}</td><td>${fmt(r.total)}</td><td>${selo(r.status)}</td>
      <td class="acoes"><a class="btn btn-sm" href="#/confirmacao/${r.id}">${r.status === 'aguardando' ? 'Pagar' : 'Ver'}</a>
      ${r.status !== 'cancelada' ? `<button class="btn btn-sm btn-sec" onclick="cancelarMinha('${r.id}')">Cancelar</button>` : ''}</td></tr>`).join('')}</table>`
    : '<p>Você ainda não tem reservas. <a href="#/reservas">Fazer uma reserva</a></p>'}
  </div></section>`;
};
window.cancelarMinha = id => {
  const l = db.get('reservas'), r = l.find(x => x.id === id);
  const dias = Math.round((new Date(r.entrada + 'T12:00') - new Date()) / 864e5);
  if (dias < 15 && r.status !== 'aguardando') return alert(`Faltam ${dias} dia(s) para o check-in. Pela política, o cancelamento precisa de 15 dias de antecedência — fale conosco pelo WhatsApp.`);
  if (!confirm('Cancelar esta reserva?')) return;
  r.status = 'cancelada'; db.set('reservas', l);
  enviarEmail(r.email, `[Guará Bangalôs] Reserva ${r.id} cancelada`, `<p>Sua reserva foi cancelada:</p><p>${linhaReserva(r)}</p><p>Se já pagou o sinal, você pode deixar o valor como crédito, remarcar ou pedir devolução pelo WhatsApp.</p>`);
  enviarEmail(POUSADA_EMAIL, `[Site] Reserva ${r.id} cancelada pelo hóspede`, `<p>${linhaReserva(r)}</p>`);
  render();
};
// cancelamento pelo formulário da página de política (código + e-mail)
window.cancelar = f => {
  const { id, email } = Object.fromEntries(new FormData(f));
  const l = db.get('reservas'), r = l.find(x => x.id === id.trim().toUpperCase() && x.email.toLowerCase() === email.trim().toLowerCase());
  const out = $('#ret-cancel');
  if (!r) return out.innerHTML = '<p class="aviso erro">Reserva não encontrada.</p>';
  if (r.status === 'cancelada') return out.innerHTML = '<p class="aviso">Essa reserva já está cancelada.</p>';
  const dias = Math.round((new Date(r.entrada + 'T12:00') - new Date()) / 864e5);
  if (dias < 15 && r.status !== 'aguardando') return out.innerHTML = `<p class="aviso erro">Faltam ${dias} dia(s) para o check-in. Pela política, o cancelamento precisa de 15 dias de antecedência — fale conosco pelo WhatsApp.</p>`;
  r.status = 'cancelada'; db.set('reservas', l);
  enviarEmail(r.email, `[Guará Bangalôs] Reserva ${r.id} cancelada`, `<p>Sua reserva foi cancelada:</p><p>${linhaReserva(r)}</p>`);
  out.innerHTML = '<p class="aviso">Reserva cancelada. Você pode ficar com crédito, remarcar ou pedir devolução pelo WhatsApp.</p>';
};

// ---------- Gestão (pousada) ----------
window.confirmarPagamento = id => {
  const l = db.get('reservas'), r = l.find(x => x.id === id);
  r.status = 'confirmada'; r.confirmada = new Date().toISOString(); db.set('reservas', l);
  enviarEmail(r.email, `[Guará Bangalôs] Reserva ${r.id} confirmada!`, `<p>Olá, ${esc(r.nome)}! Recebemos o pagamento do sinal e sua reserva está <b>confirmada</b>:</p><p>${linhaReserva(r)}</p>
    <p>Restante a pagar no check-in: <b>${fmt(r.total - (r.sinal || r.total / 2))}</b>. Check-in a partir das 15h. O Guará Bangalôs fica na região do Vale da Lua, em Alto Paraíso de Goiás (GO).</p>`);
  render();
};
window.cancelarGestao = id => {
  if (!confirm('Cancelar esta reserva?')) return;
  const l = db.get('reservas'), r = l.find(x => x.id === id);
  r.status = 'cancelada'; db.set('reservas', l);
  enviarEmail(r.email, `[Guará Bangalôs] Reserva ${r.id} cancelada`, `<p>Sua reserva foi cancelada pela pousada:</p><p>${linhaReserva(r)}</p><p>Em caso de dúvida, fale conosco pelo WhatsApp ${CMS.contato.telefone}.</p>`);
  render();
};

// ---------- janela "Email" dos artigos (enviar link a um amigo) ----------
window.abrirEmail = titulo => {
  const m = document.createElement('div'); m.className = 'modal-fundo';
  m.innerHTML = `<div class="modal"><button class="fechar-modal" aria-label="Fechar">×</button>
    <h3>Enviar este link por e-mail</h3>
    <form><label>E-mail para <span class="star">*</span><input type="email" name="para" required></label>
      <label>Remetente <span class="star">*</span><input name="nome" required></label>
      <label>Seu e-mail <span class="star">*</span><input type="email" name="de" required></label>
      <label>Assunto <span class="star">*</span><input name="assunto" required value="${esc(titulo)}"></label>
      <div><button class="btn">Enviar</button> <button type="button" class="btn btn-sec cancelar">Cancelar</button></div></form></div>`;
  const fechar = () => m.remove();
  m.addEventListener('click', e => { if (e.target === m || e.target.matches('.fechar-modal,.cancelar')) fechar(); });
  m.querySelector('form').addEventListener('submit', e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    enviarEmail(d.para, d.assunto, `<p>Este é um link enviado por ${esc(d.nome)} (${esc(d.de)}):</p><p><a href="${esc(location.href)}">${esc(location.href)}</a></p>`);
    m.querySelector('.modal').innerHTML = '<h3>O link foi enviado com sucesso.</h3><button class="btn" onclick="this.closest(\'.modal-fundo\').remove()">Fechar janela</button>';
  });
  document.body.appendChild(m); m.querySelector('input').focus();
};

// ---------- menu conforme quem está logado ----------
function atualizarMenu() {
  const s = sessao(), link = $('#link-login');
  $('#menu .extra')?.remove();
  if (s?.tipo === 'admin') { link.textContent = 'Gestão'; link.href = '#/gestao'; }
  else if (s?.tipo === 'hospede') { link.textContent = 'Minhas reservas'; link.href = '#/minhas-reservas'; }
  else { link.textContent = 'Entrar'; link.href = '#/login'; }
  if (s) link.insertAdjacentHTML('afterend', '<a href="#" class="extra" onclick="event.preventDefault();sair()">Sair</a>');
  $('#offcanvas .oc-menu').innerHTML = $('#menu').innerHTML.replace('id="link-login"', '');
}
window.atualizarMenu = atualizarMenu;
// a primeira renderização acontece no fim de admin.js
