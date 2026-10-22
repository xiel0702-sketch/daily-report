#!/usr/bin/env python3
"""Private AI HOT reader: mirror selected metadata, never crawl publisher article bodies."""
import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

API = 'https://aihot.news/api/v1/items'
ROOT = Path(__file__).resolve().parents[1]


def safe_url(value):
    if not isinstance(value, str):
        return ''
    try:
        p = urlsplit(value)
        return value if p.scheme in ('https', 'http') and p.hostname and not p.username and not p.password else ''
    except ValueError:
        return ''


def clean_text(value):
    return value.strip() if isinstance(value, str) else ''


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def normalize(raw):
    identifier = clean_text(raw.get('id'))
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier):
        raise ValueError('Source returned an invalid item ID')
    links = raw.get('links') if isinstance(raw.get('links'), dict) else {}
    source = raw.get('source') if isinstance(raw.get('source'), dict) else {}
    category = raw.get('category')
    if isinstance(category, dict):
        category = category.get('name') or category.get('label') or category.get('key') or ''
    if raw.get('selected') is False:
        raise ValueError('Selected endpoint returned an explicitly unselected item')
    score = raw.get('score')
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        score = None
    return {
        'id': identifier,
        'title': clean_text(raw.get('title')),
        'originalTitle': clean_text(raw.get('originalTitle')),
        'summary': clean_text(raw.get('summary')),
        'reason': clean_text(raw.get('reason')),
        'aihotURL': safe_url(links.get('aihot')) or 'https://aihot.news/items/' + identifier,
        'sourceURL': safe_url(links.get('original')),
        'sourceName': clean_text(source.get('name')) or 'AI HOT',
        'author': '',
        'publishedAt': clean_text(raw.get('publishedAt')),
        'selectedAt': clean_text(raw.get('selectedAt')),
        'score': score,
        'topics': [],
        'sourceCategory': category if isinstance(category, str) else '',
        'tags': [],
        'selected': True,
        'contentMode': 'summary',
        'attribution': raw.get('attribution') if isinstance(raw.get('attribution'), (str, dict)) else '',
    }


def sync(output_dir, window='7d'):
    records = []
    seen = set()
    cursors = set()
    cursor = ''
    for _ in range(100):
        query = {'mode': 'selected', 'window': window, 'by': 'timeline', 'limit': 100}
        if cursor:
            query['cursor'] = cursor
        request = Request(API + '?' + urlencode(query), headers={
            'User-Agent': 'InforePrivateResearchReader/1.0', 'Accept': 'application/json',
        })
        try:
            with urlopen(request, timeout=40) as response:
                payload = json.load(response)
        except HTTPError as error:
            if error.code in (429, 503):
                raise RuntimeError('AI HOT asked to retry later; Retry-After=' + str(error.headers.get('Retry-After', 'unspecified'))) from None
            raise RuntimeError('AI HOT request failed: HTTP ' + str(error.code)) from None
        if not isinstance(payload, dict):
            raise ValueError('Unexpected source response')
        response_query = payload.get('query')
        if isinstance(response_query, dict):
            for key, expected in [('mode', 'selected'), ('window', window), ('by', 'timeline')]:
                if key in response_query and response_query[key] != expected:
                    raise ValueError('Source response query does not match the selected feed')
        batch = payload.get('items')
        if batch is None and isinstance(payload.get('data'), dict):
            batch = payload['data'].get('items')
        if not isinstance(batch, list):
            raise ValueError('Source response is missing items')
        for raw in batch:
            item = normalize(raw)
            if not item['title']:
                continue
            if item['id'] not in seen:
                records.append(item)
                seen.add(item['id'])
        page = payload.get('page') or {}
        if not isinstance(page, dict):
            raise ValueError('Unexpected page metadata')
        next_cursor = page.get('nextCursor')
        if next_cursor is not None and not isinstance(next_cursor, str):
            raise ValueError('Source returned an invalid pagination cursor')
        if page.get('hasMore') is True and not next_cursor:
            raise ValueError('Source pagination is incomplete; existing snapshot preserved')
        if page.get('hasMore') is False and next_cursor:
            raise ValueError('Source returned inconsistent pagination metadata')
        cursor = next_cursor or ''
        if not cursor:
            break
        if cursor in cursors:
            raise ValueError('Source returned a repeated pagination cursor')
        cursors.add(cursor)
    else:
        raise ValueError('Selected feed exceeded pagination safety limit; existing snapshot preserved')
    if not records:
        raise ValueError('Empty selected feed; existing snapshot preserved')
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    manifest = {
        'schemaVersion': 1,
        'source': {'name': 'AI HOT', 'url': 'https://aihot.news/', 'feedUrl': 'https://aihot.news/feed.xml',
                   'apiUrl': API + '?mode=selected&window=' + window + '&by=timeline',
                   'termsURL': 'https://aihot.news/terms'},
        'updatedAt': now,
        'windowDays': 7 if window == '7d' else 1,
        'label': 'AI HOT 近7日精选' if window == '7d' else 'AI HOT 近24小时精选',
        'selectionPolicy': 'AI HOT selected feed; preserve source membership and order; no local scoring or model selection',
        'contentMode': 'summary',
        'items': records,
    }
    # Stage all metadata only after complete pagination. Source failure never truncates a good snapshot.
    for item in records:
        atomic_json(output_dir / 'items' / (item['id'] + '.json'), item)
    atomic_json(output_dir / 'curated.json', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'aihot')
    parser.add_argument('--window', choices=['7d', '24h'], default='7d')
    args = parser.parse_args()
    manifest = sync(args.output_dir, args.window)
    print(json.dumps({'count': len(manifest['items']), 'updatedAt': manifest['updatedAt'],
                      'windowDays': manifest['windowDays'], 'output': str(args.output_dir / 'curated.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
