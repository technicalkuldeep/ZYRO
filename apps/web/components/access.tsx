import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
export async function Access({
  children,
  admin = false,
}: {
  children: React.ReactNode;
  admin?: boolean;
}) {
  const jar = await cookies();
  let data;
  try {
    const response = await fetch(
      `${process.env.API_URL || "http://127.0.0.1:4000"}/api/auth/me`,
      {
        headers: { Cookie: jar.toString() },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) throw new Error("unavailable");
    data = await response.json();
  } catch {
    return (
      <section className="panel access-state">
        <h1>Arena is taking a breather.</h1>
        <p>
          The account database is unavailable. Your saved points have not
          changed.
        </p>
        <a className="button secondary" href="">
          Try again
        </a>
        <a className="button ghost" href="/">
          Return home
        </a>
      </section>
    );
  }
  if (!data.user) {
    const requested =
      (await headers()).get("x-zyro-path") || (admin ? "/admin" : "/arena");
    redirect(`/signin?returnTo=${encodeURIComponent(requested)}`);
  }
  if (admin && !data.user.admin)
    return (
      <section className="panel access-state">
        <span className="overline">403 · PRIVATE WORKSPACE</span>
        <h1>Administrator access required.</h1>
        <p>This account cannot access ZYRO administration.</p>
        <a className="button primary" href="/arena">
          Return to Arena
        </a>
      </section>
    );
  return <>{children}</>;
}
