/**
 * SISTEMA DE LOGS DO BACKUP
 * - Rotação diária automática
 * - Só escreve log se houver cópia ou erro
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class BackupLogger {
    constructor(config) {
        this.config = config;

        this.logEntries = {
            dados: [],
            vms: []
        };

        this.startTime = new Date();

        this.estatisticas = {
            dados: { total: 0, copiados: 0, ignorados: 0, erros: 0 },
            vms: { total: 0, copiados: 0, ignorados: 0, erros: 0 }
        };
    }

    getEstatisticas() {
        return this.estatisticas;
    }

    /* =========================
       FUNÇÕES DE DATA / TEMPO
    ========================= */

    getLocalTime() {
        return new Date().toLocaleString('pt-BR');
    }

    getDataHoje() {
        return new Date()
            .toLocaleDateString('pt-BR')
            .split('/')
            .reverse()
            .join('-');
    }

    formatDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${h.toString().padStart(2, '0')}:${m
            .toString()
            .padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /* =========================
       LOG DE ARQUIVOS
    ========================= */

    addLogEntry(tipo, nome, hash_origem, tamanho_origem, hash_destino, tamanho_destino, status) {
        if (!this.logEntries[tipo]) {
            console.warn(`⚠️ Tipo inválido de log: ${tipo}`);
            return;
        }

        const entry = {
            timestamp: this.getLocalTime(),
            nome,
            hash_origem,
            tamanho_origem,
            hash_destino,
            tamanho_destino,
            status
        };

        this.logEntries[tipo].push(entry);
        this.estatisticas[tipo].total++;

        const statusNorm = status.toLowerCase();

        if (/copiad/.test(statusNorm)) this.estatisticas[tipo].copiados++;
        else if (/exist|ignorad/.test(statusNorm)) this.estatisticas[tipo].ignorados++;
        else if (/erro|fail|falha/.test(statusNorm)) this.estatisticas[tipo].erros++;

        return entry;
    }

    /* =========================
       SALVAR LOGS
    ========================= */

    async saveLogs() {
        await fs.ensureDir(this.config.LOG_DIR);

        const endTime = new Date();
        const durationMs = endTime - this.startTime;
        const dataHoje = this.getDataHoje();

        const logAtual = path.join(this.config.LOG_DIR, 'backup_consolidado.json');

        const totalCopiados =
            this.estatisticas.dados.copiados +
            this.estatisticas.vms.copiados;

        const totalErros =
            this.estatisticas.dados.erros +
            this.estatisticas.vms.erros;

        // Regra: so toca no arquivo consolidado quando houver copia ou erro.
        // Assim, se o HD estiver desconectado ou rodar sem mudancas, o JSON fica com o ultimo backup real.
        if (totalCopiados === 0 && totalErros === 0) {
            console.log('ℹ️ Sem cópias e sem erros nesta execução. Log não será criado/rotacionado.');
            return { consolidado: null };
        }

        /* =========================
           VERIFICA TROCA DE DIA
        ========================= */

        if (fs.existsSync(logAtual)) {
            const stats = fs.statSync(logAtual);
            const dataMod = new Date(stats.mtime)
                .toLocaleDateString('pt-BR')
                .split('/')
                .reverse()
                .join('-');

            if (dataMod !== dataHoje) {
                const nomeRotacionadoBase = `backup_consolidado-${dataMod}.json`;
                let caminhoRotacionado = path.join(this.config.LOG_DIR, nomeRotacionadoBase);

                try {
                    await fs.move(logAtual, caminhoRotacionado, { overwrite: false });
                } catch {
                    const nomeRotacionadoAlt = `backup_consolidado-${dataMod}-${Date.now()}.json`;
                    caminhoRotacionado = path.join(this.config.LOG_DIR, nomeRotacionadoAlt);
                    await fs.move(logAtual, caminhoRotacionado, { overwrite: false });
                }

                console.log(`🔁 Log rotacionado: ${path.basename(caminhoRotacionado)}`);
            }
        }

        /* =========================
           MONTA LOG CONSOLIDADO
        ========================= */

        const runInfo = {
            data_referencia: dataHoje,
            start_time: this.startTime.toLocaleString('pt-BR'),
            end_time: endTime.toLocaleString('pt-BR'),
            duration_hms: this.formatDuration(durationMs),
            uuid_hd: this.config.UUID_HD_EXTERNO_ATUAL || this.config.UUID_HD_EXTERNO || null,
            alias_hd: this.config.ALIAS_HD_EXTERNO_ATUAL || null,
            status:
                totalErros > 0
                    ? 'BACKUP_EXECUTADO_COM_ERROS'
                    : totalCopiados > 0
                    ? 'BACKUP_EXECUTADO_COM_COPIAS'
                    : 'BACKUP_INICIADO_SEM_MOVIMENTACAO',
            estatisticas_gerais: {
                total_arquivos:
                    this.estatisticas.dados.total +
                    this.estatisticas.vms.total,
                total_copiados: totalCopiados,
                total_ignorados:
                    this.estatisticas.dados.ignorados +
                    this.estatisticas.vms.ignorados,
                total_erros: totalErros
            },
            backup_dados: {
                origem: this.config.BACKUP_DADOS?.ORIGEM || null,
                destino: this.config.BACKUP_DADOS?.DESTINO || null,
                ...this.estatisticas.dados
            },
            backup_vms: {
                origem: this.config.BACKUP_VMS?.ORIGEM || null,
                destino: this.config.BACKUP_VMS?.DESTINO || null,
                ...this.estatisticas.vms
            }
        };

        // Mantem um unico arquivo do dia, com historico de execucoes (ex.: varios discos).
        let runs = [];
        if (fs.existsSync(logAtual)) {
            try {
                const existente = await fs.readJson(logAtual);
                if (existente?.backup_runs && Array.isArray(existente.backup_runs)) {
                    runs = existente.backup_runs;
                } else if (existente?.backup_info && typeof existente.backup_info === 'object') {
                    runs = [existente.backup_info];
                }
            } catch { }
        }

        runs.push(runInfo);

        const logConsolidado = {
            backup_info: runInfo,      // compat: sempre reflete a ultima execucao com copia/erro
            backup_runs: runs          // historico do dia (ou do arquivo atual)
        };

        await fs.writeFile(logAtual, JSON.stringify(logConsolidado, null, 2));

        console.log(`✅ Log consolidado atualizado (${dataHoje})`);

        return { consolidado: logAtual };
    }

    /* =========================
       FUNÇÕES AUXILIARES
    ========================= */

    gerarHash(filePath) {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    listarArquivos(dir) {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .map(f => path.join(dir, f))
            .filter(f => fs.statSync(f).isFile());
    }

    validarNovosArquivos(diretorios) {
        console.log(`🔍 Verificando integridade de novos arquivos...`);

        if (!fs.existsSync(this.config.estadoPath)) {
            fs.writeFileSync(this.config.estadoPath, JSON.stringify({ verificados: [] }, null, 2));
        }

        const estado = JSON.parse(fs.readFileSync(this.config.estadoPath, 'utf8'));
        const arquivos = diretorios.flatMap(dir => this.listarArquivos(dir));

        for (const file of arquivos) {
            const hash = this.gerarHash(file);
            if (!estado.verificados.includes(hash)) {
                estado.verificados.push(hash);
            }
        }

        fs.writeFileSync(this.config.estadoPath, JSON.stringify(estado, null, 2));
    }
}

module.exports = BackupLogger;
