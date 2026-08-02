from scripts.export_openapi import schema_diff


def test_schema_diff_identifies_generated_contract_changes() -> None:
    diff = schema_diff('{\n  "version": 1\n}\n', '{\n  "version": 2\n}\n')

    assert "--- docs/openapi.json" in diff
    assert "+++ generated OpenAPI schema" in diff
    assert '-  "version": 1' in diff
    assert '+  "version": 2' in diff
