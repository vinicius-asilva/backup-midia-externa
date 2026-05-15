/**
 * CONFIGURAÇÕES GLOBAIS DO SISTEMA DE BACKUP
 */

const path = require('path');

function env(name, fallback) {
    const v = process.env[name];
    return (v === undefined || v === null || v === '') ? fallback : v;
}

function envBool(name, fallback) {
    const raw = env(name, null);
    if (raw === null) return fallback;
    return /^(1|true|yes|y|on)$/i.test(String(raw).trim());
}

function envInt(name, fallback) {
    const raw = env(name, null);
    if (raw === null) return fallback;
    const n = parseInt(String(raw).trim(), 10);
    return Number.isFinite(n) ? n : fallback;
}

function envList(name, fallback) {
    const raw = env(name, null);
    if (raw === null) return fallback;
    return String(raw)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function envJson(name, fallback) {
    const raw = env(name, null);
    if (raw === null) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}

function bytesFromGB(gbFallback) {
    const gb = envInt('BACKUP_VMS_RETENCAO_ESPACO_MINIMO_GB', gbFallback);
    return gb * 1024 * 1024 * 1024;
}

const DESTINO_BASE = env('BACKUP_DESTINO_BASE', '/media/usbdiario');
const LOG_DIR = env('BACKUP_LOG_DIR', '/dados/logs/');
const ESTADO_PATH = env('BACKUP_ESTADO_PATH', path.join(LOG_DIR, 'backup_estado.json'));

const UUID_HD_EXTERNO = env('BACKUP_UUID_HD_EXTERNO', '');
const UUIDS_HD_EXTERNOS_JSON = envJson('BACKUP_UUIDS_HD_EXTERNOS_JSON', null);
const UUIDS_HD_EXTERNOS_LIST = envList('BACKUP_UUIDS_HD_EXTERNOS', null);

let UUIDS_HD_EXTERNOS = [];
if (Array.isArray(UUIDS_HD_EXTERNOS_JSON)) UUIDS_HD_EXTERNOS = UUIDS_HD_EXTERNOS_JSON;
else if (UUIDS_HD_EXTERNOS_LIST) UUIDS_HD_EXTERNOS = UUIDS_HD_EXTERNOS_LIST;

module.exports = {
    // CONFIGURAÇÕES DE MONTAGEM E LOG
    DESTINO_BASE,
    LOG_DIR,
    ESTADO_PATH,
    // Alias legado (algumas partes do codigo usam estadoPath)
    estadoPath: ESTADO_PATH,

    // Pode ser 1 UUID (UUID_HD_EXTERNO) ou varios (UUIDS_HD_EXTERNOS).
    UUID_HD_EXTERNO,
    // Pode ser array de strings (UUID) OU objetos { uuid, alias }.
    UUIDS_HD_EXTERNOS,

    CHECK_INTERVAL: envInt('BACKUP_CHECK_INTERVAL_MS', 3600000), // 1h

    // CONFIGURAÇÕES DE PERFORMANCE
    TAMANHO_MAX_HASH_COMPLETO: envInt('BACKUP_TAMANHO_MAX_HASH_COMPLETO', 10 * 1024 * 1024 * 1024), // 10GB
    TAMANHO_BLOCO_HASH: envInt('BACKUP_TAMANHO_BLOCO_HASH', 10 * 1024 * 1024), // 10MB

    // CONFIGURAÇÕES DE BACKUP DE DADOS
    BACKUP_DADOS: {
        ORIGEM: env('BACKUP_DADOS_ORIGEM', '/dados/backup/bacula/'),
        DESTINO: env('BACKUP_DADOS_DESTINO', path.join(DESTINO_BASE, 'bacula')),
        NOME: env('BACKUP_DADOS_NOME', 'Backup Dados'),
        DESCRICAO: env('BACKUP_DADOS_DESCRICAO', 'Backup arquivo bacula'),
        VERIFICAR_HASH: envBool('BACKUP_DADOS_VERIFICAR_HASH', false),
        ATIVO: envBool('BACKUP_DADOS_ATIVO', true)
    },

    // CONFIGURAÇÕES DE BACKUP DE VMs
    BACKUP_VMS: {
        VERIFICAR_HASH: envBool('BACKUP_VMS_VERIFICAR_HASH', false),
        ORIGEM: env('BACKUP_VMS_ORIGEM', '/mnt/dados/dump'),
        DESTINO: env('BACKUP_VMS_DESTINO', path.join(DESTINO_BASE, 'vms')),
        NOME: env('BACKUP_VMS_NOME', 'Backup VMS'),
        DESCRICAO: env('BACKUP_VMS_DESCRICAO', 'Backup de máquinas virtuais'),
        // Se preencher, copia apenas arquivos com essas extensoes/sufixos (case-insensitive).
        // Ex.: ".vma.zst" ou ".qcow2" (separados por virgula)
        EXTENSOES_PERMITIDAS: envList('BACKUP_VMS_EXTENSOES', []),
        TAMANHO_MAX_HASH_COMPLETO: envInt('BACKUP_VMS_TAMANHO_MAX_HASH_COMPLETO', 50 * 1024 * 1024 * 1024), // 50GB
        ATIVO: envBool('BACKUP_VMS_ATIVO', true),

        // POLÍTICA DE RETENÇÃO DE VMs
        RETENCAO: {
            // Número de dias para manter arquivos antes de elegíveis à exclusão
            DIAS: envInt('BACKUP_VMS_RETENCAO_DIAS', 90),
            // Espaço mínimo livre no destino para manter antes de excluir backups antigos
            ESPACO_MINIMO: envInt('BACKUP_VMS_RETENCAO_ESPACO_MINIMO', bytesFromGB(10)),
            // Se true, arquivos mais antigos que DIAS serão removidos
            EXCLUIR_ANTIGOS: envBool('BACKUP_VMS_RETENCAO_EXCLUIR_ANTIGOS', true),
            // Se true, executa somente simulação de exclusões, sem apagar arquivos
            MODO_DRY_RUN: envBool('BACKUP_VMS_RETENCAO_MODO_DRY_RUN', false)
        }
    }
};
