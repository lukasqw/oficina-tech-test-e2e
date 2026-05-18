'use strict';

const axios = require('axios');
const { test, assertStatus } = require('./runner');

module.exports = async function authentication(BASE_URL, ctx, LOGIN_CPF, LOGIN_PASS) {
  console.log('\n🔐 Authentication');

  await test('POST /auth/login (usuário interno)', async () => {
    const { status, data } = await axios.post(`${BASE_URL}/auth/login`, {
      cpf:      LOGIN_CPF,
      password: LOGIN_PASS,
    });
    assertStatus(status, data, 200);
    const token = data?.data?.token ?? data?.token;
    if (!token) throw new Error('Token não encontrado na resposta');
    ctx.token = token;
  });
};
