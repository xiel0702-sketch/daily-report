#!/usr/bin/env python3
"""Run the AI HOT adjustment on loopback only, without exposing repository or server scripts."""
import argparse
import json
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from aihot_private_reader import DEFAULT_CACHE, PrivateReader

ROOT = Path(__file__).resolve().parents[1]


class PreviewHandler(SimpleHTTPRequestHandler):
    reader = None

    def send_bytes(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8', status)

    def do_GET(self):
        # Reject non-loopback hostnames as well as binding only to loopback.
        host = urlsplit('http://' + self.headers.get('Host', '')).hostname
        if host not in ('127.0.0.1', 'localhost'):
            self.send_error(403)
            return
        route = unquote(urlsplit(self.path).path)
        if route.startswith('/api/local-reader/'):
            # The personal cache is available only from this local site's own pages.
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send_error(403)
                return
            if route == '/api/local-reader/health':
                self.send_json({'available': True})
                return
            item_match = re.fullmatch(r'/api/local-reader/items/([A-Za-z0-9_-]{1,100})', route)
            image_match = re.fullmatch(r'/api/local-reader/media/([a-f0-9]{64})', route)
            try:
                if item_match:
                    refresh = parse_qs(urlsplit(self.path).query).get('refresh') == ['1']
                    self.send_json(self.reader.item(item_match.group(1), refresh))
                elif image_match:
                    body, content_type = self.reader.media(image_match.group(1))
                    self.send_bytes(body, content_type)
                else:
                    self.send_error(404)
            except KeyError:
                self.send_json({'error': '未收录该阅读内容。'}, 404)
            except (RuntimeError, ValueError) as error:
                self.send_json({'error': str(error)}, 502)
            return
        target = (ROOT / route.lstrip('/')).resolve()
        top = route.lstrip('/').split('/', 1)[0]
        allowed = route in ('/', '/index.html', '/style.css', '/app.js', '/data.js') or top in ('assets', 'reports', 'weekly-reports', 'aihot')
        if not allowed or ROOT not in (target, *target.parents) or any(part.startswith('.') for part in Path(route).parts):
            self.send_error(404)
            return
        if target.is_dir() and route != '/':
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        # Do not make restricted paths discoverable through a HEAD-only code path.
        self.send_error(405)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--refresh', action='store_true', help='Refresh selected metadata before serving')
    parser.add_argument('--cache-dir', type=Path, default=DEFAULT_CACHE, help='Personal reading cache outside the public checkout')
    args = parser.parse_args()
    if args.refresh:
        from sync_aihot import sync
        result = sync(ROOT / 'aihot')
        print('Updated AI HOT selected feed:', len(result['items']), 'items', flush=True)
    if not (ROOT / 'aihot/curated.json').exists():
        raise SystemExit('Run python3 scripts/sync_aihot.py first, or pass --refresh')
    PreviewHandler.reader = PrivateReader(args.cache_dir)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(PreviewHandler, directory=str(ROOT)))
    print('Local private preview: http://127.0.0.1:' + str(args.port) + '/#feed/ai', flush=True)
    print('Only this computer can connect. Source scripts and repository metadata are not served.', flush=True)
    print('Article bodies are fetched on demand and cached only at: ' + str(PreviewHandler.reader.cache_dir), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
