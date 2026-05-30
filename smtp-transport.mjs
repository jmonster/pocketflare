// SMTP transport for Cloudflare Workers using cloudflare:sockets.
//
// This module implements the client side of SMTP (RFC 5321) sufficient to
// deliver email through an SMTP relay on port 465 (implicit TLS) or port 587
// (STARTTLS). Port 25 is blocked by the platform and rejected explicitly.
//
// Usage:
//   import { registerSmtpTransport } from './smtp-transport.mjs';
//   registerSmtpTransport();
//   // Now globalThis.__pocketflare_smtp_send is available to Go/WASM.

import { connect } from 'cloudflare:sockets';

// ---- public entry point ---------------------------------------------------

export function registerSmtpTransport() {
  if (globalThis.__pocketflare_smtp_send) {
    return; // already registered
  }
  globalThis.__pocketflare_smtp_send = smtpSend;
}

// ---- connection cache -----------------------------------------------------

let cachedConn = null;   // { socket, writer, reader, host, port, tlsMode, authSent }
let connLock = false;    // simple mutex for serializing sends

async function withLock(fn) {
  while (connLock) {
    await new Promise(r => setTimeout(r, 5));
  }
  connLock = true;
  try {
    return await fn();
  } finally {
    connLock = false;
  }
}

// ---- main send function ---------------------------------------------------

async function smtpSend(cfg) {
  return withLock(async () => {
    const config = goObjectToJS(cfg);
    return sendWithConfig(config);
  });
}

async function sendWithConfig(cfg) {
  // Validate port.
  if (cfg.port === 25) {
    throw new Error('SMTP port 25 is blocked by Cloudflare Workers. Use port 465 (implicit TLS) or 587 (STARTTLS).');
  }
  if (!cfg.host || cfg.host.trim() === '') {
    throw new Error('SMTP host is required');
  }

  const tlsMode = cfg.tls
    ? (cfg.port === 465 ? 'on' : 'starttls')
    : 'off';

  // Try to reuse a cached connection.
  if (cachedConn && cachedConn.host === cfg.host && cachedConn.port === cfg.port && cachedConn.tlsMode === tlsMode) {
    try {
      await writeLine(cachedConn, 'RSET');
      const resp = await readResponse(cachedConn);
      if (resp.code === 250) {
        // Connection is alive and reset; send the message.
        return await sendOverSocket(cachedConn, cfg);
      }
    } catch (_) {
      // Cached connection is dead; discard and create new.
    }
    await closeConn(cachedConn);
    cachedConn = null;
  }

  // Close any stale cached connection (different host/port/tlsMode).
  if (cachedConn) {
    await closeConn(cachedConn);
    cachedConn = null;
  }

  // Create a new connection.
  const conn = await newConnection(cfg.host, cfg.port, tlsMode);
  cachedConn = { socket: conn.socket, writer: conn.writer, reader: conn.reader, host: cfg.host, port: cfg.port, tlsMode };

  try {
    await smtpHandshake(conn, cfg);
    // Sync cache with any socket upgrade (STARTTLS replaces the socket).
    cachedConn = { socket: conn.socket, writer: conn.writer, reader: conn.reader, host: cfg.host, port: cfg.port, tlsMode };
    return await sendOverSocket(conn, cfg);
  } catch (e) {
    await closeConn(conn);
    cachedConn = null;
    throw e;
  }
}

// ---- connection -----------------------------------------------------------

async function newConnection(host, port, tlsMode) {
  const secureTransport = tlsMode === 'on' ? 'on' : 'off';

  const socket = connect({ hostname: host, port }, { secureTransport });
  const writer = socket.writable.getWriter();
  const reader = readableStreamReader(socket.readable);

  try {
    // Read the initial greeting.
    const greeting = await readResponse({ reader });
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed: ${formatResponse(greeting)}`);
    }
  } catch (e) {
    try { writer.close(); } catch (_) {}
    try { socket.close(); } catch (_) {}
    throw e;
  }

  return { socket, writer, reader };
}

async function closeConn(conn) {
  if (!conn) return;
  try { conn.writer.close(); } catch (_) {}
  try { conn.socket.close(); } catch (_) {}
}

// ---- SMTP protocol --------------------------------------------------------

async function smtpHandshake(conn, cfg) {
  // EHLO
  const localName = cfg.localName || 'localhost';
  await writeLine(conn, `EHLO ${localName}`);
  const ehlo = await readResponse(conn);
  if (ehlo.code !== 250) {
    throw new Error(`SMTP EHLO failed: ${formatResponse(ehlo)}`);
  }

  // For port 587 (STARTTLS), we connect with secureTransport='off' (plain TCP),
  // send STARTTLS, then explicitly upgrade the socket with socket.startTls().
  // For port 465 (implicit TLS), TLS is already active from the connection.
  if (cfg.tls && cfg.port !== 465) {
    await writeLine(conn, 'STARTTLS');
    const starttlsResp = await readResponse(conn);
    if (starttlsResp.code !== 220) {
      throw new Error(`SMTP STARTTLS failed: ${formatResponse(starttlsResp)}`);
    }

    // Upgrade to TLS. startTls() returns a new TLS-wrapped socket; the
    // original socket is no longer usable.
    const tlsSocket = conn.socket.startTls();
    try { conn.writer.close(); } catch (_) {}
    conn.socket = tlsSocket;
    conn.writer = tlsSocket.writable.getWriter();
    conn.reader = readableStreamReader(tlsSocket.readable);

    // Re-EHLO over the encrypted channel. There is no second greeting
    // after STARTTLS — the server is waiting for the next command.
    await writeLine(conn, `EHLO ${localName}`);
    const ehlo2 = await readResponse(conn);
    if (ehlo2.code !== 250) {
      throw new Error(`SMTP post-STARTTLS EHLO failed: ${formatResponse(ehlo2)}`);
    }
  }

  // AUTH
  if (cfg.username && cfg.password) {
    const authMethod = (cfg.authMethod || 'PLAIN').toUpperCase();
    if (authMethod === 'LOGIN') {
      await authLogin(conn, cfg.username, cfg.password);
    } else {
      await authPlain(conn, cfg.username, cfg.password);
    }
  }
}

async function authPlain(conn, username, password) {
  const creds = base64Encode(`\x00${username}\x00${password}`);
  await writeLine(conn, `AUTH PLAIN ${creds}`);
  const resp = await readResponse(conn);
  if (resp.code !== 235) {
    throw new Error(`SMTP AUTH PLAIN failed: ${formatResponse(resp)}`);
  }
}

async function authLogin(conn, username, password) {
  await writeLine(conn, 'AUTH LOGIN');
  let resp = await readResponse(conn);
  if (resp.code !== 334) {
    throw new Error(`SMTP AUTH LOGIN failed: ${formatResponse(resp)}`);
  }
  await writeLine(conn, base64Encode(username));
  resp = await readResponse(conn);
  if (resp.code !== 334) {
    throw new Error(`SMTP AUTH LOGIN (username) failed: ${formatResponse(resp)}`);
  }
  await writeLine(conn, base64Encode(password));
  resp = await readResponse(conn);
  if (resp.code !== 235) {
    throw new Error(`SMTP AUTH LOGIN (password) failed: ${formatResponse(resp)}`);
  }
}

async function sendOverSocket(conn, cfg) {
  // MAIL FROM
  const fromAddr = cfg.from || '';
  await writeLine(conn, `MAIL FROM:<${fromAddr}>`);
  let resp = await readResponse(conn);
  if (resp.code !== 250) {
    throw new Error(`SMTP MAIL FROM failed: ${formatResponse(resp)}`);
  }

  // RCPT TO
  const recipients = cfg.recipients || [];
  for (const rcpt of recipients) {
    await writeLine(conn, `RCPT TO:<${rcpt}>`);
    resp = await readResponse(conn);
    if (resp.code !== 250 && resp.code !== 251) {
      throw new Error(`SMTP RCPT TO <${rcpt}> failed: ${formatResponse(resp)}`);
    }
  }

  // DATA
  await writeLine(conn, 'DATA');
  resp = await readResponse(conn);
  if (resp.code !== 354) {
    throw new Error(`SMTP DATA failed: ${formatResponse(resp)}`);
  }

  // Send dot-stuffed message body.
  const mime = cfg.mimeMessage || '';
  await sendDotStuffed(conn, mime);

  resp = await readResponse(conn);
  if (resp.code !== 250) {
    throw new Error(`SMTP message rejected: ${formatResponse(resp)}`);
  }

  // Don't QUIT — keep the connection alive for reuse.
  // The connection will be reset via RSET on the next send.
}

// ---- I/O helpers ----------------------------------------------------------

async function writeLine(conn, line) {
  const w = conn.writer;
  const encoded = new TextEncoder().encode(line + '\r\n');
  await w.write(encoded);
}

async function sendDotStuffed(conn, data) {
  // Dot-stuffing: prepend an extra '.' to any line starting with '.'.
  // Also ensure \r\n line endings.
  const w = conn.writer;
  const encoder = new TextEncoder();

  // Normalize line endings to \r\n.
  let normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  normalized = normalized.replace(/\n/g, '\r\n');

  // Split and dot-stuff.
  const lines = normalized.split('\r\n');
  const chunks = [];
  for (const line of lines) {
    if (line.startsWith('.')) {
      chunks.push('.' + line);
    } else {
      chunks.push(line);
    }
  }

  // Send as a single write to avoid chunking issues.
  const body = chunks.join('\r\n') + '\r\n.\r\n';
  await w.write(encoder.encode(body));
}

async function readResponse(conn) {
  const r = conn.reader;
  let fullText = '';
  let done = false;

  while (!done) {
    let line = '';
    // Read one line at a time (\r\n terminated).
    while (true) {
      const { value, done: streamDone } = await r.read();
      if (streamDone) {
        done = true;
        break;
      }
      const chunk = new TextDecoder().decode(value);
      fullText += chunk;
      if (fullText.includes('\r\n')) {
        break;
      }
    }

    if (done) break;

    // Extract completed lines from fullText.
    const lines = fullText.split('\r\n');
    // Check if the last complete line is a final line (starts with NNN<space>).
    for (let i = 0; i < lines.length - 1; i++) {
      const l = lines[i];
      if (/^\d{3}[ -]/.test(l)) {
        if (l.charAt(3) === ' ') {
          // Final line of a (possibly multi-line) response.
          done = true;
        }
      }
    }
  }

  // Parse the response code from the last line.
  const lines = fullText.trim().split('\r\n');
  const lastLine = lines[lines.length - 1] || '';
  const match = lastLine.match(/^(\d{3}) /);
  const code = match ? parseInt(match[1], 10) : 0;

  return { code, text: fullText.trim() };
}

function formatResponse(resp) {
  if (!resp) return '(no response)';
  // Return only the SMTP status code and first line of text.
  // Never include command payloads.
  const lines = resp.text.split('\r\n');
  return lines[0] || `code ${resp.code}`;
}

// ---- readable stream line reader ------------------------------------------

function readableStreamReader(readable) {
  let reader = null;
  return {
    read: async () => {
      if (!reader) reader = readable.getReader();
      return reader.read();
    },
  };
}

// ---- base64 for Unicode passwords -----------------------------------------
// TextEncoder-aware base64. btoa() only handles Latin1.

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---- Go object → JS object ------------------------------------------------
// Go's js.ValueOf(map[string]any{...}) produces a plain JS object when
// passed to Invoke(). The cfg argument is already a regular JS object.

function goObjectToJS(goObj) {
  // js.ValueOf from Go produces a plain JS object for maps.
  // Return as-is; this function exists as a hook for any edge cases.
  return goObj;
}
