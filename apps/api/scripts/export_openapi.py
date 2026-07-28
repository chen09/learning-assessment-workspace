import argparse
import json
from pathlib import Path

from app.main import create_app


def render_schema() -> str:
    return json.dumps(
        create_app().openapi(),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    output_path = Path(__file__).parents[3] / "docs" / "openapi.json"
    rendered = render_schema()
    if arguments.check:
        return 0 if output_path.exists() and output_path.read_text() == rendered else 1
    output_path.write_text(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
