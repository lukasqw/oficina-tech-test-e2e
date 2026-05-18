'use strict';

const axios = require('axios');
const { test, assertStatus, need, randomCpf } = require('./runner');

function id(data) {
  return data?.data?.id ?? data?.id;
}

module.exports = async function customers(BASE_URL, ctx) {
  console.log('\n👥 Customers');

  const suffix  = Date.now();
  const testDoc = randomCpf();

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  await test('POST /customers — criar cliente', async () => {
    const { status, data } = await axios.post(`${BASE_URL}/customers`, {
      name:          'Cliente Teste',
      email:         `cliente.${suffix}@testuser.com`,
      password:      'senha123',
      document:      testDoc,
      document_type: 'CPF',
      phone:         '11999990001',
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    ctx.customerId        = id(data);
    ctx.customerDocument  = testDoc;
    ctx.customerPassword  = 'senha123';
    if (!ctx.customerId) throw new Error('ID não encontrado na resposta');
  });

  await test('GET /customers', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/customers`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /customers?document={doc}', async () => {
    const { status, data } = await axios.get(
      `${BASE_URL}/customers?document=${ctx.customerDocument}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /customers/{id}', async () => {
    need(ctx.customerId, 'customerId');
    const { status, data } = await axios.get(`${BASE_URL}/customers/${ctx.customerId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('PUT /customers/{id}', async () => {
    need(ctx.customerId, 'customerId');
    const { status, data } = await axios.put(`${BASE_URL}/customers/${ctx.customerId}`, {
      name:  'Cliente Teste Atualizado',
      phone: '11988880001',
    }, { headers: h() });
    assertStatus(status, data, 200, 204);
  });
};
