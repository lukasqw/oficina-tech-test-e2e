'use strict';

const axios = require('axios');
const { test, assertStatus, need, section } = require('./runner');

function id(data) {
  return data?.data?.id ?? data?.id;
}

module.exports = async function productsAndInventory(BASE_URL, ctx) {
  console.log('\n📦 Products & Inventory');

  const suffix = Date.now();

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  section('Catálogo de produtos');

  await test('POST /products — criar produto', async () => {
    const { status, data } = await axios.post(`${BASE_URL}/products`, {
      name:         `Óleo Motor 5W30 ${suffix}`,
      description:  'Óleo sintético para motor',
      price:        4590,
      product_type: 'CONSUMABLE',
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    ctx.productId = id(data);
    if (!ctx.productId) throw new Error('ID não encontrado na resposta');
  });

  await test('GET /products', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/products`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /products/{id}', async () => {
    need(ctx.productId, 'productId');
    const { status, data } = await axios.get(`${BASE_URL}/products/${ctx.productId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('PUT /products/{id}', async () => {
    need(ctx.productId, 'productId');
    const { status, data } = await axios.put(`${BASE_URL}/products/${ctx.productId}`, {
      name:  `Óleo Motor 5W30 Atualizado ${suffix}`,
      price: 4990,
    }, { headers: h() });
    assertStatus(status, data, 200, 204);
  });

  section('Controle de estoque');

  await test('POST /products/{id}/inventory — estoque auto-criado (409 esperado)', async () => {
    need(ctx.productId, 'productId');
    const { status, data } = await axios.post(
      `${BASE_URL}/products/${ctx.productId}/inventory`,
      { quantity: 20, min_quantity: 3 },
      { headers: h() });
    // Inventory is auto-created when product is created — 409 is the expected response here
    assertStatus(status, data, 201, 409);
  });

  await test('GET /products/{id}/inventory', async () => {
    need(ctx.productId, 'productId');
    const { status, data } = await axios.get(
      `${BASE_URL}/products/${ctx.productId}/inventory`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('POST /products/{id}/inventory/increase', async () => {
    need(ctx.productId, 'productId');
    const { status, data } = await axios.post(
      `${BASE_URL}/products/${ctx.productId}/inventory/increase`,
      { quantity: 5 },
      { headers: h() });
    assertStatus(status, data, 200, 201);
  });

  await test('POST /products/{id}/inventory/manual-decrease', async () => {
    need(ctx.productId, 'productId');
    const { status, data } = await axios.post(
      `${BASE_URL}/products/${ctx.productId}/inventory/manual-decrease`,
      { quantity: 2 },
      { headers: h() });
    assertStatus(status, data, 200, 201);
  });
};
