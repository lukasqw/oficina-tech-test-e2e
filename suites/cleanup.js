'use strict';

const axios = require('axios');
const { test, assertStatus, need } = require('./runner');

module.exports = async function cleanup(BASE_URL, ctx) {
  console.log('\n🧹 Cleanup');

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  await test('DELETE /vehicles/{id}', async () => {
    need(ctx.vehicleId, 'vehicleId');
    const { status, data } = await axios.delete(
      `${BASE_URL}/vehicles/${ctx.vehicleId}`, { headers: h() });
    assertStatus(status, data, 200, 204);
  });

  await test('DELETE /customers/{id}', async () => {
    need(ctx.customerId, 'customerId');
    const { status, data } = await axios.delete(
      `${BASE_URL}/customers/${ctx.customerId}`, { headers: h() });
    assertStatus(status, data, 200, 204);
  });

  await test('DELETE /products/{id}', async () => {
    need(ctx.productId, 'productId');
    const { status, data } = await axios.delete(
      `${BASE_URL}/products/${ctx.productId}`, { headers: h() });
    assertStatus(status, data, 200, 204);
  });

  await test('DELETE /services/{id}', async () => {
    need(ctx.serviceId, 'serviceId');
    const { status, data } = await axios.delete(
      `${BASE_URL}/services/${ctx.serviceId}`, { headers: h() });
    assertStatus(status, data, 200, 204);
  });

  await test('DELETE /users/{id}', async () => {
    need(ctx.userId, 'userId');
    const { status, data } = await axios.delete(
      `${BASE_URL}/users/${ctx.userId}`, { headers: h() });
    assertStatus(status, data, 200, 204);
  });
};
