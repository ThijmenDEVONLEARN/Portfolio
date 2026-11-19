// The contact form endpoint. Everything else is a static file from dist/ (see wrangler.jsonc).
// Secrets, set in the Cloudflare dashboard: TURNSTILE_SECRET and CONTACT_TO (the inbox the messages go to).
const TOPICS = ['website', 'automatisering', 'werk', 'anders'];
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = (ok, status) => Response.json({ ok }, { status });
const line = (s) => s.replace(/[\r\n]+/g, ' ').trim(); // keeps form input out of the mail headers

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/contact') return json(false, 404);
    if (request.method !== 'POST') return json(false, 405);
    // only the site's own form may post here
    if (request.headers.get('Origin') !== url.origin) return json(false, 403);
    if (Number(request.headers.get('Content-Length') ?? 0) > 20_000) return json(false, 413);
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    // a few messages a minute from one address is plenty
    if (!(await env.LIMIT.limit({ key: ip })).success) return json(false, 429);

    let form;
    try {
      form = await request.formData();
    } catch {
      return json(false, 400);
    }
    const get = (k) => String(form.get(k) ?? '').trim();
    // a field people never see; a bot that fills it in is told all went well and nothing is sent
    if (get('website')) return json(true, 200);

    const naam = line(get('naam'));
    const mail = get('mail');
    const bericht = get('bericht');
    const onderwerp = get('onderwerp');
    if (
      !naam ||
      naam.length > 100 ||
      !MAIL.test(mail) ||
      mail.length > 200 ||
      !bericht ||
      bericht.length > 5000 ||
      !TOPICS.includes(onderwerp)
    )
      return json(false, 400);

    let human;
    try {
      const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: get('cf-turnstile-response'),
          remoteip: ip,
        }),
      });
      human = (await check.json()).success;
    } catch {
      return json(false, 502); // the check itself is unreachable: refuse rather than let it through
    }
    if (!human) return json(false, 403);

    try {
      await env.EMAIL.send({
        to: env.CONTACT_TO,
        from: env.CONTACT_FROM,
        replyTo: mail,
        subject: `Portfolio (${onderwerp}): bericht van ${naam}`,
        text: `Van: ${naam} <${mail}>\nOnderwerp: ${onderwerp}\n\n${bericht}`,
      });
    } catch (e) {
      console.error('contact mail failed', e.code, e.message);
      return json(false, 502);
    }
    return json(true, 200);
  },
};
