/* ============================================================
   GD WATER — REGISTRO RAPPORTINI
   Da incollare in Estensioni > Apps Script del foglio.
   Sostituisce integralmente la versione precedente.
   ============================================================ */

var SHEET_NAME = 'Log';

/* Cambia a ogni modifica dello script: serve a verificare, aprendo
   l'indirizzo /exec nel browser, quale versione e davvero pubblicata. */
var VERSIONE_SCRIPT = '2026-11-17 · dedup per UID';

/* Aperto nel browser, l'indirizzo /exec risponde con la versione in uso.
   Se compare "Funzione script non trovata: doGet", il deployment e vecchio. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, versione: VERSIONE_SCRIPT }))
    .setMimeType(ContentService.MimeType.JSON);
}

var COL = { TS:1, NUM:2, DATA:3, ORA:4, TEC:5, CLI:6, ATT:7,
            ESITO:8, DEST:9, TENT:10, ERR:11, SETT:12, UID:13 };

var INTESTAZIONE = ['Timestamp','Numero','Data','Ora','Tecnico','Cliente',
                    'Attivita','Esito','Destinatari','Tentativi','Errore','Settimana','UID'];

/* ---------- utilita ---------- */

function foglio_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(INTESTAZIONE);
    sh.setFrozenRows(1);
  } else if (!sh.getRange(1, COL.UID).getValue()) {
    sh.getRange(1, COL.UID).setValue('UID');   // aggiunta una volta sola
    pulisciRigheVuote_(sh);                    // toglie le righe lasciate dalla versione precedente
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function settimana_(ts) {
  var d = new Date(ts);
  if (isNaN(d)) d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "YYYY-'W'ww");
}

/* ------------------------------------------------------------------
   MANUTENZIONE A MANO
   Nell'editor Apps Script scegli "pulisciOra" nel menu a tendina in
   alto e premi Esegui: toglie le righe vuote rimaste nel foglio.
   Si puo rilanciare quando serve, non cancella nulla di valido.
   ------------------------------------------------------------------ */
function pulisciOra() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) { Logger.log('Foglio "' + SHEET_NAME + '" non trovato.'); return; }
  var n = pulisciRigheVuote_(sh);
  Logger.log(n ? ('Righe vuote rimosse: ' + n) : 'Nessuna riga vuota da rimuovere.');
}

/* Righe senza numero ne tecnico: le lasciava la versione precedente dello
   script quando riceveva una richiesta che non conosceva. Non contengono
   nulla, si rimuovono una volta sola al primo avvio della nuova versione. */
function pulisciRigheVuote_(sh) {
  if (sh.getLastRow() < 2) return;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, COL.TEC).getValues();
  var tolte = 0;
  for (var i = v.length - 1; i >= 0; i--) {
    if (!String(v[i][COL.NUM - 1] || '').trim() &&
        !String(v[i][COL.TEC - 1] || '').trim()) {
      sh.deleteRow(i + 2);
      tolte++;
    }
  }
  return tolte;
}

/* cerca il rapportino per identificatore tecnico, dal fondo.
   L'UID non si ricicla mai: un contatore azzerato non puo piu
   far scambiare un rapportino nuovo per un doppione. */
function trovaRiga_(sh, uid) {
  if (!uid || sh.getLastRow() < 2) return 0;
  var valori = sh.getRange(2, COL.UID, sh.getLastRow() - 1, 1).getValues();
  for (var i = valori.length - 1; i >= 0; i--) {
    if (String(valori[i][0]) === String(uid)) return i + 2;
  }
  return 0;
}

/* ultimo progressivo registrato per un tecnico, per riallineare il contatore */
function ultimoNumero_(sh, prefisso) {
  if (!prefisso || sh.getLastRow() < 2) return 0;
  var valori = sh.getRange(2, COL.NUM, sh.getLastRow() - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < valori.length; i++) {
    var v = String(valori[i][0] || '');
    if (v.indexOf(prefisso + '-') !== 0) continue;
    var n = parseInt(v.slice(prefisso.length + 1), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

function aggiungiRiga_(sh, r, esito) {
  sh.appendRow([
    r.ts || new Date().toISOString(),
    r.num || '', r.data || '', r.ora || '',
    r.tecnico || '', r.cliente || '', r.attivita || '',
    esito || '', r.destinatari || '',
    r.tentativi || 1, r.errore || '',
    settimana_(r.ts), r.uid || ''
  ]);
}

/* ---------- endpoint ---------- */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return json_({ error: 'foglio occupato' }); }

  try {
    var r = JSON.parse(e.postData.contents);
    var sh = foglio_();
    var azione = r.action || 'append';

    /* ULTIMO PROGRESSIVO — serve all'app per riallineare il contatore */
    if (azione === 'lastnum') {
      return json_({ ok: true, ultimo: ultimoNumero_(sh, r.prefisso) });
    }

    /* PRENOTAZIONE — risponde se QUESTO rapportino risulta gia inviato */
    if (azione === 'claim') {
      var riga = trovaRiga_(sh, r.uid);
      if (riga && String(sh.getRange(riga, COL.ESITO).getValue()) === 'INVIATA') {
        return json_({ ok: true, duplicate: true });
      }
      if (riga) {
        sh.getRange(riga, COL.ESITO).setValue('IN CORSO');
        sh.getRange(riga, COL.TENT).setValue(r.tentativi || 1);
        sh.getRange(riga, COL.TS).setValue(r.ts || new Date().toISOString());
      } else {
        aggiungiRiga_(sh, r, 'IN CORSO');
      }
      return json_({ ok: true, duplicate: false });
    }

    /* ESITO — chiude la riga aperta dalla prenotazione */
    if (azione === 'result') {
      var riga2 = trovaRiga_(sh, r.uid);
      if (!riga2) {
        aggiungiRiga_(sh, r, r.esito || '');
        return json_({ ok: true, creata: true });
      }
      sh.getRange(riga2, COL.ESITO).setValue(r.esito || '');
      sh.getRange(riga2, COL.DEST).setValue(r.destinatari || '');
      sh.getRange(riga2, COL.ERR).setValue(r.errore || '');
      sh.getRange(riga2, COL.TENT).setValue(r.tentativi || 1);
      return json_({ ok: true });
    }

    aggiungiRiga_(sh, r, r.esito || '');
    return json_({ ok: true });

  } catch (err) {
    return json_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   RIEPILOGO SETTIMANALE VIA EMAIL (opzionale)
   Attivazioni > Aggiungi attivazione > riepilogoSettimanale,
   basata sul tempo, timer settimanale, lunedi mattina.
   ============================================================ */

var DESTINATARI_RIEPILOGO = 'cinzia@termoel.it,amministrazione@gdwater.it';

function riepilogoSettimanale() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return;

  var righe = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  var da = new Date();
  da.setDate(da.getDate() - 7);

  var perTecnico = {}, daVerificare = [], totale = 0;

  righe.forEach(function (r) {
    var ts = new Date(r[0]);
    if (isNaN(ts) || ts < da) return;
    totale++;
    var tec = r[4] || 'sconosciuto';
    if (!perTecnico[tec]) perTecnico[tec] = { inviati: 0, aperti: 0, numeri: [] };
    if (r[7] === 'INVIATA') {
      perTecnico[tec].inviati++;
    } else {
      perTecnico[tec].aperti++;
      daVerificare.push(r[1] + ' — ' + tec + ' — ' + r[7] + ' ' + (r[10] || ''));
    }
    perTecnico[tec].numeri.push(r[1]);
  });

  var corpo = '<h2>Rapportini ultimi 7 giorni</h2>';
  corpo += '<p>Totale registrati: <strong>' + totale + '</strong></p>';
  corpo += '<table border="1" cellpadding="6" style="border-collapse:collapse">';
  corpo += '<tr><th>Tecnico</th><th>Inviati</th><th>Non conclusi</th><th>Numeri</th></tr>';

  Object.keys(perTecnico).forEach(function (t) {
    var p = perTecnico[t];
    corpo += '<tr><td>' + t + '</td><td>' + p.inviati + '</td><td>' + p.aperti +
             '</td><td>' + p.numeri.join(', ') + '</td></tr>';
  });
  corpo += '</table>';

  if (daVerificare.length) {
    corpo += '<h3>Da verificare</h3><ul><li>' + daVerificare.join('</li><li>') + '</li></ul>';
  }
  corpo += '<p style="font-size:12px;color:#666">I numeri sono progressivi per tecnico: ' +
           'un buco nella sequenza e un rapportino mai arrivato al server.</p>';

  MailApp.sendEmail({
    to: DESTINATARI_RIEPILOGO,
    subject: 'GD Water — rapportini settimana (' + totale + ')',
    htmlBody: corpo
  });
}
