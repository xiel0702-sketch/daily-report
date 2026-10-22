#!/usr/bin/env python3
"""On-demand reading of public AI HOT article pages, cached outside the public site."""
import hashlib
import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from aihot_article_parser import parse_article

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / 'tmp' / 'aihot-private-reader-cache'
TTL = 6 * 60 * 60
RETENTION = 7 * 24 * 60 * 60
ID_PATTERN = re.compile(r'[A-Za-z0-9_-]{1,100}')


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, value):
    atomic_write(path, json.dumps(value, ensure_ascii=False).encode('utf-8'))


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def allowed_url(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == 'https' and parsed.hostname == 'aihot.news'
                and parsed.port in (None, 443) and not parsed.username and not parsed.password)
    except ValueError:
        return False


class SourceRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError('来源跳转到了不支持的地址。')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PrivateReader:
    def __init__(self, cache_dir=DEFAULT_CACHE):
        self.cache_dir = Path(cache_dir).resolve()
        if self.cache_dir == ROOT or ROOT in self.cache_dir.parents:
            raise ValueError('Private article cache must stay outside the public checkout')
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.network_lock = threading.Lock()
        self.last_request = 0
        self.retry_until = 0
        self.opener = build_opener(SourceRedirects())
        self.prune()

    def prune(self):
        # Only our disposable, normalized reading cache is affected.
        cutoff = time.time() - RETENTION
        for folder in ('items', 'media'):
            directory = self.cache_dir / folder
            if directory.exists():
                for path in directory.iterdir():
                    if path.is_file() and path.stat().st_mtime < cutoff:
                        path.unlink()

    def fetch(self, url, headers=None, limit=3_000_000):
        if not allowed_url(url):
            raise ValueError('不支持的来源地址。')
        request_headers = {'User-Agent': 'InforePrivateResearchReader/1.0',
                           'Accept': 'text/html,application/xhtml+xml'}
        request_headers.update(headers or {})
        with self.network_lock:
            if time.time() < self.retry_until:
                raise RuntimeError('来源要求稍后重试，暂时使用已有缓存。')
            delay = self.last_request + 1.1 - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self.last_request = time.monotonic()
            try:
                with self.opener.open(Request(url, headers=request_headers), timeout=25) as response:
                    body = response.read(limit + 1)
                    if len(body) > limit:
                        raise ValueError('来源内容超过本地阅读大小限制。')
                    return body, dict(response.headers)
            except HTTPError as error:
                if error.code == 304:
                    return None, dict(error.headers)
                if error.code in (429, 503):
                    retry = error.headers.get('Retry-After', '60')
                    self.retry_until = time.time() + (min(3600, max(60, int(retry))) if retry.isdigit() else 300)
                    raise RuntimeError('来源暂时限流，请稍后重试。') from None
                raise RuntimeError('来源页面暂不可读（HTTP ' + str(error.code) + '）。') from None
            except (URLError, TimeoutError, OSError):
                raise RuntimeError('暂时无法连接来源，请检查网络后重试。') from None

    def known_item(self, identifier):
        if not ID_PATTERN.fullmatch(identifier):
            return False
        path = ROOT / 'aihot' / 'items' / (identifier + '.json')
        return path.is_file()

    def page(self, url, old=None):
        headers = {}
        if old:
            if old.get('etag'):
                headers['If-None-Match'] = old['etag']
            if old.get('lastModified'):
                headers['If-Modified-Since'] = old['lastModified']
        data, response_headers = self.fetch(url, headers)
        if data is None and old:
            return old
        if data is None:
            raise ValueError('来源未返回正文。')
        content_type = next((v for k, v in response_headers.items() if k.lower() == 'content-type'), '')
        if 'text/html' not in content_type:
            raise ValueError('来源未返回文章页面。')
        parsed = parse_article(data.decode('utf-8', errors='replace'), url)
        if not parsed.get('blocks'):
            raise ValueError('该文章页面未提供可读取的正文。')
        parsed['etag'] = next((v for k, v in response_headers.items() if k.lower() == 'etag'), '')
        parsed['lastModified'] = next((v for k, v in response_headers.items() if k.lower() == 'last-modified'), '')
        return parsed

    def public_payload(self, stored):
        result = {key: value for key, value in stored.items() if not key.startswith('_')}
        result['languages'] = {}
        for language, page in stored.get('_pages', {}).items():
            blocks = []
            for block in page.get('blocks', []):
                block = dict(block)
                if block.get('type') == 'image':
                    source = block.get('src', '')
                    parsed = urlsplit(source)
                    if not allowed_url(source) or parsed.path != '/api/img-proxy':
                        continue
                    token = hashlib.sha256(source.encode()).hexdigest()
                    write_json(self.cache_dir / 'media' / (token + '.json'), {'url': source})
                    block['src'] = '/api/local-reader/media/' + token
                blocks.append(block)
            result['languages'][language] = {'label': '中文' if language == 'zh' else '原文', 'blocks': blocks}
        return result

    def item(self, identifier, refresh=False):
        if not self.known_item(identifier):
            raise KeyError('未收录该资讯。')
        with self.lock:
            path = self.cache_dir / 'items' / (identifier + '.json')
            previous = read_json(path)
            age = time.time() - path.stat().st_mtime if previous else float('inf')
            if previous and age < (60 if refresh else TTL):
                return self.public_payload(previous)
            base = 'https://aihot.news/items/' + identifier
            pages = {}
            warnings = []
            try:
                pages['zh'] = self.page(base, (previous or {}).get('_pages', {}).get('zh'))
            except (RuntimeError, ValueError) as error:
                if previous:
                    fallback = self.public_payload(previous)
                    fallback['notice'] = str(error) + ' 当前显示上次缓存的正文。'
                    return fallback
                return {'schemaVersion': 1, 'id': identifier, 'status': 'unavailable', 'provenance': 'aihot-public-page',
                        'sourceURL': base, 'fetchedAt': utc_now(), 'label': '正文', 'notice': str(error), 'languages': {}}
            original = pages['zh'].get('originalViewURL')
            if original == base + '/original':
                try:
                    pages['original'] = self.page(original, (previous or {}).get('_pages', {}).get('original'))
                except (RuntimeError, ValueError) as error:
                    warnings.append('原文视图暂不可用。' + str(error))
            stored = {'schemaVersion': 1, 'id': identifier, 'status': 'available', 'provenance': 'aihot-public-page',
                      'sourceURL': base, 'fetchedAt': utc_now(), 'label': '正文', 'notice': ' '.join(warnings),
                      'topics': pages['zh'].get('topics', []), 'tags': pages['zh'].get('tags', []), '_pages': pages}
            write_json(path, stored)
            return self.public_payload(stored)

    def media(self, token):
        if not re.fullmatch(r'[a-f0-9]{64}', token):
            raise KeyError('图片不存在。')
        with self.lock:
            metadata = read_json(self.cache_dir / 'media' / (token + '.json'))
            if not metadata:
                raise KeyError('图片不存在。')
            path = self.cache_dir / 'media' / (token + '.bin')
            if path.exists() and metadata.get('contentType'):
                return path.read_bytes(), metadata['contentType']
            body, headers = self.fetch(metadata['url'], {'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif'}, limit=12_000_000)
            content_type = next((v.split(';')[0] for k, v in headers.items() if k.lower() == 'content-type'), '')
            if content_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'):
                raise ValueError('来源未返回支持的图片。')
            atomic_write(path, body)
            metadata['contentType'] = content_type
            write_json(self.cache_dir / 'media' / (token + '.json'), metadata)
            return body, content_type
