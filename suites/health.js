'use strict';

const axios = require('axios');
const { test, assertStatus } = require('./runner');

module.exports = async function healthChecks(BASE_URL) {
  console.log('\n📋 Health Checks');

  await test('GET /health', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/health`);
    assertStatus(status, data, 200);
  });

  await test('GET /ms-identity/health', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/ms-identity/health`);
    assertStatus(status, data, 200);
  });

  await test('GET /ms-order/health', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/ms-order/health`);
    assertStatus(status, data, 200);
  });

  await test('GET /ms-workshop/health', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/ms-workshop/health`);
    assertStatus(status, data, 200);
  });
};
