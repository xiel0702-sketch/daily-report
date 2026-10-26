#!/usr/bin/env python3
"""Snapshot selected AI HOT article bodies and images into the static site."""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from aihot_private_reader import DEFAULT_CACHE, PrivateReader, atomic_write, read_json
from sync_aihot import atomic_json

ROOT = Path(__file__).resolve().parents[1]
MEDIA_SOURCE = re.compile(r"/api/local-reader/media/([a-f0-9]{64})")
CONTENT_TYPES = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_EXTERNAL_IMAGES = 12


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def snapshot_media(reader, block, media_dir, force):
    match = MEDIA_SOURCE.fullmatch(block.get("src", ""))
    if not match:
        return False
    token = match.group(1)
    body, content_type = reader.media(token)
    extension = CONTENT_TYPES.get(content_type)
    if not extension:
        return False
    target = media_dir / (token + extension)
    if force or not target.exists():
        atomic_write(target, body)
    block["src"] = "aihot/media/" + target.name
    return True


def snapshot_external_media(reader, block, media_dir, force):
    source = block.get("src", "")
    if not isinstance(source, str) or not source.startswith(("https://", "http://")):
        return False
    body, headers, _ = reader.fetch_public(
        source,
        "image/avif,image/webp,image/png,image/jpeg,image/gif",
        12_000_000,
    )
    content_type = next(
        (value.split(";", 1)[0].strip().lower() for key, value in headers.items()
         if key.lower() == "content-type"),
        "",
    )
    extension = CONTENT_TYPES.get(content_type)
    if not extension:
        return False
    token = hashlib.sha256(source.encode("utf-8")).hexdigest()
    target = media_dir / (token + extension)
    if force or not target.exists():
        atomic_write(target, body)
    block["src"] = "aihot/media/" + target.name
    return True


def original_payload(reader, item):
    source_url = str(item.get("sourceURL") or "")
    if not source_url:
        raise ValueError("AI HOT 页面未提供正文，且本条资讯没有原文链接")
    article = reader.source_article(source_url)
    language = article.get("language")
    if language not in ("zh", "original") or not article.get("blocks"):
        raise ValueError("原文来源未提供可读正文")
    return {
        "schemaVersion": 1,
        "id": item["id"],
        "status": "available",
        "provenance": "source-public-page",
        "sourceURL": article["sourceURL"],
        "fetchedAt": article["fetchedAt"],
        "label": "正文 · 原文来源",
        "notice": "AI HOT 页面未提供完整正文，以下内容抓取自原始来源。",
        "topics": [],
        "tags": [],
        "languages": {
            language: {
                "label": "中文" if language == "zh" else "原文",
                "blocks": article["blocks"],
            }
        },
    }


def snapshot_body(reader, item, output_dir, force):
    payload = reader.item(item["id"], refresh=force)
    media_count = 0
    image_errors = []
    if not payload.get("languages"):
        try:
            payload = original_payload(reader, item)
        except (KeyError, RuntimeError, TypeError, ValueError) as error:
            notice = payload.get("notice", "").strip()
            payload["notice"] = (notice + " " + str(error)).strip()
    external_images = 0
    for language in payload.get("languages", {}).values():
        for block in language.get("blocks", []):
            if block.get("type") != "image":
                continue
            try:
                if snapshot_media(reader, block, output_dir / "media", force):
                    media_count += 1
                elif external_images < MAX_EXTERNAL_IMAGES and snapshot_external_media(
                    reader, block, output_dir / "media", force
                ):
                    external_images += 1
                    media_count += 1
                else:
                    image_errors.append("不支持的图片地址")
            except (KeyError, RuntimeError, ValueError) as error:
                image_errors.append(str(error))
                block["_imageUnavailable"] = True
        language["blocks"] = [
            block for block in language.get("blocks", [])
            if not block.get("_imageUnavailable")
        ]
    payload["snapshotAt"] = utc_now()
    payload["contentMode"] = "full"
    if image_errors:
        notice = payload.get("notice", "").strip()
        payload["notice"] = (notice + " " + "；".join(image_errors[:5])).strip()
    return payload, media_count


def sync(output_dir, cache_dir=DEFAULT_CACHE, ids=None, limit=None, force=False, write_index=True):
    output_dir = Path(output_dir).resolve()
    manifest_path = output_dir / "curated.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    all_items = manifest.get("items", [])
    if ids:
        wanted = set(ids)
        all_items = [item for item in all_items if item.get("id") in wanted]
    if limit:
        all_items = all_items[:max(0, limit)]
    if not all_items:
        raise SystemExit("No AI HOT items matched the requested selection.")

    body_dir = output_dir / "bodies"
    media_dir = output_dir / "media"
    body_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)
    reader = PrivateReader(cache_dir, known_ids={item["id"] for item in all_items})
    results = []
    failures = 0
    unavailable = 0

    for index, item in enumerate(all_items, 1):
        item_id = item["id"]
        target = body_dir / (item_id + ".json")
        existing = read_json(target)
        if existing and not force and existing.get("status") in ("available", "partial") and existing.get("languages"):
            languages = existing.get("languages", {})
            print("[%d/%d] skip %s (%d languages)" % (index, len(all_items), item_id, len(languages)), flush=True)
            results.append({
                "id": item_id,
                "status": "available",
                "reused": True,
                "languages": sorted(languages),
                "media": 0,
            })
            continue
        try:
            payload, media_count = snapshot_body(reader, item, output_dir, force)
            languages = sorted(payload.get("languages", {}))
            if not languages:
                unavailable += 1
                results.append({
                    "id": item_id,
                    "status": "unavailable",
                    "error": payload.get("notice", ""),
                })
                print("[%d/%d] UNAVAILABLE %s: %s" % (
                    index, len(all_items), item_id, payload.get("notice", ""),
                ), flush=True)
                continue
            atomic_json(target, payload)
            results.append({
                "id": item_id,
                "status": payload.get("status", "available"),
                "languages": languages,
                "media": media_count,
                "notice": payload.get("notice", ""),
            })
            print("[%d/%d] %s %s languages=%s media=%d" % (
                index, len(all_items), item_id, payload.get("status", "available"),
                ",".join(languages) or "-", media_count,
            ), flush=True)
        except (KeyError, RuntimeError, TypeError, ValueError) as error:
            failures += 1
            results.append({"id": item_id, "status": "error", "error": str(error)})
            print("[%d/%d] ERROR %s: %s" % (index, len(all_items), item_id, error), flush=True)

    body_count = sum(
        1 for path in body_dir.glob("*.json")
        if path.name != "index.json" and (read_json(path) or {}).get("languages")
    )
    summary = {
        "schemaVersion": 1,
        "source": "AI HOT",
        "updatedAt": utc_now(),
        "itemCount": len(all_items),
        "bodyCount": body_count,
        "failureCount": failures,
        "unavailableCount": unavailable,
        "items": results,
    }
    if write_index:
        atomic_json(body_dir / "index.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "aihot")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--ids", help="Comma-separated AI HOT item IDs")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--force", action="store_true", help="Refresh and replace existing snapshots")
    parser.add_argument("--strict", action="store_true", help="Exit nonzero when any requested body is unavailable")
    args = parser.parse_args()

    wanted = {value.strip() for value in args.ids.split(",") if value.strip()} if args.ids else None
    summary = sync(
        args.output_dir,
        cache_dir=args.cache_dir,
        ids=wanted,
        limit=args.limit,
        force=args.force,
    )
    print(json.dumps({
        "processed": len(summary["items"]),
        "bodies": summary["bodyCount"],
        "failures": summary["failureCount"],
        "unavailable": summary["unavailableCount"],
        "output": str(Path(args.output_dir) / "bodies"),
    }, ensure_ascii=False), flush=True)
    if summary["failureCount"] or (args.strict and summary["unavailableCount"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
