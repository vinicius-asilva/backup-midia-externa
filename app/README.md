# backup-midia-externa

Sistema de backup para mídia externa com agendamento interno e gerenciamento via PM2.

## Sobre

Este projeto monitora diretórios de dados e VMs para executar backups apenas quando há alterações. O processo foi ajustado para rodar somente de segunda a sexta-feira, entre 07:00 e 19:00.

## Como usar

1. Instale dependências:

```bash
npm install
```

2. Inicie com PM2:

```bash
pm2 start index.js --name backup-midia-externa
```

3. Verifique logs com PM2:

```bash
pm2 logs backup-midia-externa
```

## Configuração

Ajuste os parâmetros de backup em `config.js` conforme necessário.

## Boas práticas

- Não comitar credenciais no repositório.
- Use o PM2 para manter o processo vivo e monitorado.
- Verifique se o disco externo está configurado corretamente antes de rodar.
