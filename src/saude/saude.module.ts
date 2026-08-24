import { Module } from '@nestjs/common';
import { GoogleModule } from '../integrations/google/google.module';
import { InstagramModule } from '../integrations/instagram/instagram.module';
import { ValidadorConexoesService } from './validador-conexoes.service';

/**
 * Saude das credenciais conectadas.
 *
 * Modulo proprio, e nao dentro de Connections ou de Reports, porque tem DOIS
 * consumidores com necessidades opostas: a tela de integracoes (sob demanda,
 * responde ao cliente) e a checagem diaria (agendada, avisa voce). Morando
 * sozinho, nenhum dos dois precisa importar o outro.
 */
@Module({
  imports: [GoogleModule, InstagramModule],
  providers: [ValidadorConexoesService],
  exports: [ValidadorConexoesService],
})
export class SaudeModule {}
