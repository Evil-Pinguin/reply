#!/usr/bin/env python3
"""Reply · Vercel Serverless Function: /api/ai → прокси к Groq.

Файл в каталоге api/ → маршрут /api/ai (класс handler(BaseHTTPRequestHandler)).
Ключ Groq читается ТОЛЬКО из переменной окружения GROQ_API_KEY
(задаётся в настройках проекта Vercel: Settings → Environment Variables).
Ключ никогда не попадает в репозиторий и в браузер.

Без ключа функция отвечает {ok: false, error: "no_key"} — клиент
прозрачно переключается на локальный «мозг».
"""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b']
GROQ_TIMEOUT = 30


def load_api_key():
    return os.environ.get('GROQ_API_KEY', '').strip() or None


def build_system_prompt(data):
    ch = data.get('character') or {}
    loc = data.get('location')
    season = data.get('season')
    chapter = data.get('chapter')
    user = data.get('user') or {}
    p = ch.get('personality') or {}
    stats = data.get('stats') or {}
    topics = data.get('topics') or []
    evaluations = data.get('evaluations') or []
    moments = data.get('moments') or []

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
                 'что ты ИИ, не пиши вступлений вроде «Я понимаю» — сразу реплику. '
                 'ВАЖНО: помни что происходило — что было хорошо, плохо, странно, ужасно — и реагируй как живой человек.')
    if loc:
        lines.append(f'Место свидания: {loc.get("name")} {loc.get("emoji", "")} (атмосфера: {loc.get("music") or "уютная"}).')
    if season:
        lines.append(f'Сейчас время года: {season.get("name")} {season.get("emoji", "")}.')
    if chapter:
        lines.append(f'Ваша история находится в главе «{chapter.get("name")} {chapter.get("emoji", "")}» — веди себя соответственно.')
    if user and user.get('name'):
        lines.append(f'Твой собеседник: {user["name"]}{", " + str(user["age"]) + " лет" if user.get("age") else ""}.')
    if p:
        lines.append(f'Характер: разговорчивость {num(p.get("talk"))}, юмор {num(p.get("humor"))}, застенчивость {num(p.get("shy"))}, глубина {num(p.get("deep"))}.')
    extra = ' '.join(filter(None, [ch.get('commStyle'), ch.get('temperament'), ch.get('mood')]))
    if extra:
        lines.append(f'Стиль: {extra}.')
    views = ch.get('views') or {}
    if views:
        flat = ' '.join(v for arr in views.values() for v in (arr if isinstance(arr, list) else [arr]))
        if flat:
            lines.append(f'Взгляды: {flat[:1200]}.')
    if stats:
        try:
            lines.append(f'Отношения: доверие {int(stats.get("trust",0))}, комфорт {int(stats.get("comfort",0))}, юмор {int(stats.get("humor",0))}, симпатия {int(stats.get("sympathy",0))}, романтика {int(stats.get("romance",0))}.')
        except Exception:
            pass
    if topics:
        lines.append(f'Темы: {", ".join(str(t) for t in topics[:6])}.')
    if evaluations:
        goods = [e for e in evaluations if e.get('type')=='good'][-3:]
        bads = [e for e in evaluations if e.get('type')=='bad'][-3:]
        stranges = [e for e in evaluations if e.get('type')=='strange'][-3:]
        terribles = [e for e in evaluations if e.get('type')=='terrible'][-3:]
        if goods:
            lines.append('ХОРОШО: ' + '; '.join(f"{g.get('note','')}: {g.get('text','')[:60]}" for g in goods))
        if bads:
            lines.append('ПЛОХО: ' + '; '.join(f"{b.get('note','')}: {b.get('text','')[:60]}" for b in bads))
        if stranges:
            lines.append('СТРАННО: ' + '; '.join(f"{s.get('note','')}: {s.get('text','')[:60]}" for s in stranges))
        if terribles:
            lines.append('УЖАСНО: ' + '; '.join(f"{t.get('note','')}: {t.get('text','')[:60]}" for t in terribles))
    if moments:
        acts = [m for m in moments if m.get('kind') in ('order','activity') or m.get('type')=='good'][-4:]
        if acts:
            flat_m = ', '.join(str(m.get('name') or m.get('id') or m.get('kind') or '')[:30] for m in acts)
            if flat_m:
                lines.append(f'Действия: {flat_m}.')
    lines.append('Отвечай связно, 1-2 предложения, без повторов и склеек.')
    return '\n'.join(lines)


def handle_ai(payload):
    key = load_api_key()
    if not key:
        return {'ok': False, 'error': 'no_key',
                'hint': 'Задайте переменную окружения GROQ_API_KEY в настройках Vercel.'}

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
            headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}', 'User-Agent': 'Reply/1.3.4 (https://github.com/Evil-Pinguin/reply; contact@reply.app)'},
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


def _read_body(handler):
    try:
        length = int(handler.headers.get('Content-Length') or 0)
        return handler.rfile.read(length) if length else b'{}'
    except Exception:
        return b'{}'


class handler(BaseHTTPRequestHandler):
    """Vercel Python serverless function: GET/POST /api/ai."""

    def _send_json(self, obj, status=200):
        out = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(out)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        import base64
        import urllib.parse
        payload = {}
        try:
            qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            if qs.get('q'):
                raw = base64.urlsafe_b64decode(qs['q'][0].encode('ascii'))
                payload = json.loads(raw.decode('utf-8'))
        except Exception:
            payload = {}
        self._send_json(handle_ai(payload))

    def do_POST(self):
        try:
            raw = _read_body(self)
            payload = json.loads(raw.decode('utf-8') or '{}')
        except Exception:
            payload = {}
        self._send_json(handle_ai(payload))

    def log_message(self, fmt, *args):
        # тихие логи для serverless
        pass
