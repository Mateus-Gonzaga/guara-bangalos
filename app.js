// Site do Guará Bangalôs. Reservas, contas e mensagens ficam no servidor (api/api.py); o navegador guarda uma cópia em memória.
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const fmt = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dBR = iso => iso.split('-').reverse().join('/');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- dados do servidor (cópia em memória) ----------
// reservas: datas ocupadas (sem dados pessoais) + as reservas completas de quem está logado
// hospede: o hóspede logado · hospedes, emails, contatos: só para a Gestão
const db = { _d: {}, get: k => db._d[k] || [], set: (k, v) => { db._d[k] = v; } };
async function carregarDados() {
  const s = JSON.parse(sessionStorage.getItem('tg_sessao') || localStorage.getItem('tg_sessao') || 'null');
  try {
    if (s?.tipo === 'admin') {
      const d = await api('/api/admin/dados');
      db._d = { reservas: d.reservas, hospedes: d.hospedes, emails: d.emails, contatos: d.contatos, auditoria: d.auditoria };
      return;
    }
    const [ocup, eu] = await Promise.all([api('/api/ocupacao'), s?.tipo === 'hospede' ? api('/api/eu').catch(() => null) : null]);
    db._d = { reservas: [...ocup.map(r => ({ ...r, status: 'ocupada' })), ...(eu ? eu.reservas : [])], hospede: eu ? eu.hospede : null };
  } catch (e) {
    console.warn('Sem dados do servidor:', e.message);
    if (e.status === 401) return carregarDados();
  }
}
const dadosProntos = cmsPronto.then(carregarDados);
// recarrega e redesenha (depois de uma ação ou ao navegar logado)
async function atualizar() { await carregarDados(); render(); }

// ---------- unidades ----------
let UN = [];
// monta as unidades a partir do conteúdo editável (fotos já com o endereço certo)
function montarUnidades() {
  UN = CMS.unidades.map(u => ({ ...u, id: +u.id, capacidade: +u.capacidade, inclusos: +u.inclusos, ajuste: +u.ajuste, fotos: (u.fotos || []).map(urlMidia).filter(Boolean) }));
}
montarUnidades();
const unidade = id => UN.find(u => u.id === +id);

// ---------- preços (os que o motor de reservas do site mostra hoje) ----------
// casal: semana 550 · sexta a domingo 680 · feriados e natal 750 · réveillon 900
// +80 por pessoa extra (criança ou adulto). Bebês não pagam.
// Casa Guará: preço ajustado por unidade em Gestão > Editar site > Chalés.
function diaria(data, u) {
  const P$ = CMS.precos, md = data.slice(5), dow = new Date(data + 'T12:00').getDay();
  let v = +P$.semana, tipo = 'Semana';
  if ((P$.diasFds || []).map(Number).includes(dow)) { v = +P$.fds; tipo = 'Fim de semana'; }
  if ((CMS.feriadosFixos || []).includes(md) || (CMS.feriados || []).some(([a, b]) => data >= a && data <= b)) { v = +P$.feriado; tipo = 'Feriado'; }
  if (md === '12-30' || md === '12-31') { v = +P$.reveillon; tipo = 'Réveillon'; }
  return { v: Math.round(v * (u ? +u.ajuste || 100 : 100) / 100), tipo };
}
function noites(ent, sai) {
  const r = [];
  for (let d = new Date(ent + 'T12:00'); d < new Date(sai + 'T12:00'); d.setDate(d.getDate() + 1)) r.push(d.toISOString().slice(0, 10));
  return r;
}
function orcamento(u, ent, sai, adultos, criancas) {
  const ns = noites(ent, sai);
  const base = +u.inclusos || 2;
  const extras = Math.max(0, +adultos + +criancas - base);
  const linhas = ns.map(d => { const x = diaria(d, u); return { d, ...x, extra: extras * +CMS.precos.extra }; });
  const total = linhas.reduce((s, l) => s + l.v + l.extra, 0);
  return { ns, linhas, extras, total, sinal: Math.round(total * (+CMS.precos.sinal || 50)) / 100 };
}
function ocupado(uid, ent, sai, ignorar) {
  return db.get('reservas').some(r => r.status !== 'cancelada' && r.unidade === uid && r.id !== ignorar && r.entrada < sai && r.saida > ent);
}
function diaOcupado(uid, d) {
  return db.get('reservas').some(r => r.status !== 'cancelada' && r.unidade === uid && r.entrada <= d && r.saida > d);
}

// ---------- componentes ----------
const hoje = () => new Date().toISOString().slice(0, 10);
const amanha = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
window.buscar = f => {
  const p = new URLSearchParams(new FormData(f));
  if (p.get('saida') <= p.get('entrada')) return alert('A saída precisa ser depois da entrada.');
  location.hash = '#/reservas?' + p;
};
// visualizador estilo Magnific Popup: setas, teclado e contador
let lbLista = [], lbI = 0;
const ehVideo = f => /\.(mp4|webm|mov)$/i.test(f);
const lbMostrar = () => {
  const lb = $('#lightbox'), f = lbLista[lbI], v = ehVideo(f);
  let vid = lb.querySelector('video');
  if (v) { if (!vid) { vid = document.createElement('video'); vid.controls = true; vid.playsInline = true; lb.insertBefore(vid, lb.firstChild); } vid.src = f; vid.play().catch(() => {}); }
  else if (vid) { vid.pause(); vid.remove(); }
  lb.querySelector('img').style.display = v ? 'none' : '';
  if (!v) lb.querySelector('img').src = f;
  lb.querySelector('.cont').textContent = `${lbI + 1} de ${lbLista.length}`;
};
window.zoom = (src, el) => {
  const grupo = el && el.closest('.galeria');
  const full = i => i.dataset.full ? new URL(i.dataset.full, location.href).href : i.src;
  lbLista = grupo ? [...grupo.querySelectorAll('img')].map(full) : [src];
  lbI = Math.max(0, lbLista.indexOf(el ? full(el) : src)); lbMostrar();
  $('#lightbox').classList.add('on');
};
const lbPasso = n => { lbI = (lbI + n + lbLista.length) % lbLista.length; lbMostrar(); };
$('#lightbox').addEventListener('click', e => {
  if (e.target.matches('.ant')) lbPasso(-1); else if (e.target.matches('.prox')) lbPasso(1);
  else if (!['IMG', 'VIDEO'].includes(e.target.tagName)) { $('#lightbox').classList.remove('on'); $('#lightbox video')?.pause(); }
});
addEventListener('keydown', e => {
  if (!$('#lightbox').classList.contains('on')) return;
  if (e.key === 'ArrowLeft') lbPasso(-1); if (e.key === 'ArrowRight') lbPasso(1); if (e.key === 'Escape') { $('#lightbox').classList.remove('on'); $('#lightbox video')?.pause(); }
});

// ---------- páginas ----------
const P = {};

P[''] = () => `
  <section class="hero2" style="background-image:linear-gradient(180deg, rgba(31,24,19,.15) 0%, rgba(31,24,19,.05) 40%, rgba(31,24,19,.78) 100%), url('${urlMidia(CMS.home.heroFoto)}')">
    <img class="hero2-lobo" src="${urlMidia(CMS.marca.logo)}" alt="" aria-hidden="true">
    <div class="container hero2-texto">
      <h1>${esc(CMS.home.titulo)}</h1>
      <p>${esc(CMS.home.subtitulo)}</p>
    </div>
    <div class="container hero2-barra">
      <form class="busca2" onsubmit="event.preventDefault();buscar(this)" aria-label="Consultar disponibilidade">
        <label class="campo2"><span>Entrada</span><input type="date" name="entrada" min="${hoje()}" value="${hoje()}" required></label>
        <label class="campo2"><span>Saída</span><input type="date" name="saida" min="${amanha()}" value="${somaDia(hoje(), 2)}" required></label>
        <label class="campo2 num"><span>Adultos</span><input type="number" name="adultos" min="1" max="8" value="2"></label>
        <label class="campo2 num"><span>Crianças <small>1 a 12 anos</small></span><input type="number" name="criancas" min="0" max="6" value="0"></label>
        <label class="campo2 num"><span>Bebês <small>até 12 meses</small></span><input type="number" name="bebe" min="0" max="3" value="0"></label>
        <button class="btn busca2-btn">Ver disponibilidade</button>
      </form>
    </div>
  </section>
  <section class="sec chales wow"><div class="container row2">
    <img src="${urlMidia(CMS.home.chalesFoto)}" alt="">
    <div><h3 class="addon-title">${esc(CMS.home.chalesTitulo)}</h3>
      ${paragrafos(CMS.home.chalesTexto)}
      <a class="sppb-btn sppb-btn-primary" href="#/acomodacoes">Saiba mais</a></div>
  </div></section>
  <section class="features wow"><div class="container">
    <h3 class="addon-title">${esc(CMS.home.destaquesTitulo)}</h3><p>${esc(CMS.home.destaquesTexto)}</p>
    <div class="row3">
      ${CMS.home.destaques.map(d => `<div class="feature"><img src="${urlMidia(d.foto)}" alt=""><h3>${esc(d.titulo)}</h3><p>${esc(d.texto)}</p></div>`).join('')}
    </div></div></section>
  <section class="sec-piscina wow"><div class="container row2">
    <div><h3 class="addon-title">${esc(CMS.home.piscinaTitulo)}</h3>
      ${paragrafos(CMS.home.piscinaTexto)}<br>
      <a class="sppb-btn sppb-btn-default" href="#/fotos">Veja mais</a></div>
    <img src="${urlMidia(CMS.home.piscinaFoto)}" alt="">
  </div></section>`;

// ---------- modelos de página do original ----------
// faixa roxa com título + "Você está aqui" (páginas de menu do Joomla)
// cabeçalho das páginas internas: faixa com a foto do pôr do sol e o título em serifa
const banda = (t, crumb = t, sub = '') => `<section class="cab-pagina" style="background-image:linear-gradient(rgba(42,33,24,.62),rgba(42,33,24,.78)), url('${urlMidia(CMS.home.heroFoto)}')"><div class="container">
  <nav class="trilha" aria-label="Você está aqui"><a href="#/">Início</a><span aria-hidden="true">/</span><span>${crumb}</span></nav>
  <h1>${t}</h1>${sub ? `<p>${sub}</p>` : ''}</div></section>`;
// página de texto: cabeçalho + coluna de leitura
const artigo = (t, _acessos, _rating, corpo, sub = '') => banda(t, t, sub) + `<section class="pagina-texto"><div class="container"><article class="leitura">${corpo}
  <p class="leitura-acoes"><button class="link-acao" onclick="abrirEmail('${t}')"><i class="far fa-envelope"></i> Enviar esta página por e-mail</button></p></article></div></section>`;

P.sobre = () => artigo('Sobre a pousada', 0, null, paragrafos(CMS.paginas.sobre) + `<p>Conheça nossa localização no mapa:</p>${mapa()}`);

// lista de unidades: card horizontal (foto à esquerda, texto + "Veja mais")
const aPartirDe = u => Math.min(...[+CMS.precos.semana, +CMS.precos.fds].map(v => Math.round(v * (+u.ajuste || 100) / 100)));
const ICONES = { wifi: 'fa-wifi', piscina: 'fa-swimmer', estacionamento: 'fa-parking', 'ar-condicionado': 'fa-snowflake', acessibilidade: 'fa-wheelchair', cozinha: 'fa-utensils', ofurô: 'fa-hot-tub' };
const icone = a => { const k = Object.keys(ICONES).find(k => a.toLowerCase().includes(k)); return `<i class="fa ${k ? ICONES[k] : 'fa-check'}" aria-hidden="true"></i>`; };
const frases = u => u.resto.filter(l => /\.$/.test(l) && l.length > 40 && !/^(Check-|Trabalhamos|Pagamento|Café da manhã)/.test(l));
P.acomodacoes = () => banda('Acomodações', 'Acomodações', `${UN.length} unidades no cerrado, perto do Vale da Lua.`) + `<section class="pagina-texto"><div class="container lista-unidades">
  ${UN.map(u => `<article class="un-card">
    <a class="un-foto" href="#/unidade/${u.id}" aria-label="Ver ${esc(u.nome)}"><img src="${u.fotos[0] || ''}" alt="" loading="eager" decoding="async"></a>
    <div class="un-info">
      <h2><a href="#/unidade/${u.id}">${esc(u.nome)}</a></h2>
      <p class="un-meta">${esc(u.categoria)}, até ${u.capacidade} pessoas</p>
      <p class="un-desc">${esc((frases(u)[0] || u.resto.find(l => /\.$/.test(l)) || '').slice(0, 170))}</p>
      <ul class="chips">${u.amen.slice(0, 4).map(a => `<li>${icone(a)} ${esc(a)}</li>`).join('')}</ul>
      <div class="un-rodape"><p class="un-preco">a partir de <b>${fmt(aPartirDe(u))}</b> por noite</p>
        <a class="btn btn-claro" href="#/unidade/${u.id}">Ver detalhes</a><a class="btn" href="#/reservas?unidade=${u.id}">Reservar</a></div>
    </div></article>`).join('')}
</div></section>`;

// detalhe: título centralizado, carrossel, características e lista
P.unidade = id => {
  const u = unidade(id); if (!u) return P['404']();
  const bom = [], secoes = []; let atual = null;
  for (const l of u.resto) {
    if (l.length > 2 && l === l.toUpperCase() && !/\d/.test(l)) { atual = { t: l.charAt(0) + l.slice(1).toLowerCase(), itens: [] }; secoes.push(atual); }
    else if (!atual) bom.push(l);
    else atual.itens.push(l);
  }
  return banda(u.nome, 'Acomodações') + `<section class="pagina-texto"><div class="container">
    ${mosaico(u.fotos, u.nome)}
    <div class="un-detalhe">
      <div>
        <ul class="chips grandes">${u.amen.map(a => `<li>${icone(a)} ${esc(a)}</li>`).join('')}</ul>
        ${bom.length ? `<section class="bom-saber"><h2>Bom saber</h2><ul>${bom.map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>` : ''}
        ${secoes.length ? `<div class="secoes-un">${secoes.map(x => `<section><h3>${esc(x.t)}</h3><ul>${x.itens.map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>`).join('')}</div>` : ''}
      </div>
      <aside class="caixa-reserva">
        <p class="un-preco">a partir de <b>${fmt(aPartirDe(u))}</b> por noite</p>
        <p class="peq">${esc(u.categoria)}, até ${u.capacidade} pessoas. Diária para ${u.inclusos} pessoas; adicional de ${fmt(+CMS.precos.extra)} por pessoa extra.</p>
        <a class="btn btn-block" href="#/reservas?unidade=${u.id}">Ver datas e reservar</a>
        <p class="peq">Mínimo de ${CMS.precos.minNoites} noites. ${CMS.precos.sinal}% na reserva, o restante no check-in.</p>
      </aside>
    </div></div></section>`;
};
// ---------- mosaico de fotos (1 grande + 4 pequenas) e "Ver todas as fotos" ----------
const listas = {};
// vídeos tocam mudos em loop na grade; com som e controles ao abrir
const midia = (f, alt, i) => ehVideo(f) ? `<video src="${f}" muted loop autoplay playsinline preload="metadata"></video><span class="play" aria-hidden="true"><i class="fa fa-play"></i></span>` : `<img src="${f}" alt="${alt}" loading="${i ? 'lazy' : 'eager'}">`;
function mosaico(fotos, titulo, max = 5) {
  const id = 'm' + Object.keys(listas).length; listas[id] = { fotos, titulo };
  const vis = fotos.slice(0, max);
  return `<div class="mosaico n${vis.length}">
    ${vis.map((f, i) => `<button class="m-foto${ehVideo(f) ? ' m-video' : ''}" onclick="abrirFoto('${id}',${i})" aria-label="Abrir ${ehVideo(f) ? 'vídeo' : 'foto'} ${i + 1} de ${fotos.length}">${midia(f, `${esc(titulo)} — ${i + 1}`, i)}</button>`).join('')}
    <button class="ver-todas" onclick="verTodas('${id}')"><i class="fa fa-th"></i> Ver todas as fotos${fotos.length > vis.length ? ` (${fotos.length})` : ''}</button>
  </div>`;
}
window.abrirFoto = (id, i) => {
  lbLista = listas[id].fotos.map(f => new URL(f, location.href).href); lbI = i; lbMostrar();
  $('#lightbox').classList.add('on');
};
window.verTodas = id => {
  const { fotos, titulo } = listas[id];
  const m = document.createElement('div'); m.className = 'todas-fotos';
  m.innerHTML = `<div class="tf-topo"><button class="tf-voltar" aria-label="Fechar"><i class="fa fa-chevron-left"></i></button><b>${esc(titulo)}</b><span>${fotos.length} fotos</span></div>
    <div class="tf-grade">${fotos.map((f, i) => `<button class="${ehVideo(f) ? 'm-video' : ''}" onclick="abrirFoto('${id}',${i})" aria-label="Abrir ${i + 1}">${midia(f, '', 1)}</button>`).join('')}</div>`;
  const fechar = () => { m.classList.remove('on'); document.body.style.overflow = ''; setTimeout(() => m.remove(), 300); removeEventListener('keydown', esc1); };
  const esc1 = e => { if (e.key === 'Escape' && !$('#lightbox').classList.contains('on')) fechar(); };
  m.querySelector('.tf-voltar').onclick = fechar; addEventListener('keydown', esc1);
  document.body.appendChild(m); document.body.style.overflow = 'hidden'; requestAnimationFrame(() => m.classList.add('on'));
};

P.fotos = () => banda('Fotos', 'Fotos', 'O cerrado, as cachoeiras e os bangalôs.') + `<section class="pagina-texto"><div class="container">${mosaico(CMS.galeria.map(urlMidia).filter(Boolean), CMS.marca.nome, 13)}</div></section>`;

P.tarifario = () => {
  const p = CMS.precos, card = (rot, v, obs) => `<div class="preco-card"><span>${rot}</span><b>${fmt(+v)}</b><small>${obs}</small></div>`;
  return artigo('Tarifário', 0, null, `<div class="precos-grade">
    ${card('Durante a semana', p.semana, 'por noite, casal')}${card('Fim de semana', p.fds, 'por noite, casal')}${card('Feriados', p.feriado, 'por noite, casal')}${card('Réveillon', p.reveillon, '30 e 31 de dezembro')}</div>
    <ul class="regras"><li>Pessoa extra (criança ou adulto): <b>${fmt(+p.extra)}</b> por noite. Bebês não pagam.</li><li>Mínimo de <b>${p.minNoites} noites</b>. Em feriados prolongados, só o período inteiro.</li><li>Pagamento: <b>${p.sinal}%</b> na reserva e o restante no check-in, por PIX ou transferência.</li></ul>
    ${paragrafos(CMS.paginas.tarifario)}<p><a href="#/politica">Ver a política de cancelamento</a></p>`, 'Valores para um casal. Algumas unidades têm preço diferente.');
};

// ---------- Reservas: cartões de datas como no motor de reservas original ----------
const somaDia = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
function calendario(uid, ano, mes) {
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const ini = new Date(ano, mes, 1).getDay(), dias = new Date(ano, mes + 1, 0).getDate();
  let c = 'DSTQQSS'.split('').map(d => `<div class="dow">${d}</div>`).join('') + '<div class="vazio"></div>'.repeat(ini);
  for (let d = 1; d <= dias; d++) {
    const iso = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    c += `<div class="${diaOcupado(uid, iso) ? 'ocup' : 'livre'}" title="${fmt(diaria(iso, unidade(uid)).v)}">${d}</div>`;
  }
  return `<div><b>${nomes[mes]} ${ano}</b><div class="cal">${c}</div></div>`;
}
function calendarios(uid, n, inicio) {
  const d = inicio ? new Date(inicio + 'T12:00') : new Date();
  let h = '';
  for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() + i, 1); h += calendario(uid, x.getFullYear(), x.getMonth()); }
  return `<p class="legenda"><span style="background:#b2c65585"></span>Livre<span style="background:#ffc9c9"></span>Ocupado</p><br><div class="cals">${h}</div>`;
}
P.disponibilidade = q => {
  const sel = q.unidades || '1';
  const meses = q.entrada && q.saida ? Math.max(1, Math.min(12, (new Date(q.saida).getFullYear() - new Date(q.entrada).getFullYear()) * 12 + new Date(q.saida).getMonth() - new Date(q.entrada).getMonth() + 1)) : 2;
  const lista = sel === 'todos' ? UN : [unidade(sel)];
  return banda('Disponibilidades') + `<section class="page-body"><div class="container">
    <h2 class="disp-titulo">Consulta Disponibilidade</h2>
    <form class="form-disp" onsubmit="event.preventDefault();location.hash='#/disponibilidade?'+new URLSearchParams(new FormData(this))">
      <label>Selecione uma unidade:<select name="unidades">${UN.map(u => `<option value="${u.id}" ${sel == u.id ? 'selected' : ''}>${u.nome}</option>`).join('')}<option value="todos" ${sel === 'todos' ? 'selected' : ''}>-- TODOS --</option></select></label>
      <label>Data inicial:<input type="date" name="entrada" value="${q.entrada || ''}"></label>
      <label>Data final:<input type="date" name="saida" value="${q.saida || ''}"></label>
      <button class="btn btn-block">Consultar Disponibilidade</button></form>
    ${q.unidades ? lista.map(u => `<h3 style="margin:36px 0 10px">${u.nome}</h3>${calendarios(u.id, meses, q.entrada)}`).join('') : ''}
  </div></section>`;
};

const mapaURL = () => `https://maps.google.com/maps?q=${encodeURIComponent(CMS.local.lat + ',' + CMS.local.lng)}&z=13&hl=pt-BR&output=embed`;
const mapa = () => `<div class="mapa"><iframe loading="lazy" title="Mapa" src="${mapaURL()}"></iframe></div>`;
P['como-chegar'] = () => {
  const L = CMS.local, C = CMS.contato, dest = encodeURIComponent(L.lat + ',' + L.lng);
  const msg = encodeURIComponent(`Olá! Estou a caminho do ${CMS.marca.nome} e preciso de ajuda com o trajeto.`);
  return banda('Como chegar', 'Como chegar', 'Endereço, trajeto e atalhos para o GPS.') + `<section class="pagina-texto"><div class="container">
    <div class="cc">
      <div class="cc-info">
        <h2>Endereço</h2>
        <address>${esc(L.endereco).replace(/\n/g, '<br>')}</address>
        <div class="cc-botoes">
          <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener"><i class="fa fa-route"></i> Abrir rota no Google Maps</a>
          <a class="btn btn-claro" href="https://waze.com/ul?ll=${dest}&navigate=yes" target="_blank" rel="noopener"><i class="fab fa-waze"></i> Waze</a>
          <button type="button" class="btn btn-claro" onclick="navigator.clipboard.writeText(CMS.local.enderecoCompleto);toast('Endereço copiado')"><i class="far fa-copy"></i> Copiar endereço</button>
        </div>
        <h2>Trajeto</h2>
        <ol class="trajeto claro">${L.passos.filter(x => x.titulo).map((x, k, a) => `<li class="${k === a.length - 1 ? 'chegada' : ''}"><b>${esc(x.titulo)}</b><span>${esc(x.sub)}</span></li>`).join('')}</ol>
      </div>
      <div class="cc-mapa"><iframe loading="lazy" title="Mapa com a localização" src="${mapaURL()}"></iframe></div>
    </div>
    <div class="cc-dicas">
      <div><i class="far fa-clock"></i><span><b>Check-in a partir das 15h</b><small>Check-out até as 12h. Avise o horário previsto de chegada.</small></span></div>
      <div><i class="fa fa-signal"></i><span><b>Sinal de celular pode falhar</b><small>Baixe o mapa da região para usar sem internet.</small></span></div>
      <a href="https://wa.me/${esc(C.whatsapp)}?text=${msg}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i><span><b>Perdeu o caminho?</b><small>Chame no WhatsApp ${esc(C.telefone)}</small></span></a>
    </div>
  </div></section>`;
};

P.contato = () => {
  const C = CMS.contato, tel = C.telefone.replace(/\D/g, '');
  const msg = encodeURIComponent(`Olá! Vim pelo site do ${CMS.marca.nome} e gostaria de mais informações.`);
  return banda('Contato', 'Contato', 'Tire dúvidas, peça um orçamento para grupos ou combine detalhes da sua estadia.') + `<section class="pagina-texto"><div class="container ct-pagina">
    <form class="ct-form" onsubmit="event.preventDefault();enviarContato(this)" novalidate>
      <h2>Envie uma mensagem</h2>
      <p class="peq">${esc(CMS.paginas.contato)}</p>
      <div class="ct-2"><label>Nome<input name="nome" required autocomplete="name"></label><label>Telefone ou WhatsApp<input name="telefone" type="tel" autocomplete="tel" placeholder="(61) 90000-0000" oninput="mascaraCel(this)"></label></div>
      <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
      <div class="ct-2"><label>Assunto<select name="assunto"><option>Dúvida sobre hospedagem</option><option>Orçamento para grupo</option><option>Reserva já feita</option><option>Outro assunto</option></select></label>
        <label><span>Datas de interesse <small>(opcional)</small></span><input name="datas" placeholder="Ex.: 20 a 23 de dezembro"></label></div>
      <label>Mensagem<textarea name="mensagem" rows="5" required></textarea></label>
      <input name="site" tabindex="-1" autocomplete="off" aria-hidden="true" class="pote">
      <button class="btn">Enviar mensagem</button><div id="ret-contato" role="status"></div>
    </form>
    <aside class="ct-canais">
      <a class="ct-whats" href="https://wa.me/${esc(C.whatsapp)}?text=${msg}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i><span><b>Conversar no WhatsApp</b><small>A forma mais rápida de falar com a gente</small></span></a>
      <ul class="ct-lista">
        <li><i class="fa fa-phone-alt"></i><span><small>Telefone</small><a href="tel:${tel}">${esc(C.telefone)}</a></span></li>
        <li><i class="far fa-envelope"></i><span><small>E-mail</small><a href="mailto:${esc(C.email)}">${esc(C.email)}</a></span></li>
        <li><i class="fab fa-instagram"></i><span><small>Instagram</small><a href="https://instagram.com/${esc(C.instagram)}" target="_blank" rel="noopener">@${esc(C.instagram)}</a></span></li>
        <li><i class="far fa-clock"></i><span><small>Atendimento</small>Todos os dias, das 8h às 20h</span></li>
        <li><i class="fa fa-map-marker-alt"></i><span><small>Endereço</small>${esc(CMS.local.enderecoCompleto)}<a class="ct-mapa" href="#/como-chegar">Ver como chegar</a></span></li>
      </ul>
    </aside>
  </div></section>`;
};
window.enviarContato = async f => {
  const d = Object.fromEntries(new FormData(f)), out = $('#ret-contato');
  f.querySelectorAll('.invalido').forEach(l => l.classList.remove('invalido'));
  const falta = ['nome', 'email', 'mensagem'].filter(k => !String(d[k] || '').trim() || (k === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)));
  if (falta.length) { falta.forEach(k => f.elements[k].closest('label').classList.add('invalido')); f.elements[falta[0]].focus(); out.innerHTML = '<p class="aviso erro">Preencha nome, um e-mail válido e a mensagem.</p>'; return; }
  const b = f.querySelector('button'); b.disabled = true;
  try { await api('/api/contato', { metodo: 'POST', dados: d }); f.reset(); out.innerHTML = '<p class="aviso">Mensagem enviada. Respondemos em até um dia útil.</p>'; }
  catch (e) { out.innerHTML = `<p class="aviso erro">${esc(e.message)}</p>`; }
  b.disabled = false;
};

P.politica = () => artigo('Política de cancelamento', 0, null, paragrafos(CMS.paginas.politica) + `
  <div class="cancelar-aviso"><h2>Precisa cancelar uma reserva?</h2>
    <p>Entre na sua conta e abra <b>Minhas reservas</b>. Lá você vê o prazo de cada reserva e cancela com um clique.</p>
    <a class="btn" href="#/login?volta=${encodeURIComponent('#/minhas-reservas')}">Entrar e ver minhas reservas</a></div>`);
P.certificado = () => artigo('Certificado Cadastur', 0, null, CMS.paginas.certificadoFoto ? `<p class="centro"><img src="${urlMidia(CMS.paginas.certificadoFoto)}" style="max-width:640px;cursor:zoom-in" onclick="zoom(this.src)" alt="Certificado Cadastur"></p>` : '<p>O cadastro no Cadastur (Ministério do Turismo) está em andamento. A imagem do certificado pode ser enviada em Gestão &gt; Editar site &gt; Logos e rodapé.</p>');

P['404'] = () => banda('Página não encontrada') + `<section class="centro"><a class="btn" href="#/">Voltar ao início</a></section>`;

// ---------- roteador ----------
function render() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [rota, arg] = path.split('/');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const fn = P[rota] || P['404'];
  if (rota === 'unidade' || rota === 'confirmacao') app.innerHTML = fn(arg);
  else app.innerHTML = fn(q);
  document.querySelectorAll('#menu a, .oc-menu a').forEach(a => a.classList.toggle('ativo', a.getAttribute('href') === '#/' + rota));
  atualizarMenu();
  aplicarGlobais();
  document.body.classList.remove('menu-aberto');
  window.scrollTo(0, 0);
  animar();
}

// partes do index.html que também vêm do conteúdo editável
function aplicarGlobais() {
  const C = CMS.contato, L = CMS.local;
  // a seção "Como chegar" (mapa) aparece só na página inicial
  const loc = $('#localizacao'); if (loc) loc.hidden = !/^#?\/?$/.test(location.hash.split('?')[0]);
  document.querySelectorAll('.marca .logo-image').forEach(el => { const u = urlMidia(CMS.marca.logo); if (el.getAttribute('src') !== u) el.src = u; });
  const pg = $('#sp-bottom .col-pag p'); if (pg) pg.textContent = CMS.rodape.pagamento;
  document.querySelectorAll('.marca-nome').forEach(el => el.innerHTML = esc(CMS.marca.nome) + (CMS.marca.slogan ? `<small>${esc(CMS.marca.slogan)}</small>` : ''));
  const top = $('#sp-top-bar .contato'); if (top) top.innerHTML = `<i class="fa fa-mobile-alt"></i> <a href="tel:${C.telefone.replace(/\D/g, '')}">${esc(C.telefone)}</a>`;
  const soc = $('#sp-top-bar .social'); if (soc) soc.innerHTML = `<li><a href="https://instagram.com/${esc(C.instagram)}" target="_blank" aria-label="Instagram"><i class="fab fa-instagram"></i></a></li><li><a href="https://wa.me/${esc(C.whatsapp)}" target="_blank" aria-label="WhatsApp"><i class="fab fa-whatsapp"></i></a></li>`;
  const ct = $('#sp-bottom .contatos'); if (ct) ct.innerHTML = `<li><i class="fa fa-phone-alt"></i><a href="tel:${C.telefone.replace(/\D/g, '')}">${esc(C.telefone)}</a></li>
    <li><i class="fab fa-whatsapp"></i><a href="https://wa.me/${esc(C.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a></li>
    <li><i class="fab fa-instagram"></i><a href="https://instagram.com/${esc(C.instagram)}" target="_blank" rel="noopener">@${esc(C.instagram)}</a></li>
    ${C.email ? `<li><i class="far fa-envelope"></i><a href="mailto:${esc(C.email)}">${esc(C.email)}</a></li>` : ''}`;
  const lt = $('#localizacao .loc-texto');
  if (lt) {
    const dest = encodeURIComponent(L.lat + ',' + L.lng);
    lt.innerHTML = `<h2 id="loc-titulo">${esc(L.titulo)}</h2><address>${esc(L.endereco).replace(/\n/g, '<br>')}</address>
      <ol class="trajeto" aria-label="Trajeto">${L.passos.filter(p => p.titulo).map((p, i, a) => `<li class="${i === a.length - 1 ? 'chegada' : ''}"><b>${esc(p.titulo)}</b><span>${esc(p.sub)}</span></li>`).join('')}</ol>
      <div class="loc-acoes"><a class="btn loc-principal" href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener"><i class="fa fa-route" aria-hidden="true"></i> Abrir rota no Google Maps</a>
      <a class="loc-sec" href="https://waze.com/ul?ll=${dest}&navigate=yes" target="_blank" rel="noopener"><i class="fab fa-waze" aria-hidden="true"></i> Abrir no Waze</a>
      <button class="loc-sec" type="button" onclick="navigator.clipboard.writeText(CMS.local.enderecoCompleto);toast('Endereço copiado')"><i class="far fa-copy" aria-hidden="true"></i> Copiar endereço</button></div>`;
    const fr = $('#localizacao iframe'); if (fr && fr.getAttribute('src') !== mapaURL()) fr.src = mapaURL();
  }
  document.title = (typeof ehRotaAdmin === 'function' && ehRotaAdmin() ? 'Gestão — ' : '') + CMS.marca.nome + (CMS.marca.slogan ? ' — ' + CMS.marca.slogan : '');
}

// fadeInUp ao entrar na tela (equivalente ao sppb-wow do original)
const obs = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('visivel'); obs.unobserve(e.target); }
}), { threshold: .15 });
function animar() { /* sem animação de entrada nas seções: o conteúdo aparece direto */ }
// cabeçalho fixo que encolhe ao rolar
const topoH = () => $('#sp-top-bar').offsetHeight;
addEventListener('scroll', () => {
  const fixo = scrollY > topoH();
  $('#sp-header').classList.toggle('fixo', fixo);
  $('#pagina').style.paddingTop = fixo ? '60px' : '';
  $('#go-top').classList.toggle('on', scrollY > 100);
}, { passive: true });
// menu lateral usa os mesmos links do menu principal
$('#offcanvas .oc-menu').innerHTML = $('#menu').innerHTML.replace('id="link-login"', '');
$('#offcanvas').addEventListener('click', e => { if (e.target.tagName === 'A') document.body.classList.remove('menu-aberto'); });
addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('menu-aberto'); });
addEventListener('hashchange', render);
// logado, os dados podem ter mudado no servidor: busca de novo ao trocar de página
addEventListener('hashchange', () => { if (sessao()) carregarDados().then(render); });
// a primeira renderização acontece no fim de conta.js
