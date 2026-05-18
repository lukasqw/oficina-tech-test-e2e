'use strict';

const axios = require('axios');
const { test, assertStatus, need } = require('./runner');

function id(data) {
  return data?.data?.id ?? data?.id;
}

module.exports = async function services(BASE_URL, ctx) {
  console.log('\n🔧 Services');

  const suffix = Date.now();

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  await test('POST /services — criar serviço', async () => {
    const { status, data } = await axios.post(`${BASE_URL}/services`, {
      name:               `Troca de Óleo ${suffix}`,
      description:        'Troca completa de óleo e filtro',
      price:              15000,
      estimated_duration: 60,
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    ctx.serviceId = id(data);
    if (!ctx.serviceId) throw new Error('ID não encontrado na resposta');
  });

  await test('GET /services', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/services`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /services/{id}', async () => {
    need(ctx.serviceId, 'serviceId');
    const { status, data } = await axios.get(`${BASE_URL}/services/${ctx.serviceId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('PUT /services/{id}', async () => {
    need(ctx.serviceId, 'serviceId');
    const { status, data } = await axios.put(`${BASE_URL}/services/${ctx.serviceId}`, {
      name:  `Troca de Óleo Completa ${suffix}`,
      price: 17500,
    }, { headers: h() });
    assertStatus(status, data, 200, 204);
  });

};
