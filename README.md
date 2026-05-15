# backup-midia-externa

Backup de mídia externa em Node.js, com validação de horário, checagem de alterações e execução via PM2.

## O que o script faz

- Monitora as pastas de origem configuradas para backup de dados e VMs.
- Verifica se houve alterações desde o último backup bem-sucedido.
- Monta o disco externo apenas quando necessário e faz o backup.
- Executa somente de segunda a sexta, entre 07:00 e 19:00.
- Salva o estado dos backups para evitar duplicação diária.

## Como subir pelo PM2

```bash
cd '/home/vinicius/B3TECH/script bkp/app'
npm install
pm2 start index.js --name backup-midia-externa
```

Para ver logs:

```bash
pm2 logs backup-midia-externa
```

Para parar:

```bash
pm2 stop backup-midia-externa
```

## Responsabilidade principal de cada arquivo

- `app/index.js`: ponto de entrada. Instancia o agendamento e inicia o processo.
- `app/agendamento.js`: controla quando o backup deve rodar e evita execuções fora do horário permitido.
- `app/config.js`: define parâmetros de origem, destino, intervalos e paths usados pelo sistema.
- `app/montagem.js`: monta e desmonta o disco externo antes e depois do backup.
- `app/bkpdados.js`: implementa o backup dos dados de origem para o destino.
- `app/bkpvm.js`: implementa o backup das VMs configuradas.
- `app/logs.js`: registra e salva logs do processo de backup.
- `app/estado.js`: carrega e salva o estado de último backup por disco.
- `app/zabbix.js` e `app/retencao.js`: utilitários e rotinas adicionais do sistema.

## Por que usar este projeto

- Evita rodar backups fora do horário comercial indicado.
- Reduz operações desnecessárias verificando se há arquivos novos antes de montar o disco.
- Permite gerenciamento estável com PM2.
- Mantém histórico de sucesso por disco para não repetir trabalho.

## Observações

- Ajuste `app/config.js` antes de rodar para apontar corretamente as pastas de origem e destino.
- Não comite arquivos sensíveis ou credenciais no repositório.
