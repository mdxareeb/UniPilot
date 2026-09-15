"""Minimal PostgREST/Storage client over requests, service-role only."""
import requests


class ServiceError(Exception):
    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class SupabaseRest:
    def __init__(self, url: str, service_key: str, timeout: int = 30):
        if not url or not service_key:
            raise ServiceError("Supabase URL/service key missing on the worker host", retryable=False)
        self.url = url.rstrip("/")
        self.service_key = service_key
        self.timeout = timeout

    def _headers(self, prefer: str | None = None) -> dict:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _request(self, method, path, *, params=None, json=None, prefer=None):
        try:
            response = requests.request(
                method, f"{self.url}{path}", params=params, json=json,
                headers=self._headers(prefer), timeout=self.timeout,
            )
        except requests.RequestException as error:
            raise ServiceError("Supabase request failed (transport)", retryable=True) from error
        if response.status_code >= 400:
            retryable = response.status_code >= 500 or response.status_code in (408, 429)
            raise ServiceError(
                f"{method} {path} failed with status {response.status_code}", retryable=retryable
            )
        return response

    def select(self, table: str, params: dict) -> list:
        return self._request("GET", f"/rest/v1/{table}", params=params).json()

    def select_one(self, table: str, params: dict):
        rows = self.select(table, params)
        return rows[0] if rows else None

    def patch(self, table, params, body, prefer: str = "return=minimal"):
        response = self._request(
            "PATCH", f"/rest/v1/{table}", params=params, json=body, prefer=prefer
        )
        return response.json() if response.content else []

    def insert(self, table, body, prefer=None, params=None):
        response = self._request(
            "POST", f"/rest/v1/{table}", params=params, json=body,
            prefer=prefer or "return=representation",
        )
        return response.json() if response.content else []

    def delete(self, table, params):
        self._request("DELETE", f"/rest/v1/{table}", params=params, prefer="return=minimal")

    def rpc(self, name, body):
        response = self._request("POST", f"/rest/v1/rpc/{name}", json=body)
        return response.json() if response.content else None

    def download_object(self, bucket: str, path: str) -> bytes:
        response = self._request("GET", f"/storage/v1/object/{bucket}/{path}")
        return response.content

    def remove_object(self, bucket: str, path: str):
        self._request("DELETE", f"/storage/v1/object/{bucket}/{path}", prefer="return=minimal")
