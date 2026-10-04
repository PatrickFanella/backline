"""Serve a built dashboard and its SPA routes on loopback for a private pilot."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class DashboardHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        route = urlsplit(self.path).path
        target = Path(self.translate_path(route))
        if not target.exists() and not Path(route).suffix:
            self.path = "/index.html"
        return super().send_head()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--port", type=int, default=5173)
    args = parser.parse_args()
    root = args.directory.resolve(strict=True)
    if not (root / "index.html").is_file():
        parser.error("Directory must contain a built dashboard")
    handler = functools.partial(DashboardHandler, directory=str(root))
    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()
