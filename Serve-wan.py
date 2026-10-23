"""Host the BO1Z mirror on your network: http://<your-ip>:1000/bsz — the same path scheme as vel.gg/bsz.

Serves the folder this file is in (the site root: index.html, the ten map pages, artifacts/ and the map
packs) under /bsz, plus the /bsz/rooms co-op signalling service the multiplayer lobby talks to. One file,
Python standard library only, nothing to install:

    python Serve-wan.py        # all interfaces: friends on the LAN or over the internet (open/forward TCP 1000)
    python Serve-local.py      # this machine only (127.0.0.1)

The /bo1z prefix answers too, for links saved before the rename.
"""
import base64
import hashlib
import http.server
import json
import mimetypes
import os
import re
import socket
import threading
import time
import urllib.parse
from pathlib import Path

HOST = "0.0.0.0"  # Serve-local.py sets "127.0.0.1"
PORT = 1000
PREFIX = "/bsz"   # what the pages advertise (<base href>) and vel.gg uses
ALIAS = "/bo1z"   # older links still answer
ROOT = Path(__file__).resolve().parent
BUFFER = 1024 * 1024
CHUNK = 8 * 1024 * 1024  # per-map override comes from manifest.json transport.chunk

MAPS = {
    "five": "zombie_pentagon", "kino": "zombie_theater", "riese": "zombie_cod5_factory",
    "nacht": "zombie_cod5_prototype", "verruckt": "zombie_cod5_asylum", "shinonuma": "zombie_cod5_sumpf",
    "ascension": "zombie_cosmodrome", "cotd": "zombie_coast", "shangrila": "zombie_temple", "moon": "zombie_moon",
}
PAGES = (*MAPS, "bo1zm")
MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".webm": "video/webm",
        ".json": "application/json", ".css": "text/css", ".html": "text/html", ".webp": "image/webp",
        ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff": "font/woff",
        ".woff2": "font/woff2", ".txt": "text/plain", ".gsc": "text/plain", ".cfg": "text/plain"}
BLOCKED_SUFFIX = (".partial", ".tmp", "/web-manifest-horde.json", "-horde.html")

_chunks = {}
_chunks_lock = threading.Lock()


class RangeError(Exception):
    pass


def parse_range(value, size):
    """One byte range only, like kino_mirror.py: bytes=a-b, bytes=a- and suffix bytes=-b."""
    if not value.startswith("bytes=") or "," in value:
        raise RangeError("Only one byte range is supported")
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()) or size == 0:
        raise RangeError("Invalid range")
    first, last = match.groups()
    if not first:
        suffix = int(last)
        if suffix <= 0:
            raise RangeError("Invalid suffix range")
        return max(0, size - suffix), size - 1
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or start > end:
        raise RangeError("Unsatisfiable range")
    return start, end


def manifest_chunk(slug):
    """8 MiB transport chunk of one map's pack (?part=N and .br/N slicing)."""
    with _chunks_lock:
        if slug in _chunks:
            return _chunks[slug]
    manifest = ROOT / ("manifest.json" if slug == "five" else f"{slug}/manifest.json")
    try:
        chunk = int(json.loads(manifest.read_text(encoding="utf-8"))["transport"]["chunk"])
        if chunk <= 0:
            raise ValueError(chunk)
    except (OSError, ValueError, KeyError, TypeError):
        chunk = None
    with _chunks_lock:
        _chunks[slug] = chunk
    return chunk


# ----------------------------------------------------------------------------------------------------------------------
# /bsz/rooms — the co-op lobby signalling service (same protocol as the live site's Worker)
# ----------------------------------------------------------------------------------------------------------------------
MAX_PEERS = 4
ROOM_TTL = 6 * 3600
ROOM_ICE = [{"urls": "stun:stun.l.google.com:19302"}, {"urls": "stun:stun.cloudflare.com:3478"}]
ROOM_PATH = re.compile(r"^/(?:bsz|bo1z)/rooms(?=/|$)")

_rooms = {}
_rooms_lock = threading.Lock()


def _room_code():
    # The lobby's invite check is /^[A-Z2-9]{8}$/ (coop.js): eight characters, no I/O/0/1.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(alphabet[b % len(alphabet)] for b in os.urandom(8))


def _room_json(handler, status, payload):
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _room_create(handler):
    try:
        length = int(handler.headers.get("Content-Length") or 0)
        if not 0 < length <= 64 * 1024:
            raise ValueError(length)
        metadata = json.loads(handler.rfile.read(length))
    except Exception:
        _room_json(handler, 400, {"error": "Invalid room metadata"})
        return
    with _rooms_lock:
        now = time.time()
        for code in [c for c, room in _rooms.items() if now - room["createdAt"] > ROOM_TTL and not room["peers"]]:
            _rooms.pop(code, None)
        code = _room_code()
        while code in _rooms:
            code = _room_code()
        room = {"metadata": metadata, "hostToken": os.urandom(16).hex(),
                "createdAt": time.time(), "peers": {}}
        _rooms[code] = room
    _room_json(handler, 200, {"code": code, "hostToken": room["hostToken"], "createdAt": room["createdAt"]})


def _room_get(handler, code):
    with _rooms_lock:
        room = _rooms.get(code)
        metadata = room["metadata"] if room else None
    if metadata is None:
        _room_json(handler, 404, {"error": "That room does not exist."})
        return
    _room_json(handler, 200, metadata)


def rooms_handle(handler):
    """True when this request was a room request (HTTP or WebSocket)."""
    path = handler.path.split("?")[0]
    match = ROOM_PATH.match(path)
    if not match:
        return False
    rest = path[match.end():].strip("/")
    query = dict(urllib.parse.parse_qsl(handler.path.partition("?")[2], keep_blank_values=True))
    if handler.command == "POST" and not rest:
        _room_create(handler)
    elif handler.command == "GET" and rest and rest.endswith("/ice"):
        _room_json(handler, 200, {"iceServers": ROOM_ICE})
    elif handler.command == "GET" and rest and not rest.endswith("/socket"):
        _room_get(handler, rest)
    elif handler.command == "GET" and rest.endswith("/socket"):
        _room_socket(handler, rest.split("/")[0], query)
    else:
        _room_json(handler, 405, {"error": "Unsupported room request"})
    return True


def _room_socket(handler, code, query):
    role, token = query.get("role"), query.get("token", "")
    if role not in ("host", "join"):
        _room_json(handler, 400, {"error": "Invalid role"})
        return
    with _rooms_lock:
        room = _rooms.get(code)
        if not room:
            _room_json(handler, 404, {"error": "That room does not exist."})
            return
        if role == "host":
            if token != room["hostToken"] or 1 in room["peers"]:
                _room_json(handler, 403, {"error": "That room is already hosted."})
                return
            peer = 1
        else:
            free = [n for n in range(2, MAX_PEERS + 1) if n not in room["peers"]]
            if not free:
                _room_json(handler, 409, {"error": "That room is full."})
                return
            peer = free[0]
        session = os.urandom(8).hex()
        room["peers"][peer] = {"session": session, "socket": None}

    key = handler.headers.get("Sec-WebSocket-Key")
    if not key:
        _room_json(handler, 400, {"error": "Not a WebSocket request"})
        return
    accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
    handler.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                         f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
    handler.wfile.flush()
    handler.close_connection = True

    link = _Link(handler.rfile, handler.wfile)
    with _rooms_lock:
        room = _rooms.get(code)
        if not room:
            link.close()
            return
        room["peers"][peer]["socket"] = link
        others = [(n, info["session"]) for n, info in room["peers"].items() if n != peer]
        metadata = room["metadata"]
    link.send({"type": "welcome", "peer": peer, "metadata": metadata})
    for other, other_session in others:
        link.send({"type": "peer", "peer": other, "session": other_session})
        _room_to(code, other, {"type": "peer", "peer": peer, "session": session})

    try:
        while True:
            message = link.read()
            if message is None:
                break
            try:
                data = json.loads(message)
            except ValueError:
                continue
            target = data.get("peer")
            if not isinstance(target, int) or target == peer:
                continue
            with _rooms_lock:
                room = _rooms.get(code)
                sender = room["peers"].get(peer) if room else None
                receiver = room["peers"].get(target) if room else None
                sender_session = sender["session"] if sender else session
            if not receiver:
                continue
            data["peer"] = peer
            data["session"] = sender_session
            _room_to(code, target, data)
    finally:
        with _rooms_lock:
            room = _rooms.get(code)
            if room:
                room["peers"].pop(peer, None)
                others = list(room["peers"].items())
                if not room["peers"]:
                    _rooms.pop(code, None)
        for other, _info in others if room else []:
            _room_to(code, other, {"type": "left", "peer": peer, "session": session})
        link.close()


def _room_to(code, peer, payload):
    with _rooms_lock:
        room = _rooms.get(code)
        link = room["peers"].get(peer, {}).get("socket") if room else None
    if link:
        try:
            link.send(payload)
        except OSError:
            pass


class _Link:
    """Minimal RFC 6455 text frames; the signalling messages are small JSON objects."""

    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.closed = False

    def read(self):
        while True:
            header = self.reader.read(2)
            if len(header) < 2:
                return None
            opcode = header[0] & 0x0F
            length = header[1] & 0x7F
            if length == 126:
                length = int.from_bytes(self.reader.read(2), "big")
            elif length == 127:
                length = int.from_bytes(self.reader.read(8), "big")
            if length > 1 << 20:
                return None
            mask = self.reader.read(4) if header[1] & 0x80 else None
            payload = self.reader.read(length)
            if len(payload) < length:
                return None
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:  # close
                return None
            if opcode == 0x9:  # ping
                self._frame(0xA, payload)
                continue
            if opcode in (0x1, 0x0):
                return payload.decode("utf-8", "replace")
            # Binary/pong: ignored.

    def send(self, payload):
        if not self.closed:
            self._frame(0x1, json.dumps(payload).encode())

    def _frame(self, opcode, payload):
        header = bytes([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header += bytes([length])
        elif length < 1 << 16:
            header += bytes([126]) + length.to_bytes(2, "big")
        else:
            header += bytes([127]) + length.to_bytes(8, "big")
        self.writer.write(header + payload)
        self.writer.flush()

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self._frame(0x8, b"")
        except OSError:
            pass


# ----------------------------------------------------------------------------------------------------------------------
# Static site
# ----------------------------------------------------------------------------------------------------------------------
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        # Cross-origin isolation: the engine needs SharedArrayBuffer.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format, *args):
        # No query strings: they carry room tokens.
        print(f"HTTP {self.command} {urllib.parse.urlsplit(self.path).path}", flush=True)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            if not rooms_handle(self):
                self._static()
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass

    def do_POST(self):
        try:
            if not rooms_handle(self):
                self._error(404, "Not found")
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass

    def _error(self, status, message):
        body = message.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _static(self):
        request = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(request.path)
        if path in ("", "/"):
            self.send_response(302)
            self.send_header("Location", PREFIX + "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        for prefix in (PREFIX, ALIAS):
            if path == prefix:
                rel = "/"
                break
            if path.startswith(prefix + "/"):
                rel = path[len(prefix):]
                break
        else:
            return self._error(404, "Not found")
        rel_path = rel.rstrip("/").lstrip("/")
        if not rel_path:
            rel_path = "index.html"
        elif "/" not in rel_path and rel_path in PAGES:
            rel_path += ".html"  # clean page URLs: /bsz/kino serves kino.html (the pack dir sits beside it)
        part = None
        pack = next((slug for slug in MAPS
                     if rel_path.startswith("pack/" if slug == "five" else f"{slug}/pack/")), None)
        object_part = re.fullmatch(r"(.+)\.br/(\d{1,10})", rel_path) if pack else None
        if object_part:  # the CDN's <file>.br/<k> spelling: serve that slice of the whole file
            rel_path, part = object_part[1], int(object_part[2])
        query = urllib.parse.parse_qs(request.query, keep_blank_values=True)
        if "part" in query:
            if part is not None or pack is None or len(query["part"]) != 1 \
                    or not re.fullmatch(r"\d{1,10}", query["part"][0]):
                return self._error(400, "Invalid part")
            part = int(query["part"][0])
        if any(segment.startswith(".") for segment in rel_path.split("/")) or rel_path.endswith(BLOCKED_SUFFIX):
            return self._error(404, "Not a public asset")
        target = (ROOT / rel_path).resolve()
        if not (target == ROOT or ROOT in target.parents) or not target.is_file():
            return self._error(404, "Offline asset not found")
        with open(target, "rb") as stream:
            full_size = os.fstat(stream.fileno()).st_size
            base_offset, size = 0, full_size
            if part is not None:
                chunk = manifest_chunk(pack)
                if chunk is None:
                    return self._error(404, "Offline map manifest not found or invalid")
                base_offset = part * chunk
                if base_offset >= full_size:
                    return self._error(404, "Offline chunk not found")
                size = min(chunk, full_size - base_offset)
            start, end, status = 0, size - 1, 200
            if "Range" in self.headers:
                try:
                    start, end = parse_range(self.headers["Range"], size)
                except RangeError:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
            length = max(0, end - start + 1)
            mime = MIME.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] \
                or "application/octet-stream"
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-cache")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if self.command == "HEAD":
                return
            stream.seek(base_offset + start)
            remaining = length
            while remaining:
                block = stream.read(min(BUFFER, remaining))
                if not block:
                    self.close_connection = True
                    return
                self.wfile.write(block)
                remaining -= len(block)


def _lan_ips():
    addresses = set()
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        addresses.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in addresses if not ip.startswith("127."))


def main():
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print("BO1Z mirror online:")
    print(f"  http://127.0.0.1:{PORT}{PREFIX}")
    if HOST == "0.0.0.0":
        for ip in _lan_ips():
            print(f"  http://{ip}:{PORT}{PREFIX}   (friends on your network)")
        print("Internet play: forward TCP port 1000 to this machine, then share http://<your-public-ip>:1000/bsz")
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
