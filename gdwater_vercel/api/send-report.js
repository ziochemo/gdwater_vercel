const { Resend } = require('resend');

/* ============================================================
   CONFIGURAZIONE — entrambe come variabili d'ambiente su Vercel
   ============================================================ */
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const SHEET_URL  = process.env.SHEET_WEBHOOK_URL || '';

const TEC_MAIL = {
  "D'Attimis": "pdattimis@gmail.com",
  "Ecobay":    "info@ecobay.it"
};

const UFFICIO = ['service@gdwater.it', 'amministrazione@gdwater.it'];

/* ============================================================
   REGISTRO SUL FOGLIO
   Non deve mai bloccare l'invio: tetto di 7 secondi, e in caso
   di problemi si va avanti comunque.
   ============================================================ */
async function sheetCall(payload) {
  if (!SHEET_URL) {
    console.log('[SHEET] SHEET_WEBHOOK_URL non impostata - registro saltato');
    return null;
  }
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl.signal
    });
    const testo = await r.text();
    console.log('[SHEET]', payload.action, '-> HTTP', r.status, 'in', Date.now() - t0, 'ms |', testo.slice(0, 160));
    try { return JSON.parse(testo); } catch (e) { return null; }
  } catch (e) {
    console.warn('[SHEET]', payload.action, e.name === 'AbortError'
      ? 'TIMEOUT dopo 7s'
      : 'errore: ' + e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).end(); return; }

  let data = {};
  let to = [];

  try {
    const body = req.body;
    data = body.data || {};
    const pdf = body.pdf;

    const attivitaTxt = Array.isArray(data.ats)
      ? data.ats.map(a => a.n).join(' + ')
      : String(data.ats || '');

    const anagrafica = {
      num: data.num, ts: new Date().toISOString(),
      data: data.oggi, ora: data.ora,
      tecnico: data.tecnico, cliente: data.cliente,
      attivita: attivitaTxt, tentativi: data.tentativi || 1
    };

    /* ---- 1. PRENOTAZIONE: questo numero e gia stato spedito? ---- */
    const claim = await sheetCall(Object.assign({ action: 'claim' }, anagrafica));

    if (claim && claim.duplicate) {
      console.log('[DEDUP] rapportino', data.num, 'gia inviato in precedenza - non rispedito');
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    if (!claim) {
      // Il foglio non risponde. Meglio un doppione che un rapportino perso.
      console.warn('[DEDUP] registro non raggiungibile: procedo senza controllo duplicati');
    }

    /* ---- 2. DESTINATARI ---- */
    to = UFFICIO.slice();
    if (data.emailCliente && String(data.emailCliente).trim()) to.push(String(data.emailCliente).trim());
    if (data.tecnico && TEC_MAIL[data.tecnico]) to.push(TEC_MAIL[data.tecnico]);

    const attivitaHtml = Array.isArray(data.ats)
      ? data.ats.map(a => a.n).join('<br>')
      : String(data.ats || '');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0A1C3B;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">GD Water &middot; Rapportino ${data.num}</h2>
          <p style="color:#5B9BFF;margin:4px 0 0;font-size:13px">${data.oggi || ''} ${data.ora ? 'ore ' + data.ora : ''}</p>
        </div>
        <div style="background:#f8fafc;padding:20px 24px">
          <p><strong>Tecnico:</strong> ${data.tecnico}</p>
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p><strong>Cliente:</strong> ${data.cliente}<br>
             <strong>Indirizzo:</strong> ${data.indirizzo}<br>
             <strong>Tipologia:</strong> ${data.tipo}
             ${data.emailCliente ? '<br><strong>Email:</strong> ' + data.emailCliente : ''}</p>
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p><strong>Attivita:</strong><br>${attivitaHtml}</p>
          <p><strong>Orario:</strong> ${data.orario}</p>
          ${data.note && data.note !== 'Nessuna' ? '<p><strong>Note:</strong> ' + data.note + '</p>' : ''}
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p><strong>Impianto</strong><br>Modello: ${data.modello}<br>N. Seriale: ${data.seriale}</p>
          ${data.materiali && data.materiali !== 'Nessuno' ? '<p><strong>Materiali:</strong> ' + data.materiali + '</p>' : ''}
          ${data.tentativi && data.tentativi > 1 ? '<p style="font-size:12px;color:#92400E;background:#FEF3C7;padding:8px 10px;border-radius:6px">Invio differito: il rapportino era rimasto in coda sul dispositivo del tecnico (tentativo ' + data.tentativi + ').</p>' : ''}
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p style="font-size:12px;color:#64748B">Il rapportino firmato e allegato in PDF.</p>
        </div>
        <div style="background:#0A1C3B;padding:12px 24px;border-radius:0 0 8px 8px;text-align:center">
          <p style="color:#5B9BFF;font-size:11px;margin:0">GD Water &middot; Servizi post-vendita impianti acqua uso alimentare</p>
        </div>
      </div>`;

    /* ---- 3. INVIO ---- */
    if (!RESEND_KEY) throw new Error('RESEND_API_KEY non impostata su Vercel');

    const resend = new Resend(RESEND_KEY);
    const sent = await resend.emails.send({
      from: 'Rapportini GD Water <rapportini@gdwater.it>',
      to: to,
      subject: `Rapportino ${data.num} - ${data.tecnico} - ${data.cliente}`,
      html: html,
      attachments: [{
        filename: `Rapportino_${data.num}_${String(data.cliente).replace(/\s+/g, '_')}.pdf`,
        content: pdf
      }]
    });

    if (sent && sent.error) throw new Error(sent.error.message || JSON.stringify(sent.error));

    /* ---- 4. ESITO ---- */
    await sheetCall({
      action: 'result', num: data.num, esito: 'INVIATA',
      destinatari: to.join(', '), errore: '', tentativi: data.tentativi || 1
    });

    res.status(200).json({ ok: true, recipients: to });

  } catch (err) {
    console.error('send-report error:', err);

    await sheetCall({
      action: 'result', num: data.num || '?', esito: 'ERRORE',
      destinatari: to.join(', '),
      errore: String(err.message || err).slice(0, 300),
      tentativi: data.tentativi || 1
    });

    res.status(500).json({ error: String(err.message || err) });
  }
};
