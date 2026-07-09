# E2E

Запуск smoke-цикла проверки:

```bash
npm run test:e2e -- e2e/review-cycle.spec.ts
```

Требования:

- локально доступен `http://localhost:5173/`
- демо-аккаунты активны (`physics@demo.ru`, `alex@demo.ru`)
- есть доступ к Supabase из браузера

Сценарий идемпотентный: сначала ищет готовую `pending` legacy PDF-сдачу в очереди, а если её нет — создаёт новую через UI ученика и локальный PDF fixture из репозитория.
