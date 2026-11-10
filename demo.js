// Dados fictícios de demonstração: hóspedes, reservas e e-mails.
// Entram uma única vez por navegador, com datas relativas a hoje, para o site e a Gestão não abrirem vazios.
// Todos os nomes, CPFs, telefones e e-mails são inventados (domínio .test).
const SENHA_DEMO = '0b415650fc95bfff9cc2959c8b49f10db1b5e40efb4740980b9095f570803cde'; // "demo1234"

function semearDemo(forcar = false) {
  if (!forcar && localStorage.getItem('tg_demo')) return;
  const d = hoje(), dia = n => somaDia(d, n), ha = n => new Date(Date.now() - n * 864e5).toISOString();
  const hs = [
    { id: 'HDEMO1', nome: 'Maria Teste', cpf: '52998224725', celular: '(61) 90000-0001', email: 'maria@teste.test', estado: 'DF' },
    { id: 'HDEMO2', nome: 'João Exemplo', cpf: '11144477735', celular: '(62) 90000-0002', email: 'joao@teste.test', estado: 'GO' },
    { id: 'HDEMO3', nome: 'Ana Fictícia', cpf: '39053344705', celular: '(11) 90000-0003', email: 'ana@teste.test', estado: 'SP' },
    { id: 'HDEMO4', nome: 'Carlos Modelo', cpf: '15350946056', celular: '(31) 90000-0004', email: 'carlos@teste.test', estado: 'MG' },
  ].map(h => ({ ...h, criado: ha(30), senha: SENHA_DEMO }));
  const r = (id, h, u, ent, sai, status, criada, extra = {}) => {
    const un = unidade(u), hosp = hs.find(x => x.id === h), o = orcamento(un, ent, sai, extra.adultos || 2, 0);
    return { id, criada: ha(criada), status, hospede: h, unidade: u, entrada: ent, saida: sai, adultos: extra.adultos || 2, criancas: 0, bebe: 0,
      total: o.total, sinal: o.sinal, nome: hosp.nome, email: hosp.email, telefone: hosp.celular, cpf: hosp.cpf, chegada: extra.chegada || '16:00',
      pagamento: 'PIX', obs: extra.obs || '', ...(status === 'comprovante' ? { comprovante: { nome: 'comprovante-pix.pdf', tamanho: 48000, data: ha(0) } } : {}) };
  };
  const rs = [
    r('TGDEMO01', 'HDEMO1', 1, dia(-2), dia(1), 'confirmada', 20, { obs: 'Comemorando aniversário de casamento.' }),
    r('TGDEMO02', 'HDEMO2', 5, dia(0), dia(3), 'confirmada', 15, { adultos: 4, chegada: '17:30' }),
    r('TGDEMO03', 'HDEMO3', 2, dia(3), dia(6), 'comprovante', 2),
    r('TGDEMO04', 'HDEMO4', 3, dia(5), dia(7), 'aguardando', 3, { obs: 'Chegaremos de moto.' }),
    r('TGDEMO05', 'HDEMO1', 4, dia(9), dia(12), 'confirmada', 6),
    r('TGDEMO06', 'HDEMO2', 1, dia(16), dia(19), 'aguardando', 0),
    r('TGDEMO07', 'HDEMO3', 3, dia(24), dia(27), 'confirmada', 8),
    r('TGDEMO08', 'HDEMO4', 2, dia(-12), dia(-9), 'confirmada', 40),
    r('TGDEMO09', 'HDEMO4', 1, dia(30), dia(32), 'cancelada', 5),
  ];
  const em = (para, assunto, corpo, dias) => ({ id: 'MDEMO' + Math.random().toString(36).slice(2, 8), data: ha(dias), para, assunto, corpo });
  const emails = [
    em('maria@teste.test', `[${CMS.marca.nome}] Reserva TGDEMO01 confirmada!`, `<p>Olá, Maria! Recebemos o sinal e sua reserva está confirmada.</p><p>${linhaReserva(rs[0])}</p>`, 19),
    em(POUSADA_EMAIL, '[Site] Comprovante da reserva TGDEMO03', `<p>Ana Fictícia enviou o comprovante <b>comprovante-pix.pdf</b>.</p><p>${linhaReserva(rs[2])}</p>`, 0),
    em('carlos@teste.test', `[${CMS.marca.nome}] Pré-reserva TGDEMO04 recebida`, `<p>Olá, Carlos! Recebemos sua pré-reserva. Pague o sinal para garantir as datas.</p><p>${linhaReserva(rs[3])}</p>`, 3),
    em(POUSADA_EMAIL, '[Site] Nova pré-reserva TGDEMO06', `<p>Nova pré-reserva de <b>João Exemplo</b>.</p><p>${linhaReserva(rs[5])}</p>`, 0),
  ];
  // junta com o que já existir no navegador, sem duplicar
  const junta = (k, novos) => { const atuais = db.get(k).filter(x => !novos.some(n => n.id === x.id)); db.set(k, [...atuais, ...novos]); };
  junta('hospedes', hs); junta('reservas', rs); junta('emails', emails);
  localStorage.setItem('tg_demo', d);
}
window.semearDemo = semearDemo;
addEventListener('DOMContentLoaded', () => cmsPronto.then(() => semearDemo()));
