const { Resend } = require('resend');

const TEC_MAIL = {
  "D'Attimis": "pdattimis@gmail.com",
  "Ecobay": "info@ecobay.it"
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { pdf, data } = req.body;
    const resend = new Resend(process.env.RESEND_API_KEY);

    const to = ['service@gdwater.it', 'amministrazione@gdwater.it'];
    if (data.emailCliente && data.emailCliente.trim()) to.push(data.emailCliente.trim());
    if (data.tecnico && TEC_MAIL[data.tecnico]) to.push(TEC_MAIL[data.tecnico]);

    console.log('Recipients:', to);

    const attivita = Array.isArray(data.ats)
      ? data.ats.map(function(a){ return a.n; }).join('<br>')
      : String(data.ats || '');

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0A1C3B;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">GD Water &middot; Rapportino N. ${data.num}</h2>
          <p style="color:#5B9BFF;margin:4px 0 0;font-size:13px">${data.oggi}</p>
        </div>
        <div style="background:#f8fafc;padding:20px 24px">
          <p><strong>Tecnico:</strong> ${data.tecnico}</p>
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p><strong>Cliente:</strong> ${data.cliente}<br>
             <strong>Indirizzo:</strong> ${data.indirizzo}<br>
             <strong>Tipologia:</strong> ${data.tipo}
             ${data.emailCliente ? '<br><strong>Email:</strong> ' + data.emailCliente : ''}
          </p>
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p><strong>Attivita:</strong><br>${attivita}</p>
          <p><strong>Orario:</strong> ${data.orario}</p>
          ${data.note && data.note !== 'Nessuna' ? '<p><strong>Note:</strong> ' + data.note + '</p>' : ''}
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p><strong>Impianto</strong><br>
             Modello: ${data.modello}<br>
             N. Seriale: ${data.seriale}
          </p>
          ${data.materiali && data.materiali !== 'Nessuno' ? '<p><strong>Materiali:</strong> ' + data.materiali + '</p>' : ''}
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:12px 0">
          <p style="font-size:12px;color:#64748B">Il rapportino firmato e allegato in PDF.</p>
        </div>
        <div style="background:#0A1C3B;padding:12px 24px;border-radius:0 0 8px 8px;text-align:center">
          <p style="color:#5B9BFF;font-size:11px;margin:0">GD Water &middot; Servizi post-vendita impianti acqua uso alimentare</p>
        </div>
      </div>`;

    await resend.emails.send({
      from: 'Rapportini GD Water <rapportini@gdwater.it>',
      to: to,
      subject: 'Rapportino N. ' + data.num + ' - ' + data.tecnico + ' - ' + data.cliente,
      html: emailHtml,
      attachments: [{
        filename: 'Rapportino_' + data.num + '_' + data.cliente.replace(/\s+/g, '_') + '.pdf',
        content: pdf
      }]
    });

    res.status(200).json({ ok: true, recipients: to });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
};
