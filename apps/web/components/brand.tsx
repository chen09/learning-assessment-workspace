import Link from "next/link";

export function Brand({ tagline = "family learning" }: { tagline?: string }) {
  return (
    <Link className="brand" href="/" aria-label="Luma">
      <span className="brand-mark" aria-hidden="true">
        L
      </span>
      <span className="brand-copy">
        <strong>Luma</strong>
        <small>{tagline}</small>
      </span>
    </Link>
  );
}
