// Gestão > Editar site: textos, fotos, preços, unidades, páginas, contato e backup.
// Lê e grava o objeto CMS (cms.js). As fotos enviadas são reduzidas e guardadas no navegador.

ABAS.splice(1, 0, ['site', 'fa-pen-nib', 'Editar site']);

const SECOES = [
  ['inicio', 'Página inicial'], ['chales', 'Chalés'], ['precos', 'Preços e regras'],
  ['fotos', 'Galeria de fotos'], ['paginas', 'Textos das páginas'], ['contato', 'Contato, mapa e PIX'], ['marca', 'Logos e rodapé'], ['backup', 'Backup'],
];
const pegar = k => k.split('.').reduce((o, p) => (o == null ? o : o[p]), CMS);
function pôr(k, v, raiz = CMS) {
  const ps = k.split('.'), ult = ps.pop();
  const alvo = ps.reduce((o, p) => (o[p] ??= /^\d+$/.test(p) ? [] : {}), raiz);
  alvo[ult] = v;
}
const atr = v => esc(v ?? '');

// ---------- campos ----------
const campo = (k, rot, dica = '', tipo = 'text') => `<label class="ed-campo"><span>${rot}</span><input type="${tipo}" data-k="${k}" value="${atr(pegar(k))}" ${tipo === 'number' ? 'step="any"' : ''}>${dica ? `<small>${dica}</small>` : ''}</label>`;
const texto = (k, rot, dica = '', linhas = 4) => `<label class="ed-campo"><span>${rot}</span><textarea data-k="${k}" rows="${linhas}">${atr(pegar(k))}</textarea>${dica ? `<small>${dica}</small>` : ''}</label>`;
const lista = (k, rot, dica = '', linhas = 6) => `<label class="ed-campo"><span>${rot}</span><textarea data-k="${k}" data-tipo="linhas" rows="${linhas}">${atr((pegar(k) || []).join('\n'))}</textarea>${dica ? `<small>${dica}</small>` : ''}</label>`;
const foto = (k, rot) => `<div class="ed-campo ed-foto"><span>${rot}</span><div class="ed-foto-box">
  <img src="${atr(urlMidia(pegar(k)))}" alt=""><input type="hidden" data-k="${k}" value="${atr(pegar(k))}">
  <label class="btn btn-sm btn-claro"><i class="fa fa-upload"></i> Trocar foto<input type="file" accept="image/*" hidden onchange="trocarFoto(this)"></label></div></div>`;
const fotos = (k, rot) => `<div class="ed-campo"><span>${rot}</span><div class="ed-fotos" data-lista="${k}">${grade(pegar(k) || [])}</div>
  <input type="hidden" data-k="${k}" data-tipo="json" value="${atr(JSON.stringify(pegar(k) || []))}">
  <label class="btn btn-sm btn-claro ed-add"><i class="fa fa-plus"></i> Adicionar fotos<input type="file" accept="image/*,video/mp4,video/webm" multiple hidden onchange="addFotos(this)"></label>
  <small>A primeira foto é a capa. Use as setas para reordenar.</small></div>`;
function grade(refs) {
  return refs.map((r, i) => `<figure><img src="${atr(urlMidia(r))}" alt="">${i === 0 ? '<em>Capa</em>' : ''}
    <figcaption><button type="button" onclick="moverFoto(this,${i},-1)" aria-label="Mover para a esquerda" ${i ? '' : 'disabled'}><i class="fa fa-arrow-left"></i></button>
    <button type="button" onclick="moverFoto(this,${i},1)" aria-label="Mover para a direita" ${i < refs.length - 1 ? '' : 'disabled'}><i class="fa fa-arrow-right"></i></button>
    <button type="button" class="rem" onclick="removerFoto(this,${i})" aria-label="Remover foto"><i class="fa fa-trash"></i></button></figcaption></figure>`).join('') || '<p class="peq">Nenhuma foto.</p>';
}
const listaDe = el => el.closest('.ed-campo').querySelector('[data-tipo="json"]');
function regrade(inp) { const refs = JSON.parse(inp.value); inp.closest('.ed-campo').querySelector('.ed-fotos').innerHTML = grade(refs); marcarAlterado(inp); }
window.moverFoto = (b, i, d) => { const inp = listaDe(b), r = JSON.parse(inp.value); [r[i], r[i + d]] = [r[i + d], r[i]]; inp.value = JSON.stringify(r); regrade(inp); };
window.removerFoto = (b, i) => { const inp = listaDe(b), r = JSON.parse(inp.value); r.splice(i, 1); inp.value = JSON.stringify(r); regrade(inp); };
window.addFotos = async input => {
  const inp = listaDe(input), r = JSON.parse(inp.value);
  const lbl = input.closest('label'); lbl.classList.add('carregando');
  try { for (const f of input.files) r.push(await guardarMidia(await reduzirFoto(f))); }
  catch (e) { alert('Não foi possível adicionar: ' + e.message); }
  lbl.classList.remove('carregando'); input.value = '';
  inp.value = JSON.stringify(r); regrade(inp);
};
window.trocarFoto = async input => {
  const box = input.closest('.ed-foto-box'), f = input.files[0]; if (!f) return;
  try { const id = await guardarMidia(await reduzirFoto(f)); box.querySelector('input[type=hidden]').value = id; box.querySelector('img').src = urlMidia(id); marcarAlterado(box); }
  catch (e) { alert('Não foi possível usar esta imagem: ' + e.message); }
  input.value = '';
};

// ---------- salvar ----------
function marcarAlterado(el) { el.closest('form')?.classList.add('alterado'); }
document.addEventListener('input', e => { if (e.target.closest('.ed-form')) marcarAlterado(e.target); });
function lerCampos(f, raiz = CMS) {
  for (const el of f.querySelectorAll('[data-k]')) {
    let v = el.value;
    if (el.dataset.tipo === 'linhas') v = v.split('\n').map(x => x.trim()).filter(Boolean);
    else if (el.dataset.tipo === 'json') v = JSON.parse(v);
    else if (el.type === 'number') v = v === '' ? 0 : +v;
    pôr(el.dataset.k, v, raiz);
  }
}
window.salvarSecao = async f => {
  lerCampos(f);
  if (f.dataset.extra) EXTRA[f.dataset.extra](f);
  if (!await salvarCMS()) return;
  montarUnidades(); f.classList.remove('alterado');
  toast('Alterações salvas. O site já mostra a nova versão.');
  render(); recarregarPrevia();
};
const EXTRA = {
  precos(f) {
    CMS.precos.diasFds = [...f.querySelectorAll('[name=fds]:checked')].map(c => +c.value);
    CMS.feriadosFixos = f.querySelector('[name=fixos]').value.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)
      .map(x => { const m = x.match(/^(\d{1,2})\/(\d{1,2})$/); return m ? `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; }).filter(Boolean);
    CMS.feriados = [...f.querySelectorAll('.ed-feriado:not(.cab)')].map(l => [l.querySelector('[name=ini]').value, l.querySelector('[name=fim]').value, l.querySelector('[name=nome]').value.trim()])
      .filter(([a, b]) => a && b && b >= a);
  },
};
const formulario = (secao, corpo, extra = '') => `<form class="ed-form" ${extra ? `data-extra="${extra}"` : ''} onsubmit="event.preventDefault();salvarSecao(this)">
  <div class="ed-salvar"><span class="ed-status"><i class="fa fa-check-circle"></i> Tudo salvo</span><span class="ed-aviso"><i class="fa fa-circle"></i> Alterações não salvas</span>
    <button type="button" class="btn btn-claro ed-descartar" onclick="descartar()">Descartar</button><button class="btn">Salvar alterações</button></div>
  ${corpo}</form>`;
const bloco = (tit, corpo, dica = '') => `<fieldset class="ed-bloco"><legend>${tit}</legend>${dica ? `<p class="ed-onde"><i class="far fa-eye"></i> ${dica}</p>` : ''}${corpo}</fieldset>`;
window.descartar = () => { const f = document.querySelector('.ed-form'); if (f) f.classList.remove('alterado'); render(); recarregarPrevia(); toast('Alterações descartadas.'); };

// ---------- seções ----------
const ED = {};
ED.inicio = () => formulario('inicio',
  bloco('Nome e topo', `<div class="ed-2">${campo('marca.nome', 'Nome da pousada')}${campo('marca.slogan', 'Frase abaixo do nome (opcional)', 'Deixe vazio para mostrar só o nome no cabeçalho.')}</div>
    ${campo('home.titulo', 'Título grande do topo')}${texto('home.subtitulo', 'Frase do topo', '', 2)}${foto('home.heroFoto', 'Foto do topo')}`, 'Primeira coisa que o visitante vê ao abrir o site. O nome também aparece no cabeçalho de todas as páginas.') +
  bloco('Seção dos chalés', `${campo('home.chalesTitulo', 'Título')}${texto('home.chalesTexto', 'Texto', 'Deixe uma linha em branco para separar parágrafos.')}${foto('home.chalesFoto', 'Foto')}`, 'Logo abaixo da busca de datas, na página inicial.') +
  bloco('Destaques', `<div class="ed-2">${campo('home.destaquesTitulo', 'Título')}${campo('home.destaquesTexto', 'Frase')}</div>
    <div class="ed-3">${CMS.home.destaques.map((_, i) => `<div class="ed-card">${campo(`home.destaques.${i}.titulo`, `Destaque ${i + 1}`)}${campo(`home.destaques.${i}.texto`, 'Texto')}${foto(`home.destaques.${i}.foto`, 'Foto')}</div>`).join('')}</div>`, 'Três quadros com foto, no fundo lilás da página inicial.') +
  bloco('Seção da piscina', `${campo('home.piscinaTitulo', 'Título')}${texto('home.piscinaTexto', 'Texto')}${foto('home.piscinaFoto', 'Foto')}`, 'Faixa escura no fim da página inicial, antes do mapa.'), '', '#/');

ED.chales = () => {
  const ativas = db.get('reservas').filter(r => r.status !== 'cancelada');
  return formulario('chales', CMS.unidades.map((u, i) => `<details class="ed-unidade" ${i === 0 ? 'open' : ''}><summary><img src="${atr(urlMidia((u.fotos || [])[0]))}" alt=""><b>${esc(u.nome)}</b><span>${esc(u.categoria)} · até ${u.capacidade} pessoas · ${u.ajuste}% do preço</span></summary>
    <div class="ed-2">${campo(`unidades.${i}.nome`, 'Nome')}${campo(`unidades.${i}.categoria`, 'Categoria', 'Ex.: Standard, Luxo')}</div>
    <div class="ed-3">${campo(`unidades.${i}.capacidade`, 'Capacidade máxima', 'Pessoas, sem contar bebês.', 'number')}${campo(`unidades.${i}.inclusos`, 'Pessoas incluídas na diária', 'Acima disso cobra o adicional.', 'number')}${campo(`unidades.${i}.ajuste`, 'Preço desta unidade (%)', '100 = preço normal; 200 = o dobro.', 'number')}</div>
    ${lista(`unidades.${i}.amen`, 'Características', 'Uma por linha. Ex.: Wifi, Piscina, Estacionamento Free', 4)}
    ${lista(`unidades.${i}.resto`, 'Descrição completa', 'Uma linha por item. Linhas em MAIÚSCULAS viram títulos (ex.: QUARTO, COZINHA).', 10)}
    ${fotos(`unidades.${i}.fotos`, 'Fotos')}
    <button type="button" class="btn btn-sm btn-sec ed-excluir" onclick="excluirUnidade(${i})" ${ativas.some(r => r.unidade === +u.id) ? 'disabled title="Tem reservas ativas"' : ''}><i class="fa fa-trash"></i> Excluir esta unidade</button>
  </details>`).join('') + `<button type="button" class="btn btn-claro ed-nova" onclick="novaUnidade()"><i class="fa fa-plus"></i> Adicionar unidade</button>`, '', '#/acomodacoes');
};
window.novaUnidade = async () => {
  const id = Math.max(0, ...CMS.unidades.map(u => +u.id)) + 1;
  CMS.unidades.push({ id, nome: `Chalé ${id}`, categoria: 'Standard', capacidade: 3, inclusos: 2, ajuste: 100, amen: ['Wifi'], resto: ['Check-in a partir das 15h.', 'Check-out até às 12h.'], fotos: [] });
  await salvarCMS(); montarUnidades(); render();
  setTimeout(() => { const d = [...document.querySelectorAll('.ed-unidade')].pop(); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }, 50);
};
window.excluirUnidade = async i => {
  const u = CMS.unidades[i];
  if (!confirm(`Excluir "${u.nome}" do site? As reservas antigas dela continuam no histórico.`)) return;
  CMS.unidades.splice(i, 1); await salvarCMS(); montarUnidades(); toast('Unidade excluída.'); render();
};

const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const linhaFeriado = (f = ['', '', '']) => `<div class="ed-feriado"><input type="date" name="ini" value="${atr(f[0])}" aria-label="Primeira noite"><input type="date" name="fim" value="${atr(f[1])}" aria-label="Última noite"><input name="nome" value="${atr(f[2])}" placeholder="Nome do feriado" aria-label="Nome"><button type="button" onclick="this.parentNode.remove();marcarAlterado(document.querySelector('.ed-form'))" aria-label="Remover"><i class="fa fa-times"></i></button></div>`;
window.addFeriado = b => { b.insertAdjacentHTML('beforebegin', linhaFeriado()); marcarAlterado(b); };
ED.precos = () => formulario('precos',
  bloco('Diárias para um casal', `<div class="ed-4">${campo('precos.semana', 'Durante a semana (R$)', '', 'number')}${campo('precos.fds', 'Fim de semana (R$)', '', 'number')}${campo('precos.feriado', 'Feriados (R$)', '', 'number')}${campo('precos.reveillon', 'Réveillon 30 e 31/12 (R$)', '', 'number')}</div>
    <div class="ed-campo"><span>Dias cobrados como fim de semana</span><div class="ed-dias">${DIAS_SEM.map((d, i) => `<label><input type="checkbox" name="fds" value="${i}" ${CMS.precos.diasFds.map(Number).includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div><small>Marque as noites que usam o preço de fim de semana.</small></div>`,
    'O preço de cada unidade é ajustado pela porcentagem definida em Chalés (ex.: Casa Guará = 200%).') +
  bloco('Regras', `<div class="ed-3">${campo('precos.extra', 'Adicional por pessoa extra (R$/noite)', 'Crianças e adultos acima das pessoas incluídas.', 'number')}${campo('precos.minNoites', 'Mínimo de noites', '', 'number')}${campo('precos.sinal', 'Sinal na reserva (%)', 'O restante é pago no check-in.', 'number')}</div>`) +
  bloco('Feriados', `<label class="ed-campo"><span>Feriados de um dia (preço de feriado)</span><textarea name="fixos" rows="3">${atr(CMS.feriadosFixos.map(md => md.split('-').reverse().join('/')).join(', '))}</textarea><small>Formato dia/mês, separados por vírgula. Ex.: 25/12, 01/01</small></label>
    <div class="ed-campo"><span>Feriados prolongados (só aceitam reserva do período inteiro)</span><div class="ed-feriados"><div class="ed-feriado cab"><span>Primeira noite</span><span>Última noite</span><span>Nome</span><span></span></div>${CMS.feriados.map(linhaFeriado).join('')}<button type="button" class="btn btn-sm btn-claro" onclick="addFeriado(this)"><i class="fa fa-plus"></i> Adicionar feriado</button></div></div>`), 'precos', '#/reservas');

ED.fotos = () => formulario('fotos', bloco('Galeria (página Fotos)', fotos('galeria', 'Fotos e vídeos'), 'Página Fotos. As 13 primeiras aparecem no mosaico; as demais em "Ver todas as fotos".'), '', '#/fotos');

ED.paginas = () => formulario('paginas',
  bloco('Textos das páginas', `${texto('paginas.sobre', 'Sobre a pousada', 'Deixe uma linha em branco entre parágrafos.', 10)}${texto('paginas.tarifario', 'Tarifário', 'Texto da página Tarifário. Os preços cobrados de verdade ficam em "Preços e regras".', 10)}${texto('paginas.politica', 'Política de cancelamento', '', 9)}${texto('paginas.contato', 'Página de contato', '', 3)}`), '', '#/sobre');

ED.contato = () => formulario('contato',
  bloco('Contato', `<div class="ed-2">${campo('contato.telefone', 'Telefone')}${campo('contato.whatsapp', 'WhatsApp (só números, com 55 e DDD)', 'Ex.: 5561900000000')}${campo('contato.instagram', 'Instagram (sem @)')}${campo('contato.email', 'E-mail')}</div>`) +
  bloco('Localização e mapa', `${campo('local.titulo', 'Título da seção')}${texto('local.endereco', 'Endereço (como aparece no site)', '', 2)}${campo('local.enderecoCompleto', 'Endereço completo (botão "Copiar endereço")')}
    <div class="ed-2">${campo('local.lat', 'Latitude', 'Pegue no Google Maps: clique com o botão direito no local.')}${campo('local.lng', 'Longitude')}</div>
    <div class="ed-3">${CMS.local.passos.map((_, i) => `<div class="ed-card">${campo(`local.passos.${i}.titulo`, `Passo ${i + 1} do trajeto`)}${campo(`local.passos.${i}.sub`, 'Detalhe')}</div>`).join('')}</div>`) +
  bloco('Dados para pagamento (PIX)', `<div class="ed-2">${campo('pix.chave', 'Chave PIX')}${campo('pix.favorecido', 'Favorecido')}${campo('pix.banco', 'Banco')}<div class="ed-2">${campo('pix.agencia', 'Agência')}${campo('pix.conta', 'Conta')}</div></div>`), '', '#/');

ED.marca = () => formulario('marca',
  bloco('Logos', `<div class="ed-2">${foto('marca.logo', 'Logo principal (redonda)')}${foto('marca.logoDestaque', 'Logo de destaque')}</div><p class="peq">A logo principal aparece no cabeçalho, no menu da Gestão e, em transparência, sobre a foto do topo. A de destaque aparece na tela de login. Use imagens quadradas.</p>`, 'Cabeçalho de todas as páginas, tela de login e topo da página inicial.') +
  bloco('Rodapé', campo('rodape.pagamento', 'Frase sobre formas de pagamento'), 'Coluna "Formas de pagamento" no rodapé de todas as páginas.') +
  bloco('Certificado', foto('paginas.certificadoFoto', 'Imagem do certificado Cadastur'), 'Página "Nosso Parceiros", no link do rodapé.'), '', '#/');

ED.backup = () => `<div class="ed-bloco"><h3>Backup do conteúdo</h3>
  <p class="peq">As edições ficam salvas no servidor e valem para todos os visitantes. Baixe um backup do conteúdo para guardar uma cópia.</p>
  <p><button class="btn" onclick="baixarBackup(this)"><i class="fa fa-download"></i> Baixar backup</button>
  <label class="btn btn-claro"><i class="fa fa-upload"></i> Restaurar de um backup<input type="file" accept="application/json" hidden onchange="restaurarBackup(this)"></label></p>
  <hr><h3>Voltar ao conteúdo original</h3><p class="peq">Desfaz todas as edições de textos, preços, unidades e fotos. Reservas e cadastros não são afetados.</p>
  <button class="btn btn-sec" onclick="restaurarPadrao()"><i class="fa fa-undo"></i> Restaurar conteúdo original</button></div>`;
window.baixarBackup = async b => {
  b.disabled = true;
  const midias = {};
  for (const [id, url] of MID) { const blob = await (await fetch(url)).blob(); midias[id] = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); }); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ versao: 1, data: new Date().toISOString(), conteudo: CMS, midias })], { type: 'application/json' }));
  a.download = `guara-bangalos-conteudo-${hoje()}.json`; a.click(); b.disabled = false;
};
window.restaurarBackup = async input => {
  try {
    const d = JSON.parse(await input.files[0].text());
    if (!d.conteudo) throw new Error('arquivo não é um backup do site');
    if (!confirm('Substituir o conteúdo atual pelo do backup?')) return;
    const bd = await abrirBanco();
    for (const [id, dataUrl] of Object.entries(d.midias || {})) {
      const blob = await (await fetch(dataUrl)).blob();
      await new Promise(ok => { const t = bd.transaction('midias', 'readwrite'); t.objectStore('midias').put(blob, id); t.oncomplete = ok; });
      MID.set(id, URL.createObjectURL(blob));
    }
    CMS = mesclar(CMS_PADRAO(), d.conteudo); await salvarCMS(); montarUnidades(); toast('Backup restaurado.'); render();
  } catch (e) { alert('Não foi possível restaurar: ' + e.message); }
};
window.restaurarPadrao = async () => {
  if (!confirm('Desfazer todas as edições do site e voltar ao conteúdo original?')) return;
  CMS = CMS_PADRAO(); await salvarCMS(); montarUnidades(); toast('Conteúdo original restaurado.'); render();
};

// ---------- prévia ao vivo ----------
const PAGINAS_PREVIA = [['#/', 'Página inicial'], ['#/acomodacoes', 'Acomodações'], ['#/unidade/1', 'Detalhe do chalé'], ['#/fotos', 'Fotos'], ['#/reservas', 'Reservas'], ['#/tarifario', 'Tarifário'], ['#/sobre', 'Sobre'], ['#/politica', 'Política'], ['#/contato', 'Contato'], ['#/certificado', 'Certificado'], ['#/login', 'Login']];
const previa = () => document.querySelector('#ed-previa');
function atualizarPrevia() {
  const fr = previa(), f = document.querySelector('.ed-form'); if (!fr || !f) return;
  const w = fr.contentWindow; if (!w || !w.cmsAPI || !w.render) return;
  try {
    const copia = JSON.parse(JSON.stringify(CMS)); lerCampos(f, copia);
    w.cmsAPI.usar(copia); for (const [id, u] of MID) w.cmsAPI.midias.set(id, u);
    w.montarUnidades(); const y = w.scrollY; w.render(); w.scrollTo(0, y);
  } catch (err) { /* campo incompleto: espera a próxima digitação */ }
}
function recarregarPrevia() { const fr = previa(); if (fr) fr.contentWindow.location.reload(); }
window.trocarPaginaPrevia = h => { const fr = previa(); if (fr) { fr.contentWindow.location.hash = h; setTimeout(atualizarPrevia, 120); } };
let tPrevia;
document.addEventListener('input', e => { if (e.target.closest('.ed-form')) { clearTimeout(tPrevia); tPrevia = setTimeout(atualizarPrevia, 350); } });
// fotos trocadas/adicionadas também atualizam a prévia
const _marcar = marcarAlterado;
marcarAlterado = el => { _marcar(el); clearTimeout(tPrevia); tPrevia = setTimeout(atualizarPrevia, 150); };

// ---------- aba na Gestão ----------
const INTRO = {
  inicio: 'Textos e fotos da página inicial: topo, chalés, destaques e piscina.',
  chales: 'Cada unidade que aparece em Acomodações e Reservas: nome, capacidade, preço, descrição e fotos.',
  precos: 'Valores cobrados nas reservas, regras de estadia e feriados. Mudanças valem para novas reservas.',
  fotos: 'Fotos e vídeos da página Fotos.',
  paginas: 'Textos das páginas Sobre, Tarifário, Política de cancelamento e Contato.',
  contato: 'Telefone, redes, endereço, mapa e dados para pagamento por PIX.',
  marca: 'Logos, frase do rodapé e imagem do certificado.',
  backup: 'Guarde uma cópia do conteúdo ou volte ao original.',
};
ADM.site = q => {
  const sec = SECOES.some(s => s[0] === q.sec) ? q.sec : 'inicio';
  const ver = { inicio: '#/', chales: '#/acomodacoes', precos: '#/tarifario', fotos: '#/fotos', paginas: '#/sobre', contato: '#/contato', marca: '#/', backup: '' }[sec];
  const comPrevia = sec !== 'backup';
  setTimeout(() => { const fr = previa(); if (fr) fr.onload = () => setTimeout(atualizarPrevia, 200); }, 0);
  return `<div class="ed ${comPrevia ? 'com-previa' : ''}">
    <nav class="ed-secoes" aria-label="Partes do site">${SECOES.map(([k, t]) => `<a href="#/gestao?aba=site&sec=${k}" class="${k === sec ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <div class="ed-conteudo"><div class="ed-intro"><h2>${SECOES.find(s => s[0] === sec)[1]}</h2><p>${INTRO[sec]}</p></div>${ED[sec]()}</div>
    ${comPrevia ? `<aside class="ed-previa" aria-label="Prévia do site">
      <div class="ed-previa-topo"><span><i class="far fa-eye"></i> Prévia ao vivo</span>
        <select onchange="trocarPaginaPrevia(this.value)" aria-label="Página da prévia">${PAGINAS_PREVIA.map(([h, t]) => `<option value="${h}" ${h === ver ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <a href="${ver}" target="_blank" title="Abrir em nova aba" aria-label="Abrir página em nova aba"><i class="fa fa-external-link-alt"></i></a></div>
      <div class="ed-previa-moldura"><iframe id="ed-previa" title="Prévia do site" src="${location.pathname}?previa=1${ver}"></iframe></div>
      <p class="ed-previa-nota">Mostra as mudanças enquanto você digita. Só vão para o site quando você salvar.</p>
    </aside>` : ''}
  </div>`;
};
// aviso ao sair com alterações não salvas
addEventListener('beforeunload', e => { if (document.querySelector('.ed-form.alterado')) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && document.querySelector('.ed-form.alterado') && !confirm('Há alterações não salvas. Sair mesmo assim?')) e.preventDefault();
}, true);
