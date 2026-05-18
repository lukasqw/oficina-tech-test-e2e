'use strict';

const axios = require('axios');
const { test, assertStatus, need, section } = require('./runner');

function id(data) {
  return data?.data?.id ?? data?.id;
}

async function getInventory(BASE_URL, productId, headers) {
  const { data } = await axios.get(`${BASE_URL}/products/${productId}/inventory`, { headers });
  return data?.data ?? data;
}

module.exports = async function serviceOrders(BASE_URL, ctx) {
  console.log('\n📋 Service Orders');

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  function buildItems() {
    const items = [];
    if (ctx.serviceId) items.push({ item_type: 'SERVICE', reference_id: ctx.serviceId, quantity: 1 });
    if (ctx.productId) items.push({ item_type: 'PRODUCT', reference_id: ctx.productId, quantity: 1 });
    return items;
  }

  // Capture inventory baseline before any OS interactions
  let baseAvailable = 0;
  let baseReserved  = 0;
  if (ctx.productId) {
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    baseAvailable = inv.available_quantity;
    baseReserved  = inv.reserved_quantity;
  }

  section('Criação e leitura básica');

  await test('POST /service-orders — criar OS', async () => {
    need(ctx.customerId, 'customerId');
    need(ctx.vehicleId,  'vehicleId');
    const { status, data } = await axios.post(`${BASE_URL}/service-orders`, {
      customer_id: ctx.customerId,
      vehicle_id:  ctx.vehicleId,
      description: 'Revisão completa',
      items:       buildItems(),
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    ctx.orderId = id(data);
    if (!ctx.orderId) throw new Error('ID não encontrado na resposta');
  });

  await test('GET /service-orders', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/service-orders`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /service-orders?customer_id={id}', async () => {
    need(ctx.customerId, 'customerId');
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders?customer_id=${ctx.customerId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /service-orders?status=RECEIVED', async () => {
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders?status=RECEIVED`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /service-orders/{id}', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/${ctx.orderId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  section('Atualização e histórico');

  await test('PUT /service-orders/{id} — atualizar itens', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.put(`${BASE_URL}/service-orders/${ctx.orderId}`, {
      description: 'Revisão completa atualizada',
      items:       buildItems(),
    }, { headers: h() });
    assertStatus(status, data, 200, 204);
  });

  await test('GET /service-orders/{id}/history', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/${ctx.orderId}/history`, { headers: h() });
    assertStatus(status, data, 200);
  });

  section('Fluxo principal — RECEIVED → AWAITING_PAYMENT');

  await test('POST /service-orders/{id}/advance (RECEIVED → DIAGNOSING)', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('POST /service-orders/{id}/advance (DIAGNOSING → PENDING_AUTHORIZATION)', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  // Reserve(1): available_quantity -= 1, reserved_quantity += 1
  await test('GET /products/{id}/inventory — estoque reservado após PENDING_AUTHORIZATION', async () => {
    need(ctx.productId, 'productId');
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    if (inv.reserved_quantity  !== baseReserved  + 1) throw new Error(`reserved_quantity: esperado ${baseReserved + 1}, obtido ${inv.reserved_quantity}`);
    if (inv.available_quantity !== baseAvailable - 1) throw new Error(`available_quantity: esperado ${baseAvailable - 1}, obtido ${inv.available_quantity}`);
  });

  // ─── Fluxo de aprovação pelo cliente ──────────────────────────────
  let customerToken = null;

  await test('POST /customers/auth/login — cliente faz login', async () => {
    need(ctx.customerDocument, 'customerDocument');
    const { status, data } = await axios.post(`${BASE_URL}/customers/auth/login`, {
      cpf:      ctx.customerDocument,
      password: ctx.customerPassword || 'senha123',
    });
    assertStatus(status, data, 200);
    customerToken = data?.data?.token ?? data?.token;
    if (!customerToken) throw new Error('Token do cliente não encontrado na resposta');
  });

  await test('GET /service-orders — cliente vê apenas suas próprias OS (auto-filtro por JWT)', async () => {
    need(ctx.orderId, 'orderId');
    const ch = { Authorization: `Bearer ${customerToken}` };
    const { status, data } = await axios.get(`${BASE_URL}/service-orders`, { headers: ch });
    assertStatus(status, data, 200);
    const orders = data?.data ?? [];
    if (!Array.isArray(orders)) throw new Error('Resposta não é uma lista');
    const found = orders.some(o => o.id === ctx.orderId);
    if (!found) throw new Error(`OS ${ctx.orderId} não encontrada na lista do cliente`);
    const allOwn = orders.every(o => o.customer_id === ctx.customerId);
    if (!allOwn) throw new Error('Lista retornou ordens de outros clientes — auto-filtro falhou');
  });

  await test('POST /service-orders/{id}/authorize — cliente aprova OS em PENDING_AUTHORIZATION', async () => {
    need(ctx.orderId, 'orderId');
    const ch = { Authorization: `Bearer ${customerToken}` };
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/authorize`,
      { approved: true, notes: 'Aprovado pelo cliente' },
      { headers: ch });
    assertStatus(status, data, 200, 202);
  });

  await test('POST /service-orders/{id}/advance (AUTHORIZED → IN_PROGRESS)', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('POST /service-orders/{id}/advance (IN_PROGRESS → COMPLETED)', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  // ReservedDecrease(1): reserved_quantity -= 1 (consumido); available permanece -1 do baseline
  await test('GET /products/{id}/inventory — estoque deduzido após COMPLETED', async () => {
    need(ctx.productId, 'productId');
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    if (inv.reserved_quantity  !== baseReserved)      throw new Error(`reserved_quantity: esperado ${baseReserved}, obtido ${inv.reserved_quantity}`);
    if (inv.available_quantity !== baseAvailable - 1) throw new Error(`available_quantity: esperado ${baseAvailable - 1}, obtido ${inv.available_quantity}`);
  });

  await test('POST /service-orders/{id}/advance (COMPLETED → AWAITING_PAYMENT)', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderId}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('GET /service-orders/{id}/payment', async () => {
    need(ctx.orderId, 'orderId');
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/${ctx.orderId}/payment`, { headers: h() });
    assertStatus(status, data, 200);
  });

  section('Cancelamento com estoque reservado');

  // Cancel OS com reserva ativa para validar liberação de estoque
  await test('POST /service-orders — criar OS para cancelamento', async () => {
    need(ctx.customerId, 'customerId');
    need(ctx.vehicleId,  'vehicleId');
    const { status, data } = await axios.post(`${BASE_URL}/service-orders`, {
      customer_id: ctx.customerId,
      vehicle_id:  ctx.vehicleId,
      description: 'OS para cancelamento',
      items:       buildItems(),
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    ctx.orderIdToCancel = id(data);
    if (!ctx.orderIdToCancel) throw new Error('ID não encontrado na resposta');
  });

  await test('POST /service-orders/{id}/advance (RECEIVED → DIAGNOSING) — OS cancelamento', async () => {
    need(ctx.orderIdToCancel, 'orderIdToCancel');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderIdToCancel}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('POST /service-orders/{id}/advance (DIAGNOSING → PENDING_AUTHORIZATION) — OS cancelamento', async () => {
    need(ctx.orderIdToCancel, 'orderIdToCancel');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${ctx.orderIdToCancel}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  // Após OS1 COMPLETED: available = base-1, reserved = base
  // Após OS2 PENDING_AUTH Reserve(1): available = base-2, reserved = base+1
  await test('GET /products/{id}/inventory — estoque reservado antes do cancelamento', async () => {
    need(ctx.productId, 'productId');
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    if (inv.reserved_quantity  !== baseReserved  + 1) throw new Error(`reserved_quantity: esperado ${baseReserved + 1}, obtido ${inv.reserved_quantity}`);
    if (inv.available_quantity !== baseAvailable - 2) throw new Error(`available_quantity: esperado ${baseAvailable - 2}, obtido ${inv.available_quantity}`);
  });

  await test('DELETE /service-orders/{id} — cancelar OS', async () => {
    need(ctx.orderIdToCancel, 'orderIdToCancel');
    const { status, data } = await axios.delete(
      `${BASE_URL}/service-orders/${ctx.orderIdToCancel}`, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  // CancelReserved(1): reserved -= 1, available += 1 → volta ao estado pós-OS1
  await test('GET /products/{id}/inventory — reserva liberada após cancelamento', async () => {
    need(ctx.productId, 'productId');
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    if (inv.reserved_quantity  !== baseReserved)      throw new Error(`reserved_quantity: esperado ${baseReserved}, obtido ${inv.reserved_quantity}`);
    if (inv.available_quantity !== baseAvailable - 1) throw new Error(`available_quantity: esperado ${baseAvailable - 1}, obtido ${inv.available_quantity}`);
  });

  // ─── Helpers de polling ───────────────────────────────────────────────

  async function pollForStatus(orderUrl, expected, maxMs = 15000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const { data } = await axios.get(orderUrl, { headers: h() });
      const s = data?.data?.status ?? data?.status;
      if (s === expected) return;
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`Timeout aguardando status ${expected}`);
  }

  async function pollInventory(expectedReserved, maxMs = 15000) {
    if (!ctx.productId) return null;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const inv = await getInventory(BASE_URL, ctx.productId, h());
      if (inv.reserved_quantity === expectedReserved) return inv;
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`Timeout aguardando reserved_quantity=${expectedReserved}`);
  }

  // ─── Fluxo: OS com autorização negada pelo cliente ──────────────────

  section('Negação de autorização pelo cliente');

  let orderIdAuthDenied = null;
  let invBeforeDenial   = { available: 0, reserved: 0 };
  if (ctx.productId) {
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    invBeforeDenial = { available: inv.available_quantity, reserved: inv.reserved_quantity };
  }

  await test('POST /service-orders — criar OS para negação de autorização', async () => {
    need(ctx.customerId, 'customerId'); need(ctx.vehicleId, 'vehicleId');
    const { status, data } = await axios.post(`${BASE_URL}/service-orders`, {
      customer_id: ctx.customerId,
      vehicle_id:  ctx.vehicleId,
      description: 'OS — teste negação de autorização',
      items:       buildItems(),
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    orderIdAuthDenied = id(data);
    if (!orderIdAuthDenied) throw new Error('ID não encontrado na resposta');
  });

  await test('POST /service-orders/{id}/advance (RECEIVED → DIAGNOSING) — negação', async () => {
    need(orderIdAuthDenied, 'orderIdAuthDenied');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdAuthDenied}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('POST /service-orders/{id}/advance (DIAGNOSING → PENDING_AUTHORIZATION) — negação', async () => {
    need(orderIdAuthDenied, 'orderIdAuthDenied');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdAuthDenied}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('GET /products/{id}/inventory — estoque reservado antes da negação', async () => {
    need(ctx.productId, 'productId');
    const inv = await pollInventory(invBeforeDenial.reserved + 1);
    if (inv.available_quantity !== invBeforeDenial.available - 1)
      throw new Error(`available: esperado ${invBeforeDenial.available - 1}, obtido ${inv.available_quantity}`);
  });

  await test('POST /service-orders/{id}/authorize — cliente nega autorização', async () => {
    need(orderIdAuthDenied, 'orderIdAuthDenied');
    if (!customerToken) throw new Error('customerToken indisponível — etapa de login falhou');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdAuthDenied}/authorize`,
      { approved: false, notes: 'Fora do orçamento acordado' },
      { headers: { Authorization: `Bearer ${customerToken}` } });
    assertStatus(status, data, 200, 202);
  });

  await test('GET /service-orders/{id} — status AUTHORIZATION_DENIED após negação', async () => {
    need(orderIdAuthDenied, 'orderIdAuthDenied');
    await pollForStatus(`${BASE_URL}/service-orders/${orderIdAuthDenied}`, 'AUTHORIZATION_DENIED');
  });

  await test('GET /products/{id}/inventory — estoque liberado após negação (CANCEL_RESERVED)', async () => {
    need(ctx.productId, 'productId');
    // Poll until reserved returns to pre-block baseline — fails if CANCEL_RESERVED never fires.
    const inv = await pollInventory(invBeforeDenial.reserved);
    if (inv.available_quantity !== invBeforeDenial.available)
      throw new Error(`available pós-negação: esperado ${invBeforeDenial.available}, obtido ${inv.available_quantity}`);
  });

  // ─── Fluxo: Cancelamento de OS em RECEIVED (sem saga) ────────────────

  section('Cancelamento em RECEIVED (sem saga)');

  let orderIdReceivedCancel    = null;
  let invBeforeReceivedCancel  = { available: 0, reserved: 0 };
  if (ctx.productId) {
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    invBeforeReceivedCancel = { available: inv.available_quantity, reserved: inv.reserved_quantity };
  }

  await test('POST /service-orders — criar OS para cancelamento em RECEIVED', async () => {
    need(ctx.customerId, 'customerId'); need(ctx.vehicleId, 'vehicleId');
    const { status, data } = await axios.post(`${BASE_URL}/service-orders`, {
      customer_id: ctx.customerId,
      vehicle_id:  ctx.vehicleId,
      description: 'OS — cancelamento imediato em RECEIVED',
      items:       buildItems(),
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    orderIdReceivedCancel = id(data);
    if (!orderIdReceivedCancel) throw new Error('ID não encontrado na resposta');
  });

  await test('DELETE /service-orders/{id} — cancelar OS em RECEIVED (sem saga)', async () => {
    need(orderIdReceivedCancel, 'orderIdReceivedCancel');
    const { status, data } = await axios.delete(
      `${BASE_URL}/service-orders/${orderIdReceivedCancel}`, { headers: h() });
    assertStatus(status, data, 200, 202, 204);
  });

  await test('GET /service-orders/{id} — status CANCELED após deleção em RECEIVED', async () => {
    need(orderIdReceivedCancel, 'orderIdReceivedCancel');
    await pollForStatus(`${BASE_URL}/service-orders/${orderIdReceivedCancel}`, 'CANCELED');
  });

  await test('GET /products/{id}/inventory — sem alteração de estoque (RECEIVED não reserva)', async () => {
    need(ctx.productId, 'productId');
    const inv = await getInventory(BASE_URL, ctx.productId, h());
    if (inv.reserved_quantity  !== invBeforeReceivedCancel.reserved)
      throw new Error(`reserved inalterado: esperado ${invBeforeReceivedCancel.reserved}, obtido ${inv.reserved_quantity}`);
    if (inv.available_quantity !== invBeforeReceivedCancel.available)
      throw new Error(`available inalterado: esperado ${invBeforeReceivedCancel.available}, obtido ${inv.available_quantity}`);
  });

  // ─── Validação: PUT bloqueado após PENDING_AUTHORIZATION ──────────────

  section('Imutabilidade de itens após PENDING_AUTHORIZATION');

  let orderIdImmutable = null;

  await test('POST /service-orders — criar OS para teste de imutabilidade de itens', async () => {
    need(ctx.customerId, 'customerId'); need(ctx.vehicleId, 'vehicleId');
    const { status, data } = await axios.post(`${BASE_URL}/service-orders`, {
      customer_id: ctx.customerId,
      vehicle_id:  ctx.vehicleId,
      description: 'OS — imutabilidade de itens',
      items:       buildItems(),
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    orderIdImmutable = id(data);
    if (!orderIdImmutable) throw new Error('ID não encontrado na resposta');
  });

  await test('POST /service-orders/{id}/advance (RECEIVED → DIAGNOSING) — imutabilidade', async () => {
    need(orderIdImmutable, 'orderIdImmutable');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdImmutable}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  await test('POST /service-orders/{id}/advance (DIAGNOSING → PENDING_AUTHORIZATION) — imutabilidade', async () => {
    need(orderIdImmutable, 'orderIdImmutable');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdImmutable}/advance`, {}, { headers: h() });
    assertStatus(status, data, 200, 202);
  });

  // Aguarda a saga de RESERVE concluir antes de testar imutabilidade —
  // o status só fica PENDING_AUTHORIZATION após o MS3 confirmar a reserva.
  await test('GET /service-orders/{id} — aguardar PENDING_AUTHORIZATION (saga RESERVE)', async () => {
    need(orderIdImmutable, 'orderIdImmutable');
    await pollForStatus(`${BASE_URL}/service-orders/${orderIdImmutable}`, 'PENDING_AUTHORIZATION');
  });

  await test('PUT /service-orders/{id} — 4xx após PENDING_AUTHORIZATION (itens imutáveis)', async () => {
    need(orderIdImmutable, 'orderIdImmutable');
    const { status, data } = await axios.put(
      `${BASE_URL}/service-orders/${orderIdImmutable}`,
      { description: 'Tentativa de edição proibida', items: buildItems() },
      { headers: h() });
    if (status < 400)
      throw new Error(`esperado status 4xx, obtido ${status}. Body: ${JSON.stringify(data)}`);
  });

  await test('POST /service-orders/{id}/authorize — negar para liberar estoque (cleanup)', async () => {
    need(orderIdImmutable, 'orderIdImmutable');
    if (!customerToken) throw new Error('customerToken indisponível');
    const { status, data } = await axios.post(
      `${BASE_URL}/service-orders/${orderIdImmutable}/authorize`,
      { approved: false },
      { headers: { Authorization: `Bearer ${customerToken}` } });
    assertStatus(status, data, 200, 202);
  });

  section('Testes de erro básicos');

  await test('GET /service-orders/{id} — 404 para ID inexistente', async () => {
    const { status, data } = await axios.get(
      `${BASE_URL}/service-orders/00000000-0000-0000-0000-000000000000`, { headers: h() });
    if (status !== 404)
      throw new Error(`esperado 404, obtido ${status}. Body: ${JSON.stringify(data)}`);
  });

  await test('POST /service-orders — 401 sem Authorization header', async () => {
    const { status, data } = await axios.post(`${BASE_URL}/service-orders`, {
      customer_id: ctx.customerId,
      vehicle_id:  ctx.vehicleId,
      description: 'Sem autenticação',
      items:       buildItems(),
    });
    if (status !== 401 && status !== 403)
      throw new Error(`esperado 401/403, obtido ${status}`);
  });
};
