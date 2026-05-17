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

Ajuste os parâmetros de backup em `config.js` ou usando um arquivo `.env` na raiz de `app`.

Use `.env.example` como base para criar seu `.env` local.

Exemplo de variáveis:

```bash
BACKUP_DADOS_ORIGEM=/dados/backup/bacula/
BACKUP_DADOS_DESTINO=/media/usbdiario/bacula
BACKUP_VMS_ORIGEM=/mnt/dados/dump
BACKUP_VMS_DESTINO=/media/usbdiario/vms
BACKUP_VMS_EXTENSOES=.zst
BACKUP_SCHEDULE_DIAS=segunda,terca,quarta,quinta,sexta
BACKUP_SCHEDULE_INICIO=07:00
BACKUP_SCHEDULE_FIM=18:00
ZABBIX_SERVER=192.168.0.202
ZABBIX_HOST=pve
BACKUP_DRY_RUN=false
```

## Retenção de VMs por HD

Você pode definir políticas de retenção diferentes para cada HD externo usando `UUIDS_HD_EXTERNOS_JSON` no `app/config.js`.
Cada disco pode incluir um campo `retencao` com regras específicas:

```json
{
  "uuid": "uuid-do-hd-1",
  "alias": "HD-Backup-1",
  "retencao": {
    "DIAS": 30,
    "ESPACO_MINIMO": 10737418240,
    "EXCLUIR_ANTIGOS": true,
    "MODO_DRY_RUN": false
  }
}
```

Se o disco não tiver `retencao`, a configuração padrão de `BACKUP_VMS.RETENCAO` será usada.

## Simulação de retenção (dry-run)

Para testar quais arquivos seriam rotacionados sem apagar nada, use:

```bash
BACKUP_VMS_RETENCAO_MODO_DRY_RUN=true
```

No modo `dry-run`, o script lista os arquivos que seriam excluídos sem removê-los.

## Boas práticas

- Não comitar credenciais no repositório.
- Use o PM2 para manter o processo vivo e monitorado.
- Verifique se o disco externo está configurado corretamente antes de rodar.
