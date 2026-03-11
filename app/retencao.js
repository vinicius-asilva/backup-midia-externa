/**
 * POLÍTICA DE RETENÇÃO DE BACKUPS
 */

const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Defaults internos de segurança
 */
const DEFAULTS = {
    MIN_BACKUPS_PRESERVADOS: 2,       // qtde de backups que sempre vai ter no diretorio
    NAO_EXCLUIR_MENOS_QUE_DIAS: 5,     // nunca ira deletar arquivos copiados a menos de 5 dias
    MODO_DRY_RUN: false               // true = apenas simula
};

class GestorRetencao {

    constructor(configRetencao, logger, tipo) {

        this.logger = logger;
        this.tipo = tipo;

        this.config = {
            ...DEFAULTS,
            ...configRetencao
        };
    }

    /**
     * Verifica espaço livre em disco (bytes)
     */
    async verificarEspacoDisco(diretorio) {
        try {
            const { stdout } = await execAsync(`df -k "${diretorio}" | tail -1`);
            const [, , usado, disponivel] = stdout.trim().split(/\s+/);

            return {
                livre: parseInt(disponivel, 10) * 1024,
                usado: parseInt(usado, 10) * 1024
            };
        } catch {
            return { livre: 0, usado: 0 };
        }
    }

    /**
     * Lista backups ordenados do MAIS ANTIGO para o MAIS NOVO
     */
    async listarBackups(diretorio) {

        const arquivos = await fs.readdir(diretorio);
        const backups = [];

        for (const nome of arquivos) {
            const caminho = path.join(diretorio, nome);

            try {
                const stats = await fs.stat(caminho);
                if (!stats.isFile() || nome.endsWith('.json')) continue;

                const idadeDias = Math.floor(
                    (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24)
                );

                backups.push({
                    nome,
                    caminho,
                    tamanho: stats.size,
                    idadeDias,
                    mtime: stats.mtime
                });

            } catch {
                continue;
            }
        }

        return backups.sort((a, b) => a.mtime - b.mtime);
    }

    /**
     * Aplica política de retenção
     */
    async aplicar(diretorioBackups) {

        const relatorio = {
            excluidos: 0,
            espacoLiberado: 0,
            arquivos: []
        };

        if (!this.config.EXCLUIR_ANTIGOS) {
            return relatorio;
        }

        const espacoDisco = await this.verificarEspacoDisco(diretorioBackups);
        let espacoLivreAtual = espacoDisco.livre;

        const backups = await this.listarBackups(diretorioBackups);

        if (backups.length === 0) return relatorio;

        const paraExcluir = [];

        /**
         * EXCLUSÃO POR IDADE
         */
        for (const bkp of backups) {

            if (bkp.idadeDias <= this.config.NAO_EXCLUIR_MENOS_QUE_DIAS) {
                continue;
            }

            if (bkp.idadeDias > this.config.DIAS) {
                paraExcluir.push(bkp);
                espacoLivreAtual += bkp.tamanho;
            }
        }

        /**
         *  EXCLUSÃO POR ESPAÇO (SE NECESSÁRIO)
         */
        let espacoNecessario =
            this.config.ESPACO_MINIMO - espacoLivreAtual;

        if (espacoNecessario > 0) {

            for (const bkp of backups) {

                if (paraExcluir.includes(bkp)) continue;

                if (bkp.idadeDias <= this.config.NAO_EXCLUIR_MENOS_QUE_DIAS) {
                    continue;
                }

                if ((backups.length - paraExcluir.length)
                    <= this.config.MIN_BACKUPS_PRESERVADOS) {
                    break;
                }

                paraExcluir.push(bkp);
                espacoNecessario -= bkp.tamanho;

                if (espacoNecessario <= 0) break;
            }
        }

        /**
         *  EXECUTAR EXCLUSÕES
         */
        for (const bkp of paraExcluir) {

            if (this.config.MODO_DRY_RUN) {
                continue;
            }

            try {
                await fs.remove(bkp.caminho);

                relatorio.excluidos++;
                relatorio.espacoLiberado += bkp.tamanho;
                relatorio.arquivos.push({
                    nome: bkp.nome,
                    idadeDias: bkp.idadeDias,
                    tamanho: bkp.tamanho
                });

                if (this.logger) {
                    this.logger.addLogEntry(
                        this.tipo,
                        'RETENCAO',
                        bkp.nome,
                        `${(bkp.tamanho / (1024 ** 3)).toFixed(2)} GB`,
                        'EXCLUIDO',
                        'N/A',
                        `Backup removido por retenção`
                    );
                }

            } catch { }
        }

        return relatorio;
    }
}

module.exports = GestorRetencao;
