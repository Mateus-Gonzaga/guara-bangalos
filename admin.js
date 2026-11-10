// Área da pousada: login e painel isolados do site (sem cabeçalho, menus e rodapé do site).
// Rotas: #/gestao (o login é o mesmo dos hóspedes, em #/login)?aba=painel|reservas|calendario|hospedes|emails

const ehRotaAdmin = () => /^#\/gestao/.test(location.hash);
// a tela de login também fica em tela cheia (só o cartão sobre a foto)
const ehRotaLogin = () => /^#\/(login|admin)(\?|$)/.test(location.hash);

// ---------- login: o mesmo de hóspedes (#/login); #/admin é só um atalho ----------
P.admin = () => { location.hash = ehAdmin() ? '#/gestao' : '#/login?volta=' + encodeURIComponent('#/gestao'); return ''; };

// ---------- painel ----------
const ABAS = [
  ['painel', 'fa-chart-line', 'Painel'], ['reservas', 'fa-calendar-check', 'Reservas'], ['calendario', 'fa-th', 'Ocupação'],
  ['hospedes', 'fa-users', 'Hóspedes'], ['emails', 'fa-envelope', 'E-mails'],
];
P.gestao = q => {
  if (!ehAdmin()) { location.hash = '#/login?volta=' + encodeURIComponent('#/gestao'); return ''; }
  const aba = ABAS.some(a => a[0] === q.aba) ? q.aba : 'painel';
  const rs = db.get('reservas'), pend = rs.filter(r => r.status === 'comprovante').length;
  const titulo = ABAS.find(a => a[0] === aba)[2];
  return `<div class="adm">
    <aside class="adm-side">
      <a class="adm-logo" href="#/gestao"><img src="img/logo-guara-pedra.jpg" alt="Guará Bangalôs" class="logo-pedra"><strong class="adm-marca">${esc(CMS.marca.nome)}</strong><span>Gestão</span></a>
      <nav>${ABAS.map(([k, ic, t]) => `<a href="#/gestao?aba=${k}" class="${k === aba ? 'on' : ''}"><i class="fa ${ic}"></i> ${t}${k === 'reservas' && pend ? `<span class="badge">${pend}</span>` : ''}</a>`).join('')}</nav>
      <div class="adm-side-pe"><a href="#/" target="_blank"><i class="fa fa-external-link-alt"></i> Ver site</a><a href="#" onclick="event.preventDefault();sair()"><i class="fa fa-sign-out-alt"></i> Sair</a></div>
    </aside>
    <main class="adm-main">
      <header class="adm-top"><button class="adm-menu" onclick="document.body.classList.toggle('adm-aberto')" aria-label="Menu"><i class="fa fa-bars"></i></button>
        <h1>${titulo}</h1><span class="adm-user"><i class="far fa-user-circle"></i> Administração</span></header>
      <div class="adm-conteudo">${ADM[aba](q, rs)}</div>
    </main></div>`;
};

const ADM = {};
const hojeISO = () => hoje();
const noPeriodo = (r, d) => r.entrada <= d && r.saida > d;

ADM.painel = (q, rs) => {
  const d = hojeISO(), ativas = rs.filter(r => r.status !== 'cancelada');
  const dataLonga = new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const nome = u => (unidade(u) || { nome: 'Unidade removida' }).nome;
  const chegHoje = ativas.filter(r => r.entrada === d), saiHoje = ativas.filter(r => r.saida === d);
  const ocupHoje = UN.filter(u => ativas.some(r => r.unidade === u.id && noPeriodo(r, d))).length;

  // o que precisa de ação
  const comprov = rs.filter(r => r.status === 'comprovante');
  const paradas = rs.filter(r => r.status === 'aguardando' && (Date.now() - new Date(r.criada)) / 864e5 >= 2);
  const atencao = [
    ...comprov.map(r => `<li><span class="at-ic azul"><i class="fa fa-paperclip"></i></span><div><b>${esc(r.nome)}</b> enviou o comprovante<small>${nome(r.unidade)}, ${dBR(r.entrada)} a ${dBR(r.saida)}, sinal ${fmt(r.sinal || r.total / 2)}</small></div>
      <button class="btn btn-sm" onclick="confirmarPagamento('${r.id}')">Confirmar pagamento</button></li>`),
    ...paradas.map(r => `<li><span class="at-ic amarelo"><i class="fa fa-hourglass-half"></i></span><div><b>${esc(r.nome)}</b> ainda não pagou o sinal<small>Pré-reserva de ${new Date(r.criada).toLocaleDateString('pt-BR')}, ${nome(r.unidade)}, ${dBR(r.entrada)}</small></div>
      <a class="btn btn-sm btn-claro" target="_blank" href="https://wa.me/55${soDig(r.telefone)}">Chamar no WhatsApp</a></li>`),
  ];

  // ocupação dos próximos 14 dias
  const dias = Array.from({ length: 14 }, (_, i) => somaDia(d, i));
  const mapa = `<div class="pn-ocup"><div class="pn-ocup-lin cab"><span></span>${dias.map(x => { const t = new Date(x + 'T12:00'); return `<span class="${[0, 6].includes(t.getDay()) ? 'fds' : ''}">${'DSTQQSS'[t.getDay()]}<b>${t.getDate()}</b></span>`; }).join('')}</div>
    ${UN.map(u => `<div class="pn-ocup-lin"><span class="un">${esc(u.nome.replace(' (duas suítes)', ''))}</span>${dias.map(x => { const r = ativas.find(y => y.unidade === u.id && noPeriodo(y, x)); return `<span class="cel ${r ? 'st-' + r.status : 'livre'}" title="${r ? esc(r.nome) + ' · ' + STATUS[r.status] : 'Livre'}"></span>`; }).join('')}</div>`).join('')}</div>`;
  const noitesLivres = UN.length * 14 - UN.reduce((s, u) => s + dias.filter(x => ativas.some(r => r.unidade === u.id && noPeriodo(r, x))).length, 0);

  // financeiro do mês
  const mes = d.slice(0, 7), nomeMes = new Date(d + 'T12:00').toLocaleDateString('pt-BR', { month: 'long' });
  const confMes = rs.filter(r => r.status === 'confirmada' && r.entrada.slice(0, 7) === mes);
  const receitaMes = confMes.reduce((s, r) => s + r.total, 0);
  const aReceber = rs.filter(r => r.status === 'confirmada' && r.saida >= d).reduce((s, r) => s + (r.total - (r.sinal || r.total / 2)), 0);
  const pendente = rs.filter(r => ['aguardando', 'comprovante'].includes(r.status)).reduce((s, r) => s + (r.sinal || r.total / 2), 0);
  const diasMes = new Date(+mes.slice(0, 4), +mes.slice(5), 0).getDate();
  const noitesMes = UN.reduce((s, u) => s + Array.from({ length: diasMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`).filter(x => ativas.some(r => r.unidade === u.id && noPeriodo(r, x))).length, 0);
  const ocupMes = UN.length ? Math.round(100 * noitesMes / (UN.length * diasMes)) : 0;

  const chegadas = ativas.filter(r => r.entrada >= d && r.entrada <= somaDia(d, 14)).sort((a, b) => a.entrada.localeCompare(b.entrada));
  const linkReservas = location.origin + location.pathname + '#/reservas';

  return `<div class="pn">
    <header class="pn-topo"><div><p class="pn-data">${dataLonga.charAt(0).toUpperCase() + dataLonga.slice(1)}</p><h2>Resumo do dia</h2></div>
      <nav class="pn-atalhos"><a class="btn btn-claro" href="#/gestao?aba=reservas"><i class="fa fa-calendar-check"></i> Reservas</a><a class="btn btn-claro" href="#/gestao?aba=site&sec=precos"><i class="fa fa-tags"></i> Preços</a><a class="btn btn-claro" href="#/gestao?aba=site"><i class="fa fa-pen-nib"></i> Editar site</a></nav></header>

    <section class="pn-hoje" aria-label="Hoje">
      <div><span>Chegadas hoje</span><b>${chegHoje.length}</b><small>${chegHoje.map(r => esc(r.nome.split(' ')[0]) + ' · ' + nome(r.unidade)).join(', ') || 'Ninguém chega hoje'}</small></div>
      <div><span>Saídas hoje</span><b>${saiHoje.length}</b><small>${saiHoje.map(r => esc(r.nome.split(' ')[0]) + ' · ' + nome(r.unidade)).join(', ') || 'Ninguém sai hoje'}</small></div>
      <div><span>Ocupadas hoje</span><b>${ocupHoje}<em>/${UN.length}</em></b><small>${UN.length - ocupHoje} unidade(s) livre(s)</small></div>
      <div><span>Ocupação em ${nomeMes}</span><b>${ocupMes}<em>%</em></b><div class="pn-barra" role="img" aria-label="${ocupMes}% ocupado"><i style="width:${ocupMes}%"></i></div></div>
    </section>

    <div class="pn-grade">
      <section class="adm-box pn-atencao"><h2>Precisa da sua atenção ${atencao.length ? `<span class="badge">${atencao.length}</span>` : ''}</h2>
        ${atencao.length ? `<ul>${atencao.join('')}</ul>` : `<div class="pn-vazio"><i class="fa fa-check-circle"></i><p>Tudo em dia. Comprovantes novos e pré-reservas sem pagamento aparecem aqui.</p></div>`}</section>
      <section class="adm-box pn-fin"><h2>Financeiro</h2>
        <div class="pn-num"><span>Confirmado em ${nomeMes}</span><b>${fmt(receitaMes)}</b><small>${confMes.length} reserva(s)</small></div>
        <div class="pn-num"><span>A receber nos check-ins</span><b>${fmt(aReceber)}</b></div>
        <div class="pn-num"><span>Sinais ainda não pagos</span><b>${fmt(pendente)}</b></div></section>
    </div>

    <section class="adm-box"><div class="pn-tit"><h2>Ocupação nos próximos 14 dias</h2><span class="peq">${noitesLivres} noite(s) livre(s) no total</span><a href="#/gestao?aba=calendario">Ver mapa completo</a></div>
      ${mapa}<p class="pn-leg"><span class="livre"></span>Livre<span class="st-aguardando"></span>Aguardando pagamento<span class="st-comprovante"></span>Comprovante enviado<span class="st-confirmada"></span>Confirmada</p></section>

    <section class="adm-box"><div class="pn-tit"><h2>Próximas chegadas</h2><a href="#/gestao?aba=reservas">Todas as reservas</a></div>
      ${chegadas.length ? `<ul class="pn-cheg">${chegadas.map(r => { const t = new Date(r.entrada + 'T12:00'); return `<li><time><b>${t.getDate()}</b>${t.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</time><div><b>${esc(r.nome)}</b><small>${nome(r.unidade)}, ${noites(r.entrada, r.saida).length} noite(s), ${r.adultos + (r.criancas || 0)} hóspede(s)${r.chegada ? `, chega por volta das ${esc(r.chegada)}` : ''}</small></div>${selo(r.status)}<a class="pn-wpp" target="_blank" href="https://wa.me/55${soDig(r.telefone)}" aria-label="WhatsApp de ${esc(r.nome)}"><i class="fab fa-whatsapp"></i></a></li>`; }).join('')}</ul>`
        : `<div class="pn-vazio"><i class="far fa-calendar"></i><p>Nenhuma chegada nas próximas duas semanas. Divulgue o link de reservas:</p><button class="btn btn-sm btn-claro" onclick="navigator.clipboard.writeText('${linkReservas}');toast('Link copiado')"><i class="far fa-copy"></i> Copiar link de reservas</button></div>`}</section>
  </div>`;
};

ADM.reservas = (q, rs) => {
  const filtro = q.status || '', busca = (q.busca || '').toLowerCase();
  const lista = rs.filter(r => (!filtro || r.status === filtro) && (!busca || [r.id, r.nome, r.email, r.telefone].join(' ').toLowerCase().includes(busca)))
    .sort((a, b) => a.entrada.localeCompare(b.entrada));
  return `<div class="adm-barra">
      <div class="filtros">${['', ...Object.keys(STATUS)].map(s => `<a class="${filtro === s ? 'on' : ''}" href="#/gestao?aba=reservas&status=${s}">${s ? STATUS[s] : 'Todas'} (${s ? rs.filter(r => r.status === s).length : rs.length})</a>`).join('')}</div>
      <form onsubmit="event.preventDefault();location.hash='#/gestao?aba=reservas&status=${filtro}&busca='+encodeURIComponent(this.b.value)"><input name="b" placeholder="Buscar por código, nome, e-mail..." value="${esc(q.busca || '')}"></form>
    </div>
    <div class="adm-box">${lista.length ? `<table><tr><th>Código</th><th>Unidade</th><th>Período</th><th>Hóspede</th><th>Total</th><th>Situação</th><th></th></tr>
    ${lista.map(r => `<tr><td>${r.id}<br><small>${new Date(r.criada).toLocaleDateString('pt-BR')}</small></td><td>${unidade(r.unidade).nome}</td><td>${dBR(r.entrada)} – ${dBR(r.saida)}<br><small>${noites(r.entrada, r.saida).length} noite(s) · chegada ${esc(r.chegada || '—')}</small></td>
      <td>${esc(r.nome)}<br><small>${esc(r.telefone)} · ${esc(r.email)}</small>${r.obs ? `<br><small><i>${esc(r.obs)}</i></small>` : ''}</td>
      <td>${fmt(r.total)}<br><small>sinal ${fmt(r.sinal || r.total / 2)}</small></td><td>${selo(r.status)}${r.comprovante ? `<br><small>📎 ${esc(r.comprovante.nome)}</small>` : ''}</td>
      <td class="acoes">${['aguardando', 'comprovante'].includes(r.status) ? `<button class="btn btn-sm" onclick="confirmarPagamento('${r.id}')">Confirmar pagamento</button><br>` : ''}
      <a class="btn btn-sm btn-sec" target="_blank" href="https://wa.me/55${soDig(r.telefone)}">WhatsApp</a>
      ${r.status !== 'cancelada' ? `<button class="btn btn-sm btn-sec" onclick="cancelarGestao('${r.id}')">Cancelar</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="peq">Nenhuma reserva encontrada.</p>'}</div>`;
};

ADM.calendario = (q, rs) => {
  const ini = q.de && q.de >= '2000' ? q.de : hojeISO(), dias = 30;
  const ds = Array.from({ length: dias }, (_, i) => somaDia(ini, i));
  const ativas = rs.filter(r => r.status !== 'cancelada');
  return `<div class="adm-barra"><div class="filtros">
      <a href="#/gestao?aba=calendario&de=${somaDia(ini, -30)}">← 30 dias</a><a href="#/gestao?aba=calendario">Hoje</a><a href="#/gestao?aba=calendario&de=${somaDia(ini, 30)}">30 dias →</a></div>
      <p class="legenda"><span class="st-aguardando"></span>Aguardando<span class="st-comprovante"></span>Comprovante<span class="st-confirmada"></span>Confirmada</p></div>
    <div class="adm-box ocup-wrap"><table class="ocup"><tr><th></th>${ds.map(d => { const dt = new Date(d + 'T12:00'); return `<th class="${[0, 6].includes(dt.getDay()) ? 'fds' : ''}">${dt.getDate()}<br><small>${'DSTQQSS'[dt.getDay()]}</small></th>`; }).join('')}</tr>
    ${UN.map(u => `<tr><th>${u.nome.replace(' (duas suítes)', '')}</th>${ds.map(d => { const r = ativas.find(x => x.unidade === u.id && noPeriodo(x, d));
      return r ? `<td class="st-${r.status}" title="${esc(r.nome)} · ${r.id}" onclick="location.hash='#/gestao?aba=reservas&busca=${r.id}'">${r.entrada === d ? esc(r.nome.split(' ')[0]) : ''}</td>` : '<td></td>'; }).join('')}</tr>`).join('')}
    </table></div>`;
};

ADM.hospedes = (q, rs) => {
  const hs = db.get('hospedes');
  return `<div class="adm-box">${hs.length ? `<table><tr><th>Nome</th><th>CPF</th><th>Celular</th><th>E-mail</th><th>Estado</th><th>Cadastro</th><th>Reservas</th></tr>
    ${hs.map(h => `<tr><td>${esc(h.nome)}</td><td>${fmtCPF(h.cpf)}</td><td>${esc(h.celular)}</td><td>${esc(h.email)}</td><td>${esc(h.estado || '—')}</td><td>${new Date(h.criado).toLocaleDateString('pt-BR')}</td>
      <td><a href="#/gestao?aba=reservas&busca=${encodeURIComponent(h.email)}">${rs.filter(r => r.hospede === h.id).length}</a></td></tr>`).join('')}</table>` : '<p class="peq">Nenhum hóspede cadastrado.</p>'}</div>`;
};

ADM.emails = q => {
  const ms = db.get('emails').slice().reverse(), sel = ms.find(m => m.id === q.m) || ms[0];
  return ms.length ? `<p class="peq">E-mails que o site teria enviado. Neste site de demonstração nada sai de verdade.</p><div class="caixa adm-box">
      <ul>${ms.map(m => `<li class="${m.id === sel.id ? 'on' : ''}" onclick="location.hash='#/gestao?aba=emails&m=${m.id}'"><b>${esc(m.assunto)}</b><br><small>${esc(m.para)} · ${new Date(m.data).toLocaleString('pt-BR')}</small></li>`).join('')}</ul>
      <div class="msg"><p class="peq">Para: ${esc(sel.para)}<br>De: Guará Bangalôs &lt;${POUSADA_EMAIL}&gt;<br>${new Date(sel.data).toLocaleString('pt-BR')}</p><h3>${esc(sel.assunto)}</h3><div>${sel.corpo}</div></div></div>`
    : '<div class="adm-box"><p class="peq">Nenhum e-mail enviado ainda.</p></div>';
};

// ---------- liga/desliga o "modo admin" (esconde o site) ----------
const atualizarMenuSite = atualizarMenu;
window.atualizarMenu = atualizarMenu = function () {
  document.body.classList.toggle('modo-admin', ehRotaAdmin() || ehRotaLogin());
  document.body.classList.remove('adm-aberto');
  document.title = ehRotaAdmin() ? 'Gestão — Guará Bangalôs' : 'Guará Bangalôs — Hospedagem Ecolodge';
  atualizarMenuSite();
  // no site, a pousada logada vê "Gestão" no menu; hóspede/visitante seguem como antes
};
// primeira renderização: espera as fotos enviadas carregarem
addEventListener('DOMContentLoaded', () => cmsPronto.then(() => { montarUnidades(); render(); }));
