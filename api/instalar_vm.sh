#!/usr/bin/env bash
# Instala/atualiza a API do Guará Bangalôs na VM (rodar com sudo, na pasta onde está o api.py).
# - cria o usuário de sistema guara-api e a pasta de dados /var/lib/guara
# - na primeira vez: gera a senha da Gestão (salva em ~ubuntu/guara_admin_senha.txt) e o /etc/guara-api.env
# - instala o serviço guara-api (porta local 8093)
set -euo pipefail
cd "$(dirname "$0")"

id guara-api &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin guara-api
install -d -o guara-api -g guara-api -m 750 /var/lib/guara
install -d -m 755 /opt/guara-api
install -m 644 api.py /opt/guara-api/api.py

if [ ! -f /etc/guara-api.env ]; then
  SENHA=$(python3 -c "import secrets;print(secrets.token_urlsafe(12))")
  HASH=$(SENHA="$SENHA" python3 -c "import os,hashlib,secrets;s=secrets.token_hex(16);print(f'pbkdf2\$600000\${s}\$'+hashlib.pbkdf2_hmac('sha256',os.environ['SENHA'].encode(),bytes.fromhex(s),600000).hex())")
  umask 077
  cat > /etc/guara-api.env <<EOF
GUARA_PORTA=8093
GUARA_DADOS=/var/lib/guara
SITE_URL=https://guarabangalos.com.br
CORS_ORIGENS=https://mateus-gonzaga.github.io
EMAIL_DE=Guará Bangalôs <reservas@guarabangalos.com.br>
EMAIL_POUSADA=guarabangalos@gmail.com
ADMIN_USUARIO=admin
ADMIN_SENHA_HASH=$HASH
# cole a chave do Resend depois do sinal de igual e rode: sudo systemctl restart guara-api
RESEND_API_KEY=
EOF
  chmod 600 /etc/guara-api.env
  printf 'Gestão do Guará Bangalôs\nusuário: admin\nsenha: %s\n' "$SENHA" > /home/ubuntu/guara_admin_senha.txt
  chown ubuntu:ubuntu /home/ubuntu/guara_admin_senha.txt; chmod 600 /home/ubuntu/guara_admin_senha.txt
  echo "Senha da Gestão salva em /home/ubuntu/guara_admin_senha.txt"
fi

cat > /etc/systemd/system/guara-api.service <<'EOF'
[Unit]
Description=API do site Guará Bangalôs
After=network.target

[Service]
User=guara-api
Group=guara-api
EnvironmentFile=/etc/guara-api.env
Environment=PYTHONIOENCODING=utf-8
ExecStart=/usr/bin/python3 /opt/guara-api/api.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/guara

[Install]
WantedBy=multi-user.target
EOF

# backup diário do banco (guarda 14 dias)
cat > /etc/cron.daily/guara-backup <<'EOF'
#!/bin/sh
d=/var/lib/guara/backups; mkdir -p $d
sqlite3 /var/lib/guara/guara.db ".backup $d/guara-$(date +%F).db" 2>/dev/null || python3 -c "import sqlite3,sys;sqlite3.connect('/var/lib/guara/guara.db').backup(sqlite3.connect(sys.argv[1]))" "$d/guara-$(date +%F).db"
chown -R guara-api:guara-api $d; chmod 700 $d
find $d -name 'guara-*.db' -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/guara-backup

systemctl daemon-reload
systemctl enable guara-api >/dev/null
systemctl restart guara-api
sleep 1
curl -fsS http://127.0.0.1:8093/api/saude && echo
