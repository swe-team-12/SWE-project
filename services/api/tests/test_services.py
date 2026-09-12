from typing import Any

from app import services


class FakeS3Client:
    def generate_presigned_url(
        self,
        operation_name: str,
        *,
        Params: dict[str, str],
        ExpiresIn: int,
    ) -> str:
        assert operation_name == "get_object"
        assert Params == {"Bucket": "biletflow", "Key": "support/case/proof.png"}
        assert ExpiresIn == 180
        return "http://public-storage.example/biletflow/support/case/proof.png?signature=test"


def test_signed_download_url_is_signed_for_public_endpoint(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_client(service_name: str, **kwargs: Any) -> FakeS3Client:
        captured["service_name"] = service_name
        captured.update(kwargs)
        return FakeS3Client()

    monkeypatch.setattr(services.boto3, "client", fake_client)
    monkeypatch.setattr(
        services.settings,
        "s3_public_endpoint",
        "http://public-storage.example",
    )

    url = services.signed_download_url("support/case/proof.png", expires_seconds=180)

    assert captured["service_name"] == "s3"
    assert captured["endpoint_url"] == "http://public-storage.example"
    assert url.startswith("http://public-storage.example/")
