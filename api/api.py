#!/usr/bin/env python3
"""API do site Guará Bangalôs.

Guarda reservas, hóspedes, mensagens de contato e o conteúdo editável num banco SQLite
e envia os e-mails pelo Resend. Só usa a biblioteca padrão do Python (3.10+).

Configuração por variáveis de ambiente (em produção: /etc/guara-api.env):
  GUARA_PORTA        porta local (padrão 8093)
  GUARA_DADOS        pasta do banco e dos arquivos enviados (padrão ./dados)
  GUARA_ESTATICO     pasta do site, só para testar localmente (em produção o Caddy serve o site)
  RESEND_API_KEY     chave do Resend; sem ela os e-mails ficam só registrados na Gestão
  EMAIL_DE           remetente, ex.: Guará Bangalôs <reservas@guarabangalos.com.br>
  EMAIL_POUSADA      quem recebe os avisos, ex.: guarabangalos@gmail.com
  ADMIN_USUARIO      usuário da Gestão (padrão admin)
  ADMIN_SENHA_HASH   gerado com: python3 api.py --hash-senha
  SITE_URL           ex.: https://guarabangalos.com.br
  CORS_ORIGENS       origens extras separadas por vírgula (ex.: o GitHub Pages)
  WHATSAPP_NUMERO    celular da pousada com DDI e DDD, só números (ex.: 5561999998888)
  WHATSAPP_MODO      evolution ou callmebot (vazio = sem aviso por WhatsApp)
  EVOLUTION_URL, EVOLUTION_INSTANCIA, EVOLUTION_CHAVE   para o modo evolution (Evolution API)
  CALLMEBOT_CHAVE    para o modo callmebot (grátis; a chave chega no WhatsApp do número cadastrado)
  LEMBRETE_DIAS      quantos dias antes do check-in mandar o lembrete (padrão 3)
"""
import base64, hashlib, hmac, json, mimetypes, os, re, secrets, sqlite3, sys, threading, time
import urllib.request, urllib.error, urllib.parse
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORTA = int(os.environ.get('GUARA_PORTA', '8093'))
DADOS = Path(os.environ.get('GUARA_DADOS', Path(__file__).with_name('dados')))
ESTATICO = os.environ.get('GUARA_ESTATICO')
RESEND_KEY = os.environ.get('RESEND_API_KEY', '').strip()
EMAIL_DE = os.environ.get('EMAIL_DE', 'Guará Bangalôs <reservas@guarabangalos.com.br>')
EMAIL_POUSADA = os.environ.get('EMAIL_POUSADA', 'guarabangalos@gmail.com')
ADMIN_USUARIO = os.environ.get('ADMIN_USUARIO', 'admin').lower()
ADMIN_SENHA_HASH = os.environ.get('ADMIN_SENHA_HASH', '')
SITE_URL = os.environ.get('SITE_URL', 'https://guarabangalos.com.br').rstrip('/')
CORS = {o.strip() for o in os.environ.get('CORS_ORIGENS', '').split(',') if o.strip()}
WPP_NUMERO = re.sub(r'\D', '', os.environ.get('WHATSAPP_NUMERO', ''))
WPP_MODO = os.environ.get('WHATSAPP_MODO', '').strip().lower() if WPP_NUMERO else ''
EVO_URL = os.environ.get('EVOLUTION_URL', '').rstrip('/')
EVO_INST = os.environ.get('EVOLUTION_INSTANCIA', '')
EVO_CHAVE = os.environ.get('EVOLUTION_CHAVE', '')
CMB_CHAVE = os.environ.get('CALLMEBOT_CHAVE', '')
LEMBRETE_DIAS = int(os.environ.get('LEMBRETE_DIAS', '3'))
MAX_CORPO = 8 * 1024 * 1024
STATUS = {'aguardando': 'Aguardando pagamento', 'comprovante': 'Comprovante enviado', 'confirmada': 'Confirmada', 'cancelada': 'Cancelada'}

DADOS.mkdir(parents=True, exist_ok=True)
(DADOS / 'arquivos').mkdir(exist_ok=True)
(DADOS / 'midia').mkdir(exist_ok=True)
BANCO = DADOS / 'guara.db'
TRAVA = threading.Lock()  # operações que leem e gravam (ex.: checar datas livres e criar a reserva)


# ---------------------------------------------------------------- banco
def conexao():
    c = sqlite3.connect(BANCO, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c


def criar_banco():
    with conexao() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS hospedes (
          id TEXT PRIMARY KEY, criado TEXT, nome TEXT, cpf TEXT UNIQUE, celular TEXT,
          email TEXT UNIQUE COLLATE NOCASE, estado TEXT, senha TEXT,
          codigo TEXT, codigo_tipo TEXT, codigo_ate REAL, codigo_erros INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS reservas (
          id TEXT PRIMARY KEY, criada TEXT, status TEXT, hospede TEXT REFERENCES hospedes(id),
          unidade INTEGER, unidade_nome TEXT, entrada TEXT, saida TEXT, adultos INTEGER, criancas INTEGER, bebe INTEGER,
          total REAL, sinal REAL, nome TEXT, email TEXT, telefone TEXT, cpf TEXT, chegada TEXT, pagamento TEXT, obs TEXT,
          comprovante_nome TEXT, comprovante_arq TEXT, comprovante_data TEXT, confirmada TEXT);
        CREATE INDEX IF NOT EXISTS reservas_un ON reservas(unidade, entrada);
        CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, tipo TEXT, hospede TEXT, expira REAL);
        CREATE TABLE IF NOT EXISTS emails (id TEXT PRIMARY KEY, data TEXT, para TEXT, assunto TEXT, corpo TEXT, status TEXT);
        CREATE TABLE IF NOT EXISTS contatos (id TEXT PRIMARY KEY, data TEXT, nome TEXT, email TEXT, telefone TEXT,
          assunto TEXT, datas TEXT, mensagem TEXT, lida INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS cms (id INTEGER PRIMARY KEY CHECK (id = 1), conteudo TEXT, atualizado TEXT);
        CREATE TABLE IF NOT EXISTS auditoria (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, quem TEXT, ip TEXT, acao TEXT, detalhe TEXT, resultado TEXT);
        CREATE TABLE IF NOT EXISTS whatsapp (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, texto TEXT, status TEXT);
        ''')
        colunas = {r[1] for r in c.execute('PRAGMA table_info(reservas)')}
        for col in ('lembrete_checkin', 'cobranca_sinal'):
            if col not in colunas:
                c.execute(f'ALTER TABLE reservas ADD COLUMN {col} TEXT')


def auditar(req, acao, detalhe='', resultado='ok', quem=None):
    """Registra uma operação importante (nunca senhas, códigos ou tokens). Guarda 1 ano."""
    quem = quem or ('admin' if req.tipo == 'admin' else req.hospede or 'visitante')
    with conexao() as c:
        c.execute('INSERT INTO auditoria (data,quem,ip,acao,detalhe,resultado) VALUES (?,?,?,?,?,?)', (agora(), quem, req.ip, acao, str(detalhe)[:300], resultado))
        c.execute('DELETE FROM auditoria WHERE data < ?', ((datetime.now(timezone.utc) - timedelta(days=365)).isoformat(),))


def agora():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def novo_id(prefixo):
    return prefixo + format(int(time.time() * 1000), 'x').upper()[-7:] + secrets.token_hex(2).upper()


# ---------------------------------------------------------------- senhas e sessões
def hash_senha(senha, sal=None, it=600_000):
    sal = sal or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', senha.encode(), bytes.fromhex(sal), it).hex()
    return f'pbkdf2${it}${sal}${h}'


def confere_senha(senha, guardado):
    try:
        _, it, sal, h = guardado.split('$')
        return hmac.compare_digest(hash_senha(senha, sal, int(it)).split('$')[3], h)
    except (ValueError, AttributeError):
        return False


def nova_sessao(c, tipo, hospede=None, lembrar=False):
    token = secrets.token_urlsafe(32)
    c.execute('DELETE FROM sessoes WHERE expira < ?', (time.time(),))
    c.execute('INSERT INTO sessoes VALUES (?,?,?,?)', (token, tipo, hospede, time.time() + (30 if lembrar else 1) * 86400))
    return token


# limites por IP (memória): tentativas de login e envios de formulário
LIMITES = {}
def limite(chave, maximo, janela):
    """True se passou do limite de `maximo` eventos em `janela` segundos."""
    t = time.time()
    l = [x for x in LIMITES.get(chave, []) if x > t - janela]
    LIMITES[chave] = l
    return len(l) >= maximo


def registra(chave):
    LIMITES.setdefault(chave, []).append(time.time())


# ---------------------------------------------------------------- e-mail (Resend)
def esc(s):
    return str(s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def moeda(v):
    s = f'{float(v or 0):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return 'R$ ' + s


def dbr(iso):
    return '/'.join(reversed(str(iso).split('-')))


def molde(corpo):
    return f'''<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2A2118;line-height:1.55">
<div style="border-bottom:3px solid #A0522D;padding:14px 0;margin-bottom:18px;font:bold 20px Georgia,serif">Guará Bangalôs</div>
{corpo}
<p style="margin-top:28px;font-size:12px;color:#7a6f64">Guará Bangalôs · Vale da Lua, Alto Paraíso de Goiás (GO) · <a href="{SITE_URL}" style="color:#A0522D">{SITE_URL.replace("https://", "")}</a></p></div>'''


def enviar_email(para, assunto, corpo, responder_para=None, anexos=None):
    """Registra o e-mail (aparece na Gestão) e envia em segundo plano."""
    mid = novo_id('M')
    with conexao() as c:
        c.execute('INSERT INTO emails VALUES (?,?,?,?,?,?)', (mid, agora(), para, assunto, corpo, 'enviando' if RESEND_KEY else 'não enviado (sem chave do Resend)'))
    if not RESEND_KEY:
        return

    def tarefa():
        dados = {'from': EMAIL_DE, 'to': [para], 'subject': assunto, 'html': molde(corpo)}
        if responder_para:
            dados['reply_to'] = responder_para
        if anexos:
            dados['attachments'] = anexos
        req = urllib.request.Request('https://api.resend.com/emails', data=json.dumps(dados).encode(), method='POST',
                                     headers={'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json', 'User-Agent': 'guara-api/1'})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                status = 'enviado' if r.status < 300 else f'erro {r.status}'
        except urllib.error.HTTPError as e:
            status = f'erro {e.code}: {e.read()[:200].decode(errors="ignore")}'
        except Exception as e:  # rede fora do ar etc.
            status = f'erro: {e}'[:250]
        with conexao() as c:
            c.execute('UPDATE emails SET status=? WHERE id=?', (status, mid))
    threading.Thread(target=tarefa, daemon=True).start()


# ---------------------------------------------------------------- aviso por WhatsApp para a pousada
def avisar_whatsapp(texto):
    """Manda uma mensagem curta para o WhatsApp da pousada (se configurado). Nunca trava o site."""
    if not WPP_MODO:
        return
    def tarefa():
        try:
            if WPP_MODO == 'evolution':
                req = urllib.request.Request(f'{EVO_URL}/message/sendText/{urllib.parse.quote(EVO_INST)}', method='POST',
                                             data=json.dumps({'number': WPP_NUMERO, 'text': texto, 'textMessage': {'text': texto}}).encode(),
                                             headers={'apikey': EVO_CHAVE, 'Content-Type': 'application/json', 'User-Agent': 'guara-api/1'})
            else:
                q = urllib.parse.urlencode({'phone': '+' + WPP_NUMERO, 'text': texto, 'apikey': CMB_CHAVE})
                req = urllib.request.Request('https://api.callmebot.com/whatsapp.php?' + q, headers={'User-Agent': 'guara-api/1'})
            with urllib.request.urlopen(req, timeout=20) as r:
                status = 'enviado' if r.status < 300 else f'erro {r.status}'
        except urllib.error.HTTPError as e:
            status = f'erro {e.code}'
        except Exception as e:
            status = f'erro: {e}'[:200]
        with conexao() as c:
            c.execute('INSERT INTO whatsapp (data,texto,status) VALUES (?,?,?)', (agora(), texto[:500], status))
    threading.Thread(target=tarefa, daemon=True).start()


def linha_reserva(r):
    hosp = f"{r['adultos']} adulto(s)" + (f", {r['criancas']} criança(s)" if r['criancas'] else '')
    return f"{esc(r['unidade_nome'])} · {dbr(r['entrada'])} a {dbr(r['saida'])} · {hosp} · total {moeda(r['total'])}"


def link_reserva(r):
    return f"{SITE_URL}/#/confirmacao/{r['id']}"


# ---------------------------------------------------------------- validação
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def so_dig(s):
    return re.sub(r'\D', '', str(s or ''))


def cpf_valido(c):
    c = so_dig(c)
    if len(c) != 11 or len(set(c)) == 1:
        return False
    for t in (9, 10):
        s = sum(int(c[i]) * (t + 1 - i) for i in range(t))
        if (s * 10 % 11) % 10 != int(c[t]):
            return False
    return True


def data_iso(s):
    try:
        return date.fromisoformat(str(s))
    except ValueError:
        return None


# ---------------------------------------------------------------- preços (mesma regra do site, conferida aqui)
def cms_atual(c):
    r = c.execute('SELECT conteudo FROM cms WHERE id=1').fetchone()
    return json.loads(r['conteudo']) if r else None


def orcamento(cms, un, ent, sai, adultos, criancas):
    p = cms['precos']
    u = next((x for x in cms['unidades'] if int(x['id']) == un), None)
    if not u:
        raise Erro('Unidade não encontrada.')
    if adultos + criancas > int(u.get('capacidade') or 99):
        raise Erro(f"Esta unidade recebe até {u['capacidade']} pessoas.")
    noites = [ent + timedelta(days=i) for i in range((sai - ent).days)]
    if len(noites) < int(p.get('minNoites') or 1):
        raise Erro(f"Mínimo de {p['minNoites']} diárias.")
    for a, b, nome in cms.get('feriados') or []:
        fim = str(date.fromisoformat(b) + timedelta(days=1))
        if str(ent) <= b and str(sai) > a and (str(ent) > a or str(sai) < fim):
            raise Erro(f'Feriado prolongado ({nome}): somente reservas para todo o período, de {dbr(a)} a {dbr(fim)}.')
    extras = max(0, adultos + criancas - int(u.get('inclusos') or 2))
    total = 0
    for d in noites:
        iso, md, dow = str(d), str(d)[5:], (d.weekday() + 1) % 7
        v = float(p['semana'])
        if dow in [int(x) for x in p.get('diasFds') or []]: v = float(p['fds'])
        if md in (cms.get('feriadosFixos') or []) or any(f[0] <= iso <= f[1] for f in cms.get('feriados') or []): v = float(p['feriado'])
        if md in ('12-30', '12-31'): v = float(p['reveillon'])
        total += round(v * float(u.get('ajuste') or 100) / 100) + extras * float(p['extra'])
    return u, total, round(total * float(p.get('sinal') or 50)) / 100


class Erro(Exception):
    def __init__(self, msg, codigo=400, campo=None):
        super().__init__(msg)
        self.codigo, self.campo = codigo, campo


def publico_hospede(h):
    return {k: h[k] for k in ('id', 'criado', 'nome', 'cpf', 'celular', 'email', 'estado')}


def publica_reserva(r):
    d = dict(r)
    d.pop('comprovante_arq', None)
    d['comprovante'] = {'nome': d.pop('comprovante_nome'), 'data': d.pop('comprovante_data')} if d.get('comprovante_nome') else None
    d.pop('comprovante_nome', None); d.pop('comprovante_data', None)
    return d


# ---------------------------------------------------------------- rotas
ROTAS = []
def rota(metodo, padrao, quem=None):
    def deco(f):
        ROTAS.append((metodo, re.compile('^' + padrao + '$'), quem, f))
        return f
    return deco


@rota('GET', '/api/saude')
def saude(req):
    return {'ok': True, 'email': bool(RESEND_KEY), 'whatsapp': bool(WPP_MODO)}


@rota('GET', '/api/ocupacao')
def ocupacao(req):
    with conexao() as c:
        rs = c.execute("SELECT unidade, entrada, saida FROM reservas WHERE status != 'cancelada' AND saida >= ?", (str(date.today() - timedelta(days=1)),)).fetchall()
    return [dict(r) for r in rs]


@rota('GET', '/api/cms')
def cms_ler(req):
    with conexao() as c:
        r = c.execute('SELECT conteudo FROM cms WHERE id=1').fetchone()
    return json.loads(r['conteudo']) if r else {}


@rota('PUT', '/api/cms', 'admin')
def cms_salvar(req):
    with conexao() as c:
        c.execute('INSERT INTO cms VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET conteudo=excluded.conteudo, atualizado=excluded.atualizado',
                  (json.dumps(req.json, ensure_ascii=False), agora()))
    auditar(req, 'conteúdo do site alterado')
    return {'ok': True}


@rota('POST', '/api/midia', 'admin')
def midia_enviar(req):
    tipo = req.headers.get('Content-Type', '')
    ext = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm'}.get(tipo.split(';')[0])
    if not ext:
        raise Erro('Formato não aceito. Use JPG, PNG, WEBP ou MP4.')
    nome = secrets.token_hex(8) + ext
    (DADOS / 'midia' / nome).write_bytes(req.corpo)
    return {'url': '/api/midia/' + nome}


@rota('GET', r'/api/midia/([0-9a-f]{16}\.(?:jpg|png|webp|mp4|webm))')
def midia_ler(req, nome):
    arq = DADOS / 'midia' / nome
    if not arq.exists():
        raise Erro('Arquivo não encontrado.', 404)
    return ('arquivo', arq, mimetypes.guess_type(nome)[0], 'public, max-age=31536000, immutable')


# ----- contas de hóspedes
@rota('POST', '/api/cadastro')
def cadastro(req):
    d = req.json
    if limite('cad:' + req.ip, 10, 3600):
        raise Erro('Muitos cadastros seguidos. Tente mais tarde.', 429)
    nome, email, senha = str(d.get('nome', '')).strip(), str(d.get('email', '')).strip(), str(d.get('senha', ''))
    if len(nome.split()) < 2: raise Erro('Informe nome e sobrenome.', campo='nome')
    if not cpf_valido(d.get('cpf')): raise Erro('CPF inválido.', campo='cpf')
    if len(so_dig(d.get('celular'))) < 10: raise Erro('Celular incompleto.', campo='celular')
    if not EMAIL_RE.match(email): raise Erro('E-mail inválido.', campo='email')
    if len(senha) < 6: raise Erro('A senha precisa ter pelo menos 6 caracteres.', campo='senha')
    if email.lower() == ADMIN_USUARIO:
        raise Erro('Este e-mail não pode ser usado para cadastro de hóspede.', campo='email')
    with TRAVA, conexao() as c:
        if c.execute('SELECT 1 FROM hospedes WHERE cpf=?', (so_dig(d['cpf']),)).fetchone():
            raise Erro('Já existe uma conta com este CPF.', campo='cpf')
        if c.execute('SELECT 1 FROM hospedes WHERE email=?', (email,)).fetchone():
            raise Erro('Já existe uma conta com este e-mail.', campo='email')
        hid = novo_id('H')
        c.execute('INSERT INTO hospedes (id,criado,nome,cpf,celular,email,estado,senha) VALUES (?,?,?,?,?,?,?,?)',
                  (hid, agora(), nome, so_dig(d['cpf']), str(d.get('celular', ''))[:20], email, str(d.get('estado', ''))[:2], hash_senha(senha)))
        token = nova_sessao(c, 'hospede', hid)
    registra('cad:' + req.ip)
    enviar_email(email, '[Guará Bangalôs] Cadastro realizado', f'<p>Olá, {esc(nome)}!</p><p>Seu cadastro no site da Guará Bangalôs foi criado. Use seu e-mail ou CPF para entrar.</p>')
    return {'token': token, 'tipo': 'hospede'}


@rota('POST', '/api/login')
def login(req):
    d = req.json
    chave = 'login:' + req.ip
    if limite(chave, 5, 300):
        auditar(req, 'login bloqueado por excesso de tentativas', resultado='bloqueado')
        raise Erro('Muitas tentativas. Tente de novo em alguns minutos ou entre com código por e-mail.', 429)
    usuario, senha = str(d.get('usuario', '')).strip().lower(), str(d.get('senha', ''))
    with conexao() as c:
        if usuario == ADMIN_USUARIO:
            if ADMIN_SENHA_HASH and confere_senha(senha, ADMIN_SENHA_HASH):
                auditar(req, 'login da Gestão', quem='admin')
                return {'token': nova_sessao(c, 'admin', None, d.get('lembrar')), 'tipo': 'admin'}
        else:
            dig = so_dig(usuario)
            h = c.execute('SELECT * FROM hospedes WHERE email=? OR (cpf=? AND length(?)=11)', (usuario, dig, dig)).fetchone()
            if h and confere_senha(senha, h['senha']):
                auditar(req, 'login de hóspede', quem=h['id'])
                return {'token': nova_sessao(c, 'hospede', h['id'], d.get('lembrar')), 'tipo': 'hospede'}
    registra(chave)
    auditar(req, 'login recusado', 'usuário: ' + ('admin' if usuario == ADMIN_USUARIO else usuario[:60]), 'falhou')
    restam = 5 - len(LIMITES.get(chave, []))
    raise Erro('Usuário ou senha inválidos.' + (f' Restam {restam} tentativa(s).' if restam <= 2 else ''), 401)


@rota('POST', '/api/sair')
def sair(req):
    if req.token:
        with conexao() as c:
            c.execute('DELETE FROM sessoes WHERE token=?', (req.token,))
    return {'ok': True}


def pedir_codigo(req, tipo):
    email = str(req.json.get('email', '')).strip()
    if limite('cod:' + req.ip, 5, 900):
        raise Erro('Muitos pedidos de código. Aguarde alguns minutos.', 429)
    registra('cod:' + req.ip)
    with conexao() as c:
        h = c.execute('SELECT * FROM hospedes WHERE email=?', (email,)).fetchone()
        if h:
            cod = f'{secrets.randbelow(900000) + 100000}'
            minutos = 10 if tipo == 'login' else 30
            c.execute('UPDATE hospedes SET codigo=?, codigo_tipo=?, codigo_ate=?, codigo_erros=0 WHERE id=?', (cod, tipo, time.time() + minutos * 60, h['id']))
            c.commit()
            if tipo == 'login':
                enviar_email(h['email'], '[Guará Bangalôs] Seu código de acesso', f'<p>Use o código abaixo para entrar no site da Guará Bangalôs. Ele vale por 10 minutos.</p><p style="font-size:26px;letter-spacing:4px"><b>{cod}</b></p><p>Se não foi você, ignore este e-mail.</p>')
            else:
                enviar_email(h['email'], '[Guará Bangalôs] Código para redefinir a senha', f'<p>Seu código de verificação é:</p><p style="font-size:26px;letter-spacing:4px"><b>{cod}</b></p><p>Ele vale por 30 minutos. Se não foi você, ignore este e-mail.</p>')
    return {'ok': True}  # não revela se o e-mail existe


def usar_codigo(c, email, codigo, tipo):
    h = c.execute('SELECT * FROM hospedes WHERE email=?', (str(email).strip(),)).fetchone()
    if not h or h['codigo_tipo'] != tipo or not h['codigo'] or time.time() > (h['codigo_ate'] or 0) or (h['codigo_erros'] or 0) >= 5:
        raise Erro('Código inválido ou expirado.', 400, 'codigo')
    if not hmac.compare_digest(h['codigo'], str(codigo).strip()):
        c.execute('UPDATE hospedes SET codigo_erros=codigo_erros+1 WHERE id=?', (h['id'],))
        c.commit()
        raise Erro('Código inválido ou expirado.', 400, 'codigo')
    c.execute('UPDATE hospedes SET codigo=NULL, codigo_tipo=NULL, codigo_ate=NULL, codigo_erros=0 WHERE id=?', (h['id'],))
    return h


@rota('POST', '/api/codigo-login')
def codigo_login(req):
    return pedir_codigo(req, 'login')


@rota('POST', '/api/entrar-codigo')
def entrar_codigo(req):
    with conexao() as c:
        h = usar_codigo(c, req.json.get('email', ''), req.json.get('codigo', ''), 'login')
        return {'token': nova_sessao(c, 'hospede', h['id']), 'tipo': 'hospede'}


@rota('POST', '/api/recuperar')
def recuperar(req):
    return pedir_codigo(req, 'reset')


@rota('POST', '/api/redefinir')
def redefinir(req):
    senha = str(req.json.get('senha', ''))
    if len(senha) < 6:
        raise Erro('A senha precisa ter pelo menos 6 caracteres.', campo='senha')
    with conexao() as c:
        h = usar_codigo(c, req.json.get('email', ''), req.json.get('codigo', ''), 'reset')
        c.execute('UPDATE hospedes SET senha=? WHERE id=?', (hash_senha(senha), h['id']))
        c.execute("DELETE FROM sessoes WHERE hospede=?", (h['id'],))
    auditar(req, 'senha redefinida por código', quem=h['id'])
    enviar_email(h['email'], '[Guará Bangalôs] Sua senha foi alterada', '<p>A senha da sua conta foi alterada. Se não foi você, fale conosco pelo WhatsApp.</p>')
    return {'ok': True}


@rota('GET', '/api/eu', 'hospede')
def eu(req):
    with conexao() as c:
        h = c.execute('SELECT * FROM hospedes WHERE id=?', (req.hospede,)).fetchone()
        rs = c.execute('SELECT * FROM reservas WHERE hospede=? ORDER BY entrada', (req.hospede,)).fetchall()
    return {'hospede': publico_hospede(h), 'reservas': [publica_reserva(r) for r in rs]}


@rota('PUT', '/api/eu', 'hospede')
def eu_salvar(req):
    d = req.json
    nome, email = str(d.get('nome', '')).strip(), str(d.get('email', '')).strip()
    if len(nome.split()) < 2: raise Erro('Informe nome e sobrenome.', campo='nome')
    if len(so_dig(d.get('celular'))) < 10: raise Erro('Celular incompleto.', campo='celular')
    if not EMAIL_RE.match(email): raise Erro('E-mail inválido.', campo='email')
    with TRAVA, conexao() as c:
        h = c.execute('SELECT * FROM hospedes WHERE id=?', (req.hospede,)).fetchone()
        if c.execute('SELECT 1 FROM hospedes WHERE email=? AND id!=?', (email, h['id'])).fetchone():
            raise Erro('Este e-mail já é usado por outra conta.', campo='email')
        c.execute('UPDATE hospedes SET nome=?, celular=?, email=?, estado=? WHERE id=?', (nome, str(d.get('celular', ''))[:20], email, str(d.get('estado', ''))[:2], h['id']))
    if h['email'].lower() != email.lower():
        enviar_email(h['email'], '[Guará Bangalôs] E-mail da conta alterado', f'<p>O e-mail da sua conta foi alterado para {esc(email)}. Se não foi você, fale conosco.</p>')
    return {'ok': True}


@rota('POST', '/api/eu/senha', 'hospede')
def eu_senha(req):
    d = req.json
    with conexao() as c:
        h = c.execute('SELECT * FROM hospedes WHERE id=?', (req.hospede,)).fetchone()
        if not confere_senha(str(d.get('atual', '')), h['senha']): raise Erro('Senha atual incorreta.', campo='atual')
        if len(str(d.get('senha', ''))) < 6: raise Erro('A senha precisa ter pelo menos 6 caracteres.', campo='senha')
        c.execute('UPDATE hospedes SET senha=? WHERE id=?', (hash_senha(d['senha']), h['id']))
    enviar_email(h['email'], '[Guará Bangalôs] Sua senha foi alterada', '<p>A senha da sua conta foi alterada. Se não foi você, fale conosco pelo WhatsApp.</p>')
    return {'ok': True}


# ----- reservas
@rota('POST', '/api/reservas', 'hospede')
def reservar(req):
    d = req.json
    ent, sai = data_iso(d.get('entrada')), data_iso(d.get('saida'))
    if not ent or not sai or sai <= ent: raise Erro('Datas inválidas.')
    if ent < date.today(): raise Erro('A data de entrada já passou.')
    if (sai - ent).days > 60: raise Erro('Para estadias acima de 60 noites, fale conosco.')
    try:
        un, adultos, criancas, bebe = int(d['unidade']), int(d.get('adultos', 1)), int(d.get('criancas', 0)), int(d.get('bebe', 0))
        total, sinal = round(float(d['total']), 2), round(float(d['sinal']), 2)
    except (KeyError, TypeError, ValueError):
        raise Erro('Dados da reserva incompletos.')
    if adultos < 1 or criancas < 0 or bebe < 0: raise Erro('Dados da reserva inválidos.')
    with TRAVA, conexao() as c:
        h = c.execute('SELECT * FROM hospedes WHERE id=?', (req.hospede,)).fetchone()
        cms = cms_atual(c)
        if not cms:
            raise Erro('Reservas pelo site ainda não foram ativadas. Fale conosco pelo WhatsApp.', 503)
        u, total_srv, sinal_srv = orcamento(cms, un, ent, sai, adultos, criancas)
        if abs(total_srv - total) > 0.5:
            auditar(req, 'reserva: valor divergente', f'enviado {total}, correto {total_srv}', 'recusado')
            raise Erro('Os preços foram atualizados. Recarregue a página e confira o novo total.', 409)
        total, sinal = total_srv, sinal_srv
        if c.execute("SELECT 1 FROM reservas WHERE unidade=? AND status!='cancelada' AND entrada < ? AND saida > ?", (un, str(sai), str(ent))).fetchone():
            raise Erro('Essas datas acabaram de ficar indisponíveis. Escolha outras no calendário.', 409)
        r = {'id': novo_id('GB'), 'criada': agora(), 'status': 'aguardando', 'hospede': h['id'], 'unidade': un,
             'unidade_nome': str(u.get('nome'))[:80], 'entrada': str(ent), 'saida': str(sai),
             'adultos': adultos, 'criancas': criancas, 'bebe': bebe, 'total': total, 'sinal': sinal,
             'nome': str(d.get('nome') or h['nome'])[:120], 'email': h['email'], 'telefone': str(d.get('celular') or h['celular'])[:20],
             'cpf': h['cpf'], 'chegada': str(d.get('chegada', ''))[:5], 'pagamento': str(d.get('pagamento', ''))[:30], 'obs': str(d.get('obs', ''))[:1000]}
        c.execute(f"INSERT INTO reservas ({','.join(r)}) VALUES ({','.join('?' * len(r))})", tuple(r.values()))
    auditar(req, 'reserva criada', f"{r['id']} {r['unidade_nome']} {r['entrada']} a {r['saida']} {moeda(total)}")
    enviar_email(r['email'], f"[Guará Bangalôs] Pré-reserva {r['id']} recebida",
                 f"<p>Olá, {esc(r['nome'])}!</p><p>Recebemos sua pré-reserva:</p><p><b>{linha_reserva(r)}</b></p>"
                 f"<p>Para garantir as datas, pague o sinal de <b>{moeda(r['sinal'])}</b> e envie o comprovante pelo site. Os dados para pagamento estão na página da reserva:</p>"
                 f"<p><a href=\"{link_reserva(r)}\" style=\"background:#A0522D;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none\">Ver reserva e pagar o sinal</a></p>"
                 f"<p>O restante ({moeda(r['total'] - r['sinal'])}) é pago no check-in. Check-in a partir das 15h, check-out até as 12h.</p>")
    enviar_email(EMAIL_POUSADA, f"[Site] Nova pré-reserva {r['id']} — {r['nome']}",
                 f"<p>Nova pré-reserva de <b>{esc(r['nome'])}</b> ({esc(r['email'])}, {esc(r['telefone'])}):</p><p>{linha_reserva(r)}</p>"
                 f"<p>Chegada prevista: {esc(r['chegada'] or '—')} · Pagamento: {esc(r['pagamento'])}</p><p>Observações: {esc(r['obs'] or '—')}</p>"
                 f"<p><a href=\"{SITE_URL}/#/gestao?aba=reservas&busca={r['id']}\">Abrir na Gestão</a></p>", responder_para=r['email'])
    avisar_whatsapp(f"🏡 Nova pré-reserva {r['id']}\n{r['nome']} · {r['telefone']}\n{r['unidade_nome']}: {dbr(r['entrada'])} a {dbr(r['saida'])}\nTotal {moeda(r['total'])} · sinal {moeda(r['sinal'])}\n{SITE_URL}/#/gestao?aba=reservas&busca={r['id']}")
    return publica_reserva(r)


def reserva_do(c, rid, req):
    r = c.execute('SELECT * FROM reservas WHERE id=?', (rid,)).fetchone()
    if not r or (req.tipo != 'admin' and r['hospede'] != req.hospede):
        raise Erro('Reserva não encontrada.', 404)
    return r


@rota('POST', r'/api/reservas/([A-Z0-9]+)/comprovante', 'hospede')
def comprovante(req, rid):
    nome = re.sub(r'[^\w.\- ]', '_', urllib.parse.unquote(req.headers.get('X-Arquivo', 'comprovante')))[:80]
    tipo = req.headers.get('Content-Type', '').split(';')[0]
    if tipo not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/heic'):
        raise Erro('Envie uma foto ou um PDF do comprovante.')
    if len(req.corpo) > 6 * 1024 * 1024:
        raise Erro('Arquivo muito grande (máximo 6 MB).')
    with conexao() as c:
        r = reserva_do(c, rid, req)
        if r['status'] not in ('aguardando', 'comprovante'):
            raise Erro('Esta reserva não aceita comprovante.')
        arq = f"{rid}-{secrets.token_hex(4)}{Path(nome).suffix.lower()[:6]}"
        (DADOS / 'arquivos' / arq).write_bytes(req.corpo)
        auditar(req, 'comprovante enviado', rid)
        c.execute("UPDATE reservas SET comprovante_nome=?, comprovante_arq=?, comprovante_data=?, status='comprovante' WHERE id=?", (nome, arq, agora(), rid))
    enviar_email(EMAIL_POUSADA, f"[Site] Comprovante da reserva {rid} — {r['nome']}",
                 f"<p>{esc(r['nome'])} enviou o comprovante <b>{esc(nome)}</b> (em anexo) da reserva:</p><p>{linha_reserva(r)}</p>"
                 f"<p>Sinal esperado: <b>{moeda(r['sinal'])}</b>. Confira o pagamento e confirme a reserva na <a href=\"{SITE_URL}/#/gestao\">Gestão</a>.</p>",
                 responder_para=r['email'], anexos=[{'filename': nome, 'content': base64.b64encode(req.corpo).decode()}])
    avisar_whatsapp(f"📎 Comprovante recebido · reserva {rid}\n{r['nome']} · sinal esperado {moeda(r['sinal'])}\nConfira o pagamento e confirme na Gestão: {SITE_URL}/#/gestao")
    return {'ok': True}


def cancelar_reserva(c, r, por):
    c.execute("UPDATE reservas SET status='cancelada' WHERE id=?", (r['id'],))
    c.commit()  # libera o banco antes de registrar os e-mails
    if por == 'pousada':
        enviar_email(r['email'], f"[Guará Bangalôs] Reserva {r['id']} cancelada", f"<p>Sua reserva foi cancelada pela pousada:</p><p>{linha_reserva(r)}</p><p>Em caso de dúvida, responda este e-mail ou fale conosco pelo WhatsApp.</p>")
    else:
        enviar_email(r['email'], f"[Guará Bangalôs] Reserva {r['id']} cancelada", f"<p>Sua reserva foi cancelada:</p><p>{linha_reserva(r)}</p><p>Se já pagou o sinal, você pode deixar o valor como crédito, remarcar ou pedir devolução pelo WhatsApp.</p>")
        enviar_email(EMAIL_POUSADA, f"[Site] Reserva {r['id']} cancelada pelo hóspede", f"<p>{esc(r['nome'])} cancelou a reserva:</p><p>{linha_reserva(r)}</p>", responder_para=r['email'])
        avisar_whatsapp(f"❌ Reserva {r['id']} cancelada pelo hóspede\n{r['nome']} · {r['unidade_nome']}: {dbr(r['entrada'])} a {dbr(r['saida'])}")


def checa_politica(r):
    if r['status'] == 'cancelada':
        raise Erro('Essa reserva já está cancelada.')
    dias = (date.fromisoformat(r['entrada']) - date.today()).days
    if dias < 15 and r['status'] != 'aguardando':
        raise Erro(f'Faltam {dias} dia(s) para o check-in. Pela política, o cancelamento precisa de 15 dias de antecedência. Fale conosco pelo WhatsApp.')


@rota('POST', r'/api/reservas/([A-Z0-9]+)/cancelar', 'hospede')
def cancelar_minha(req, rid):
    with conexao() as c:
        r = reserva_do(c, rid, req)
        checa_politica(r)
        cancelar_reserva(c, r, 'hospede')
    auditar(req, 'reserva cancelada pelo hóspede', rid)
    return {'ok': True}


@rota('POST', '/api/cancelar-por-codigo')
def cancelar_codigo(req):
    if limite('canc:' + req.ip, 10, 3600):
        raise Erro('Muitas tentativas. Tente mais tarde.', 429)
    registra('canc:' + req.ip)
    with conexao() as c:
        r = c.execute('SELECT * FROM reservas WHERE id=? AND email=? COLLATE NOCASE', (str(req.json.get('id', '')).strip().upper(), str(req.json.get('email', '')).strip())).fetchone()
        if not r:
            raise Erro('Reserva não encontrada.', 404)
        checa_politica(r)
        cancelar_reserva(c, r, 'hospede')
    return {'ok': True}


# ----- contato
@rota('POST', '/api/contato')
def contato(req):
    d = {k: str(req.json.get(k, '')).strip()[:3000] for k in ('nome', 'email', 'telefone', 'assunto', 'datas', 'mensagem', 'site')}
    if d['site']:  # campo escondido: robôs preenchem
        return {'ok': True}
    if not d['nome'] or not EMAIL_RE.match(d['email']) or not d['mensagem']:
        raise Erro('Preencha nome, um e-mail válido e a mensagem.')
    if limite('ct:' + req.ip, 5, 3600):
        raise Erro('Você já enviou várias mensagens. Fale conosco pelo WhatsApp.', 429)
    registra('ct:' + req.ip)
    with conexao() as c:
        c.execute('INSERT INTO contatos (id,data,nome,email,telefone,assunto,datas,mensagem) VALUES (?,?,?,?,?,?,?,?)',
                  (novo_id('C'), agora(), d['nome'], d['email'], d['telefone'], d['assunto'], d['datas'], d['mensagem']))
    enviar_email(EMAIL_POUSADA, f"[Site] {d['assunto'] or 'Mensagem'} — {d['nome']}",
                 f"<p><b>{esc(d['nome'])}</b> ({esc(d['email'])}{', ' + esc(d['telefone']) if d['telefone'] else ''}) escreveu pelo site:</p>"
                 + (f"<p>Datas de interesse: {esc(d['datas'])}</p>" if d['datas'] else '')
                 + f"<p style=\"white-space:pre-wrap;background:#F5F0EA;padding:12px;border-radius:8px\">{esc(d['mensagem'])}</p><p>Para responder, é só responder este e-mail.</p>",
                 responder_para=d['email'])
    avisar_whatsapp(f"✉️ Mensagem pelo site · {d['assunto'] or 'Contato'}\n{d['nome']} ({d['email']}{', ' + d['telefone'] if d['telefone'] else ''})\n{d['mensagem'][:300]}")
    return {'ok': True}


# ----- Gestão
@rota('GET', '/api/admin/dados', 'admin')
def admin_dados(req):
    with conexao() as c:
        return {
            'reservas': [publica_reserva(r) for r in c.execute('SELECT * FROM reservas ORDER BY entrada')],
            'hospedes': [publico_hospede(h) for h in c.execute('SELECT * FROM hospedes ORDER BY criado DESC')],
            'emails': [dict(m) for m in c.execute('SELECT * FROM emails ORDER BY data DESC LIMIT 300')],
            'contatos': [dict(m) for m in c.execute('SELECT * FROM contatos ORDER BY data DESC LIMIT 300')],
            'auditoria': [dict(m) for m in c.execute('SELECT * FROM auditoria ORDER BY id DESC LIMIT 300')],
            'whatsapp': [dict(m) for m in c.execute('SELECT * FROM whatsapp ORDER BY id DESC LIMIT 100')],
            'config': {'email': bool(RESEND_KEY), 'whatsapp': WPP_MODO or '', 'lembrete_dias': LEMBRETE_DIAS},
        }


@rota('POST', r'/api/admin/reservas/([A-Z0-9]+)/confirmar', 'admin')
def admin_confirmar(req, rid):
    with conexao() as c:
        r = reserva_do(c, rid, req)
        if r['status'] == 'cancelada':
            raise Erro('Reserva cancelada.')
        c.execute("UPDATE reservas SET status='confirmada', confirmada=? WHERE id=?", (agora(), rid))
    auditar(req, 'pagamento confirmado', f"{rid} sinal {moeda(r['sinal'])}")
    enviar_email(r['email'], f"[Guará Bangalôs] Reserva {rid} confirmada!",
                 f"<p>Olá, {esc(r['nome'])}! Recebemos o pagamento do sinal e sua reserva está <b>confirmada</b>:</p><p>{linha_reserva(r)}</p>"
                 f"<p>Restante a pagar no check-in: <b>{moeda(r['total'] - r['sinal'])}</b>. Check-in a partir das 15h.</p>"
                 f"<p>Veja como chegar: <a href=\"{SITE_URL}/#/como-chegar\">{SITE_URL.replace('https://', '')}/#/como-chegar</a></p>")
    return {'ok': True}


@rota('POST', r'/api/admin/reservas/([A-Z0-9]+)/cancelar', 'admin')
def admin_cancelar(req, rid):
    with conexao() as c:
        r = reserva_do(c, rid, req)
        if r['status'] == 'cancelada':
            raise Erro('Essa reserva já está cancelada.')
        cancelar_reserva(c, r, 'pousada')
    auditar(req, 'reserva cancelada pela pousada', rid)
    return {'ok': True}


@rota('GET', r'/api/admin/reservas/([A-Z0-9]+)/comprovante', 'admin')
def admin_comprovante(req, rid):
    with conexao() as c:
        r = reserva_do(c, rid, req)
    if not r['comprovante_arq']:
        raise Erro('Sem comprovante.', 404)
    return ('arquivo', DADOS / 'arquivos' / r['comprovante_arq'], mimetypes.guess_type(r['comprovante_nome'])[0], 'private, no-store')


@rota('POST', r'/api/admin/contatos/([A-Z0-9]+)/lida', 'admin')
def admin_lida(req, cid):
    with conexao() as c:
        c.execute('UPDATE contatos SET lida=1 WHERE id=?', (cid,))
    return {'ok': True}


# ---------------------------------------------------------------- rotinas automáticas (a cada 30 min)
def cms_local():
    with conexao() as c:
        cms = cms_atual(c) or {}
    return cms.get('local') or {}, cms.get('contato') or {}


def lembretes():
    """Lembrete de check-in para reservas confirmadas e cobrança do sinal após 48 h sem pagamento."""
    hoje = date.today()
    local, contato = cms_local()
    rota = f"https://www.google.com/maps/dir/?api=1&destination={local.get('lat')},{local.get('lng')}" if local.get('lat') else f'{SITE_URL}/#/como-chegar'
    wpp = re.sub(r'\D', '', str(contato.get('whatsapp', '')))
    with conexao() as c:
        chegando = c.execute("SELECT * FROM reservas WHERE status='confirmada' AND lembrete_checkin IS NULL AND entrada >= ? AND entrada <= ?",
                             (str(hoje), str(hoje + timedelta(days=LEMBRETE_DIAS)))).fetchall()
        devendo = c.execute("SELECT * FROM reservas WHERE status='aguardando' AND cobranca_sinal IS NULL AND criada <= ? AND entrada >= ?",
                            ((datetime.now(timezone.utc) - timedelta(hours=48)).isoformat().replace('+00:00', 'Z'), str(hoje))).fetchall()
        for r in chegando:
            c.execute('UPDATE reservas SET lembrete_checkin=? WHERE id=?', (agora(), r['id']))
        for r in devendo:
            c.execute('UPDATE reservas SET cobranca_sinal=? WHERE id=?', (agora(), r['id']))
    for r in chegando:
        dias = (date.fromisoformat(r['entrada']) - hoje).days
        quando = 'hoje' if dias == 0 else 'amanhã' if dias == 1 else f'em {dias} dias'
        endereco = esc(local.get('endereco', '')).replace('\n', '<br>')
        enviar_email(r['email'], f"[Guará Bangalôs] Sua estadia começa {quando}!",
                     f"<p>Olá, {esc(r['nome'].split()[0])}! Estamos te esperando.</p><p><b>{linha_reserva(r)}</b></p>"
                     f"<p>Check-in a partir das 15h{', chegada prevista ' + esc(r['chegada']) if r['chegada'] else ''}. Check-out até as 12h.<br>"
                     f"Restante a pagar no check-in: <b>{moeda(r['total'] - r['sinal'])}</b>.</p>"
                     + (f"<p><b>Endereço</b><br>{endereco}</p>" if endereco else '')
                     + f"<p><a href=\"{rota}\" style=\"background:#A0522D;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none\">Abrir a rota no mapa</a></p>"
                     f"<p>Veja o passo a passo do caminho em <a href=\"{SITE_URL}/#/como-chegar\">{SITE_URL.replace('https://', '')}/#/como-chegar</a>.</p>"
                     + (f"<p>Qualquer dúvida no caminho, chame no WhatsApp: <a href=\"https://wa.me/{wpp}\">wa.me/{wpp}</a>.</p>" if wpp else ''))
    for r in devendo:
        enviar_email(r['email'], f"[Guará Bangalôs] Falta o sinal da reserva {r['id']}",
                     f"<p>Olá, {esc(r['nome'].split()[0])}!</p><p>Sua pré-reserva ainda está aguardando o pagamento do sinal:</p><p><b>{linha_reserva(r)}</b></p>"
                     f"<p>Para garantir as datas, pague o sinal de <b>{moeda(r['sinal'])}</b> e envie o comprovante pelo site:</p>"
                     f"<p><a href=\"{link_reserva(r)}\" style=\"background:#A0522D;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none\">Pagar o sinal</a></p>"
                     f"<p>Se mudou de ideia, você pode cancelar a pré-reserva em Minhas reservas. Se já pagou, é só enviar o comprovante.</p>")
    if devendo:
        avisar_whatsapp('⏳ Sinal não pago há 48 h (cobrança enviada por e-mail):\n' + '\n'.join(f"{r['id']} · {r['nome']} · {dbr(r['entrada'])}" for r in devendo))
    return len(chegando), len(devendo)


def rotinas():
    while True:
        try:
            a, b = lembretes()
            if a or b:
                print(f'rotinas: {a} lembrete(s) de check-in, {b} cobrança(s) de sinal', flush=True)
        except Exception:
            import traceback
            traceback.print_exc()
        time.sleep(1800)


# ---------------------------------------------------------------- servidor HTTP
class Pedido:
    pass


class Servidor(BaseHTTPRequestHandler):
    server_version = 'guara'
    sys_version = ''

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.headers.get('X-Forwarded-For', self.client_address[0]), fmt % args))

    def cors(self):
        origem = self.headers.get('Origin')
        if origem and origem in CORS:
            self.send_header('Access-Control-Allow-Origin', origem)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Arquivo')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')

    def responder(self, codigo, dados):
        corpo = json.dumps(dados, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(corpo)))
        self.cors()
        self.end_headers()
        self.wfile.write(corpo)

    def arquivo(self, caminho, tipo, cache):
        dados = Path(caminho).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', tipo or 'application/octet-stream')
        self.send_header('Content-Length', str(len(dados)))
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.cors()
        self.end_headers()
        self.wfile.write(dados)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self): self.tratar('GET')
    def do_POST(self): self.tratar('POST')
    def do_PUT(self): self.tratar('PUT')

    def tratar(self, metodo):
        caminho = self.path.split('?')[0]
        if not caminho.startswith('/api/'):
            return self.estatico(caminho) if ESTATICO and metodo == 'GET' else self.responder(404, {'erro': 'Não encontrado.'})
        try:
            for m, padrao, quem, f in ROTAS:
                achou = padrao.match(caminho)
                if m != metodo or not achou:
                    continue
                req = Pedido()
                req.headers = self.headers
                req.ip = (self.headers.get('X-Forwarded-For') or self.client_address[0]).split(',')[0].strip()
                tam = int(self.headers.get('Content-Length') or 0)
                if tam > MAX_CORPO:
                    raise Erro('Arquivo muito grande.', 413)
                req.corpo = self.rfile.read(tam) if tam else b''
                req.json = {}
                if req.corpo and 'json' in self.headers.get('Content-Type', ''):
                    try:
                        req.json = json.loads(req.corpo)
                    except ValueError:
                        raise Erro('Pedido inválido.')
                    if not isinstance(req.json, dict):
                        raise Erro('Pedido inválido.')
                auth = self.headers.get('Authorization', '')
                req.token = auth[7:] if auth.startswith('Bearer ') else None
                req.tipo = req.hospede = None
                if req.token:
                    with conexao() as c:
                        s = c.execute('SELECT * FROM sessoes WHERE token=? AND expira > ?', (req.token, time.time())).fetchone()
                    if s:
                        req.tipo, req.hospede = s['tipo'], s['hospede']
                if quem and req.tipo != quem:
                    if quem == 'admin' and req.tipo == 'hospede':
                        auditar(req, 'acesso negado à Gestão', caminho, 'negado')
                    raise Erro('Sua sessão expirou. Entre de novo.', 401)
                res = f(req, *achou.groups())
                if isinstance(res, tuple) and res[0] == 'arquivo':
                    return self.arquivo(*res[1:])
                return self.responder(200, res)
            self.responder(404, {'erro': 'Não encontrado.'})
        except Erro as e:
            self.responder(e.codigo, {'erro': str(e), 'campo': e.campo})
        except Exception as e:  # erro inesperado: registra e responde genérico
            import traceback
            traceback.print_exc()
            self.responder(500, {'erro': 'Erro no servidor. Tente de novo em instantes.'})

    def estatico(self, caminho):
        base = Path(ESTATICO).resolve()
        alvo = (base / caminho.lstrip('/')).resolve()
        if alvo.is_dir():
            alvo = alvo / 'index.html'
        if base not in alvo.parents and alvo != base or not alvo.is_file():
            return self.responder(404, {'erro': 'Não encontrado.'})
        self.arquivo(alvo, mimetypes.guess_type(str(alvo))[0], 'no-cache')


if __name__ == '__main__':
    if '--hash-senha' in sys.argv:
        import getpass
        print(hash_senha(getpass.getpass('Senha da Gestão: ')))
        sys.exit()
    criar_banco()
    threading.Thread(target=rotinas, daemon=True).start()
    print(f'Guará API em http://127.0.0.1:{PORTA}  (e-mail: {"Resend" if RESEND_KEY else "só registro"}; dados em {DADOS})', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORTA), Servidor).serve_forever()
