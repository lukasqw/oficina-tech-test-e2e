'use strict';

const axios = require('axios');
const { test, assertStatus, need, randomCpf } = require('./runner');

function id(data) {
  return data?.data?.id ?? data?.id;
}

module.exports = async function users(BASE_URL, ctx) {
  console.log('\n👤 Users');

  const suffix  = Date.now();
  const testCpf = randomCpf();

  const h = () => ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  await test('POST /users — criar usuário', async () => {
    const { status, data } = await axios.post(`${BASE_URL}/users`, {
      name:     'Mecânico Teste',
      email:    `mecanico.${suffix}@test.com`,
      cpf:      testCpf,
      password: 'senha123',
      role:     'MANAGER',
    }, { headers: h() });
    assertStatus(status, data, 200, 201);
    ctx.userId = id(data);
    if (!ctx.userId) throw new Error('ID não encontrado na resposta');
  });

  await test('GET /users', async () => {
    const { status, data } = await axios.get(`${BASE_URL}/users`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('GET /users/{id}', async () => {
    need(ctx.userId, 'userId');
    const { status, data } = await axios.get(`${BASE_URL}/users/${ctx.userId}`, { headers: h() });
    assertStatus(status, data, 200);
  });

  await test('PUT /users/{id}', async () => {
    need(ctx.userId, 'userId');
    const { status, data } = await axios.put(`${BASE_URL}/users/${ctx.userId}`, {
      name: 'Mecânico Teste Atualizado',
    }, { headers: h() });
    assertStatus(status, data, 200, 204);
  });
};
