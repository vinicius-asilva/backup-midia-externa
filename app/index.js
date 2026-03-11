/**
 * ARQUIVO PRINCIPAL - SISTEMA DE BACKUP
 * Ponto de entrada da aplicação
 */

const AgendamentoBackup = require('./agendamento');

// Inicializa e inicia o sistema
const agendamento = new AgendamentoBackup();
agendamento.iniciar();

// Manipulação de sinais para graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔚 Recebido SIGINT, encerrando sistema de backup...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔚 Recebido SIGTERM, encerrando sistema de backup...');
    process.exit(0);
});

// Export para uso com PM2
module.exports = agendamento

