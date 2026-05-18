#!/usr/bin/env node
/**
 * Oficina Tech — E2E Test Suite
 *
 * Usage:
 *   node e2e.js <baseUrl> <cpf> <password> [user|customer]
 *
 * Or via env vars:
 *   BASE_URL=... LOGIN_CPF=... LOGIN_PASSWORD=... LOGIN_TYPE=user node e2e.js
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

// Load .env if present
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) {
      process.env[k.trim()] = v.join('=').trim();
    }
  });
}

const BASE_URL   = (process.env.BASE_URL   || process.argv[2] || '').replace(/\/$/, '');
const LOGIN_CPF  = process.env.LOGIN_CPF   || process.argv[3];
const LOGIN_PASS = process.env.LOGIN_PASSWORD || process.argv[4];

if (!BASE_URL || !LOGIN_CPF || !LOGIN_PASS) {
  console.error('\nUso: node e2e.js <baseUrl> <cpf> <senha>');
  console.error('     BASE_URL=... LOGIN_CPF=... LOGIN_PASSWORD=... node e2e.js\n');
  process.exit(1);
}

// Never throw on non-2xx — we assert status codes manually
axios.defaults.validateStatus = () => true;

// Shared state across suites
const ctx = {};

const healthChecks    = require('./suites/health');
const authentication  = require('./suites/auth');
const users           = require('./suites/users');
const customers       = require('./suites/customers');
const vehicles        = require('./suites/vehicles');
const productsAndInventory = require('./suites/products-inventory');
const services        = require('./suites/services');
const serviceOrders   = require('./suites/service-orders');
const payments        = require('./suites/payments');
const cleanup         = require('./suites/cleanup');
const { getStats }    = require('./suites/runner');

async function main() {
  const start = Date.now();

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║    Oficina Tech — API E2E Test Suite         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  Base URL : ${BASE_URL}`);
  console.log(`  Login    : CPF ${LOGIN_CPF} (usuário interno)`);

  await healthChecks(BASE_URL);
  await authentication(BASE_URL, ctx, LOGIN_CPF, LOGIN_PASS);

  if (!ctx.token) {
    console.log('\n⚠️  Login falhou — abortando testes autenticados.\n');
    process.exit(1);
  }

  await users(BASE_URL, ctx);
  await customers(BASE_URL, ctx);
  await vehicles(BASE_URL, ctx);
  await productsAndInventory(BASE_URL, ctx);
  await services(BASE_URL, ctx);
  await serviceOrders(BASE_URL, ctx);
  await payments(BASE_URL, ctx);
  await cleanup(BASE_URL, ctx);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const { passed, failed, failures } = getStats();
  const total = passed + failed;

  console.log(`\n${'═'.repeat(48)}`);
  console.log(`  ${passed}/${total} passaram  |  ${failed} falharam  |  ${elapsed}s`);

  if (failures.length > 0) {
    console.log('\n  Falhas:');
    failures.forEach(f => {
      console.log(`    ❌ ${f.name}`);
      console.log(`       ${f.detail}`);
    });
    console.log('');
    process.exit(1);
  }

  console.log('\n  ✅ Todos os testes passaram!\n');
}

main().catch(err => {
  console.error('\n💥 Erro fatal:', err.message);
  process.exit(1);
});
