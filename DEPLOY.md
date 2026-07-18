# Deploy e produção

## Pré-requisitos

- Node.js 24 LTS ou superior
- Ambiente com HTTPS habilitado
- Variáveis de ambiente configuradas corretamente
- Banco SQLite com permissões adequadas para escrita e backup
- Acesso ao domínio ou endpoint público configurado corretamente

O backend utiliza o módulo nativo node:sqlite e requer Node.js 24 ou superior. A versão de desenvolvimento está registrada no arquivo .nvmrc.

## Variáveis de ambiente recomendadas

```env
PORT=3000
NODE_ENV=production

JWT_SECRET=uma-string-muito-segura-e-privada
JWT_EXPIRES_IN=2h

AUTH_COOKIE_NAME=portfolio_session
AUTH_COOKIE_MAX_AGE=7200

ALLOWED_ORIGIN=https://seu-dominio.com
TRUST_PROXY=false

RATE_LIMIT_WINDOW_MS=60000
MAX_CONTACT_REQUESTS=15
MAX_AUTH_REQUESTS=10
CSRF_COOKIE_NAME=portfolio_csrf

DATABASE_PATH=/caminho/persistente/portfolio.sqlite
LOG_FILE_PATH=/caminho/persistente/logs/app.log
```

## Passos recomendados

1. Instale as dependências:

```bash
npm ci
```

2. Crie o arquivo .env com os valores corretos para produção.

3. Garanta que o diretório do banco e os logs tenham permissão de escrita.

4. Gere o administrador inicial, se necessário:

```bash
npm run admin:create
```

5. Inicie o servidor em produção:

```bash
npm start
```

## Recomendações operacionais

- Use um proxy reverso como Nginx ou Caddy para garantir HTTPS e encaminhamento de tráfego.
- Ative TRUST_PROXY=true quando o servidor estiver atrás de um proxy reverso e queira respeitar corretamente o header X-Forwarded-For.
- Mantenha o banco SQLite em um volume persistente e faça backups regulares.
- Mantenha o JWT_SECRET em segredo e fora do repositório.
- Revise os logs periodicamente e considere rotação de logs para ambientes com maior volume.
- Considere mover a observabilidade para uma solução externa em produção, como Loki, Datadog, Papertrail ou um sistema semelhante.
- Defina limites adequados de taxa para evitar abuso, especialmente em endpoints públicos.

## Checklist de implantação

- [ ] HTTPS ativo
- [ ] Dominio configurado
- [ ] Variáveis de ambiente definidas
- [ ] Banco persistente e com backup
- [ ] Usuário administrador criado
- [ ] Logs e monitoramento habilitados
