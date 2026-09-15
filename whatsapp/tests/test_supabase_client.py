import pytest
import requests

from wa_service.supabase_client import ServiceError, SupabaseRest


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code
        self.content = b""

    def json(self):
        return []


def client():
    return SupabaseRest("http://local", "service")


@pytest.mark.parametrize("status", [400, 401, 403, 404, 409, 422])
def test_client_errors_are_non_retryable(monkeypatch, status):
    monkeypatch.setattr(requests, "request", lambda *args, **kwargs: FakeResponse(status))
    with pytest.raises(ServiceError) as excinfo:
        client().select("integration_runs", {"select": "*"})
    assert excinfo.value.retryable is False
    assert str(excinfo.value) == f"GET /rest/v1/integration_runs failed with status {status}"


@pytest.mark.parametrize("status", [500, 503])
def test_server_errors_are_retryable(monkeypatch, status):
    monkeypatch.setattr(requests, "request", lambda *args, **kwargs: FakeResponse(status))
    with pytest.raises(ServiceError) as excinfo:
        client().select("integration_runs", {"select": "*"})
    assert excinfo.value.retryable is True


@pytest.mark.parametrize("status", [408, 429])
def test_timeout_and_rate_limit_are_retryable(monkeypatch, status):
    monkeypatch.setattr(requests, "request", lambda *args, **kwargs: FakeResponse(status))
    with pytest.raises(ServiceError) as excinfo:
        client().select("integration_runs", {"select": "*"})
    assert excinfo.value.retryable is True


def test_transport_error_becomes_retryable_service_error(monkeypatch):
    def raise_connection_error(*args, **kwargs):
        raise requests.ConnectionError("connection refused")

    monkeypatch.setattr(requests, "request", raise_connection_error)
    with pytest.raises(ServiceError) as excinfo:
        client().select("integration_runs", {"select": "*"})
    assert excinfo.value.retryable is True
    assert excinfo.value.message == "Supabase request failed (transport)"


def test_patch_defaults_to_minimal_and_returns_no_rows(monkeypatch):
    calls = {}

    def fake_request(method, url, **kwargs):
        calls.update(kwargs)
        return FakeResponse(204)

    monkeypatch.setattr(requests, "request", fake_request)
    assert client().patch("events", {"id": "eq.e1"}, {"title": "x"}) == []
    assert calls["headers"]["Prefer"] == "return=minimal"


def test_patch_representation_returns_rows_and_sends_prefer(monkeypatch):
    calls = {}

    def fake_request(method, url, **kwargs):
        calls.update(kwargs)
        response = FakeResponse(200)
        response.content = b'[{"id": "cand-1"}]'
        response.json = lambda: [{"id": "cand-1", "status": "confirmed"}]
        return response

    monkeypatch.setattr(requests, "request", fake_request)
    rows = client().patch(
        "integration_candidates",
        {"id": "eq.cand-1", "status": "eq.pending"},
        {"status": "confirmed"},
        prefer="return=representation",
    )
    assert rows == [{"id": "cand-1", "status": "confirmed"}]
    assert calls["headers"]["Prefer"] == "return=representation"
    assert calls["json"] == {"status": "confirmed"}
    assert calls["params"] == {"id": "eq.cand-1", "status": "eq.pending"}
