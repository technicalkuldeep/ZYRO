"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty" role="alert">
      <h1>Something interrupted this page.</h1>
      <p>Your saved data stays on the server. Try loading the page again.</p>
      <button onClick={reset} className="button primary">
        Try again
      </button>
    </div>
  );
}
