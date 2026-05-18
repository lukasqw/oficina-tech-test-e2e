'use strict';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    let detail;
    if (err.response) {
      const status = err.response.status;
      const body   = err.response.data;
      detail = `HTTP ${status} — ${JSON.stringify(body)}`;
      console.log(`     ├─ HTTP ${status}`);
      if (body !== undefined && body !== null) {
        const formatted = typeof body === 'object'
          ? JSON.stringify(body, null, 2)
          : String(body).slice(0, 1000);
        const lines = formatted.split('\n');
        console.log(`     ├─ Response body:`);
        lines.forEach(l => console.log(`     │  ${l}`));
      }
    } else {
      detail = err.message;
      console.log(`     ├─ ${err.message}`);
      if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1, 4);
        stackLines.forEach(l => console.log(`     │  ${l.trim()}`));
      }
    }
    console.log(`     └─ (fim do erro)`);
    failures.push({ name, detail });
    failed++;
  }
}

function assertStatus(actual, body, ...expected) {
  if (!expected.includes(actual)) {
    const b = typeof body === 'object' ? JSON.stringify(body) : String(body);
    const err = new Error(`status ${actual} (esperado ${expected.join('/')}). Body: ${b}`);
    err.response = { status: actual, data: body };
    throw err;
  }
}

function need(value, name) {
  if (!value) throw new Error(`${name} não disponível — passo anterior falhou`);
  return value;
}

function getStats() {
  return { passed, failed, failures };
}

// Generates a random CPF that passes mod-11 check digit validation
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

function section(label) {
  console.log(`\n  ─── ${label}`);
}

module.exports = { test, assertStatus, need, randomCpf, getStats, section };
