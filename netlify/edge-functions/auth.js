// HTTP Basic login in front of the whole site (docs/adr/0001: the tool must never have a public
// URL). Credentials come from the Netlify environment variables BASIC_AUTH_USER and
// BASIC_AUTH_PASSWORD. If either is missing the site refuses to serve anything.

const decoder = new TextDecoder();

// Compares without stopping at the first difference.
function sameText(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function credentialsOf(request) {
  const [scheme, encoded] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  try {
    const text = decoder.decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    const colon = text.indexOf(":");
    return colon < 0 ? null : { user: text.slice(0, colon), password: text.slice(colon + 1) };
  } catch {
    return null;
  }
}

export default async (request, context) => {
  const user = Netlify.env.get("BASIC_AUTH_USER");
  const password = Netlify.env.get("BASIC_AUTH_PASSWORD");
  if (!user || !password) {
    return new Response("Pristup nije konfiguriran (BASIC_AUTH_USER i BASIC_AUTH_PASSWORD).", { status: 503 });
  }
  const given = credentialsOf(request);
  if (given && sameText(given.user, user) && sameText(given.password, password)) {
    return context.next();
  }
  return new Response("Potrebna je prijava.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Granice", charset="UTF-8"' },
  });
};

export const config = { path: "/*" };
