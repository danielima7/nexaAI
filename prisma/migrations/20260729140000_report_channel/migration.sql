-- Canal de entrega do resumo diario.
-- Padrao "email": nao depende de aprovacao de plataforma (o WhatsApp esta banido).
ALTER TABLE "ReportSchedule" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'email';
ALTER TABLE "ReportSchedule" ADD COLUMN "emailTo" TEXT;
