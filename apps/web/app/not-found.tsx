import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <h1>That page is off the map.</h1>
      <p>Find a new perspective in the market explorer.</p>
      <Link className="button primary" href="/markets">
        Explore markets
      </Link>
    </div>
  );
}
