"use strict";

/**
 * Suite E2E — Pagamento Mercado Pago (Orders API)
 *
 * Seções 1–4 sempre rodam (sem pagamento).
 * Seções 5+ pausam e pedem pagamento manual no sandbox MP quando
 * MP_WEBHOOK_SECRET está definido no .env.
 *
 * Cartões de teste (exp 11/30, qualquer nome salvo os de status abaixo):
 *   Mastercard  5031 4332 1540 6351  CVV 123
 *   Visa        4235 6477 2802 5682  CVV 123
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

const axios = require("axios");
const crypto = require("crypto");
const readline = require("readline");
const { test, assertStatus, need, section } = require("./runner");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signWebhook(secret, paymentID) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const reqId = crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const manifest = `id:${paymentID};request-id:${reqId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return { signature: `ts=${ts},v1=${v1}`, requestId: reqId };
}

async function pollStatus(BASE_URL, orderId, headers, expected, maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  let last = null;
  let attempts = 0;

  // Allow pressing 'q' to abort the poll early
  let cancelReject = null;
  const cancelPromise = new Promise((_, reject) => { cancelReject = reject; });

  const isTTY = Boolean(process.stdin.isTTY);
  const onData = (buf) => {
    const key = buf[0];
    if (key === 113 /* q */ || key === 81 /* Q */ || key === 3 /* Ctrl+C */) {
      cancelReject(new Error('cancelado pelo usuário (q)'));
      if (key === 3) process.exit(130);
    }
  };

  if (isTTY) {
    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
      process.stdout.write(`     \x1b[2m[q] cancelar polling\x1b[0m\n`);
    } catch (_) {}
  }

  const cleanup = () => {
    if (isTTY) {
      try {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch (_) {}
    }
  };

  try {
    while (Date.now() < deadline) {
      const { status, data } = await axios.get(
        `${BASE_URL}/service-orders/${orderId}`,
        { headers },
      );
      last = data?.data?.status ?? data?.status;
      attempts++;
      if (attempts <= 2 || attempts % 5 === 0)
        console.log(
          `     [poll] OS ${orderId} → status=${last} (HTTP ${status})`,
        );
      if (last === expected) return;
      await Promise.race([
        new Promise((r) => setTimeout(r, 1000)),
        cancelPromise,
      ]);
    }
    throw new Error(
      `Timeout aguardando ${expected} (último status: ${last}) na OS ${orderId}`,
    );
  } finally {
    cleanup();
  }
}

async function pollMpOrderId(BASE_URL, orderId, headers, maxMs = 15000) {
  const deadline = Date.now() + maxMs;
  let lastStatus = null;
  let lastBody = null;
  while (Date.now() < deadline) {
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/${orderId}/payment`,
      { headers },
    );
    lastStatus = status;
    lastBody = data;
    if (status === 200) {
      const body = data?.data ?? data;
      if (body?.mp_order_id)
        return { mpOrderId: body.mp_order_id, paymentUrl: body.payment_url };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(
    `     [pollMpOrderId] último HTTP ${lastStatus} body: ${JSON.stringify(lastBody)}`,
  );
  throw new Error(`mp_order_id nunca populado na OS ${orderId}`);
}

async function waitForEnter(prompt) {
  const tty = Boolean(process.stdout.isTTY);
  const yl  = tty ? '\x1b[33m' : '';
  const rs  = tty ? '\x1b[0m'  : '';
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(`  ${yl}▶  ${prompt}${rs} `, () => { rl.close(); resolve(); }),
  );
}

function printPaymentInstructions(paymentUrl, cardName, cardNumber, cvv, holderName, cpf) {
  const tty = Boolean(process.stdout.isTTY);
  const cy = tty ? '\x1b[36m' : '';
  const bo = tty ? '\x1b[1m'  : '';
  const di = tty ? '\x1b[2m'  : '';
  const yl = tty ? '\x1b[33m' : '';
  const rs = tty ? '\x1b[0m'  : '';

  const W   = 62;
  const bar = '─'.repeat(W);
  const ln  = (text = '') => console.log(`${cy}  │${rs} ${text}`);

  console.log(`\n${cy}  ┌${bar}┐${rs}`);
  ln(`${yl}${bo}⚠  AÇÃO NECESSÁRIA — Pague no sandbox do Mercado Pago${rs}`);
  ln();
  ln(`${di}URL:${rs} ${paymentUrl}`);
  ln();
  ln(`Cartão   ${bo}${cardName}${rs}`);
  ln(`Número   ${bo}${cardNumber}${rs}`);
  ln(`CVV      ${bo}${cvv}${rs}`);
  ln(`Validade ${bo}11/30${rs}`);
  ln(`Titular  ${bo}${holderName}${rs}  ${di}← define o resultado${rs}`);
  if (cpf) ln(`CPF      ${bo}${cpf}${rs}`);
  ln();
  ln(`${di}Buyer: TESTUSER8247756854211801431  /  ZF9BfBakNr${rs}`);
  console.log(`${cy}  └${bar}┘${rs}\n`);
}

// ─── Suite principal ──────────────────────────────────────────────────────────

module.exports = async function payments(BASE_URL, ctx) {

  const h = () => (ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {});
  const webhookSecret = process.env.MP_WEBHOOK_SECRET;

  // Re-login do customer (token não propagado pelo suite anterior)
  let customerToken = null;
  if (ctx.customerDocument) {
    try {
      const { data } = await axios.post(`${BASE_URL}/customers/auth/login`, {
        cpf: ctx.customerDocument,
        password: ctx.customerPassword || "senha123",
      });
      customerToken = data?.data?.token ?? data?.token;
    } catch (_) {}
  }
  const ch = () =>
    customerToken ? { Authorization: `Bearer ${customerToken}` } : h();

  function buildItems() {
    const items = [];
    if (ctx.serviceId)
      items.push({
        item_type: "SERVICE",
        reference_id: ctx.serviceId,
        quantity: 1,
      });
    if (ctx.productId)
      items.push({
        item_type: "PRODUCT",
        reference_id: ctx.productId,
        quantity: 1,
      });
    return items;
  }

  async function createOS(description) {
    need(ctx.customerId, "customerId");
    need(ctx.vehicleId, "vehicleId");
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders`,
      {
        customer_id: ctx.customerId,
        vehicle_id: ctx.vehicleId,
        description,
        items: buildItems(),
      },
      { headers: h() },
    );
    assertStatus(status, data, 200, 201);
    const oid = data?.data?.id ?? data?.id;
    if (!oid) throw new Error("ID não retornado na criação da OS");
    return oid;
  }

  async function advanceStep(orderId, label) {
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderId}/advance`,
      {},
      { headers: h() },
    );
    const tty = Boolean(process.stdout.isTTY);
    const di  = tty ? '\x1b[2m' : '';
    const rs  = tty ? '\x1b[0m' : '';
    const rd  = tty ? '\x1b[31m': '';
    const detail = status >= 400 ? ` ${rd}${JSON.stringify(data)}${rs}` : '';
    console.log(`${di}advance${rs} ${label} → ${status}${detail}`);
    return { status, data };
  }

  // Retries a step that may return 5xx while a background saga is still settling
  async function advanceStepRetrying(orderId, label, maxRetries = 10, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await advanceStep(orderId, label);
      if (result.status < 500) return result;
      if (attempt < maxRetries) {
        console.log(`     [retry] ${label} aguardando saga (tentativa ${attempt})...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new Error(`${label} falhou após ${maxRetries} tentativas`);
  }

  async function advanceToAwaitingPayment(orderId) {
    await advanceStep(orderId, "OPEN→DIAGNOSIS");
    await advanceStep(orderId, "DIAGNOSIS→BUDGET");
    await pollStatus(BASE_URL, orderId, h(), "PENDING_AUTHORIZATION", 20000);
    const authRes = await axios.post(
      `${BASE_URL}/service-orders/${orderId}/authorize`,
      { approved: true },
      { headers: ch() },
    );
    console.log(
      `     [authorize] HTTP ${authRes.status}${authRes.status >= 400 ? " body: " + JSON.stringify(authRes.data) : ""}`,
    );
    await advanceStep(orderId, "BUDGET→SERVICE_IN_PROGRESS");
    await advanceStep(orderId, "SERVICE_IN_PROGRESS→SERVICE_COMPLETED");
    await advanceStepRetrying(orderId, "SERVICE_COMPLETED→AWAITING_PAYMENT");
    const result = await pollMpOrderId(BASE_URL, orderId, h());
    const tty2 = Boolean(process.stdout.isTTY);
    const di2  = tty2 ? '\x1b[2m' : '';
    const rs2  = tty2 ? '\x1b[0m' : '';
    console.log(`${di2}mp_order_id${rs2} ${result.mpOrderId}`);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Payment URL (ctx.orderId já em AWAITING_PAYMENT após service-orders)
  // ─────────────────────────────────────────────────────────────────────────

  section("Payment URL — OS em AWAITING_PAYMENT");

  let mpOrderId = null;
  let paymentUrl = null;

  await test("GET /service-orders/{id}/payment — retorna mp_order_id e payment_url", async () => {
    need(ctx.orderId, "orderId");
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/${ctx.orderId}/payment`,
      { headers: h() },
    );
    assertStatus(status, data, 200);
    const body = data?.data ?? data;
    mpOrderId = body?.mp_order_id;
    paymentUrl = body?.payment_url;
    if (!mpOrderId) throw new Error("mp_order_id ausente na resposta");
    if (!paymentUrl) throw new Error("payment_url ausente na resposta");
  });

  await test("payment_url aponta para domínio do Mercado Pago", async () => {
    need(paymentUrl, "paymentUrl");
    if (
      !paymentUrl.includes("mercadopago") &&
      !paymentUrl.includes("mercadolibre")
    )
      throw new Error(`payment_url não aponta para MP: ${paymentUrl}`);
  });

  await test("GET /service-orders/{id}/payment — 401 sem token", async () => {
    need(ctx.orderId, "orderId");
    const { status } = await axios.get(
      `${BASE_URL}/service-orders/${ctx.orderId}/payment`,
    );
    if (status !== 401 && status !== 403)
      throw new Error(`esperado 401/403, obtido ${status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Páginas de resultado (públicas — sem JWT)
  // ─────────────────────────────────────────────────────────────────────────

  section("GET /payments/result — redirect pós-pagamento");

  for (const s of ["success", "pending", "failure"]) {
    await test(`GET /payments/result?status=${s} — 200 HTML`, async () => {
      const { status, data } = await axios.get(
        `${BASE_URL}/payments/result?status=${s}&order=${ctx.orderId ?? "test"}`,
      );
      assertStatus(status, data, 200);
      if (
        typeof data === "string" &&
        data.length > 0 &&
        !data.trim().startsWith("<")
      )
        throw new Error("Resposta não parece ser HTML");
    });
  }

  await test("GET /payments/result?status=invalido — retorna 4xx", async () => {
    const { status } = await axios.get(
      `${BASE_URL}/payments/result?status=invalido`,
    );
    if (status < 400) throw new Error(`esperado 4xx, obtido ${status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. retry-payment — validação de estado
  // ─────────────────────────────────────────────────────────────────────────

  section("POST /service-orders/{id}/retry-payment — validação de estado");

  await test("retry-payment em AWAITING_PAYMENT retorna 4xx (requer PAYMENT_REJECTED)", async () => {
    need(ctx.orderId, "orderId");
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/retry-payment`,
      {},
      { headers: h() },
    );
    if (status !== 400 && status !== 409 && status !== 422)
      throw new Error(
        `esperado 400/409/422, obtido ${status}. Body: ${JSON.stringify(data)}`,
      );
  });

  await test("retry-payment sem token — retorna 401", async () => {
    need(ctx.orderId, "orderId");
    const { status } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/retry-payment`,
      {},
    );
    if (status !== 401 && status !== 403)
      throw new Error(`esperado 401/403, obtido ${status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5+ Fluxos interativos (requer MP_WEBHOOK_SECRET)
  // ─────────────────────────────────────────────────────────────────────────

  if (!webhookSecret) {
    console.log(
      "\n  ⚠️  MP_WEBHOOK_SECRET ausente — fluxos interativos (5-7) pulados",
    );
    console.log(
      "     Adicione MP_WEBHOOK_SECRET=<chave> ao tests/.env para habilitá-los\n",
    );
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Aprovado → PAID
  // Usa ctx.orderId que já está em AWAITING_PAYMENT
  // ─────────────────────────────────────────────────────────────────────────

  section("Fluxo 1 — Pagamento aprovado → PAID");

  printPaymentInstructions(
    paymentUrl,
    "Mastercard",
    "5031 4332 1540 6351",
    "123",
    "APRO",
    "12345678909",
  );

  await waitForEnter(
    "  Pressione Enter APÓS concluir o pagamento no browser...",
  );

  // O webhook real chega do MP automaticamente após o pagamento; apenas aguardamos.

  await test("GET /service-orders/{id} — status PAID (aguarda até 60s)", async () => {
    need(ctx.orderId, "orderId");
    await pollStatus(BASE_URL, ctx.orderId, h(), "PAID", 60000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Rejeitado → retry-payment
  // ─────────────────────────────────────────────────────────────────────────

  section("Fluxo 2 — Pagamento rejeitado → retry-payment → AWAITING_PAYMENT");

  let orderIdRetry = null;
  let mpDataRetry = null;

  await test("POST /service-orders — criar OS para retry", async () => {
    orderIdRetry = await createOS("OS — teste retry após rejeição MP");
  });

  await test("avança OS até AWAITING_PAYMENT (retry flow)", async () => {
    need(orderIdRetry, "orderIdRetry");
    mpDataRetry = await advanceToAwaitingPayment(orderIdRetry);
  });

  if (mpDataRetry?.paymentUrl) {
    printPaymentInstructions(
      mpDataRetry.paymentUrl,
      "Mastercard",
      "5031 4332 1540 6351",
      "123",
      "FUND  ← use este nome para forçar rejeição por saldo insuficiente",
      "12345678909",
    );
    await waitForEnter(
      "  Pressione Enter APÓS tentar o pagamento (ele deve ser recusado)...",
    );
  }

  // O webhook de rejeição chega do MP automaticamente; apenas aguardamos.

  await test("GET /service-orders/{id} — status PAYMENT_REJECTED (aguarda até 60s)", async () => {
    need(orderIdRetry, "orderIdRetry");
    await pollStatus(BASE_URL, orderIdRetry, h(), "PAYMENT_REJECTED", 60000);
  });

  await test("POST /service-orders/{id}/retry-payment — volta para AWAITING_PAYMENT", async () => {
    need(orderIdRetry, "orderIdRetry");
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdRetry}/retry-payment`,
      {},
      { headers: h() },
    );
    assertStatus(status, data, 200, 202);
  });

  await test("GET /service-orders/{id} — status AWAITING_PAYMENT após retry", async () => {
    need(orderIdRetry, "orderIdRetry");
    await pollStatus(BASE_URL, orderIdRetry, h(), "AWAITING_PAYMENT", 30000);
  });

  await test("GET /service-orders/{id}/payment — novo mp_order_id gerado após retry", async () => {
    need(orderIdRetry, "orderIdRetry");
    const { mpOrderId: newId } = await pollMpOrderId(
      BASE_URL,
      orderIdRetry,
      h(),
    );
    if (newId === mpDataRetry.mpOrderId)
      throw new Error(`mp_order_id não mudou após retry: ${newId}`);
  });

  await test("DELETE /service-orders/{id} — cancela OS de retry (cleanup)", async () => {
    need(orderIdRetry, "orderIdRetry");
    const { status, data } = await axios.delete(
      `${BASE_URL}/service-orders/${orderIdRetry}`,
      { headers: h() },
    );
    assertStatus(status, data, 200, 202);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Estorno externo → CANCELED (webhook "refunded" do MP)
  // DESABILITADO: requer ação manual no painel do vendedor MP
  // ─────────────────────────────────────────────────────────────────────────

  /*
  section("Fluxo 3 — Estorno externo pelo painel MP → CANCELED");

  let orderIdRefund = null;
  let mpDataRefund = null;

  await test("POST /service-orders — criar OS para teste de estorno", async () => {
    orderIdRefund = await createOS("OS — teste cancelamento por estorno MP");
  });

  await test("avança OS até AWAITING_PAYMENT (refund flow)", async () => {
    need(orderIdRefund, "orderIdRefund");
    mpDataRefund = await advanceToAwaitingPayment(orderIdRefund);
  });

  if (mpDataRefund?.paymentUrl) {
    printPaymentInstructions(
      mpDataRefund.paymentUrl,
      "Mastercard",
      "5031 4332 1540 6351",
      "123",
      "APRO  ← aprovado para chegarmos ao status PAID",
      "12345678909",
    );
    await waitForEnter(
      "  Pressione Enter APÓS concluir o pagamento (deve ser aprovado)...",
    );
  }

  await test("GET /service-orders/{id} — status PAID após pagamento aprovado (aguarda até 60s)", async () => {
    need(orderIdRefund, "orderIdRefund");
    await pollStatus(BASE_URL, orderIdRefund, h(), "PAID", 60000);
  });

  const LINE = "─".repeat(60);
  console.log(`\n  ${LINE}`);
  console.log(`  🔄  AÇÃO NECESSÁRIA — Faça o estorno pelo painel do vendedor`);
  console.log(`  ${LINE}`);
  console.log(`  1. Acesse o painel do Mercado Pago com a conta do vendedor de teste`);
  console.log(`  2. Localize o pagamento aprovado referente à OS ${orderIdRefund}`);
  console.log(`  3. Clique em "Devolver dinheiro" / "Estornar" para realizar o reembolso total`);
  console.log(`  4. O webhook "refunded" chegará automaticamente e transitará a OS para CANCELED`);
  console.log(`  ${LINE}\n`);

  await waitForEnter(
    "  Pressione Enter APÓS concluir o estorno no painel do vendedor...",
  );

  await test("GET /service-orders/{id} — status CANCELED após estorno (aguarda webhook até 60s)", async () => {
    need(orderIdRefund, "orderIdRefund");
    await pollStatus(BASE_URL, orderIdRefund, h(), "CANCELED", 60000);
  });
  */
};
