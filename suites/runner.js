'use strict';

// ─── Terminal ─────────────────────────────────────────────────────────────────
const isTTY = Boolean(process.stdout.isTTY);

const raw = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
};
// In non-TTY (CI pipes) strip all escape codes so logs stay clean
const c = isTTY
  ? raw
  : Object.fromEntries(Object.keys(raw).map(k => [k, '']));

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function eraseLine() {
  if (isTTY) process.stdout.write('\r\x1b[2K');
}

// ─── State ────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

// ─── test() ──────────────────────────────────────────────────────────────────
async function test(name, fn) {
  const t0 = Date.now();

  // Spinner — shows elapsed time when the test runs long
  let frame = 0;
  let timer = null;
  if (isTTY) {
    const spin = () => {
      const ms = Date.now() - t0;
      const fr  = FRAMES[frame++ % FRAMES.length];
      const age = ms > 4000
        ? ` ${c.yellow}(${(ms / 1000).toFixed(0)}s…)${c.reset}`
        : '';
      process.stdout.write(`\r\x1b[2K  ${c.dim}${fr}${c.reset} ${name}${age}`);
    };
    spin();
    timer = setInterval(spin, 100);
  }

  // Capture console.log emitted inside the test so it doesn't break the spinner.
  // Logs are flushed, indented, after the result line.
  const logs = [];
  const origLog = console.log;
  console.log = (...args) =>
    logs.push(
      args
        .map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
        .join(' '),
    );

  const elapsed = () => {
    const ms = Date.now() - t0;
    return ms > 200
      ? ` ${c.dim}(${ms > 999 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`})${c.reset}`
      : '';
  };

  const flushLogs = () => {
    logs.forEach(entry =>
      entry
        .split('\n')
        .forEach(line => origLog(`     ${c.dim}│${c.reset} ${line}`)),
    );
  };

  try {
    await fn();
    clearInterval(timer);
    eraseLine();
    origLog(`  ${c.green}✓${c.reset} ${name}${elapsed()}`);
    console.log = origLog;
    flushLogs();
    passed++;
  } catch (err) {
    clearInterval(timer);
    eraseLine();
    origLog(`  ${c.red}✗${c.reset} ${c.bold}${c.red}${name}${c.reset}`);
    console.log = origLog;
    flushLogs();

    let detail;
    if (err.response) {
      const st   = err.response.status;
      const body = err.response.data;
      detail = `HTTP ${st} — ${JSON.stringify(body)}`;
      origLog(`     ${c.dim}├─${c.reset} HTTP ${c.red}${st}${c.reset}`);
      if (body != null) {
        const fmt =
          typeof body === 'object'
            ? JSON.stringify(body, null, 2)
            : String(body).slice(0, 1000);
        origLog(`     ${c.dim}├─${c.reset} Response body:`);
        fmt.split('\n').forEach(l => origLog(`     ${c.dim}│${c.reset}  ${l}`));
      }
    } else {
      detail = err.message;
      origLog(`     ${c.dim}├─${c.reset} ${c.red}${err.message}${c.reset}`);
      if (err.stack) {
        err.stack
          .split('\n')
          .slice(1, 4)
          .forEach(l =>
            origLog(`     ${c.dim}│${c.reset}  ${c.dim}${l.trim()}${c.reset}`),
          );
      }
    }
    origLog(`     ${c.dim}└─ (fim do erro)${c.reset}`);
    failures.push({ name, detail });
    failed++;
  }
}

// ─── assertStatus() ──────────────────────────────────────────────────────────
function assertStatus(actual, body, ...expected) {
  if (!expected.includes(actual)) {
    const b = typeof body === 'object' ? JSON.stringify(body) : String(body);
    const err = new Error(
      `status ${actual} (esperado ${expected.join('/')}). Body: ${b}`,
    );
    err.response = { status: actual, data: body };
    throw err;
  }
}

// ─── need() ──────────────────────────────────────────────────────────────────
function need(value, name) {
  if (!value) throw new Error(`${name} não disponível — passo anterior falhou`);
  return value;
}

// ─── section() ───────────────────────────────────────────────────────────────
function section(label) {
  console.log(`\n  ${c.cyan}>>${c.reset} ${c.bold}${label}${c.reset}`);
}

// ─── randomCpf() ─────────────────────────────────────────────────────────────
function randomCpf() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const s1 = n.reduce((sum, v, i) => sum + v * (10 - i), 0);
  const r1 = s1 % 11;
  n.push(r1 < 2 ? 0 : 11 - r1);
  const s2 = n.reduce((sum, v, i) => sum + v * (11 - i), 0);
  const r2 = s2 % 11;
  n.push(r2 < 2 ? 0 : 11 - r2);
  return n.join('');
}

// ─── getStats() ──────────────────────────────────────────────────────────────
function getStats() {
  return { passed, failed, failures };
}

module.exports = { test, assertStatus, need, randomCpf, getStats, section };
