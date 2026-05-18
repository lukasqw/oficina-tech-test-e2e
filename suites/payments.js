'use strict';

/**
 * Suite E2E — Pagamento Mercado Pago (Orders API)
 *
 * Seções 1–4 sempre rodam (sem pagamento).
 * Seções 5+ pausam e pedem pagamento manual no sandbox MP quando
 * MP_WEBHOOK_SECRET está definido no .env.
 *
 * Cartões de teste (exp 11/30, qualquer nome salvo os de status abaixo):
 *   Mastercard  5031 4332 1540 6351  CVV 123
 *   Visa        4235 4777 2802 5682  CVV 123
 *   Amex        3753 651535 56885    CVV 1234
 *   Elo Débito  5067 7667 8388 8311  CVV 123
 *
 * Nome do titular define o resultado:
 *   APRO → Aprovado         (CPF 12345678909)
 *   FUND → Saldo insuficiente (CPF 12345678909)
 *   OTHE → Recusado geral   (CPF 12345678909)
 *   SECU → CVV inválido
 *   EXPI → Data expirada
 *   CONT → Pendente
 *
 * Buyer de teste do sandbox:
 *   usuário  TESTUSER8247756854211801431
 *   senha    ZF9BfBakNr
 */

const axios    = require('axios');
const crypto   = require('crypto');
const readline = require('readline');
const { test, assertStatus, need, section } = require('./runner');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signWebhook(secret, paymentID) {
  const ts    = Math.floor(Date.now() / 1000).toString();
  const reqId = crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const manifest = `id:${paymentID};request-id:${reqId};ts:${ts};`;
  const v1    = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return { signature: `ts=${ts},v1=${v1}`, requestId: reqId };
}

async function pollStatus(BASE_URL, orderId, headers, expected, maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  let last = null;
  let attempts = 0;
  while (Date.now() < deadline) {
    const { status, data } = await axios.get(`${BASE_URL}/service-orders/${orderId}`, { headers });
    last = data?.data?.status ?? data?.status;
    attempts++;
    if (attempts <= 2 || attempts % 5 === 0)
      console.log(`     [poll] OS ${orderId} → status=${last} (HTTP ${status})`);
    if (last === expected) return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Timeout aguardando ${expected} (último status: ${last}) na OS ${orderId}`);
}

async function pollMpOrderId(BASE_URL, orderId, headers, maxMs = 15000) {
  const deadline = Date.now() + maxMs;
  let lastStatus = null;
  let lastBody   = null;
  while (Date.now() < deadline) {
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/${orderId}/payment`, { headers });
    lastStatus = status;
    lastBody   = data;
    if (status === 200) {
      const body = data?.data ?? data;
      if (body?.mp_order_id) return { mpOrderId: body.mp_order_id, paymentUrl: body.payment_url };
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`     [pollMpOrderId] último HTTP ${lastStatus} body: ${JSON.stringify(lastBody)}`);
  throw new Error(`mp_order_id nunca populado na OS ${orderId}`);
}

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

function printPaymentInstructions(paymentUrl, cardName, cardNumber, cvv, holderName, cpf) {
  const LINE = '─'.repeat(60);
  console.log(`\n  ${LINE}`);
  console.log(`  💳  AÇÃO NECESSÁRIA — Pague no sandbox do Mercado Pago`);
  console.log(`  ${LINE}`);
  console.log(`  URL de pagamento:`);
  console.log(`  ${paymentUrl}`);
  console.log(`\n  Cartão : ${cardName}`);
  console.log(`  Número : ${cardNumber}`);
  console.log(`  CVV    : ${cvv}`);
  console.log(`  Validade: 11/30`);
  console.log(`  Titular: ${holderName}  (define o resultado)`);
  if (cpf) console.log(`  CPF    : ${cpf}`);
  console.log(`\n  Buyer de teste: TESTUSER8247756854211801431 / ZF9BfBakNr`);
  console.log(`  ${LINE}\n`);
}

// ─── Suite principal ──────────────────────────────────────────────────────────

module.exports = async function payments(BASE_URL, ctx) {
  console.log('\n💳 Pagamento Mercado Pago');

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};
  const webhookSecret = process.env.MP_WEBHOOK_SECRET;

  // Re-login do customer (token não propagado pelo suite anterior)
  let customerToken = null;
  if (ctx.customerDocument) {
    try {
      const { data } = await axios.post(`${BASE_URL}/customers/auth/login`, {
        cpf:      ctx.customerDocument,
        password: ctx.customerPassword || 'senha123',
      });
      customerToken = data?.data?.token ?? data?.token;
    } catch (_) {}
  }
  const ch = () => customerToken ? { Authorization: `Bearer ${customerToken}` } : h();

  function buildItems() {
    const items = [];
    if (ctx.serviceId) items.push({ item_type: 'SERVICE', reference_id: ctx.serviceId, quantity: 1 });
    if (ctx.productId)  items.push({ item_type: 'PRODUCT',  reference_id: ctx.productId,  quantity: 1 });
    return items;
  }

  async function createOS(description) {
    need(ctx.customerId, 'customerId'); need(ctx.vehicleId, 'vehicleId');
    const { status, data } = await axios.post(`${BASE_URL}/service-orders`, {
      customer_id: ctx.customerId, vehicle_id: ctx.vehicleId,
      description, items: buildItems(),
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    const oid = data?.data?.id ?? data?.id;
    if (!oid) throw new Error('ID não retornado na criação da OS');
    return oid;
  }

  async function advanceStep(orderId, label) {
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderId}/advance`, {}, { headers: h() });
    console.log(`     [advance] ${label} → HTTP ${status}${status >= 400 ? ' body: ' + JSON.stringify(data) : ''}`);
    return { status, data };
  }

  async function advanceToAwaitingPayment(orderId) {
    await advanceStep(orderId, 'OPEN→DIAGNOSIS');
    await advanceStep(orderId, 'DIAGNOSIS→BUDGET');
    await pollStatus(BASE_URL, orderId, h(), 'PENDING_AUTHORIZATION', 20000);
    const authRes = await axios.post(`${BASE_URL}/service-orders/${orderId}/authorize`,
      { approved: true }, { headers: ch() });
    console.log(`     [authorize] HTTP ${authRes.status}${authRes.status >= 400 ? ' body: ' + JSON.stringify(authRes.data) : ''}`);
    await advanceStep(orderId, 'BUDGET→SERVICE_IN_PROGRESS');
    await advanceStep(orderId, 'SERVICE_IN_PROGRESS→SERVICE_COMPLETED');
    await advanceStep(orderId, 'SERVICE_COMPLETED→AWAITING_PAYMENT');
    const result = await pollMpOrderId(BASE_URL, orderId, h());
    console.log(`     [mp_order] mpOrderId=${result.mpOrderId} paymentUrl=${result.paymentUrl}`);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Payment URL (ctx.orderId já em AWAITING_PAYMENT após service-orders)
  // ─────────────────────────────────────────────────────────────────────────

  section('Payment URL — OS em AWAITING_PAYMENT');

  let mpOrderId  = null;
  let paymentUrl = null;

  await test('GET /service-orders/{id}/payment — retorna mp_order_id e payment_url', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/${ctx.orderId}/payment`, { headers: h() });
    assertStatus(status, data, 200);
    const body = data?.data ?? data;
    mpOrderId  = body?.mp_order_id;
    paymentUrl = body?.payment_url;
    if (!mpOrderId)  throw new Error('mp_order_id ausente na resposta');
    if (!paymentUrl) throw new Error('payment_url ausente na resposta');
  });

  await test('payment_url aponta para domínio do Mercado Pago', async () => {
    need(paymentUrl, 'paymentUrl');
    if (!paymentUrl.includes('mercadopago') && !paymentUrl.includes('mercadolibre'))
      throw new Error(`payment_url não aponta para MP: ${paymentUrl}`);
  });

  await test('GET /service-orders/{id}/payment — 401 sem token', async () => {
    need(ctx.orderId, 'orderId');
    const { status } = await axios.get(`${BASE_URL}/service-orders/${ctx.orderId}/payment`);
    if (status !== 401 && status !== 403)
      throw new Error(`esperado 401/403, obtido ${status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Páginas de resultado (públicas — sem JWT)
  // ─────────────────────────────────────────────────────────────────────────

  section('GET /payments/result — redirect pós-pagamento');

  for (const s of ['success', 'pending', 'failure']) {
    await test(`GET /payments/result?status=${s} — 200 HTML`, async () => {
      const { status, data } = await axios.get(
        `${BASE_URL}/payments/result?status=${s}&order=${ctx.orderId ?? 'test'}`);
      assertStatus(status, data, 200);
      if (typeof data === 'string' && data.length > 0 && !data.trim().startsWith('<'))
        throw new Error('Resposta não parece ser HTML');
    });
  }

  await test('GET /payments/result?status=invalido — retorna 4xx', async () => {
    const { status } = await axios.get(`${BASE_URL}/payments/result?status=invalido`);
    if (status < 400) throw new Error(`esperado 4xx, obtido ${status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. retry-payment — validação de estado
  // ─────────────────────────────────────────────────────────────────────────

  section('POST /service-orders/{id}/retry-payment — validação de estado');

  await test('retry-payment em AWAITING_PAYMENT retorna 4xx (requer PAYMENT_REJECTED)', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/retry-payment`, {}, { headers: h() });
    if (status !== 400 && status !== 409 && status !== 422)
      throw new Error(`esperado 400/409/422, obtido ${status}. Body: ${JSON.stringify(data)}`);
  });

  await test('retry-payment sem token — retorna 401', async () => {
    need(ctx.orderId, 'orderId');
    const { status } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/retry-payment`, {});
    if (status !== 401 && status !== 403)
      throw new Error(`esperado 401/403, obtido ${status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5+ Fluxos interativos (requer MP_WEBHOOK_SECRET)
  // ─────────────────────────────────────────────────────────────────────────

  if (!webhookSecret) {
    console.log('\n  ⚠️  MP_WEBHOOK_SECRET ausente — fluxos interativos (5-7) pulados');
    console.log('     Adicione MP_WEBHOOK_SECRET=<chave> ao tests/.env para habilitá-los\n');
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Aprovado → PAID
  // Usa ctx.orderId que já está em AWAITING_PAYMENT
  // ─────────────────────────────────────────────────────────────────────────

  section('Fluxo 1 — Pagamento aprovado → PAID');

  printPaymentInstructions(
    paymentUrl,
    'Mastercard', '5031 4332 1540 6351', '123',
    'APRO', '12345678909'
  );

  await waitForEnter('  Pressione Enter APÓS concluir o pagamento no browser...');

  // O webhook real chega do MP automaticamente após o pagamento; apenas aguardamos.

  await test('GET /service-orders/{id} — status PAID (aguarda até 60s)', async () => {
    need(ctx.orderId, 'orderId');
    await pollStatus(BASE_URL, ctx.orderId, h(), 'PAID', 60000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. OS em PAID → cancelamento com refund
  // ─────────────────────────────────────────────────────────────────────────

  section('Fluxo 2 — Cancelamento de OS em PAID → refund MP');

  let orderIdRefund   = null;
  let mpDataRefund    = null;

  await test('POST /service-orders — criar OS para refund', async () => {
    orderIdRefund = await createOS('OS — teste refund MP');
  });

  await test('avança OS até AWAITING_PAYMENT (refund flow)', async () => {
    need(orderIdRefund, 'orderIdRefund');
    mpDataRefund = await advanceToAwaitingPayment(orderIdRefund);
  });

  if (mpDataRefund?.paymentUrl) {
    printPaymentInstructions(
      mpDataRefund.paymentUrl,
      'Visa', '4235 4777 2802 5682', '123',
      'APRO', '12345678909'
    );
    await waitForEnter('  Pressione Enter APÓS concluir o pagamento no browser...');
  }

  // O webhook real chega do MP automaticamente; apenas aguardamos.

  await test('GET /service-orders/{id} — status PAID (refund flow)', async () => {
    need(orderIdRefund, 'orderIdRefund');
    await pollStatus(BASE_URL, orderIdRefund, h(), 'PAID', 60000);
  });

  await test('DELETE /service-orders/{id} — cancela OS em PAID (dispara refund MP)', async () => {
    need(orderIdRefund, 'orderIdRefund');
    const { status, data } = await axios.delete(
      `${BASE_URL}/service-orders/${orderIdRefund}`, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('GET /service-orders/{id} — status CANCELED após refund (aguarda até 60s)', async () => {
    need(orderIdRefund, 'orderIdRefund');
    await pollStatus(BASE_URL, orderIdRefund, h(), 'CANCELED', 60000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Rejeitado → retry-payment
  // ─────────────────────────────────────────────────────────────────────────

  section('Fluxo 3 — Pagamento rejeitado → retry-payment → AWAITING_PAYMENT');

  let orderIdRetry = null;
  let mpDataRetry  = null;

  await test('POST /service-orders — criar OS para retry', async () => {
    orderIdRetry = await createOS('OS — teste retry após rejeição MP');
  });

  await test('avança OS até AWAITING_PAYMENT (retry flow)', async () => {
    need(orderIdRetry, 'orderIdRetry');
    mpDataRetry = await advanceToAwaitingPayment(orderIdRetry);
  });

  if (mpDataRetry?.paymentUrl) {
    printPaymentInstructions(
      mpDataRetry.paymentUrl,
      'Mastercard', '5031 4332 1540 6351', '123',
      'FUND  ← use este nome para forçar rejeição por saldo insuficiente', '12345678909'
    );
    await waitForEnter('  Pressione Enter APÓS tentar o pagamento (ele deve ser recusado)...');
  }

  // O webhook de rejeição chega do MP automaticamente; apenas aguardamos.

  await test('GET /service-orders/{id} — status PAYMENT_REJECTED (aguarda até 60s)', async () => {
    need(orderIdRetry, 'orderIdRetry');
    await pollStatus(BASE_URL, orderIdRetry, h(), 'PAYMENT_REJECTED', 60000);
  });

  await test('POST /service-orders/{id}/retry-payment — volta para AWAITING_PAYMENT', async () => {
    need(orderIdRetry, 'orderIdRetry');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdRetry}/retry-payment`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('GET /service-orders/{id} — status AWAITING_PAYMENT após retry', async () => {
    need(orderIdRetry, 'orderIdRetry');
    await pollStatus(BASE_URL, orderIdRetry, h(), 'AWAITING_PAYMENT', 30000);
  });

  await test('GET /service-orders/{id}/payment — novo mp_order_id gerado após retry', async () => {
    need(orderIdRetry, 'orderIdRetry');
    const { mpOrderId: newId } = await pollMpOrderId(BASE_URL, orderIdRetry, h());
    if (newId === mpDataRetry.mpOrderId)
      throw new Error(`mp_order_id não mudou após retry: ${newId}`);
  });

  await test('DELETE /service-orders/{id} — cancela OS de retry (cleanup)', async () => {
    need(orderIdRetry, 'orderIdRetry');
    const { status, data } = await axios.delete(
      `${BASE_URL}/service-orders/${orderIdRetry}`, { headers: h() });
    assertStatus(status, data, 200, 202);
  });
};
