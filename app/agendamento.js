/**
 * SISTEMA DE AGENDAMENTO E EXECUÇÃO
 * Configurado para PM2
 */

const MontagemHD = require('./montagem');
const BackupLogger = require('./logs');
const BackupDados = require('./bkpdados');
const BackupVMs = require('./bkpvm');
const config = require('./config');
const fs = require('fs-extra');
const path = require('path');
const { getDataHoje, carregarEstado, salvarEstado } = require('./estado');

class AgendamentoBackup {
    constructor() {
        this.montagemHD = new MontagemHD(config);
        this.emExecucao = false;
    }

    async getUltimaModificacaoMs(diretorio) {
        if (!diretorio) return NaN;

        try {
            if (!await fs.pathExists(diretorio)) return NaN;
        } catch {
            return NaN;
        }

        let maxMs = NaN;
        const stack = [diretorio];

        while (stack.length) {
            const dir = stack.pop();
            let entries;

            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const ent of entries) {
                const full = path.join(dir, ent.name);

                if (ent.isDirectory()) {
                    stack.push(full);
                    continue;
                }

                if (!ent.isFile()) continue;

                try {
                    const st = await fs.stat(full);
                    if (!Number.isFinite(maxMs) || st.mtimeMs > maxMs) maxMs = st.mtimeMs;
                } catch {
                    continue;
                }
            }
        }

        return maxMs;
    }

    async temArquivoNovoDesde(diretorio, sinceMs) {
        if (!Number.isFinite(sinceMs)) return true;
        if (!diretorio) return false;

        try {
            if (!await fs.pathExists(diretorio)) return false;
        } catch {
            return false;
        }

        const stack = [diretorio];

        while (stack.length) {
            const dir = stack.pop();
            let entries;

            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const ent of entries) {
                const full = path.join(dir, ent.name);

                if (ent.isDirectory()) {
                    stack.push(full);
                    continue;
                }

                if (!ent.isFile()) continue;

                try {
                    const st = await fs.stat(full);
                    if (st.mtimeMs > sinceMs) return true;
                } catch {
                    continue;
                }
            }
        }

        return false;
    }

    /**
     * Executa backup completo
     */
    async executarBackupCompleto() {
        // Evita execuções simultâneas
        if (this.emExecucao) {
            console.log('⚠️  Backup já em execução, aguardando...');
            return;
        }

        this.emExecucao = true;

        try {
            const estadoPath = config.ESTADO_PATH || config.estadoPath || (config.LOG_DIR ? path.join(config.LOG_DIR, 'backup_estado.json') : null);
            const estado = await carregarEstado(estadoPath);
            const hoje = getDataHoje();

            const porDisco = estado?.last_success_by_disk && typeof estado.last_success_by_disk === 'object'
                ? estado.last_success_by_disk
                : {};

            // Backward compat (estado antigo)
            if (estado?.last_success_time && estado?.last_success_date && !Object.keys(porDisco).length) {
                const uuidFallback = config.UUID_HD_EXTERNO || 'DEFAULT';
                porDisco[uuidFallback] = {
                    date: estado.last_success_date,
                    time: estado.last_success_time
                };
            }

            if (!config.BACKUP_DADOS?.ATIVO && !config.BACKUP_VMS?.ATIVO) {
                console.log('ℹ️ Backups desativados (DADOS e VMs). Nada a fazer.');
                return;
            }

            // Calcula uma vez por execucao: ultima modificacao nas origens (sem montar HD).
            const ultimaDadosMs = config.BACKUP_DADOS?.ATIVO ? await this.getUltimaModificacaoMs(config.BACKUP_DADOS.ORIGEM) : NaN;
            const ultimaVmsMs = config.BACKUP_VMS?.ATIVO ? await this.getUltimaModificacaoMs(config.BACKUP_VMS.ORIGEM) : NaN;

            const discos = this.montagemHD.getDiscosConfigurados();
            if (!discos.length) {
                console.log('❌ Nenhum disco configurado (UUID_HD_EXTERNO/UUIDS_HD_EXTERNOS).');
                return;
            }

            let algumRodou = false;

            for (const disco of discos) {
                const uuid = disco.uuid;
                const alias = disco.alias || null;

                const info = porDisco[uuid] || {};
                if (info?.date === hoje) {
                    console.log(`ℹ️ Disco ${uuid}${alias ? ` (${alias})` : ''}: backup já executado com sucesso hoje (${hoje}).`);
                    continue;
                }

                const lastSuccessMs = info?.time ? new Date(info.time).getTime() : NaN;

                const precisaRodarDisco =
                    (config.BACKUP_DADOS?.ATIVO && (!Number.isFinite(lastSuccessMs) || (Number.isFinite(ultimaDadosMs) && ultimaDadosMs > lastSuccessMs))) ||
                    (config.BACKUP_VMS?.ATIVO && (!Number.isFinite(lastSuccessMs) || (Number.isFinite(ultimaVmsMs) && ultimaVmsMs > lastSuccessMs)));

                if (!precisaRodarDisco) {
                    console.log(`ℹ️ Disco ${uuid}${alias ? ` (${alias})` : ''}: sem arquivos novos desde o ultimo sucesso. HD nao sera montado.`);
                    continue;
                }

                console.log('\n' + '='.repeat(70));
                console.log(`🔄 INICIANDO BACKUP PARA DISCO: ${uuid}${alias ? ` (${alias})` : ''}`);
                console.log('='.repeat(70));

                const hdPronto = await this.montagemHD.montarDisco(disco);
                if (!hdPronto) {
                    console.log(`❌ Disco ${uuid}${alias ? ` (${alias})` : ''}: não foi possível montar. Pulando.`);
                    continue;
                }

                algumRodou = true;

                try {
                    const logger = new BackupLogger(config);

                    console.log(`🆔 UUID HD: ${config.UUID_HD_EXTERNO_ATUAL || uuid}`);
                    console.log(`🏷️  Alias HD: ${config.ALIAS_HD_EXTERNO_ATUAL || alias || 'N/A'}`);
                    console.log(`🏠 Diretório base: ${config.DESTINO_BASE}`);
                    console.log(`⏰ Início geral: ${new Date().toISOString()}`);
                    console.log('='.repeat(70));

                    const backupDados = new BackupDados(config, logger);
                    const backupVMs = new BackupVMs(config, logger);

                    const options = Number.isFinite(lastSuccessMs) ? { onlyNewerThanMs: lastSuccessMs } : {};
                    const resultados = {
                        dados: await backupDados.executar(options),
                        vms: await backupVMs.executar(options)
                    };

                    const arquivosLog = await logger.saveLogs();
                    this.gerarRelatorioFinal(logger, resultados, arquivosLog);

                    const sucessoGeral =
                        (config.BACKUP_DADOS?.ATIVO ? resultados.dados : true) &&
                        (config.BACKUP_VMS?.ATIVO ? resultados.vms : true);

                    if (sucessoGeral) {
                        porDisco[uuid] = {
                            date: hoje,
                            time: new Date().toISOString(),
                            alias: alias || null
                        };

                        await salvarEstado(estadoPath, {
                            ...estado,
                            last_success_by_disk: porDisco
                        });
                    }
                } finally {
                    try {
                        console.log("🔽 Tentando desmontar o HD externo...");
                        await this.montagemHD.desmontar();
                    } catch (err) {
                        console.log("⚠️ Falha ao desmontar HD:", err.message);
                    }
                }
            }

            if (!algumRodou) {
                console.log('ℹ️ Nenhum disco precisou executar backup nesta rodada.');
            }
        } catch (error) {
            console.log(`💥 ERRO NO PROCESSO DE BACKUP: ${error.message}`);
        } finally {
 	    console.log("🔚 Finalizando processo de backup...");

            this.emExecucao = false;
        }
    }

    /**
     * Gera relatório final
     */
    gerarRelatorioFinal(logger, resultados, arquivosLog) {
        const estatisticas = logger.getEstatisticas();
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 RELATÓRIO FINAL DE BACKUP');
        console.log('='.repeat(70));
        
        console.log(`📈 ESTATÍSTICAS GERAIS:`);
        console.log(`   📋 Total de arquivos: ${estatisticas.dados.total + estatisticas.vms.total}`);
        console.log(`   🔄 Arquivos copiados: ${estatisticas.dados.copiados + estatisticas.vms.copiados}`);
        console.log(`   ✅ Arquivos ignorados: ${estatisticas.dados.ignorados + estatisticas.vms.ignorados}`);
        console.log(`   ❌ Erros: ${estatisticas.dados.erros + estatisticas.vms.erros}`);
        
        console.log(`\n📂 BACKUP DE DADOS:`);
        console.log(`   📊 Arquivos: ${estatisticas.dados.total}`);
        console.log(`   🔄 Copiados: ${estatisticas.dados.copiados}`);
        console.log(`   ✅ Ignorados: ${estatisticas.dados.ignorados}`);
        console.log(`   ❌ Erros: ${estatisticas.dados.erros}`);
        console.log(`   📈 Status: ${resultados.dados ? 'SUCESSO' : 'FALHA'}`);
        
        console.log(`\n🖥️  BACKUP DE VMs:`);
        console.log(`   📊 Arquivos: ${estatisticas.vms.total}`);
        console.log(`   🔄 Copiados: ${estatisticas.vms.copiados}`);
        console.log(`   ✅ Ignorados: ${estatisticas.vms.ignorados}`);
        console.log(`   ❌ Erros: ${estatisticas.vms.erros}`);
        console.log(`   📈 Status: ${resultados.vms ? 'SUCESSO' : 'FALHA'}`);
        
        console.log(`\n⏱️  DURAÇÃO TOTAL: ${(new Date() - logger.startTime) / 1000} segundos`);
        console.log(`📄 Log consolidado: ${arquivosLog?.consolidado ? path.basename(arquivosLog.consolidado) : 'não alterado nesta execução'}`);
        console.log('='.repeat(70));
    }

    /**
     * Inicia agendamento automático
     */
    iniciar() {
        console.log('💾 SISTEMA DE BACKUP MULTI-DIRETÓRIO INICIADO');
        console.log(`⏰ Verificando a cada ${config.CHECK_INTERVAL / 1000} segundos`);
        console.log(`📂 Diretórios monitorados:`);
        console.log(`   📁 Dados: ${config.BACKUP_DADOS.ORIGEM} → ${config.BACKUP_DADOS.DESTINO}`);
        console.log(`   🖥️  VMs: ${config.BACKUP_VMS.ORIGEM} → ${config.BACKUP_VMS.DESTINO}`);
        console.log('🚀 Use PM2 para gerenciar o processo: pm2 start agendamento.js --name backup-system');

        // Executa imediatamente
        this.executarBackupCompleto();

        // Agenda execuções periódicas
        setInterval(() => {
            this.executarBackupCompleto();
        }, config.CHECK_INTERVAL);
    }
}

module.exports = AgendamentoBackup;
