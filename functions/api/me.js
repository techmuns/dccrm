/** /api/me — the signed-in user's email (from Cloudflare Access), or "Team". */
import { json, currentUser } from './_lib.js';
export function onRequestGet({ request }) {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  return json({ user: currentUser(request), authenticated: !!(email && email.trim()) });
}
