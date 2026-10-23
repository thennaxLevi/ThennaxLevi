"""Gera dist/salao-dos-ecos.html: o jogo inteiro num único arquivo HTML
(sprites em base64, código embutido), fácil de mandar por mensagem ou e-mail.
Run:  python3 tools/build_standalone.py
"""
import base64, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, 'game')
OUT = os.path.join(ROOT, 'dist', 'salao-dos-ecos.html')


def read(*p):
    with open(os.path.join(GAME, *p), encoding='utf-8') as f:
        return f.read()


def main():
    page = read('index.html')
    atlas_js = read('assets', 'atlas.js')
    game_js = read('game.js')
    with open(os.path.join(GAME, 'assets', 'atlas.png'), 'rb') as f:
        png = 'data:image/png;base64,' + base64.b64encode(f.read()).decode()
    assert "atlasImg.src = 'assets/atlas.png';" in game_js
    game_js = game_js.replace("atlasImg.src = 'assets/atlas.png';", f"atlasImg.src = '{png}';")
    page = page.replace('<script src="assets/atlas.js"></script>', '<script>' + atlas_js + '</script>')
    page = page.replace('<script src="game.js"></script>', '<script>' + game_js + '</script>')
    assert 'src="game.js"' not in page and 'src="assets/' not in page
    # o index.html é escrito sem <head> (o Artifact adiciona um); aqui montamos o documento completo
    head, _, body = page.partition('<div class="wrap" id="wrap">')
    doc = ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + head + '</head>\n<body>\n<div class="wrap" id="wrap">' + body + '\n</body>\n</html>\n')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(doc)
    print(OUT, round(os.path.getsize(OUT) / 1024), 'KB')


if __name__ == '__main__':
    main()
