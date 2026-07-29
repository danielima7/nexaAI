import { Logger } from '@nestjs/common';

/**
 * Silencia os logs do Nest durante os testes.
 *
 * Varios services logam por design (auditoria, avisos de configuracao). Nos
 * testes isso enterra o resultado real do Jest em centenas de linhas de log e
 * torna impossivel ver qual asercao falhou.
 */
Logger.overrideLogger(false);
