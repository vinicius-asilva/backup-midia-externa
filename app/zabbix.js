// utils/zabbix.js
const { exec } = require("child_process");

function sendToZabbix(key, value) {
  const ZBX_SERVER = process.env.ZABBIX_SERVER || "192.168.0.202"; // IP ou hostname do seu Zabbix Server
  const ZBX_HOST = process.env.ZABBIX_HOST || "pve";             // Nome EXATO do host cadastrado no Zabbix
  const cmd = `/usr/bin/zabbix_sender -z ${ZBX_SERVER} -s "${ZBX_HOST}" -k ${key} -o ${value}`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Zabbix Sender] Erro ao enviar ${key}:`, stderr.trim());
    } else {
      console.log(`[Zabbix Sender] Enviado: ${key}=${value}`);
    }
  });
}

module.exports = { sendToZabbix };

