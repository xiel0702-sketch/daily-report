#!/usr/bin/env python3
"""Snapshot selected AI HOT article bodies and images into the static site."""
import argparse
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


def snapshot_body(reader, item_id, output_dir, force):
    payload = reader.item(item_id, refresh=force)
    media_count = 0
    image_errors = []
    for language in payload.get("languages", {}).values():
        for block in language.get("blocks", []):
            if block.get("type") != "image":
                continue
            try:
                if snapshot_media(reader, block, output_dir / "media", force):
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "aihot")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--ids", help="Comma-separated AI HOT item IDs")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--force", action="store_true", help="Refresh and replace existing snapshots")
    args = parser.parse_args()

    output_dir = args.output_dir.resolve()
    manifest_path = output_dir / "curated.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    all_items = manifest.get("items", [])
    if args.ids:
        wanted = {value.strip() for value in args.ids.split(",") if value.strip()}
        all_items = [item for item in all_items if item.get("id") in wanted]
    if args.limit:
        all_items = all_items[:max(0, args.limit)]
    if not all_items:
        raise SystemExit("No AI HOT items matched the requested selection.")

    body_dir = output_dir / "bodies"
    media_dir = output_dir / "media"
    body_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)
    reader = PrivateReader(args.cache_dir)
    results = []
    failures = 0

    for index, item in enumerate(all_items, 1):
        item_id = item["id"]
        target = body_dir / (item_id + ".json")
        existing = read_json(target)
        if existing and not args.force:
            languages = existing.get("languages", {})
            print("[%d/%d] skip %s (%d languages)" % (index, len(all_items), item_id, len(languages)), flush=True)
            results.append({
                "id": item_id,
                "status": "skipped",
                "languages": sorted(languages),
                "media": 0,
            })
            continue
        try:
            payload, media_count = snapshot_body(reader, item_id, output_dir, args.force)
            atomic_json(target, payload)
            languages = sorted(payload.get("languages", {}))
            results.append({
                "id": item_id,
                "status": payload.get("status", "unknown"),
                "languages": languages,
                "media": media_count,
                "notice": payload.get("notice", ""),
            })
            print("[%d/%d] %s %s languages=%s media=%d" % (
                index, len(all_items), item_id, payload.get("status", "unknown"),
                ",".join(languages) or "-", media_count,
            ), flush=True)
        except (KeyError, RuntimeError, TypeError, ValueError) as error:
            failures += 1
            results.append({"id": item_id, "status": "error", "error": str(error)})
            print("[%d/%d] ERROR %s: %s" % (index, len(all_items), item_id, error), flush=True)

    body_count = sum(1 for path in body_dir.glob("*.json") if path.name != "index.json")
    summary = {
        "schemaVersion": 1,
        "source": "AI HOT",
        "updatedAt": utc_now(),
        "itemCount": len(all_items),
        "bodyCount": body_count,
        "failureCount": failures,
        "items": results,
    }
    atomic_json(body_dir / "index.json", summary)
    print(json.dumps({
        "processed": len(all_items),
        "bodies": summary["bodyCount"],
        "failures": failures,
        "output": str(body_dir),
    }, ensure_ascii=False), flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
