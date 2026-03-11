/**
 * SISTEMA DE BACKUP DE DADOS
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { sendToZabbix } = require("./zabbix");

class BackupDados {
    constructor(config, logger) {
        this.config = config.BACKUP_DADOS;
        this.configGeral = config;
        this.logger = logger;
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
     * Calcula hash do arquivo
     */
    async calcularHashArquivo(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stats = fs.statSync(filePath);
            const usarHashParcial = stats.size > this.configGeral.TAMANHO_MAX_HASH_COMPLETO;
            
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

	    // Se o arquivo existe não verifica

	//	if (!this.configGeral.VERIFICAR_HASH && await fs.pathExists(destPath)) {
	//	     console.log(`⏩ [DADOS] Pulando: ${nomeRelativo} (já existente no destino)`);
	//  	return;
	//   }
            
            console.log(`📄 [DADOS] Processando: ${nomeRelativo}`);
            
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
                console.log(`   🔄 [DADOS] Copiando...`);
                await fs.copy(srcPath, destPath);
                
                const statsDest = await fs.stat(destPath);
                const hashDest = await this.calcularHashArquivo(destPath);
                const tamanhoDest = this.formatarTamanho(statsDest.size);
                
                if (hashDest === hashSrc && statsSrc.size === statsDest.size) {
                    status = 'Arquivo copiado e conferido: hash OK, tamanho OK';
                    console.log(`   ✅ [DADOS] ${status}`);
                } else {
                    status = 'ERRO: Verificação pós-cópia falhou';
                    console.log(`   ❌ [DADOS] ${status}`);
                }
                
                this.logger.addLogEntry('dados', nomeRelativo, hashSrc, tamanhoSrc, hashDest, tamanhoDest, status);
            } else {
                this.logger.addLogEntry('dados', nomeRelativo, hashSrc, tamanhoSrc, hashSrc, tamanhoSrc, status);
                console.log(`   ✅ [DADOS] ${status}`);
            }

        } catch (error) {
            const errorMessage = `Erro na cópia: ${error.message}`;
            const nomeRelativo = path.relative(this.config.ORIGEM, srcPath);
            
            this.logger.addLogEntry('dados', nomeRelativo, 'ERRO', 'ERRO', 'ERRO', 'ERRO', errorMessage);
            console.log(`❌ [DADOS] ${nomeRelativo} - ${errorMessage}`);
        }
    }

    /**
     * Copia diretório recursivamente
     */
    async copiarDiretorioRecursivo(srcDir, destDir, options = {}) {
        if (!await fs.pathExists(srcDir)) {
            console.log(`⚠️  Diretório de dados não encontrado: ${srcDir}`);
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
                    if (Number.isFinite(options.onlyNewerThanMs) && stats.mtimeMs <= options.onlyNewerThanMs) {
                        // Arquivo antigo: nao toca no destino (HD) nesta execucao.
                        continue;
                    }
                    await this.copiarArquivoComVerificacao(srcPath, destPath, srcDir);
                }
            } catch (error) {
                console.log(`❌ [DADOS] Erro ao processar ${srcPath}: ${error.message}`);
            }
        }
    }

    /**
     * Executa backup completo de dados
     */
    async executar(options = {}) {
        if (!this.config.ATIVO) {
            console.log('⚙️  Backup de dados desativado na configuração');
            return true;
        }

        console.log(`\n📂 INICIANDO BACKUP DE DADOS`);
        console.log(`   📝 ${this.config.DESCRICAO}`);
        console.log(`   📁 Origem: ${this.config.ORIGEM}`);
        console.log(`   💾 Destino: ${this.config.DESTINO}`);
        console.log(`   ⏰ Início: ${new Date().toISOString()}`);
        console.log('-'.repeat(50));

	sendToZabbix("init.backup.dados", 0);

        try {
            await this.copiarDiretorioRecursivo(this.config.ORIGEM, this.config.DESTINO, options);
            console.log(`✅ BACKUP DE DADOS FINALIZADO`);
	    sendToZabbix("init.backup.dados", 1);
	    sendToZabbix("falha.backup.dados", 0);
            return true;
        } catch (error) {
            console.log(`❌ ERRO NO BACKUP DE DADOS: ${error.message}`);
	    console.error(error)
	    sendToZabbix("falha.backup.dados", 1)
            return false;
        } finally {
	    console.log(`[DEBUG] retorno do executar() concluido`);
	}
    }
}

module.exports = BackupDados;
