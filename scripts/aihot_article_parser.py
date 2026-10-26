#!/usr/bin/env python3
"""Convert an AI HOT page's first visible div.prose to inert article blocks.

This module does not fetch URLs or inspect scripts/hydration data.  Run
``python3 scripts/aihot_article_parser.py --verify`` for a small structural and
security check, or pass a saved HTML file and its canonical page URL to inspect
the resulting JSON.
"""

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit


_VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
_DROP = {
    "script", "style", "iframe", "object", "embed", "template", "noscript",
    "svg", "canvas", "form", "button", "input", "select", "textarea",
    "audio", "video",
}
_BLOCK = {
    "p", "div", "section", "article", "header", "footer", "main", "aside",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol",
    "li", "hr", "figure", "figcaption", "table", "thead", "tbody", "tfoot",
    "tr", "td", "th", "dl", "dt", "dd",
}
_SPACE = re.compile(r"\s+")
_HIDDEN_STYLE = re.compile(
    r"(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)",
    re.I,
)
_CONTENT_CLASSES = {
    "article-body", "article-content", "article__body", "article__content",
    "content-body", "entry-content", "markdown-body", "post-body",
    "post-content", "prose", "rich_media_content", "story-body",
}


class _Node:
    def __init__(self, tag, attrs=None, ignored=False):
        self.tag = tag
        self.attrs = attrs or {}
        self.children = []
        self.ignored = ignored


class _PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("document")
        self.stack = [self.root]

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        hidden = (
            "hidden" in attrs
            or attrs.get("aria-hidden", "").lower() == "true"
            or bool(_HIDDEN_STYLE.search(attrs.get("style", "")))
        )
        node = _Node(tag, attrs, self.stack[-1].ignored or hidden or tag in _DROP)
        self.stack[-1].children.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attributes):
        self.handle_starttag(tag, attributes)
        if tag not in _VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        # In particular, no script/hydration string is retained or inspected.
        if not self.stack[-1].ignored:
            self.stack[-1].children.append(data)


def _walk(node):
    if node.ignored:
        return
    yield node
    for child in node.children:
        if isinstance(child, _Node):
            yield from _walk(child)


def _plain(node, preserve=False):
    if isinstance(node, str):
        return node
    if node.ignored:
        return ""
    if node.tag == "br":
        return "\n"
    values = []
    for child in node.children:
        values.append(_plain(child, preserve))
        if not preserve and isinstance(child, _Node) and child.tag in _BLOCK:
            values.append("\n")
    return "".join(values)


def _url(value, page_url):
    """Resolve a normal HTTP URL, excluding credentials and control characters."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if any(ord(char) < 32 or ord(char) == 127 for char in value) or "\\" in value:
        return None
    try:
        resolved = urljoin(page_url, value)
        parsed = urlsplit(resolved)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        # Forces malformed ports such as https://host:abc/ to be rejected.
        parsed.port
        return resolved
    except (ValueError, TypeError):
        return None


def _append_inline(result, text, marks):
    if not text:
        return
    entry = dict(marks)
    entry["text"] = text
    if result and {k: v for k, v in result[-1].items() if k != "text"} == marks:
        result[-1]["text"] += text
    else:
        result.append(entry)


def _trim_inlines(inlines):
    """Collapse HTML whitespace across markup while preserving explicit br."""
    result = []
    last_space = True
    for item in inlines:
        text = item["text"]
        if item.get("code"):
            text = text.replace("\r\n", "\n").replace("\r", "\n")
        else:
            # br has its own newline token; ordinary source formatting is space.
            text = "\n" if text == "\n" else _SPACE.sub(" ", text)
        if last_space and text.startswith(" "):
            text = text.lstrip(" ")
        if text:
            _append_inline(result, text, {k: v for k, v in item.items() if k != "text"})
            last_space = text.endswith((" ", "\n"))
    while result:
        result[-1]["text"] = result[-1]["text"].rstrip()
        if result[-1]["text"]:
            break
        result.pop()
    return result


class _BlockConverter:
    def __init__(self, page_url):
        self.page_url = page_url

    def inline_parts(self, node, marks=None):
        """Yield inline dictionaries and image blocks in source document order."""
        marks = dict(marks or {})
        if isinstance(node, str):
            yield {"text": node, **marks}
            return
        if node.ignored:
            return
        if node.tag == "img":
            src = _url(node.attrs.get("src"), self.page_url)
            if src:
                block = {"type": "image", "src": src, "alt": node.attrs.get("alt", "")}
                for dimension in ("width", "height"):
                    value = node.attrs.get(dimension, "")
                    if re.fullmatch(r"[1-9]\d{0,5}", value):
                        block[dimension] = int(value)
                yield block
            return
        if node.tag == "br":
            yield {"text": "\n", **marks}
            return
        if node.tag == "a":
            href = _url(node.attrs.get("href"), self.page_url)
            if href:
                marks["href"] = href
        elif node.tag in ("strong", "b"):
            marks["bold"] = True
        elif node.tag in ("em", "i"):
            marks["italic"] = True
        elif node.tag == "code":
            marks["code"] = True
        for child in node.children:
            yield from self.inline_parts(child, marks)

    def inline_blocks(self, nodes, kind="paragraph", level=None):
        result, inlines = [], []

        def flush():
            cleaned = _trim_inlines(inlines)
            inlines.clear()
            if not cleaned:
                return
            text = "".join(item["text"] for item in cleaned)
            if not text.strip():
                return
            block = {"type": kind, "text": text}
            if kind != "quote":
                block["inlines"] = cleaned
            if level is not None:
                block["level"] = level
            result.append(block)

        for node in nodes:
            for part in self.inline_parts(node):
                if part.get("type") == "image":
                    flush()
                    result.append(part)
                else:
                    inlines.append(part)
        flush()
        return result

    def list_blocks(self, node, depth=0):
        """Flatten nested lists with visible indentation, retaining image order."""
        result, items = [], []

        def flush():
            if items:
                result.append({"type": "list", "ordered": node.tag == "ol", "items": list(items)})
                items.clear()

        for child in node.children:
            if not isinstance(child, _Node) or child.ignored or child.tag != "li":
                continue
            chunks = []

            def flush_item():
                if not chunks:
                    return
                blocks = self.flow(chunks)
                chunks.clear()
                for block in blocks:
                    if block["type"] == "paragraph":
                        inlines = block["inlines"]
                        if depth:
                            inlines = [{"text": "\u2003" * depth}] + inlines
                        items.append({"inlines": inlines})
                    else:
                        flush()
                        result.append(block)

            for content in child.children:
                if isinstance(content, _Node) and content.tag in ("ol", "ul") and not content.ignored:
                    flush_item()
                    flush()
                    result.extend(self.list_blocks(content, depth + 1))
                else:
                    chunks.append(content)
            flush_item()
        flush()
        return result

    def flow(self, nodes, default_kind="paragraph"):
        result, pending = [], []

        def flush():
            if pending:
                result.extend(self.inline_blocks(pending, default_kind))
                pending.clear()

        for node in nodes:
            if isinstance(node, str):
                pending.append(node)
                continue
            if node.ignored:
                continue
            tag = node.tag
            if tag not in _BLOCK:
                pending.append(node)
                continue
            flush()
            if tag == "p":
                result.extend(self.inline_blocks(node.children, default_kind))
            elif re.fullmatch(r"h[1-6]", tag):
                result.extend(self.inline_blocks(node.children, "heading", max(2, min(4, int(tag[1])))))
            elif tag in ("ol", "ul"):
                result.extend(self.list_blocks(node))
            elif tag == "blockquote":
                result.extend(self.flow(node.children, "quote"))
            elif tag == "pre":
                text = _plain(node, preserve=True).replace("\r\n", "\n").replace("\r", "\n")
                if text.strip():
                    block = {"type": "code", "text": text}
                    for descendant in _walk(node):
                        for token in descendant.attrs.get("class", "").split():
                            if token.startswith("language-") and re.fullmatch(r"language-[\w.+#-]{1,40}", token):
                                block["language"] = token[len("language-"):]
                                break
                        if "language" in block:
                            break
                    result.append(block)
            elif tag == "hr":
                result.append({"type": "rule"})
            else:
                result.extend(self.flow(node.children, default_kind))
        flush()
        return result


def parse_article(html, page_url):
    """Return visible article blocks and optional visible-page metadata.

    No body is inferred from hidden state.  A missing visible article is an
    explicit error so that callers do not cache a login/error page as success.
    """
    if not isinstance(html, str):
        raise TypeError("html must be text")
    if not _url(page_url, page_url):
        raise ValueError("page_url must be an absolute HTTP(S) URL without credentials")
    parser = _PageParser()
    parser.feed(html)
    parser.close()
    prose = next((node for node in _walk(parser.root)
                  if node.tag == "div" and "prose" in node.attrs.get("class", "").split()), None)
    if prose is None:
        raise ValueError("No visible article div.prose was found")
    blocks = _BlockConverter(page_url).flow(prose.children)
    if not blocks:
        raise ValueError("Visible article div.prose has no readable content")
    result = {"blocks": blocks, "topics": [], "tags": []}
    for node in _walk(parser.root):
        if node.tag != "a":
            continue
        href = _url(node.attrs.get("href"), page_url)
        if not href:
            continue
        parsed = urlsplit(href)
        text = _SPACE.sub(" ", _plain(node)).strip()
        if not text:
            continue
        same_site = parsed.netloc == urlsplit(page_url).netloc
        if same_site and parsed.path.startswith("/topics/") and text not in result["topics"]:
            result["topics"].append(text)
        elif same_site and parsed.path == "/all" and "tag" in parse_qs(parsed.query):
            label = text.lstrip("#").strip()
            if label and label not in result["tags"]:
                result["tags"].append(label)
        if same_site and text == "原文" and parsed.path == urlsplit(page_url).path.rstrip("/") + "/original":
            result.setdefault("originalViewURL", href)
        elif text in ("打开原文", "原文链接", "阅读原文") and not same_site:
            result.setdefault("originalURL", href)
        if "author" in node.attrs.get("rel", "").lower().split():
            result.setdefault("author", text)
    return result


def _text_length(blocks):
    total = 0
    for block in blocks:
        if block.get("inlines"):
            total += sum(len(part.get("text", "")) for part in block["inlines"])
        elif block.get("items"):
            total += sum(
                len(part.get("text", ""))
                for item in block["items"]
                for part in item.get("inlines", [])
            )
        elif block.get("type") == "code":
            total += len(block.get("text", ""))
    return total


def _link_text_length(blocks):
    total = 0
    for block in blocks:
        if not block.get("inlines"):
            continue
        for part in block["inlines"]:
            if part.get("href"):
                total += len(part.get("text", ""))
    return total


def _source_candidates(root):
    for node in _walk(root):
        if node.tag in ("article", "main"):
            yield node
            continue
        if node.tag not in ("div", "section"):
            continue
        classes = {value.lower() for value in node.attrs.get("class", "").split()}
        if classes & _CONTENT_CLASSES:
            yield node


def _source_block_signature(block):
    kind = block.get("type", "")
    if block.get("inlines"):
        text = " ".join(part.get("text", "") for part in block["inlines"])
    elif block.get("items"):
        text = " ".join(
            part.get("text", "")
            for item in block["items"]
            for part in item.get("inlines", [])
        )
    else:
        text = block.get("text", "")
    return kind + ":" + _SPACE.sub(" ", text).strip().lower()


def _clean_source_blocks(blocks):
    stop_phrases = {
        "keep reading", "related", "related articles", "read more",
        "recommended", "recommended articles", "you may also like",
        "更多内容", "推荐阅读", "相关阅读", "延伸阅读",
    }
    result = []
    seen = set()
    for block in blocks:
        if block.get("type") == "heading":
            heading = _source_block_signature(block).split(":", 1)[-1]
            if heading in stop_phrases:
                break
        signature = _source_block_signature(block)
        if signature and signature in seen:
            continue
        seen.add(signature)
        result.append(block)
    return result


def parse_source_article(html, page_url):
    """Extract the strongest readable article from a publisher page.

    Publisher pages use several common containers instead of AI HOT's
    ``div.prose``. Candidate content is scored by readable text and block
    structure so a page shell or teaser is not mistaken for the full article.
    """
    if not isinstance(html, str):
        raise TypeError("html must be text")
    if not _url(page_url, page_url):
        raise ValueError("page_url must be an absolute HTTP(S) URL without credentials")
    parser = _PageParser()
    parser.feed(html)
    parser.close()

    language = "original"
    html_node = next((node for node in _walk(parser.root) if node.tag == "html"), None)
    if html_node and html_node.attrs.get("lang", "").lower().startswith("zh"):
        language = "zh"

    best = None
    for node in _source_candidates(parser.root):
        blocks = _BlockConverter(page_url).flow(node.children)
        if not blocks:
            continue
        chars = _text_length(blocks)
        paragraphs = sum(block.get("type") == "paragraph" for block in blocks)
        headings = sum(block.get("type") == "heading" for block in blocks)
        if chars < 80 or (paragraphs < 2 and chars < 200):
            continue
        link_chars = _link_text_length(blocks)
        link_penalty = int(800 * link_chars / max(chars, 1))
        score = (
            chars
            + paragraphs * 80
            + headings * 50
            + (500 if node.tag == "article" else 300 if node.tag == "main" else 200)
            - link_penalty
        )
        if best is None or score > best[0]:
            best = (score, language, blocks)

    if best is None:
        raise ValueError("No readable publisher article was found")
    blocks = best[2]
    first_heading = next(
        (index for index, block in enumerate(blocks) if block.get("type") == "heading"),
        None,
    )
    if first_heading is not None and 0 < first_heading <= 5:
        if _text_length(blocks[:first_heading]) < 300:
            blocks = blocks[first_heading:]
    blocks = _clean_source_blocks(blocks)
    return {"blocks": blocks, "language": best[1], "topics": [], "tags": []}


def _verify():
    example = '''<script>{"body":"hidden secret"}</script>
    <div hidden><div class="prose"><p>invisible article</p></div></div>
    <div class="prose"><h1>A <em>heading</em></h1>
    <p>Before <strong>bold</strong> <a href="/ok">link</a>
    <a href="javascript:alert(1)">unsafe</a><a href="https://u:p@bad/">credentials</a>
    <img src="/image.png" onerror="alert(1)" width="640" height="480">After</p>
    <iframe>frame secret</iframe><style>style secret</style>
    <p aria-hidden="true">hidden text</p><p style="display:none">hidden style</p>
    <pre><code class="language-python">x = 1\n  print(x)\n</code></pre>
    <ol><li>first<ul><li>nested <code>x</code></li></ul>tail</li><li>last</li></ol>
    <blockquote><p>quoted</p></blockquote><hr></div>
    <div class="prose"><p>second article</p></div>
    <a href="/topics/agent">Agent</a><a href="/all?tag=Agent">#Agent</a>
    <a href="/items/test/original">原文</a>
    <a href="https://publisher.example/story">打开原文</a>'''
    article = parse_article(example, "https://aihot.news/items/test")
    serialized = json.dumps(article)
    assert all(term not in serialized for term in (
        "hidden secret", "invisible article", "frame secret", "style secret",
        "hidden text", "hidden style", "second article", "javascript:", "https://u:p@", "onerror",
    ))
    blocks = article["blocks"]
    assert [block["type"] for block in blocks[:4]] == ["heading", "paragraph", "image", "paragraph"]
    assert blocks[0]["level"] == 2
    assert blocks[2]["src"] == "https://aihot.news/image.png"
    assert blocks[2]["width"] == 640 and blocks[2]["height"] == 480
    assert any(inline.get("bold") for inline in blocks[1]["inlines"])
    assert any(inline.get("href") == "https://aihot.news/ok" for inline in blocks[1]["inlines"])
    assert next(block for block in blocks if block["type"] == "code") == {
        "type": "code", "text": "x = 1\n  print(x)\n", "language": "python",
    }
    nested = [item for block in blocks if block["type"] == "list" for item in block["items"]]
    assert any(item["inlines"][0]["text"] == "\u2003" for item in nested)
    assert article["topics"] == ["Agent"] and article["tags"] == ["Agent"]
    assert article["originalURL"] == "https://publisher.example/story"
    assert article["originalViewURL"] == "https://aihot.news/items/test/original"
    for value in ("javascript:alert(1)", "https://u:p@example.com/", "https://example.com:bad/", "//u:p@example.com/", "https://exa\\mple.com/"):
        assert _url(value, "https://aihot.news/") is None
    for invalid in ("<div>missing article</div>", '<div class="prose"><script>body</script></div>'):
        try:
            parse_article(invalid, "https://aihot.news/")
        except ValueError:
            pass
        else:
            raise AssertionError("Unreadable page must not be accepted")

    source = '''<html lang="zh-CN"><body><nav><p>导航链接</p></nav>
    <main><p>很短</p></main><article><h1>原始文章</h1>
    <p>这是从原始来源提取的第一段正文，包含足够多的说明、背景信息和具体事实，用于正文识别与质量校验。</p>
    <p>这是第二段正文，包含<a href="/reference">站内引用</a>、补充解释、影响分析以及更多可供后续阅读的正文信息。</p>
    <img src="/publisher.png" width="800" height="450">
    </article><footer><p>版权信息</p></footer></body></html>'''
    source_article = parse_source_article(source, "https://publisher.example/story")
    assert source_article["language"] == "zh"
    assert source_article["blocks"][0]["text"] == "原始文章"
    assert any(block.get("type") == "image" for block in source_article["blocks"])
    for invalid in ("<html><body><nav>only navigation</nav></body></html>", "<html><body></body></html>"):
        try:
            parse_source_article(invalid, "https://publisher.example/")
        except ValueError:
            pass
        else:
            raise AssertionError("Publisher page without article must not be accepted")
    print("Article parser structural/security verification passed.")


def main():
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("html_file", nargs="?")
    command.add_argument("page_url", nargs="?", default="https://aihot.news/")
    command.add_argument("--verify", action="store_true")
    args = command.parse_args()
    if args.verify:
        _verify()
    if args.html_file:
        result = parse_article(Path(args.html_file).read_text(encoding="utf-8"), args.page_url)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif not args.verify:
        command.error("provide an HTML file or --verify")


if __name__ == "__main__":
    main()
