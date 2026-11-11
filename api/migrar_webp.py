"""Troca no conteúdo salvo (tabela cms) as fotos .jpg/.png do projeto pelas versões .webp.
Uso: python3 migrar_webp.py caminho/guara.db mapa.json"""
import json, sqlite3, sys
db, mapa = sys.argv[1], json.load(open(sys.argv[2], encoding='utf-8'))
c = sqlite3.connect(db)
r = c.execute('SELECT conteudo FROM cms WHERE id=1').fetchone()
if not r: sys.exit('sem conteúdo salvo')
s = r[0]; n = 0
for a, b in mapa.items():
    n += s.count('"' + a + '"'); s = s.replace('"' + a + '"', '"' + b + '"')
c.execute('UPDATE cms SET conteudo=? WHERE id=1', (s,)); c.commit()
print('fotos trocadas:', n)
