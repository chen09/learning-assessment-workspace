import argparse
import difflib
import json
import sys
from pathlib import Path

from app.main import create_app


def render_schema() -> str:
    return json.dumps(
        create_app().openapi(),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def schema_diff(expected: str, rendered: str) -> str:
    return "".join(
        difflib.unified_diff(
            expected.splitlines(keepends=True),
            rendered.splitlines(keepends=True),
            fromfile="docs/openapi.json",
            tofile="generated OpenAPI schema",
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    output_path = Path(__file__).parents[3] / "docs" / "openapi.json"
    rendered = render_schema()
    if arguments.check:
        expected = output_path.read_text() if output_path.exists() else ""
        if expected == rendered:
            return 0
        print("OpenAPI contract is out of date. Run npm run openapi:generate.", file=sys.stderr)
        print(schema_diff(expected, rendered), file=sys.stderr)
        return 1
    output_path.write_text(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
