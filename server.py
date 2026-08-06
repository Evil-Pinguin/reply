#!/usr/bin/env python3
"""Reply dev-server: статическая раздача с запретом кэширования.
Чтобы браузер всегда получал свежие CSS/JS (иначе старые версии
с багами кликов висят в кэше превью)."""
import http.server
import socketserver
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8080

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

with socketserver.TCPServer(('0.0.0.0', PORT), NoCacheHandler) as httpd:
    print(f'Reply server on http://0.0.0.0:{PORT} (no-cache)')
    httpd.serve_forever()
