/**
 * ESTADO PERSISTENTE DO BACKUP
 * Usado para evitar re-execucoes no mesmo dia e para detectar pendencias sem montar o HD.
 */

const fs = require('fs-extra');
const path = require('path');

function getDataHoje() {
    // YYYY-MM-DD no timezone local
    return new Date()
        .toLocaleDateString('pt-BR')
        .split('/')
        .reverse()
        .join('-');
}

async function carregarEstado(estadoPath) {
    try {
        if (!estadoPath) return {};
        if (!await fs.pathExists(estadoPath)) return {};
        const data = await fs.readJson(estadoPath);
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

async function salvarEstado(estadoPath, estado) {
    if (!estadoPath) return;
    await fs.ensureDir(path.dirname(estadoPath));
    await fs.writeJson(estadoPath, estado || {}, { spaces: 2 });
}

module.exports = {
    getDataHoje,
    carregarEstado,
    salvarEstado
};

