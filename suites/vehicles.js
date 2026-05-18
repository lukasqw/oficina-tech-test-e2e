'use strict';

const axios = require('axios');
const { test, assertStatus, need } = require('./runner');

function id(data) {
  return data?.data?.id ?? data?.id;
}

module.exports = async function vehicles(BASE_URL, ctx) {
  console.log('\n🚗 Vehicles');

  const t = Date.now();
  const plate = `TST${(t % 9) + 1}A${String((t % 89) + 10)}`; // unique Mercosul-format plate per run

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  await test('POST /vehicles — criar veículo', async () => {
    need(ctx.customerId, 'customerId');
    const { status, data } = await axios.post(`${BASE_URL}/vehicles`, {
      customer_id:      ctx.customerId,
      license_plate:    plate,
      brand:            'Toyota',
      model:            'Corolla',
      model_year:       2020,
      manufacture_year: 2019,
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    ctx.vehicleId    = id(data);
    ctx.vehiclePlate = plate;
    if (!ctx.vehicleId) throw new Error('ID não encontrado na resposta');
  });

  await test('GET /vehicles', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/vehicles`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /vehicles?customer_id={id}', async () => {
    need(ctx.customerId, 'customerId');
    const { status, data } = await axios.get(
      `${BASE_URL}/vehicles?customer_id=${ctx.customerId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /vehicles/{id}', async () => {
    need(ctx.vehicleId, 'vehicleId');
    const { status, data } = await axios.get(`${BASE_URL}/vehicles/${ctx.vehicleId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /customers/{id}/vehicles', async () => {
    need(ctx.customerId, 'customerId');
    const { status, data } = await axios.get(
      `${BASE_URL}/customers/${ctx.customerId}/vehicles`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('PUT /vehicles/{id}', async () => {
    need(ctx.vehicleId, 'vehicleId');
    const { status, data } = await axios.put(`${BASE_URL}/vehicles/${ctx.vehicleId}`, {
      color: 'Preto',
    }, { headers: h() });
    assertStatus(status, data, 200, 204);
  });
};
