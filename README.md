# oficina-tech-api-e2e

Testes E2E da plataforma Oficina Tech. Exercita o fluxo completo via API Gateway — auth, clientes, veículos, ordens de serviço, pagamento Mercado Pago e limpeza.

## Requisitos

- Node.js >= 18
- Acesso à URL do API Gateway

## Configuração

Copie o exemplo e preencha com os valores do ambiente:

```bash
cp .env.example .env
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `BASE_URL` | Sim | URL base do API Gateway (sem `/` no final) |
| `LOGIN_CPF` | Sim | CPF de um usuário admin já cadastrado |
| `LOGIN_PASSWORD` | Sim | Senha do usuário admin |
| `MP_WEBHOOK_SECRET` | Não | Secret do webhook MP — habilita testes de pagamento completo |

## Executar

```bash
npm install
npm test
```

## Suites

Os testes rodam em sequência e compartilham contexto (IDs criados numa suite são usados nas seguintes):

| Suite | O que testa |
|---|---|
| `health` | Health check dos serviços |
| `auth` | Login e geração de token JWT |
| `users` | CRUD de usuários |
| `customers` | CRUD de clientes e login de customer |
| `vehicles` | Veículos vinculados a clientes |
| `services` | Catálogo de serviços |
| `products-inventory` | Produtos e controle de estoque |
| `service-orders` | Ciclo de vida completo das OS |
| `payments` | Fluxo de pagamento Mercado Pago |
| `cleanup` | Remove dados criados durante os testes |

### Testes de pagamento

Sem `MP_WEBHOOK_SECRET`: apenas validações de estado (sem pagamento real).

Com `MP_WEBHOOK_SECRET`: o teste pausa e exibe a URL de pagamento sandbox do MP. Use os cartões de teste abaixo para completar o pagamento manualmente.

**Cartões de teste (validade 11/30):**

| Bandeira | Número | CVV |
|---|---|---|
| Mastercard | 5031 4332 1540 6351 | 123 |
| Visa | 4235 4777 2802 5682 | 123 |

**Nome do titular define o resultado:** `APRO` = aprovado · `FUND` = saldo insuficiente · `OTHE` = recusado

**Buyer sandbox:** `TESTUSER8247756854211801431` / `ZF9BfBakNr`
