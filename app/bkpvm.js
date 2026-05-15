/**
 * SISTEMA DE BACKUP DE VMs COM RETENÇÃO
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const GestorRetencao = require('./retencao');
const { sendToZabbix } = require('./zabbix');

class BackupVMs {
    constructor(config, logger) {
        // Configuração padrão de VMs e referência ao config geral
        this.config = config.BACKUP_VMS;
        this.configGeral = config;
        this.logger = logger;

        // Mantém as opções de retenção padrão para poder restaurar se necessário
        this.retentaoDefault = { ...this.config.RETENCAO };
        this.gestorRetencao = new GestorRetencao(this.config.RETENCAO, logger, 'vms');
    }

    atualizarRetencao(retencaoConfig) {
        // Atualiza apenas a retenção de VMs para este disco específico
        this.config.RETENCAO = {
            ...this.retentaoDefault,
            ...(retencaoConfig || {})
        };
        this.gestorRetencao = new GestorRetencao(this.config.RETENCAO, this.logger, 'vms');
    }

    /**
     * Formata tamanho em bytes
     */
    formatarTamanho(bytes) {
        const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
        let tamanho = bytes;
        let unidadeIndex = 0;
        
        while (tamanho >= 1024 && unidadeIndex < unidades.length - 1) {
            tamanho /= 1024;
            unidadeIndex++;
        }
        
        return `${tamanho.toFixed(2)} ${unidades[unidadeIndex]}`;
    }

    /**
     * Calcula hash do arquivo (otimizado para VMs grandes)
     */
    async calcularHashArquivo(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stats = fs.statSync(filePath);
            const usarHashParcial = stats.size > this.config.TAMANHO_MAX_HASH_COMPLETO;
            
            const stream = fs.createReadStream(filePath, 
                usarHashParcial ? { start: 0, end: this.configGeral.TAMANHO_BLOCO_HASH - 1 } : {}
            );
            
            stream.on('error', reject);
            stream.on('data', chunk => hash.update(chunk));
            
            stream.on('end', async () => {
                if (usarHashParcial) {
                    try {
                        const endStream = fs.createReadStream(filePath, { 
                            start: Math.max(0, stats.size - this.configGeral.TAMANHO_BLOCO_HASH), 
                            end: stats.size 
                        });
                        
                        endStream.on('data', chunk => hash.update(chunk));
                        endStream.on('end', () => resolve(hash.digest('hex')));
                        endStream.on('error', reject);
                    } catch (error) {
                        reject(error);
                    }
                } else {
                    resolve(hash.digest('hex'));
                }
            });
        });
    }

    /**
     * Copia arquivo com verificação
     */
    async copiarArquivoComVerificacao(srcPath, destPath, origemBase) {
        try {
            const statsSrc = await fs.stat(srcPath);
            const tamanhoSrc = this.formatarTamanho(statsSrc.size);
            const nomeRelativo = path.relative(origemBase, srcPath);
	  
	    // Se o arquivo existir não faz a verificação
	    if (!this.configGeral.VERIFICAR_HASH && await fs.pathExists(destPath)) {
		console.log(`⏩ [VMS] Pulando: ${nomeRelativo} (já existente no destino)`);
		return;
	    }

            
            console.log(`📄 [VMS] Processando: ${nomeRelativo}`);
            
            const hashSrc = await this.calcularHashArquivo(srcPath);
            let copiaNecessaria = true;
            let status = '';

            if (await fs.pathExists(destPath)) {
                const hashDest = await this.calcularHashArquivo(destPath);
                const statsDest = await fs.stat(destPath);
                
                if (hashDest === hashSrc && statsSrc.size === statsDest.size) {
                    copiaNecessaria = false;
                    status = 'Arquivo já existente e integridade confirmada';
                } else {
                    status = 'Arquivo diferente detectado, será sobrescrito';
                }
            } else {
                status = 'Novo arquivo, será copiado';
            }

            if (copiaNecessaria) {
                console.log(`   🔄 [VMS] Copiando...`);
                await fs.copy(srcPath, destPath);
                
                const statsDest = await fs.stat(destPath);
                const hashDest = await this.calcularHashArquivo(destPath);
                const tamanhoDest = this.formatarTamanho(statsDest.size);
                
                if (hashDest === hashSrc && statsSrc.size === statsDest.size) {
                    status = 'Arquivo copiado e conferido: hash OK, tamanho OK';
                    console.log(`   ✅ [VMS] ${status}`);
                } else {
                    status = 'ERRO: Verificação pós-cópia falhou';
                    console.log(`   ❌ [VMS] ${status}`);
                }
                
                this.logger.addLogEntry('vms', nomeRelativo, hashSrc, tamanhoSrc, hashDest, tamanhoDest, status);
            } else {
                this.logger.addLogEntry('vms', nomeRelativo, hashSrc, tamanhoSrc, hashSrc, tamanhoSrc, status);
                console.log(`   ✅ [VMS] ${status}`);
            }

        } catch (error) {
            const errorMessage = `Erro na cópia: ${error.message}`;
            const nomeRelativo = path.relative(this.config.ORIGEM, srcPath);
            
            this.logger.addLogEntry('vms', nomeRelativo, 'ERRO', 'ERRO', 'ERRO', 'ERRO', errorMessage);
            console.log(`❌ [VMS] ${nomeRelativo} - ${errorMessage}`);
        }
    }

    /**
     * Copia diretório recursivamente
     */
    async copiarDiretorioRecursivo(srcDir, destDir, options = {}) {
        if (!await fs.pathExists(srcDir)) {
            console.log(`⚠️  Diretório de VMs não encontrado: ${srcDir}`);
            return;
        }
        
        await fs.ensureDir(destDir);
        const itens = await fs.readdir(srcDir);
        
        for (const item of itens) {
            const srcPath = path.join(srcDir, item);
            const destPath = path.join(destDir, item);
            
            try {
                const stats = await fs.stat(srcPath);
                if (stats.isDirectory()) {
                    await this.copiarDiretorioRecursivo(srcPath, destPath, options);
                } else {
                    const exts = this.config.EXTENSOES_PERMITIDAS;
                    if (Array.isArray(exts) && exts.length) {
                        const nomeLower = item.toLowerCase();
                        const permitido = exts.some(e => {
                            if (typeof e !== 'string') return false;
                            const suf = e.trim().toLowerCase();
                            if (!suf) return false;
                            const sufNorm = suf.startsWith('.') ? suf : `.${suf}`;
                            return nomeLower.endsWith(sufNorm) || nomeLower.endsWith(suf);
                        });

                        if (!permitido) {
                            continue;
                        }
                    }

                    if (Number.isFinite(options.onlyNewerThanMs) && stats.mtimeMs <= options.onlyNewerThanMs) {
                        // Arquivo antigo: nao toca no destino (HD) nesta execucao.
                        continue;
                    }
                    await this.copiarArquivoComVerificacao(srcPath, destPath, srcDir);
                }
            } catch (error) {
                console.log(`❌ [VMS] Erro ao processar ${srcPath}: ${error.message}`);
            }
        }
    }

    /**
     * Executa backup completo de VMs com retenção
     */
    async executar(options = {}) {
        if (!this.config.ATIVO) {
            console.log('⚙️  Backup de VMs desativado na configuração');
            return true;
        }

        console.log(`\n🖥️  INICIANDO BACKUP DE VMs`);
        console.log(`   📝 ${this.config.DESCRICAO}`);
        console.log(`   📁 Origem: ${this.config.ORIGEM}`);
        console.log(`   💾 Destino: ${this.config.DESTINO}`);
        console.log(`   ⏰ Início: ${new Date().toISOString()}`);
        
        // Aplica retenção antes do backup
        await this.gestorRetencao.aplicar(this.config.DESTINO);
        
        console.log('-'.repeat(50));

	sendToZabbix("init.backup.vms", 0)

        try {
            await this.copiarDiretorioRecursivo(this.config.ORIGEM, this.config.DESTINO, options);
            console.log(`✅ BACKUP DE VMs FINALIZADO`);
	    sendToZabbix("init.backup.vms", 1)
	    sendToZabbix("falha.backup.vms", 0)

            return true;
        } catch (error) {
            console.log(`❌ ERRO NO BACKUP DE VMs: ${error.message}`);
	    sendToZabbix("falha.backup.vms", 1)
            return false;
        }
    }
}

module.exports = BackupVMs;
