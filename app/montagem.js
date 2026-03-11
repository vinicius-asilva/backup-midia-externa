/**
 * SISTEMA DE MONTAGEM DE HD VIA UUID
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs-extra');
const execAsync = promisify(exec);

class MontagemHD {
    constructor(config) {
        this.config = config;
        this.uuidMontado = null;
        this.aliasMontado = null;
    }

    normalizarDisco(entry) {
        if (typeof entry === 'string' && entry.trim()) {
            return { uuid: entry.trim(), alias: null };
        }

        if (entry && typeof entry === 'object') {
            const uuid = typeof entry.uuid === 'string' ? entry.uuid.trim() : '';
            const alias = typeof entry.alias === 'string' ? entry.alias.trim() : '';
            if (!uuid) return null;
            return { uuid, alias: alias || null };
        }

        return null;
    }

    getDiscosConfigurados() {
        const lista = [];
        const adicionados = new Set();

        if (Array.isArray(this.config.UUIDS_HD_EXTERNOS)) {
            for (const e of this.config.UUIDS_HD_EXTERNOS) {
                const disco = this.normalizarDisco(e);
                if (!disco) continue;
                if (adicionados.has(disco.uuid)) continue;
                adicionados.add(disco.uuid);
                lista.push(disco);
            }
        }

        if (typeof this.config.UUID_HD_EXTERNO === 'string' && this.config.UUID_HD_EXTERNO.trim()) {
            const uuid = this.config.UUID_HD_EXTERNO.trim();
            if (!adicionados.has(uuid)) {
                adicionados.add(uuid);
                lista.push({ uuid, alias: null });
            }
        }

        return lista;
    }

    /**
     * Verifica se o HD externo está montado
     */
    async verificarMontagem() {
        try {
            await fs.access(this.config.DESTINO_BASE);
            const { stdout } = await execAsync(`mount | grep "${this.config.DESTINO_BASE}"`);
            const estaMontado = stdout.includes(this.config.DESTINO_BASE);
            
            console.log(`📌 Status montagem: ${estaMontado ? 'MONTADO' : 'NÃO MONTADO'}`);
            return estaMontado;
            
        } catch (error) {
            console.log(`📌 Status montagem: NÃO MONTADO (${error.message})`);
            return false;
        }
    }

    /**
     * Monta o HD externo usando UUID
     */
    async montarDisco(disco) {
        const uuid = disco?.uuid;
        const alias = disco?.alias || null;

        try {
            const comandoMontagem = `mount UUID=${uuid} ${this.config.DESTINO_BASE}`;
            await execAsync(comandoMontagem);
            this.uuidMontado = uuid;
            this.aliasMontado = alias;
            this.config.UUID_HD_EXTERNO_ATUAL = uuid;
            this.config.ALIAS_HD_EXTERNO_ATUAL = alias;
            console.log(`✅ HD externo montado com sucesso via UUID: ${uuid}${alias ? ` (${alias})` : ''}`);
            return true;
        } catch (error) {
            console.log(`⚠️ Falha ao montar UUID ${uuid}${alias ? ` (${alias})` : ''}: ${error.message}`);
            return false;
        }
    }

    async montar() {
        const discos = this.getDiscosConfigurados();

        if (discos.length === 0) {
            console.log('❌ Nenhum UUID de HD externo configurado (UUID_HD_EXTERNO/UUIDS_HD_EXTERNOS).');
            return false;
        }

        console.log(`🔧 Tentando montar HD externo...`);
        console.log(`   UUIDs: ${discos.map(d => d.uuid).join(', ')}`);
        console.log(`   Destino: ${this.config.DESTINO_BASE}`);

        await fs.ensureDir(this.config.DESTINO_BASE);

        for (const disco of discos) {
            if (await this.montarDisco(disco)) return true;
        }

        console.log(`❌ Erro ao montar HD externo: nenhum dos UUIDs respondeu`);
        return false;
    }

    /**
     * Desmonta o HD externo
     */
    async desmontar() {
        try {
            console.log(`🔧 Desmontando HD externo...`);
            await execAsync(`umount ${this.config.DESTINO_BASE}`);
            console.log(`✅ HD externo desmontado com sucesso`);
            this.uuidMontado = null;
            this.aliasMontado = null;
            this.config.UUID_HD_EXTERNO_ATUAL = null;
            this.config.ALIAS_HD_EXTERNO_ATUAL = null;
            return true;
        } catch (error) {
            console.log(`❌ Erro ao desmontar HD: ${error.message}`);
            return false;
        }
    }

    /**
     * Verifica e monta o HD se necessário
     */
    async prepararHD() {
        const estaMontado = await this.verificarMontagem();
        
        if (!estaMontado) {
            console.log(`🔧 HD não montado, tentando montagem automática...`);
            return await this.montar();
        }
        
        return true;
    }
}

module.exports = MontagemHD
