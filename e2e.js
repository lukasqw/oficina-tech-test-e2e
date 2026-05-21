#!/usr/bin/env node
/**
 * Oficina Tech — E2E Test Suite
 *
 * Usage:
 *   node e2e.js <baseUrl> <cpf> <password>
 *
 * Or via env vars:
 *   BASE_URL=... LOGIN_CPF=... LOGIN_PASSWORD=... node e2e.js
 */

'use strict';

// Force UTF-8 on Windows so emoji and box-drawing chars render correctly
if (process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001', { stdio: 'pipe' }); } catch (_) {}
}

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

// ─── Load .env ────────────────────────────────────────────────────────────────
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) {
      process.env[k.trim()] = v.join('=').trim();
    }
  });
}

const BASE_URL   = (process.env.BASE_URL      || process.argv[2] || '').replace(/\/$/, '');
const LOGIN_CPF  =  process.env.LOGIN_CPF     || process.argv[3];
const LOGIN_PASS =  process.env.LOGIN_PASSWORD || process.argv[4];

if (!BASE_URL || !LOGIN_CPF || !LOGIN_PASS) {
  console.error('\nUso: node e2e.js <baseUrl> <cpf> <senha>');
  console.error('     BASE_URL=... LOGIN_CPF=... LOGIN_PASSWORD=... node e2e.js\n');
  process.exit(1);
}

// Never throw on non-2xx — status codes are asserted manually
axios.defaults.validateStatus = () => true;

// ─── Colors ───────────────────────────────────────────────────────────────────
const isTTY = Boolean(process.stdout.isTTY);
const c = isTTY ? {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
} : Object.fromEntries(
  ['reset','bold','dim','red','green','yellow','cyan'].map(k => [k, '']),
);

// ─── Suites ───────────────────────────────────────────────────────────────────
const healthChecks        = require('./suites/health');
const authentication      = require('./suites/auth');
const users               = require('./suites/users');
const customers           = require('./suites/customers');
const vehicles            = require('./suites/vehicles');
const productsAndInventory= require('./suites/products-inventory');
const services            = require('./suites/services');
const serviceOrders       = require('./suites/service-orders');
const payments            = require('./suites/payments');
const cleanup             = require('./suites/cleanup');
const { getStats, suiteStart, suiteEnd } = require('./suites/runner');

// ─── Shared state across suites ──────────────────────────────────────────────
const ctx = {};

// ─── runSuite() ───────────────────────────────────────────────────────────────
async function runSuite(label, fn, ...args) {
  suiteStart(label);
  await fn(...args);
  suiteEnd();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();

  // Header
  const title = ' Oficina Tech — API E2E Test Suite ';
  const W     = title.length + 2;
  const bar   = '═'.repeat(W);
  console.log(`\n${c.cyan}╔${bar}╗${c.reset}`);
  console.log(`${c.cyan}║${c.reset}${c.bold} ${title} ${c.reset}${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}╚${bar}╝${c.reset}`);
  console.log(`\n  ${c.dim}URL  ${c.reset} ${BASE_URL}`);
  console.log(`  ${c.dim}Login${c.reset} CPF ${LOGIN_CPF}`);

  // Suites
  await runSuite('Health Checks',          healthChecks,         BASE_URL);
  await runSuite('Autenticação',           authentication,       BASE_URL, ctx, LOGIN_CPF, LOGIN_PASS);

  if (!ctx.token) {
    console.log(`\n${c.yellow}⚠️  Login falhou — abortando testes autenticados.${c.reset}\n`);
    process.exit(1);
  }

  await runSuite('Usuários',              users,               BASE_URL, ctx);
  await runSuite('Clientes',             customers,           BASE_URL, ctx);
  await runSuite('Veículos',             vehicles,            BASE_URL, ctx);
  await runSuite('Produtos & Inventário', productsAndInventory, BASE_URL, ctx);
  await runSuite('Serviços',             services,            BASE_URL, ctx);
  await runSuite('Ordens de Serviço',    serviceOrders,       BASE_URL, ctx);
  await runSuite('Pagamentos',           payments,            BASE_URL, ctx);
  await runSuite('Cleanup',              cleanup,             BASE_URL, ctx);

  // Summary
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const { passed, failed, failures } = getStats();
  const total = passed + failed;

  console.log(`\n${c.cyan}${'═'.repeat(W + 2)}${c.reset}`);
  console.log(
    `\n  ${c.green}✓ ${passed} passed${c.reset}` +
    `   ${failed > 0 ? c.red : c.dim}✗ ${failed} failed${c.reset}` +
    `   ${c.dim}⏱  ${elapsed}s${c.reset}` +
    `   ${c.dim}${total} total${c.reset}\n`,
  );

  if (failures.length > 0) {
    console.log(`${c.red}${c.bold}  Falhas:${c.reset}\n`);
    failures.forEach((f, i) => {
      console.log(`  ${c.red}${i + 1}.${c.reset} ${c.bold}${f.name}${c.reset}`);
      console.log(`     ${c.dim}${f.detail.slice(0, 200)}${c.reset}\n`);
    });
    process.exit(1);
  }

  console.log(`  ${c.green}${c.bold}✓ Todos os testes passaram!${c.reset}\n`);
}

main().catch(err => {
  console.error(`\n${c.red}💥 Erro fatal: ${err.message}${c.reset}`);
  process.exit(1);
});
