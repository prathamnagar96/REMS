"""Vercel Python function entrypoint for the FastAPI backend."""
from __future__ import annotations

from server.app.main import app as fastapi_app


class PrefixAwareASGI:
    """Ensure requests are routed correctly whether Vercel strips /api or not."""

    def __init__(self, app, prefix: str = "/api") -> None:
        self.app = app
        self.prefix = prefix
        self._prefix_bytes = prefix.encode("utf-8")

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            path = scope.get("path") or ""
            if not path.startswith(self.prefix):
                updated_scope = dict(scope)
                updated_scope["path"] = f"{self.prefix}{path if path.startswith('/') else '/' + path}"

                raw_path = scope.get("raw_path")
                if isinstance(raw_path, (bytes, bytearray)):
                    normalized_raw = raw_path if raw_path.startswith(b"/") else b"/" + bytes(raw_path)
                    updated_scope["raw_path"] = self._prefix_bytes + normalized_raw

                scope = updated_scope

        await self.app(scope, receive, send)


app = PrefixAwareASGI(fastapi_app)
