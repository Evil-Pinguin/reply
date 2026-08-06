#!/usr/bin/env python3
"""Reply dev-server: статическая раздача + прокси для внешнего ИИ (Groq).

- Статика отдаётся с запретом кэширования (чтобы браузер всегда получал
  свежие CSS/JS — иначе старые версии с багами висят в кэше превью).
- POST /api/ai — прокси к Groq API. Ключ берётся из переменной окружения
  GROQ_API_KEY или из gitignored-файла groq_key.txt / .env. Ключ не
  попадает ни в репозиторий, ни в браузер. Без ключа эндпоинт отвечает
  {ok: false, error: "no_key"}, и клиент использует локальный «мозг».
"""
import http.server
import json
import os
import socket
import socketserver
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', 8080))

GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
GROQ_TIMEOUT = 30


def load_api_key():
    """Ключ Groq: сначала окружение, потом groq_key.txt / .env (gitignored)."""
    env = os.environ.get('GROQ_API_KEY', '').strip()
    if env:
        return env
    for path in ('groq_key.txt', '.env'):
        try:
            with open(path, encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' in line:
                        key, _, val = line.partition('=')
                        if key.strip().upper() == 'GROQ_API_KEY':
                            return val.strip().strip('"').strip("'")
                    elif line.startswith('sk-'):
                        return line
        except FileNotFoundError:
            continue
    return None


def build_system_prompt(data):
    ch = data.get('character') or {}
    loc = data.get('location')
    season = data.get('season')
    chapter = data.get('chapter')
    user = data.get('user') or {}
    p = ch.get('personality') or {}

    def num(v, default=0.5):
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return default

    lines = []
    name = ch.get('name') or 'персонаж'
    lines.append(f'Ты — «{name}» из приложения Reply (симулятор первого свидания). '
                 'Отвечай ОТ ПЕРВОГО ЛИЦА, полностью в образе, по-русски. '
                 'Живо, тепло, естественно, как живой человек на свидании: 1–3 коротких предложения, '
                 'можно лёгкая ирония, изредка одно уместное эмодзи. Не выходи из образа, не объясняй, '
                 'что ты ИИ, не пиши вступлений вроде «Я понимаю» — сразу реплику.')
    if loc:
        lines.append(f'Место свидания: {loc.get("name")} {loc.get("emoji", "")} (атмосфера: {loc.get("music") or "уютная"}).')
    if season:
        lines.append(f'Сейчас время года: {season.get("name")} {season.get("emoji", "")}.')
    if chapter:
        lines.append(f'Ваша история находится в главе «{chapter.get("name")} {chapter.get("emoji", "")}» — веди себя соответственно (начало знакомства / тепло / доверие / близость).')
    if user and user.get('name'):
        lines.append(f'Твой собеседник: {user["name"]}{", " + str(user["age"]) + " лет" if user.get("age") else ""}. Обращайся к нему(ней) по имени не слишком часто.')
    if p:
        lines.append(f'Характер: разговорчивость {num(p.get("talk"))}, юмор {num(p.get("humor"))}, '
                     f'застенчивость {num(p.get("shy"))}, глубина {num(p.get("deep"))}, '
                     f'эмодзи-активность {num(p.get("emoji"))}.')
    extra = ' '.join(filter(None, [ch.get('commStyle'), ch.get('temperament'), ch.get('mood')]))
    if extra:
        lines.append(f'Стиль и темперамент: {extra}.')
    views = ch.get('views') or {}
    if views:
        flat = ' '.join(v for arr in views.values() for v in (arr if isinstance(arr, list) else [arr]))
        if flat:
            lines.append(f'Твои личные взгляды (используй как источник живых деталей): {flat[:1200]}.')
    catches = ch.get('catchphrases') or []
    if catches:
        lines.append(f'Твои коронные фразы, иногда вплетай похожие: {"; ".join(str(c) for c in catches[:6])}.')
    interests = ch.get('interests') or []
    if interests:
        lines.append(f'Твои интересы: {", ".join(str(i) for i in interests[:8])}.')
    return '\n'.join(lines)


def handle_ai(payload):
    key = load_api_key()
    if not key:
        return {'ok': False, 'error': 'no_key',
                'hint': 'Задайте GROQ_API_KEY или положите ключ в groq_key.txt (см. groq_key.example.txt).'}

    history = payload.get('history') or []
    if not isinstance(history, list):
        history = []

    messages = [{'role': 'system', 'content': build_system_prompt(payload)}]
    for turn in history[-16:]:
        role = turn.get('role')
        text = turn.get('text')
        if role in ('user', 'assistant') and isinstance(text, str) and text.strip():
            messages.append({'role': role, 'content': text.strip()})

    if payload.get('initiative'):
        messages.append({'role': 'user', 'content': '(Собеседник молчит — прояви инициативу: напиши первым что-нибудь живое, предложи что-то или пофлиртуй. Только реплика.)'})

    body = json.dumps({
        'model': GROQ_MODELS[0],
        'messages': messages,
        'temperature': 0.9,
        'max_tokens': 220,
        'top_p': 0.95,
    }).encode('utf-8')

    last_err = None
    for model in GROQ_MODELS:
        req_body = json.loads(body)
        req_body['model'] = model
        req = urllib.request.Request(
            GROQ_URL, data=json.dumps(req_body).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'},
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=GROQ_TIMEOUT) as resp:
                raw = resp.read().decode('utf-8', 'replace')
            data = json.loads(raw)
            choice = (data.get('choices') or [{}])[0]
            reply = (choice.get('message') or {}).get('content')
            if reply and str(reply).strip():
                return {'ok': True, 'model': model, 'reply': str(reply).strip()}
            return {'ok': False, 'error': 'empty'}
        except urllib.error.HTTPError as e:
            last_err = f'HTTP {e.code}'
            if e.code == 404:
                continue  # модель недоступна — пробуем следующую
            try:
                detail = e.read().decode('utf-8', 'replace')[:300]
                last_err = f'HTTP {e.code}: {detail}'
            except Exception:
                pass
            break
        except Exception as e:
            last_err = str(e)[:200]
            break
    return {'ok': False, 'error': 'groq_error', 'detail': last_err}


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path.split('?')[0] != '/api/ai':
            self.send_error(404, 'Not Found')
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(length) if length else b'{}'
            payload = json.loads(raw.decode('utf-8') or '{}')
        except Exception:
            payload = {}
        result = handle_ai(payload)
        out = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, fmt, *args):
        # тихие логи для /api/ai, обычные для статики
        if self.path.startswith('/api/'):
            return
        super().log_message(fmt, *args)


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('0.0.0.0', PORT), NoCacheHandler) as httpd:
        print(f'Reply server on http://0.0.0.0:{PORT} (no-cache)')
        if load_api_key():
            print('Groq AI: ключ найден — внешний ИИ-собеседник активен')
        else:
            print('Groq AI: ключ не найден — чат работает на локальном «мозге» '
                  '(задайте GROQ_API_KEY или создайте groq_key.txt)')
        httpd.serve_forever()
