import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Luma Learn home">
      <span className="brand-mark" aria-hidden="true">
        L
      </span>
      <span className="brand-copy">
        <strong>Luma</strong>
        <small>family learning</small>
      </span>
    </Link>
  );
}
