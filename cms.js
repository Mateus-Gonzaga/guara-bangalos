// Conteúdo editável do site (textos, fotos, preços, unidades, contato).
// Fica salvo no navegador: textos em localStorage ('tg_cms') e fotos enviadas em IndexedDB.
// Carregado antes do app.js. A Gestão > "Editar site" altera este objeto.

// ---------- conteúdo padrão (o que o site mostra antes de qualquer edição) ----------
function unidadesPadrao() {
  // unidades fictícias de demonstração (edite em Gestão > Editar site > Chalés)
  const G = n => n.split(' ').map(x => `img/guara/${x}.jpg`);
  const base = ['Café da manhã servido no bangalô, sob encomenda.', 'Check-in a partir das 15h.', 'Check-out até as 12h.', 'Pagamento de 50% na reserva e 50% no check-in, por PIX ou transferência.'];
  const quarto = ['QUARTO', 'Cama queen com enxoval de algodão', 'Ventilador de teto', 'Cortinas blackout', 'Rede na varanda'];
  const cozinha = ['COZINHA', 'Cooktop de 2 bocas e frigobar', 'Cafeteira italiana e chaleira', 'Louças e talheres para 4 pessoas'];
  const banheiro = ['BANHEIRO', 'Chuveiro com aquecimento solar', 'Toalhas de banho e de rosto', 'Sabonete e xampu naturais'];
  return [
    { id: 1, nome: 'Bangalô Ipê', categoria: 'Standard', capacidade: 3, inclusos: 2, ajuste: 100,
      amen: ['Wifi', 'Estacionamento', 'Ofurô aquecido', 'Piscina natural'],
      resto: [...base, 'O Bangalô Ipê fica mais perto do rio, entre ipês-amarelos que florescem em agosto.', ...quarto, ...cozinha, ...banheiro, 'VISTA', 'Varanda de frente para a mata ciliar e o barulho da água.'], fotos: G('f01 f02 f04 f07 f12') },
    { id: 2, nome: 'Bangalô Buriti', categoria: 'Standard', capacidade: 3, inclusos: 2, ajuste: 100,
      amen: ['Wifi', 'Estacionamento', 'Ofurô aquecido', 'Piscina natural'],
      resto: [...base, 'O Bangalô Buriti tem acesso direto à trilha que leva à cachoeira da propriedade.', ...quarto, ...cozinha, ...banheiro, 'VISTA', 'Deck suspenso voltado para as veredas de buriti.'], fotos: G('f09 f10 f11 f13 f14') },
    { id: 3, nome: 'Bangalô Pequi', categoria: 'Vista da serra', capacidade: 3, inclusos: 2, ajuste: 110,
      amen: ['Wifi', 'Estacionamento', 'Ofurô aquecido', 'Vista da serra'],
      resto: [...base, 'O Bangalô Pequi fica no ponto mais alto do terreno, com o melhor pôr do sol.', ...quarto, ...cozinha, ...banheiro, 'VISTA', 'Janela panorâmica para a serra e o céu estrelado.'], fotos: G('f16 f17 f19 f20 f23') },
    { id: 4, nome: 'Bangalô Sucupira', categoria: 'Acessível', capacidade: 3, inclusos: 2, ajuste: 100,
      amen: ['Wifi', 'Estacionamento', 'Acessibilidade', 'Ofurô aquecido'],
      resto: [...base, 'O Bangalô Sucupira é todo no térreo, com rampa e banheiro adaptado.', ...quarto, ...cozinha, ...banheiro], fotos: G('f18 f15') },
    { id: 5, nome: 'Casa Guará (duas suítes)', categoria: 'Família e grupos', capacidade: 8, inclusos: 4, ajuste: 200,
      amen: ['Ar-condicionado', 'Wifi', 'Estacionamento', 'Piscina aquecida'],
      resto: ['A Casa Guará tem 2 suítes, cada uma com cama de casal e bicama de solteiro.', 'Entre as suítes fica a área de convivência com cozinha completa, sala, deck e piscina com aquecimento solar.', 'Recebe até 8 pessoas.', 'Check-in a partir das 15h.', 'Check-out até as 12h.'], fotos: G('f26 f27 f28') },
  ];
}
const CMS_PADRAO = () => ({
  marca: { nome: 'Guará Bangalôs', slogan: 'Ecolodge', logo: 'img/logo-guara.png', logoDestaque: 'img/logo-guara-pedra.jpg' },
  rodape: { pagamento: 'Trabalhamos com PIX ou transferências.' },
  contato: { telefone: '(61) 90000-0000', whatsapp: '5561900000000', instagram: 'guarabangalos', email: 'reservas@guarabangalos.test' },
  home: {
    titulo: 'Guará Bangalôs',
    subtitulo: 'Bangalôs no cerrado da Chapada dos Veadeiros, na região do Vale da Lua, em Alto Paraíso de Goiás.',
    heroFoto: 'img/guara/por-do-sol-1-ia.jpg',
    chalesTitulo: 'Conheça nossos bangalôs',
    chalesTexto: 'Quatro bangalôs e uma casa para grupos, espalhados pelo cerrado.\n\nCada bangalô tem quarto, banheiro, cozinha, deck e ofurô com água aquecida.',
    chalesFoto: 'img/guara/por-do-sol-4.jpg',
    destaquesTitulo: 'Guará Bangalôs',
    destaquesTexto: 'Um refúgio aconchegante e sustentável em meio à natureza da Chapada dos Veadeiros',
    destaques: [
      { titulo: 'Pôr do sol', texto: 'Mirante no alto do terreno', foto: 'img/guara/por-do-sol-3.jpg' },
      { titulo: 'Piscina natural', texto: 'Com pedras no fundo', foto: 'img/guara/f21.jpg' },
      { titulo: 'Fauna do cerrado', texto: 'Araras, tucanos e, com sorte, o lobo-guará', foto: 'img/guara/f25.jpg' },
    ],
    piscinaTitulo: 'Piscina natural de água corrente',
    piscinaTexto: 'Nossa piscina não utiliza produtos químicos, não tem agressão ao meio ambiente e a sua pele.\n\nO visual rústico com pedras mantém o aspecto de cachoeira com muito conforto.',
    piscinaFoto: 'img/guara/f04.jpg',
  },
  paginas: {
    sobre: 'A construção do Guará Bangalôs, na Chapada dos Veadeiros (GO), foi pautada na sustentabilidade e na valorização dos recursos locais. Os bangalôs integrados à natureza foram erguidos com materiais regionais, como terra e pedras, e tecnologias que reaproveitam água e energia solar.\n\nAs habitações são suspensas, evitando impermeabilizar o solo, e painéis solares fotovoltaicos alimentam os equipamentos internos e eletrodomésticos.',
    tarifario: 'TARIFÁRIO para um CASAL\n\nR$ 550 - diária durante a semana\nR$ 680 - diária de sexta a domingo\nR$ 750 - diária em feriados e Natal\nR$ 900 - diárias no réveillon\n\nCobramos adicional de R$ 80 na diária para uma criança ou adulto extra.\n\nTrabalhamos com pagamento de 50% na data da reserva e 50% no dia do check-in.\n\nOs pagamentos são realizados via PIX, TED ou transferência bancária.',
    politica: 'POLÍTICA DE CANCELAMENTO\n\n🔴 O cancelamento precisa ser feito com, no mínimo, 15 dias de antecedência da data do check-in. Nesse caso, é possível:\n- deixar o valor de crédito para usar em outra oportunidade;\n- remarcar a reserva para outra data disponível; ou\n- solicitar devolução do valor pago.\n\n🔴 No show (não aparecer no dia da reserva sem avisar): paga hospedagem integralmente.',
    contato: 'Por favor nos envie sua dúvida ou sugestão que em breve responderemos.',
    certificadoFoto: '',
  },
  local: {
    titulo: 'Como chegar ao Guará Bangalôs',
    endereco: 'Região do Vale da Lua\nAlto Paraíso de Goiás · 73770-000',
    enderecoCompleto: 'Vale da Lua, Alto Paraíso de Goiás - GO, 73770-000',
    lat: '-14.1772768', lng: '-47.7788036',
    passos: [
      { titulo: 'Alto Paraíso de Goiás', sub: 'Cerca de 230 km de Brasília' },
      { titulo: 'GO-239, sentido São Jorge', sub: 'Estrada para a vila de São Jorge' },
      { titulo: 'Guará Bangalôs', sub: 'Região do Vale da Lua' },
    ],
  },
  precos: { semana: 550, fds: 680, feriado: 750, reveillon: 900, extra: 80, minNoites: 2, sinal: 50, diasFds: [5, 6, 0] },
  feriadosFixos: ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-24', '12-25'],
  feriados: [
    ['2026-11-20', '2026-11-21', 'Consciência Negra'], ['2026-12-24', '2026-12-26', 'Natal'],
    ['2026-12-30', '2027-01-02', 'Réveillon'], ['2027-02-06', '2027-02-09', 'Carnaval'],
    ['2027-03-26', '2027-03-27', 'Semana Santa'], ['2027-04-17', '2027-04-20', 'Tiradentes'],
  ],
  pix: { chave: 'pix-teste@guarabangalos.test', favorecido: 'GUARÁ BANGALÔS (TESTE)', banco: 'Banco de Teste 000', agencia: '0001', conta: '12345-6' },
  galeria: ['img/guara/por-do-sol-1.jpg', 'img/guara/por-do-sol-2.jpg', 'img/guara/por-do-sol-3.jpg', 'img/guara/por-do-sol-4.jpg', 'img/guara/f01.jpg', 'img/guara/f02.jpg', 'img/guara/f04.jpg', 'img/guara/f07.jpg', 'img/guara/f09.jpg', 'img/guara/f10.jpg', 'img/guara/f11.jpg', 'img/guara/f12.jpg', 'img/guara/f13.jpg', 'img/guara/f14.jpg', 'img/guara/f15.jpg', 'img/guara/f16.jpg', 'img/guara/f17.jpg', 'img/guara/f18.jpg', 'img/guara/f19.jpg', 'img/guara/f20.jpg', 'img/guara/f21.jpg', 'img/guara/f23.jpg', 'img/guara/f25.jpg', 'img/guara/f26.jpg', 'img/guara/f27.jpg', 'img/guara/f28.jpg', 'img/guara/f30.jpg', 'img/guara/f08.jpg'],
  unidades: unidadesPadrao(),
});

// mescla o salvo com o padrão (campos novos do padrão continuam aparecendo)
function mesclar(base, salvo) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return salvo === undefined ? base : salvo;
  const r = { ...base };
  for (const k in salvo || {}) r[k] = k in base ? mesclar(base[k], salvo[k]) : salvo[k];
  return r;
}
let CMS = mesclar(CMS_PADRAO(), JSON.parse(localStorage.getItem('tg_cms') || '{}'));
function salvarCMS() {
  try { localStorage.setItem('tg_cms', JSON.stringify(CMS)); return true; }
  catch (e) { alert('Não foi possível salvar: o espaço do navegador acabou.'); return false; }
}

// ---------- fotos enviadas: IndexedDB ----------
const MID = new Map(); // id -> URL temporária do arquivo
function abrirBanco() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('guara_midias', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('midias');
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
}
async function guardarMidia(blob) {
  const id = 'mid:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const bd = await abrirBanco();
  await new Promise((ok, erro) => { const t = bd.transaction('midias', 'readwrite'); t.objectStore('midias').put(blob, id); t.oncomplete = ok; t.onerror = () => erro(t.error); });
  MID.set(id, URL.createObjectURL(blob));
  return id;
}
async function carregarMidias() {
  try {
    const bd = await abrirBanco();
    await new Promise(ok => {
      const c = bd.transaction('midias').objectStore('midias').openCursor();
      c.onsuccess = () => { const k = c.result; if (!k) return ok(); MID.set(k.key, URL.createObjectURL(k.value)); k.continue(); };
      c.onerror = () => ok();
    });
  } catch (e) { /* sem IndexedDB: só as fotos do projeto */ }
}
// endereço de uma foto: arquivo do projeto ou foto enviada pela Gestão
const urlMidia = ref => (ref && ref.startsWith('mid:') ? MID.get(ref) || '' : ref || '');
const cmsPronto = carregarMidias();

// reduz a foto antes de guardar (máx. 1920px, JPEG) para caber no navegador
function reduzirFoto(arquivo, max = 1920) {
  if (/^video\//.test(arquivo.type)) return Promise.resolve(arquivo);
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? ok(b) : erro(new Error('falha')), 'image/jpeg', .86);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => erro(new Error('Arquivo de imagem inválido'));
    img.src = URL.createObjectURL(arquivo);
  });
}

// texto simples -> parágrafos (linha em branco separa parágrafos; quebra simples vira <br>)
const paragrafos = t => String(t || '').trim().split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

// usado pela prévia ao vivo da Gestão (troca o conteúdo sem salvar)
window.cmsAPI = { usar: c => { CMS = c; }, midias: MID };
